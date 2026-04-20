const express = require("express");
const pool = require("../db");
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { tableExists, getColumns } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { convertQuantity } = require("../utils/unitConversion");
const { writeInventoryMovement } = require("../utils/inventoryMovements");

const router = express.Router();

const round2 = (num) => Number(Number(num || 0).toFixed(2));
const MAX_NOTES_LENGTH = 500;
const REPORT_TIMEZONE = "Asia/Manila";
const ORDER_TYPES = new Set(["DINE_IN", "TAKEOUT", "DELIVERY"]);

router.use(requireAuth, requireAnyRole(["OWNER", "CASHIER"]));

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function dateKeyInTimezone(value, timeZone = REPORT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

function buildSaleDate(value) {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    // Keep the selected Manila date while using the actual current Manila time of entry.
    const nowParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: REPORT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const timeMap = nowParts.reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    const hh = timeMap.hour || "12";
    const mm = timeMap.minute || "00";
    const ss = timeMap.second || "00";
    return new Date(`${value}T${hh}:${mm}:${ss}+08:00`);
  }
  return new Date(value);
}

function isTakeoutContainerCategory(category) {
  const normalized = String(category || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return normalized === "TAKE OUT CONTAINERS" || normalized === "TAKEOUT CONTAINERS" || normalized.includes("CONTAINER");
}

function supportsContainerCharge(orderType) {
  return orderType === "TAKEOUT" || orderType === "DELIVERY";
}

async function getSalesDayClosure(connOrPool, saleDate) {
  if (!(await tableExists("sales_day_closures"))) return null;
  const [[closure]] = await connOrPool.query(
    `SELECT sdc.sale_date, sdc.closed_at, sdc.total_revenue, sdc.total_transactions, sdc.closed_by_user_id,
            u.full_name AS closed_by_name
       FROM sales_day_closures sdc
       LEFT JOIN users u ON u.id = sdc.closed_by_user_id
      WHERE sdc.sale_date = ?`,
    [saleDate]
  );
  return closure || null;
}

async function syncSalesDayClosure(conn, saleDate) {
  const existingClosure = await getSalesDayClosure(conn, saleDate);
  if (!existingClosure) return null;

  const [completedRows] = await conn.query(
    `SELECT sale_datetime, net_amount
       FROM sales_transactions
      WHERE status = 'COMPLETED'`
  );
  const totals = completedRows.reduce(
    (acc, row) => {
      if (dateKeyInTimezone(row.sale_datetime) === saleDate) {
        acc.total_transactions += 1;
        acc.total_revenue = round2(acc.total_revenue + Number(row.net_amount || 0));
      }
      return acc;
    },
    { total_transactions: 0, total_revenue: 0 }
  );

  await conn.query(
    `UPDATE sales_day_closures
        SET total_revenue = ?, total_transactions = ?
      WHERE sale_date = ?`,
    [round2(totals.total_revenue), Number(totals.total_transactions || 0), saleDate]
  );

  return totals;
}

async function buildInventoryUsageForMenuItem(conn, menuItemId, saleQty) {
  const [[menuRow]] = await conn.query(
    `SELECT m.id, m.menu_name, m.recipe_version_id, rv.yield_amount, rv.portion_size
       FROM menu_items m
       LEFT JOIN recipe_versions rv ON rv.id = m.recipe_version_id
      WHERE m.id = ?`,
    [menuItemId]
  );
  if (!menuRow) throw new Error(`Menu item ${menuItemId} was not found.`);
  if (!menuRow.recipe_version_id) {
    throw new Error(`Menu item ${menuRow.menu_name} has no recipe linked, so inventory usage cannot be calculated.`);
  }

  const [recipeLines] = await conn.query(
    `SELECT ri.ingredient_id, ri.qty_used, ri.qty_unit, i.ingredient_name, i.base_unit, i.quantity
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_version_id = ?`,
    [menuRow.recipe_version_id]
  );
  if (!recipeLines.length) {
    throw new Error(`Menu item ${menuRow.menu_name} has an empty recipe, so inventory usage cannot be calculated.`);
  }

  const yieldAmount = Number(menuRow.yield_amount || 0);
  const portionSize = Number(menuRow.portion_size || 0);
  const portionsPerBatch = yieldAmount > 0 && portionSize > 0 ? yieldAmount / portionSize : 1;
  const batchFactor = saleQty / (portionsPerBatch > 0 ? portionsPerBatch : 1);

  return recipeLines.map((line) => {
    const baseQty = convertQuantity(Number(line.qty_used || 0), line.qty_unit, line.base_unit);
    if (!Number.isFinite(baseQty)) {
      throw new Error(
        `Recipe line for ${line.ingredient_name} uses ${line.qty_unit}, which cannot be converted to the ingredient base unit ${line.base_unit}.`
      );
    }
    return {
      ingredientId: line.ingredient_id,
      ingredientName: line.ingredient_name,
      baseUnit: line.base_unit,
      currentStock: Number(line.quantity || 0),
      qtyUsedBaseUnit: round2(baseQty * batchFactor),
    };
  });
}

router.get("/", async (_req, res) => {
  try {
    if (!(await tableExists("sales_transactions")) || !(await tableExists("sales_items"))) {
      const selectedDate = String(_req.query.date || "").trim();
      const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : dateKeyInTimezone(new Date());
      return res.json({
        summary: { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0, selectedDayRevenue: 0, selectedDayTransactions: 0 },
        items: [],
        breakdown: [],
        dayStatus: {
          saleDate: reportDate,
          isClosed: false,
          closedAt: null,
          closedByName: null,
          totalRevenue: 0,
          totalTransactions: 0,
        },
      });
    }

    const salesTxCols = await getColumns("sales_transactions");
    const guestNameSelect = salesTxCols.guest_name ? "st.guest_name" : "NULL AS guest_name";
    const orderTypeSelect = salesTxCols.order_type ? "st.order_type" : "'DINE_IN' AS order_type";
    const [transactions] = await pool.query(
      `SELECT st.id, st.sale_datetime, st.net_amount, st.status, st.notes, st.cashier_user_id,
              ${guestNameSelect},
              ${orderTypeSelect},
              COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(u.username), ''), CONCAT('User #', st.cashier_user_id)) AS cashier_name,
              COUNT(si.id) AS line_count
         FROM sales_transactions st
         LEFT JOIN users u ON u.id = st.cashier_user_id
         LEFT JOIN sales_items si ON si.sales_transaction_id = st.id
        GROUP BY st.id
        ORDER BY st.sale_datetime DESC, st.id DESC`
    );

    const selectedDate = String(_req.query.date || "").trim();
    const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : dateKeyInTimezone(new Date());
    const todayKey = dateKeyInTimezone(new Date());
    const reportDateTransactions = transactions.filter((row) => {
      const key = row.sale_datetime ? dateKeyInTimezone(row.sale_datetime) : "";
      return key === reportDate;
    });
    const selectedCompletedTransactionIds = reportDateTransactions
      .filter((row) => row.status === "COMPLETED")
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const [breakdown] = selectedCompletedTransactionIds.length
      ? await pool.query(
          `SELECT mi.id AS menu_item_id,
                  mi.menu_name,
                  ROUND(SUM(si.qty), 2) AS quantity_sold,
                  ROUND(SUM(si.line_total), 2) AS revenue
             FROM sales_items si
             JOIN menu_items mi ON mi.id = si.menu_item_id
            WHERE si.sales_transaction_id IN (?)
            GROUP BY mi.id, mi.menu_name
            ORDER BY revenue DESC, mi.menu_name ASC`,
          [selectedCompletedTransactionIds]
        )
      : [[]];
    const completed = transactions.filter((row) => row.status === "COMPLETED");
    const totalRevenue = round2(completed.reduce((sum, row) => sum + Number(row.net_amount || 0), 0));
    const todayRevenue = round2(
      completed.reduce((sum, row) => {
        const key = row.sale_datetime ? dateKeyInTimezone(row.sale_datetime) : "";
        return key === todayKey ? sum + Number(row.net_amount || 0) : sum;
      }, 0)
    );
    const selectedDayTransactions = reportDateTransactions.filter((row) => row.status === "COMPLETED");
    const selectedDayRevenue = round2(
      selectedDayTransactions.reduce((sum, row) => sum + Number(row.net_amount || 0), 0)
    );
    const dayStatus = await getSalesDayClosure(pool, reportDate);

    res.json({
      summary: {
        totalRevenue,
        totalTransactions: completed.length,
        todayRevenue,
        selectedDayRevenue,
        selectedDayTransactions: selectedDayTransactions.length,
      },
      items: reportDateTransactions,
      breakdown,
      dayStatus: {
        saleDate: reportDate,
        isClosed: Boolean(dayStatus),
        closedAt: dayStatus?.closed_at || null,
        closedByName: dayStatus?.closed_by_name || null,
        totalRevenue: Number(dayStatus?.total_revenue || selectedDayRevenue || 0),
        totalTransactions: Number(dayStatus?.total_transactions || selectedDayTransactions.length || 0),
      },
    });
  } catch (err) {
    console.error("GET /sales failed:", err.message);
    res.status(500).json({ message: "Failed to fetch sales" });
  }
});

router.post("/", async (req, res) => {
  const notes = req.body.notes ? String(req.body.notes).trim() : null;
  const guestName = req.body.guestName ? String(req.body.guestName).trim() : null;
  const orderType = String(req.body.orderType || "DINE_IN").trim().toUpperCase();
  const saleItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (req.body.saleDate && !isValidDate(req.body.saleDate)) {
    return res.status(400).json({ message: "saleDate must be a valid date." });
  }
  const saleDate = buildSaleDate(req.body.saleDate);
  const saleDateKey = dateKeyInTimezone(saleDate);
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    return res.status(400).json({ message: `notes must be ${MAX_NOTES_LENGTH} characters or fewer.` });
  }
  if (guestName && guestName.length > 120) {
    return res.status(400).json({ message: "guestName must be 120 characters or fewer." });
  }
  if (!ORDER_TYPES.has(orderType)) {
    return res.status(400).json({ message: "orderType must be DINE_IN, TAKEOUT, or DELIVERY." });
  }

  if (!saleItems.length) {
    return res.status(400).json({ message: "At least one sale item is required." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const dayClosure = await getSalesDayClosure(conn, saleDateKey);
    if (dayClosure) {
      throw new Error(`Sales for ${saleDateKey} were already completed at ${dayClosure.closed_at}.`);
    }
    const salesTxCols = await getColumns("sales_transactions");
    const salesItemsCols = await getColumns("sales_items");

    const cleanedItems = [];
    for (const [index, item] of saleItems.entries()) {
      const menuItemId = Number(item.menuItemId);
      const qty = Number(item.quantity);
      const takeoutContainerIngredientId = Number(item.takeoutContainerIngredientId || 0);
      const takeoutContainerQty = Number(item.takeoutContainerQty || 0);
      const takeoutContainerUnitPrice = Number(item.takeoutContainerUnitPrice || 0);
      if (!Number.isFinite(menuItemId) || menuItemId <= 0) {
        throw new Error(`Sale item ${index + 1} is missing a menu item.`);
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Sale item ${index + 1} needs a quantity greater than 0.`);
      }

      const [[menuRow]] = await conn.query(
        `SELECT m.id, m.menu_name, ph.selling_price
           FROM menu_items m
           LEFT JOIN menu_price_history ph ON ph.id = (
             SELECT id
               FROM menu_price_history
              WHERE menu_item_id = m.id
              ORDER BY effective_date DESC, id DESC
              LIMIT 1
           )
          WHERE m.id = ?`,
        [menuItemId]
      );

      if (!menuRow) throw new Error(`Menu item ${menuItemId} was not found.`);
      if (!Number.isFinite(Number(menuRow.selling_price)) || Number(menuRow.selling_price) <= 0) {
        throw new Error(`Menu item ${menuRow.menu_name} does not have a valid current selling price.`);
      }

      const inventoryUsage = await buildInventoryUsageForMenuItem(conn, menuItemId, qty);
      let takeoutContainer = null;
      if (takeoutContainerIngredientId > 0) {
        if (!supportsContainerCharge(orderType)) {
          throw new Error(`Sale item ${index + 1} includes a takeout container, but the sale is not marked as TAKEOUT or DELIVERY.`);
        }
        if (!Number.isFinite(takeoutContainerQty) || takeoutContainerQty <= 0) {
          throw new Error(`Sale item ${index + 1} needs a valid takeout container quantity.`);
        }
        if (!Number.isFinite(takeoutContainerUnitPrice) || takeoutContainerUnitPrice < 0) {
          throw new Error(`Sale item ${index + 1} needs a valid takeout container unit price.`);
        }

        const [[containerRow]] = await conn.query(
          `SELECT id, ingredient_name, category, base_unit, quantity, current_ap_cost
             FROM ingredients
            WHERE id = ?`,
          [takeoutContainerIngredientId]
        );
        if (!containerRow) {
          throw new Error(`Takeout container for sale item ${index + 1} was not found.`);
        }
        if (!isTakeoutContainerCategory(containerRow.category)) {
          throw new Error(`${containerRow.ingredient_name} is not tagged as a takeout container in inventory.`);
        }

        const containerQtyUsed = round2(takeoutContainerQty);
        inventoryUsage.push({
          ingredientId: containerRow.id,
          ingredientName: containerRow.ingredient_name,
          baseUnit: containerRow.base_unit,
          currentStock: Number(containerRow.quantity || 0),
          qtyUsedBaseUnit: containerQtyUsed,
        });

        takeoutContainer = {
          ingredientId: containerRow.id,
          ingredientName: containerRow.ingredient_name,
          quantity: containerQtyUsed,
          unitPrice: round2(
            Number.isFinite(takeoutContainerUnitPrice) && takeoutContainerUnitPrice >= 0
              ? takeoutContainerUnitPrice
              : Number(containerRow.current_ap_cost || 0)
          ),
        };
        takeoutContainer.total = round2(takeoutContainer.quantity * takeoutContainer.unitPrice);
      }

      const unitPrice = round2(item.unitPrice ?? menuRow.selling_price ?? 0);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error(`Sale item ${index + 1} has an invalid unit price.`);
      }
      const lineTotal = round2(unitPrice * qty + Number(takeoutContainer?.total || 0));

      cleanedItems.push({
        menuItemId,
        menuName: menuRow.menu_name,
        quantity: qty,
        unitPrice,
        lineTotal,
        inventoryUsage,
        takeoutContainer,
      });
    }

    const inventoryTotals = cleanedItems.reduce((acc, item) => {
      item.inventoryUsage.forEach((usage) => {
        acc[usage.ingredientId] = acc[usage.ingredientId] || {
          ingredientName: usage.ingredientName,
          baseUnit: usage.baseUnit,
          qtyUsedBaseUnit: 0,
          currentStock: usage.currentStock,
        };
        acc[usage.ingredientId].qtyUsedBaseUnit = round2(acc[usage.ingredientId].qtyUsedBaseUnit + usage.qtyUsedBaseUnit);
      });
      return acc;
    }, {});

    Object.entries(inventoryTotals).forEach(([, usage]) => {
      if (usage.currentStock < usage.qtyUsedBaseUnit) {
        throw new Error(
          `Not enough stock for ${usage.ingredientName}. Need ${usage.qtyUsedBaseUnit.toFixed(2)} ${usage.baseUnit}, but only ${usage.currentStock.toFixed(2)} is available.`
        );
      }
    });

    const netAmount = round2(cleanedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const txFields = ["sale_datetime"];
    const txValues = [saleDate];
    if (salesTxCols.guest_name) {
      txFields.push("guest_name");
      txValues.push(guestName);
    }
    if (salesTxCols.order_type) {
      txFields.push("order_type");
      txValues.push(orderType);
    }
    txFields.push(
      "cashier_user_id",
      "gross_amount",
      "discount_amount",
      "net_amount",
      "payment_method",
      "status",
      "notes"
    );
    txValues.push(req.user?.id || null, netAmount, 0, netAmount, "CASH", "COMPLETED", notes);
    const [txResult] = await conn.query(
      `INSERT INTO sales_transactions (${txFields.join(", ")}) VALUES (${txFields.map(() => "?").join(", ")})`,
      txValues
    );

    const txId = txResult.insertId;
    const salesItemFields = ["sales_transaction_id", "menu_item_id", "qty", "unit_price", "line_total"];
    if (salesItemsCols.takeout_container_ingredient_id) salesItemFields.push("takeout_container_ingredient_id");
    if (salesItemsCols.takeout_container_qty) salesItemFields.push("takeout_container_qty");
    if (salesItemsCols.takeout_container_unit_price) salesItemFields.push("takeout_container_unit_price");
    if (salesItemsCols.takeout_container_total) salesItemFields.push("takeout_container_total");

    const rows = cleanedItems.map((item) => {
      const row = [txId, item.menuItemId, item.quantity, item.unitPrice, item.lineTotal];
      if (salesItemsCols.takeout_container_ingredient_id) row.push(item.takeoutContainer?.ingredientId || null);
      if (salesItemsCols.takeout_container_qty) row.push(item.takeoutContainer?.quantity || 0);
      if (salesItemsCols.takeout_container_unit_price) row.push(item.takeoutContainer?.unitPrice || 0);
      if (salesItemsCols.takeout_container_total) row.push(item.takeoutContainer?.total || 0);
      return row;
    });

    const [salesItemResult] = await conn.query(
      `INSERT INTO sales_items (${salesItemFields.join(", ")}) VALUES ?`,
      [rows]
    );

    const firstSalesItemId = salesItemResult.insertId;
    const usageRows = [];
    cleanedItems.forEach((item, index) => {
      const salesItemId = firstSalesItemId + index;
      item.inventoryUsage.forEach((usage) => {
        usageRows.push([salesItemId, usage.ingredientId, usage.qtyUsedBaseUnit, usage.baseUnit]);
      });
    });
    if (usageRows.length) {
      await conn.query(
        `INSERT INTO sales_item_inventory_usage
          (sales_item_id, ingredient_id, qty_used_base_unit, base_unit)
         VALUES ?`,
        [usageRows]
      );
    }

    const ingredientCols = await getColumns("ingredients");
    const decrementStockSql = ingredientCols.last_updated
      ? "UPDATE ingredients SET quantity = quantity - ?, last_updated = NOW() WHERE id=?"
      : "UPDATE ingredients SET quantity = quantity - ? WHERE id=?";
    for (const [ingredientId, usage] of Object.entries(inventoryTotals)) {
      await conn.query(decrementStockSql, [
        usage.qtyUsedBaseUnit,
        Number(ingredientId),
      ]);
      await writeInventoryMovement(
        {
          ingredient_id: Number(ingredientId),
          movement_type: "SALE_OUT",
          quantity_change: -usage.qtyUsedBaseUnit,
          resulting_quantity: Number(usage.currentStock || 0) - usage.qtyUsedBaseUnit,
          unit: usage.baseUnit || null,
          source_module: "SALES",
          reference_type: "sales_transaction",
          reference_id: txId,
          notes: `Sale #${txId} consumed inventory for ${usage.ingredientName}.`,
          created_by_user_id: req.user?.id || null,
        },
        conn
      );
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "SALES",
        action_name: "CREATE",
        entity_type: "sales_transaction",
        entity_id: txId,
        summary: `Recorded guest check ${txId} with ${cleanedItems.length} line item(s) totaling ${netAmount.toFixed(2)}.`,
        metadata: {
          guest_name: guestName,
          order_type: orderType,
          item_count: cleanedItems.length,
          total_amount: netAmount,
        },
      },
      conn
    );

    await conn.commit();
    res.status(201).json({ id: txId, netAmount });
  } catch (err) {
    await conn.rollback();
    console.error("POST /sales failed:", err.message);
    res.status(500).json({ message: err.message || "Failed to record sale" });
  } finally {
    conn.release();
  }
});

