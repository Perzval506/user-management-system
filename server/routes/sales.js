const express = require("express");
const pool = require("../db");
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { tableExists } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { convertQuantity } = require("../utils/unitConversion");

const router = express.Router();

const round2 = (num) => Number(Number(num || 0).toFixed(2));
const MAX_NOTES_LENGTH = 500;

router.use(requireAuth, requireAnyRole(["OWNER", "CASHIER"]));

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
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
      return res.json({
        summary: { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0 },
        items: [],
        breakdown: [],
      });
    }

    const [transactions] = await pool.query(
      `SELECT st.id, st.sale_datetime, st.net_amount, st.status, st.notes, st.cashier_user_id,
              u.full_name AS cashier_name,
              COUNT(si.id) AS line_count
         FROM sales_transactions st
         LEFT JOIN users u ON u.id = st.cashier_user_id
         LEFT JOIN sales_items si ON si.sales_transaction_id = st.id
        GROUP BY st.id
        ORDER BY st.sale_datetime DESC, st.id DESC`
    );

    const [breakdown] = await pool.query(
      `SELECT mi.id AS menu_item_id,
              mi.menu_name,
              ROUND(SUM(si.qty), 2) AS quantity_sold,
              ROUND(SUM(si.line_total), 2) AS revenue
         FROM sales_items si
         JOIN sales_transactions st ON st.id = si.sales_transaction_id
         JOIN menu_items mi ON mi.id = si.menu_item_id
        WHERE st.status = 'COMPLETED'
        GROUP BY mi.id, mi.menu_name
        ORDER BY revenue DESC, mi.menu_name ASC`
    );

    const todayKey = new Date().toISOString().slice(0, 10);
    const completed = transactions.filter((row) => row.status === "COMPLETED");
    const totalRevenue = round2(completed.reduce((sum, row) => sum + Number(row.net_amount || 0), 0));
    const todayRevenue = round2(
      completed.reduce((sum, row) => {
        const key = row.sale_datetime ? new Date(row.sale_datetime).toISOString().slice(0, 10) : "";
        return key === todayKey ? sum + Number(row.net_amount || 0) : sum;
      }, 0)
    );

    res.json({
      summary: {
        totalRevenue,
        totalTransactions: completed.length,
        todayRevenue,
      },
      items: transactions,
      breakdown,
    });
  } catch (err) {
    console.error("GET /sales failed:", err.message);
    res.status(500).json({ message: "Failed to fetch sales" });
  }
});

router.post("/", async (req, res) => {
  const notes = req.body.notes ? String(req.body.notes).trim() : null;
  const saleItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (req.body.saleDate && !isValidDate(req.body.saleDate)) {
    return res.status(400).json({ message: "saleDate must be a valid date." });
  }
  const saleDate = req.body.saleDate ? new Date(req.body.saleDate) : new Date();
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    return res.status(400).json({ message: `notes must be ${MAX_NOTES_LENGTH} characters or fewer.` });
  }

  if (!saleItems.length) {
    return res.status(400).json({ message: "At least one sale item is required." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const cleanedItems = [];
    for (const [index, item] of saleItems.entries()) {
      const menuItemId = Number(item.menuItemId);
      const qty = Number(item.quantity);
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

      const unitPrice = round2(item.unitPrice ?? menuRow.selling_price ?? 0);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error(`Sale item ${index + 1} has an invalid unit price.`);
      }
      const lineTotal = round2(unitPrice * qty);

      cleanedItems.push({
        menuItemId,
        menuName: menuRow.menu_name,
        quantity: qty,
        unitPrice,
        lineTotal,
        inventoryUsage,
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
    const [txResult] = await conn.query(
      `INSERT INTO sales_transactions
        (sale_datetime, cashier_user_id, gross_amount, discount_amount, net_amount, payment_method, status, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [saleDate, req.user?.id || null, netAmount, 0, netAmount, "CASH", "COMPLETED", notes]
    );

    const txId = txResult.insertId;
    const rows = cleanedItems.map((item) => [
      txId,
      item.menuItemId,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
    ]);

    const [salesItemResult] = await conn.query(
      `INSERT INTO sales_items
        (sales_transaction_id, menu_item_id, qty, unit_price, line_total)
       VALUES ?`,
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

    for (const [ingredientId, usage] of Object.entries(inventoryTotals)) {
      await conn.query("UPDATE ingredients SET quantity = quantity - ?, last_updated = NOW() WHERE id=?", [
        usage.qtyUsedBaseUnit,
        Number(ingredientId),
      ]);
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "SALES",
        action_name: "CREATE",
        entity_type: "sales_transaction",
        entity_id: txId,
        summary: `Recorded sale with ${cleanedItems.length} line item(s) totaling ${netAmount.toFixed(2)}.`,
        metadata: {
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
    const [[sale]] = await conn.query("SELECT id, status FROM sales_transactions WHERE id=? FOR UPDATE", [saleId]);
    if (!sale) {
      await conn.rollback();
      return res.status(404).json({ message: "Sale not found." });
    }
    if (sale.status === "VOIDED") {
      await conn.rollback();
      return res.status(400).json({ message: "Sale is already voided." });
    }

    const [usageRows] = await conn.query(
      `SELECT siiu.ingredient_id, siiu.qty_used_base_unit
         FROM sales_item_inventory_usage siiu
         JOIN sales_items si ON si.id = siiu.sales_item_id
        WHERE si.sales_transaction_id = ?`,
      [saleId]
    );

    for (const usage of usageRows) {
      await conn.query("UPDATE ingredients SET quantity = quantity + ?, last_updated = NOW() WHERE id=?", [
        Number(usage.qty_used_base_unit || 0),
        usage.ingredient_id,
      ]);
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

module.exports = router;