router.patch("/:id/void", async (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isFinite(saleId) || saleId <= 0) {
    return res.status(400).json({ message: "Invalid sale id." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[sale]] = await conn.query("SELECT id, status, sale_datetime FROM sales_transactions WHERE id=? FOR UPDATE", [saleId]);
    if (!sale) {
      await conn.rollback();
      return res.status(404).json({ message: "Sale not found." });
    }
    if (sale.status === "VOIDED") {
      await conn.rollback();
      return res.status(400).json({ message: "Sale is already voided." });
    }
    const saleDateKey = dateKeyInTimezone(sale.sale_datetime);
    const dayClosure = await getSalesDayClosure(conn, saleDateKey);
    if (dayClosure && req.user?.role !== "OWNER") {
      await conn.rollback();
      return res.status(409).json({ message: `Sales for ${saleDateKey} were already completed and can no longer be voided.` });
    }

    const [usageRows] = await conn.query(
      `SELECT siiu.ingredient_id, siiu.qty_used_base_unit, siiu.base_unit, i.ingredient_name, i.quantity
         FROM sales_item_inventory_usage siiu
         JOIN sales_items si ON si.id = siiu.sales_item_id
         JOIN ingredients i ON i.id = siiu.ingredient_id
        WHERE si.sales_transaction_id = ?`,
      [saleId]
    );

    const ingredientCols = await getColumns("ingredients");
    const incrementStockSql = ingredientCols.last_updated
      ? "UPDATE ingredients SET quantity = quantity + ?, last_updated = NOW() WHERE id=?"
      : "UPDATE ingredients SET quantity = quantity + ? WHERE id=?";
    for (const usage of usageRows) {
      await conn.query(incrementStockSql, [
        Number(usage.qty_used_base_unit || 0),
        usage.ingredient_id,
      ]);
      await writeInventoryMovement(
        {
          ingredient_id: usage.ingredient_id,
          movement_type: "SALE_VOID_IN",
          quantity_change: Number(usage.qty_used_base_unit || 0),
          resulting_quantity: Number(usage.quantity || 0) + Number(usage.qty_used_base_unit || 0),
          unit: usage.base_unit || null,
          source_module: "SALES",
          reference_type: "sales_transaction",
          reference_id: saleId,
          notes: `Voided sale #${saleId} and restored inventory for ${usage.ingredient_name}.`,
          created_by_user_id: req.user?.id || null,
        },
        conn
      );
    }

    await conn.query("UPDATE sales_transactions SET status='VOIDED' WHERE id=?", [saleId]);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "SALES",
        action_name: "VOID",
        entity_type: "sales_transaction",
        entity_id: saleId,
        summary: `Voided sale #${saleId}.`,
      },
      conn
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PATCH /sales/:id/void failed:", err.message);
    res.status(500).json({ message: "Failed to void sale" });
  } finally {
    conn.release();
  }
});

router.post("/complete-day", async (req, res) => {
  const saleDate = String(req.body?.saleDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
    return res.status(400).json({ message: "saleDate must be in YYYY-MM-DD format." });
  }

  if (!(await tableExists("sales_day_closures"))) {
    return res.status(503).json({ message: "Sales day closure setup is incomplete. Run the latest database migration first." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const existingClosure = await getSalesDayClosure(conn, saleDate);
    if (existingClosure) {
      await conn.rollback();
      return res.status(409).json({ message: `Sales for ${saleDate} were already completed.` });
    }

    const [completedRows] = await conn.query(
      `SELECT sale_datetime, net_amount
         FROM sales_transactions
        WHERE status = 'COMPLETED'`
    );
    const totals = completedRows.reduce(
      (acc, row) => {
        if (dateKeyInTimezone(row.sale_datetime) === saleDate) {
          acc.total_transactions += 1;
          acc.total_revenue = round2(acc.total_revenue + Number(row.net_amount || 0));
        }
        return acc;
      },
      { total_transactions: 0, total_revenue: 0 }
    );

    const [result] = await conn.query(
      `INSERT INTO sales_day_closures
        (sale_date, total_revenue, total_transactions, closed_by_user_id, closed_at, created_at)
       VALUES (?,?,?,?,NOW(),NOW())`,
      [saleDate, round2(totals.total_revenue), Number(totals.total_transactions || 0), req.user?.id || null]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "SALES",
        action_name: "COMPLETE_DAY",
        entity_type: "sales_day_closure",
        entity_id: result.insertId,
        summary: `Completed sales for ${saleDate} with ${Number(totals.total_transactions || 0)} transaction(s) totaling ${round2(totals.total_revenue).toFixed(2)}.`,
        metadata: {
          sale_date: saleDate,
          total_revenue: round2(totals.total_revenue),
          total_transactions: Number(totals.total_transactions || 0),
        },
      },
      conn
    );

    await conn.commit();
    res.status(201).json({
      saleDate,
      totalRevenue: round2(totals.total_revenue),
      totalTransactions: Number(totals.total_transactions || 0),
    });
  } catch (err) {
    await conn.rollback();
    console.error("POST /sales/complete-day failed:", err.message);
    res.status(500).json({ message: err.message || "Failed to complete sales for the day" });
  } finally {
    conn.release();
  }
});

module.exports = router;
