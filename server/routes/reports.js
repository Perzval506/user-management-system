const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { tableExists, getColumns } = require("../utils/dbIntrospection");
const { computeMenuItemCosting } = require("../utils/costing");
const { buildActor, writeAuditLog } = require("../utils/auditLog");

const router = express.Router();

router.use(requireAuth, requireRole("OWNER"));

const LOW_STOCK_THRESHOLD = 5;
const PROFIT_ALERT_STATUSES = new Set(["Loss", "Low Profit"]);
const REPORT_TIMEZONE = "Asia/Manila";

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateKey(dateValue, timeZone = REPORT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateValue));
  const map = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

function startOfWeekKey(dateValue = new Date()) {
  const [year, month, dayOfMonth] = dateKey(dateValue).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const weekDay = date.getDay();
  const diff = date.getDate() - weekDay + (weekDay === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().slice(0, 10);
}

function monthKey(dateValue) {
  return dateKey(dateValue).slice(0, 7);
}

async function getSalesStatusSummary() {
  if (!(await tableExists("sales_transactions"))) return [];
  const [rows] = await pool.query(
    `SELECT status,
            COUNT(*) AS transaction_count,
            ROUND(SUM(net_amount), 2) AS total_amount
       FROM sales_transactions
      GROUP BY status
      ORDER BY FIELD(status, 'COMPLETED', 'VOIDED', 'REFUNDED'), status`
  );
  return rows.map((row) => ({
    status: row.status,
    transaction_count: Number(row.transaction_count || 0),
    total_amount: Number(row.total_amount || 0),
    included_in_revenue: row.status === "COMPLETED",
  }));
}

async function getLatestPurchaseOrderUnitCosts() {
  if (!(await tableExists("purchase_order_details")) || !(await tableExists("purchase_orders"))) return {};
  const [rows] = await pool.query(
    `SELECT ranked.ingredient_id, ranked.unit_cost, ranked.supplier_name, ranked.purchased_at, ranked.reference_number
       FROM (
         SELECT pod.ingredient_id,
                ROUND(COALESCE(pod.price, 0), 4) AS unit_cost,
                po.store_name AS supplier_name,
                po.purchase_date AS purchased_at,
                CONCAT('PO-', LPAD(po.id, 4, '0')) AS reference_number,
                ROW_NUMBER() OVER (PARTITION BY pod.ingredient_id ORDER BY po.purchase_date DESC, pod.id DESC) AS rn
           FROM purchase_order_details pod
           JOIN purchase_orders po ON po.id = pod.purchase_order_id
          WHERE pod.ingredient_id IS NOT NULL
       ) ranked
      WHERE ranked.rn = 1`
  );
  return rows.reduce((acc, row) => {
    acc[row.ingredient_id] = row;
    return acc;
  }, {});
}

async function getLatestQuickPurchaseUnitCosts() {
  if (!(await tableExists("purchases"))) return {};
  const [rows] = await pool.query(
    `SELECT ranked.ingredient_key, ranked.unit_cost, ranked.created_at, ranked.reference_number
       FROM (
         SELECT LOWER(TRIM(ingredient_name)) AS ingredient_key,
                CASE
                  WHEN quantity IS NULL OR quantity <= 0 THEN NULL
                  ELSE ROUND(price / quantity, 4)
                END AS unit_cost,
                created_at,
                CONCAT('PUR-', LPAD(id, 4, '0')) AS reference_number,
                ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(ingredient_name)) ORDER BY created_at DESC, id DESC) AS rn
           FROM purchases
          WHERE ingredient_name IS NOT NULL
            AND TRIM(ingredient_name) <> '' 
       ) ranked
      WHERE ranked.rn = 1`
  );
  return rows.reduce((acc, row) => {
    acc[row.ingredient_key] = row;
    return acc;
  }, {});
}

async function getIngredientCostRows() {
  const cols = await getColumns("ingredients");
  const activeIngredientWhere = cols.status ? "WHERE i.status = 'ACTIVE'" : "";
  const select = [
    "i.id",
    "i.ingredient_name",
    "i.category",
    "i.base_unit",
    cols.quantity ? "i.quantity" : "0 AS quantity",
  ];
  if (cols.current_ap_cost) {
    select.push("i.current_ap_cost");
  } else {
    select.push("NULL AS current_ap_cost");
  }
  const [ingredientResult, latestPoCosts, latestQuickCosts] = await Promise.all([
    pool.query(`SELECT ${select.join(", ")} FROM ingredients i ${activeIngredientWhere} ORDER BY i.ingredient_name ASC`),
    getLatestPurchaseOrderUnitCosts(),
    getLatestQuickPurchaseUnitCosts(),
  ]);
  const [rows] = ingredientResult;

  return rows.map((row) => {
    const poCost = latestPoCosts[row.id];
    const quickCost = latestQuickCosts[String(row.ingredient_name || "").trim().toLowerCase()];
    const unitCost =
      Number.isFinite(Number(row.current_ap_cost)) && Number(row.current_ap_cost) > 0
        ? Number(row.current_ap_cost)
        : poCost && Number.isFinite(Number(poCost.unit_cost))
          ? Number(poCost.unit_cost)
          : quickCost && Number.isFinite(Number(quickCost.unit_cost))
            ? Number(quickCost.unit_cost)
            : 0;

    return {
      ...row,
      quantity: Number(row.quantity || 0),
      unit_cost: round2(unitCost),
      inventory_value: round2(Number(row.quantity || 0) * unitCost),
      cost_source: poCost ? "Purchase Record" : quickCost ? "Quick Purchase" : row.current_ap_cost ? "Ingredient AP Cost" : "Unknown",
      cost_reference: poCost?.reference_number || quickCost?.reference_number || null,
      cost_updated_at: poCost?.purchased_at || quickCost?.created_at || null,
    };
  });
}

async function getCurrentPriceMap() {
  const [rows] = await pool.query(
    `SELECT mph.menu_item_id, mph.selling_price, mph.effective_date
       FROM menu_price_history mph
       JOIN (
         SELECT menu_item_id, MAX(CONCAT(effective_date, '-', LPAD(id, 10, '0'))) AS latest_key
           FROM menu_price_history
          GROUP BY menu_item_id
       ) latest ON latest.menu_item_id = mph.menu_item_id
               AND CONCAT(mph.effective_date, '-', LPAD(mph.id, 10, '0')) = latest.latest_key`
  );
  return rows.reduce((acc, row) => {
    acc[row.menu_item_id] = row;
    return acc;
  }, {});
}

async function buildCostVsSellingPrice() {
  if (!(await tableExists("menu_items"))) return [];
  const menuCols = await getColumns("menu_items");
  const recipeVersionCols = (await tableExists("recipe_versions")) ? await getColumns("recipe_versions") : {};
  const ingredientCols = await getColumns("ingredients");
  const recipeIngredientCols = await getColumns("recipe_ingredients");
  const activeMenuWhere = menuCols.status ? "WHERE m.status = 'ACTIVE'" : "";
  const hasCurrentApCost = Boolean(ingredientCols.current_ap_cost);
  const hasRecipeLinePrice = Boolean(recipeIngredientCols.price);
  const hasYieldPercent = Boolean(recipeIngredientCols.yield_percent);
  const [menuRows, currentPriceMap] = await Promise.all([
    pool.query(
    `SELECT m.id,
            m.menu_name,
            m.recipe_version_id,
            ${menuCols.target_food_cost_percent ? "m.target_food_cost_percent" : "NULL AS target_food_cost_percent"},
            ${menuCols.dine_in_packaging_cost ? "m.dine_in_packaging_cost" : "0 AS dine_in_packaging_cost"},
            ${menuCols.takeout_packaging_cost ? "m.takeout_packaging_cost" : "0 AS takeout_packaging_cost"},
            ${menuCols.delivery_packaging_cost ? "m.delivery_packaging_cost" : "0 AS delivery_packaging_cost"},
            ${recipeVersionCols.yield_amount ? "rv.yield_amount" : "NULL AS yield_amount"},
            ${recipeVersionCols.portion_size ? "rv.portion_size" : "NULL AS portion_size"}
       FROM menu_items m
       LEFT JOIN recipe_versions rv ON rv.id = m.recipe_version_id
      ${activeMenuWhere}
      ORDER BY m.menu_name ASC`
    ).then(([rows]) => rows),
    getCurrentPriceMap(),
  ]);

  const recipeVersionIds = menuRows
    .map((menu) => Number(menu.recipe_version_id || 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  const ingredientsByRecipeVersion = {};
  if (recipeVersionIds.length) {
    const apCostSelect = hasCurrentApCost ? ", i.current_ap_cost" : ", NULL AS current_ap_cost";
    const priceSelect = hasRecipeLinePrice ? "ri.price" : "NULL AS price";
    const yieldSelect = hasYieldPercent ? "ri.yield_percent" : "NULL AS yield_percent";
    const [ingredientRows] = await pool.query(
      `SELECT ri.recipe_version_id, ri.ingredient_id, ri.qty_used, ri.qty_unit, ${priceSelect}, ${yieldSelect},
              i.ingredient_name, i.base_unit${apCostSelect}
         FROM recipe_ingredients ri
         JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_version_id IN (?)`,
      [recipeVersionIds]
    );
    ingredientRows.forEach((line) => {
      const key = Number(line.recipe_version_id);
      ingredientsByRecipeVersion[key] = ingredientsByRecipeVersion[key] || [];
      ingredientsByRecipeVersion[key].push(line);
    });
  }

  const result = [];
  for (const menu of menuRows) {
    const currentPrice = currentPriceMap[menu.id]?.selling_price ?? null;
    if (!menu.recipe_version_id) {
      result.push({
        id: menu.id,
        menu_name: menu.menu_name,
        current_price: currentPrice,
        cost_per_portion: null,
        suggested_price: null,
        profit_per_portion: null,
        profit_margin: null,
        status: "No Recipe",
      });
      continue;
    }

    const ingredientRows = ingredientsByRecipeVersion[Number(menu.recipe_version_id)] || [];

    const costing = computeMenuItemCosting({
      ingredients: ingredientRows.map((line) => ({
        ingredient_id: line.ingredient_id,
        ingredient_name: line.ingredient_name,
        quantity_used: Number(line.qty_used || 0),
        quantity_unit: line.qty_unit,
        base_unit: line.base_unit,
        ap_cost_per_unit:
          line.price !== null && typeof line.price !== "undefined"
            ? Number(line.price || 0)
            : Number(line.current_ap_cost || 0),
        yield_percent:
          line.yield_percent !== null && typeof line.yield_percent !== "undefined"
            ? Number(line.yield_percent || 0)
            : 100,
      })),
      total_yield_grams: Number(menu.yield_amount || 0),
      portion_size_grams: Number(menu.portion_size || 0),
      target_food_cost_percent: Number(menu.target_food_cost_percent || 0),
      current_selling_price: Number(currentPrice || 0),
      order_type: "DINE_IN",
      dine_in_packaging_cost: Number(menu.dine_in_packaging_cost || 0),
      takeout_packaging_cost: Number(menu.takeout_packaging_cost || 0),
      delivery_packaging_cost: Number(menu.delivery_packaging_cost || 0),
    });

    result.push({
      id: menu.id,
      menu_name: menu.menu_name,
      current_price: currentPrice,
      cost_per_portion: costing.cost_per_portion,
      suggested_price: costing.suggested_price,
      profit_per_portion: costing.profit_per_portion,
      profit_margin: costing.profit_margin,
      status: costing.status,
    });
  }

  return result;
}

async function getSalesTransactions() {
  if (!(await tableExists("sales_transactions"))) return [];
  const cols = await getColumns("sales_transactions");
  const [rows] = await pool.query(
    `SELECT id,
            sale_datetime,
            ${cols.gross_amount ? "gross_amount" : "net_amount AS gross_amount"},
            ${cols.discount_amount ? "discount_amount" : "0 AS discount_amount"},
            net_amount,
            status
       FROM sales_transactions
      WHERE status = 'COMPLETED'
      ORDER BY sale_datetime DESC, id DESC`
  );
  return rows;
}

async function buildReportsPayload() {
  const [
    hasPurchaseRequests,
    hasMenuPromotions,
    hasAuditLogs,
    hasPurchases,
    hasPurchaseOrders,
    hasSalesItems,
    hasSalesTransactions,
    hasInventoryMovements,
  ] = await Promise.all([
    tableExists("purchase_requests"),
    tableExists("menu_promotions"),
    tableExists("audit_logs"),
    tableExists("purchases"),
    tableExists("purchase_orders"),
    tableExists("sales_items"),
    tableExists("sales_transactions"),
    tableExists("inventory_movements"),
  ]);
  const inventoryMovementCols = hasInventoryMovements ? await getColumns("inventory_movements") : {};
  const menuItemCols = (await tableExists("menu_items")) ? await getColumns("menu_items") : {};
  const purchaseOrderCols = hasPurchaseOrders ? await getColumns("purchase_orders") : {};
  const activeMenuSalesWhere = menuItemCols.status ? "AND mi.status = 'ACTIVE'" : "";
  const purchaseOrderReceiptSelect = purchaseOrderCols.receipt_no ? ", po.receipt_no" : ", NULL AS receipt_no";
  const purchaseOrderInvoiceSelect = purchaseOrderCols.invoice_no ? ", po.invoice_no" : ", NULL AS invoice_no";

  const [
    ingredientRows,
    costVsSellingPrice,
    salesTransactions,
    pendingPurchaseRows,
    activePromoRows,
    recentActivities,
    quickPurchaseRowsResult,
    purchaseOrderRowsResult,
    topSellingRowsResult,
    wastageRowsResult,
    salesStatusSummary,
  ] = await Promise.all([
    getIngredientCostRows(),
    buildCostVsSellingPrice(),
    getSalesTransactions(),
    hasPurchaseRequests
      ? pool.query("SELECT COUNT(*) AS pending_count FROM purchase_requests WHERE status='PENDING'").then(([rows]) => rows)
      : Promise.resolve([{ pending_count: 0 }]),
    hasMenuPromotions
      ? pool.query(
          `SELECT COUNT(*) AS active_promos
             FROM menu_promotions
            WHERE status = 'ACTIVE'
              AND start_date <= CURDATE()
              AND (end_date IS NULL OR end_date >= CURDATE())`
        ).then(([rows]) => rows)
      : Promise.resolve([{ active_promos: 0 }]),
    hasAuditLogs
      ? pool.query(
          `SELECT id, actor_name, module_name, action_name, summary, created_at
             FROM audit_logs
            ORDER BY created_at DESC, id DESC
            LIMIT 8`
        ).then(([rows]) => rows)
      : Promise.resolve([]),
    hasPurchases
      ? pool.query(
          `SELECT id, ingredient_name, quantity, price, created_at
             FROM purchases
            ORDER BY created_at DESC, id DESC
            LIMIT 80`
        ).then(([rows]) => rows)
      : Promise.resolve([]),
    hasPurchaseOrders
      ? pool.query(
          `SELECT po.id, po.store_name, po.purchase_date, po.total_amount,
                  ${purchaseOrderReceiptSelect.slice(2)},
                  ${purchaseOrderInvoiceSelect.slice(2)},
                  COUNT(pod.id) AS item_count
             FROM purchase_orders po
             LEFT JOIN purchase_order_details pod ON pod.purchase_order_id = po.id
            GROUP BY po.id
            ORDER BY po.purchase_date DESC, po.id DESC
            LIMIT 80`
        ).then(([rows]) => rows)
      : Promise.resolve([]),
    hasSalesItems && hasSalesTransactions
      ? pool.query(
          `SELECT mi.id AS menu_item_id,
                  mi.menu_name,
                  ROUND(SUM(si.qty), 2) AS quantity_sold,
                  ROUND(SUM(si.line_total), 2) AS revenue
             FROM sales_items si
             JOIN menu_items mi ON mi.id = si.menu_item_id
             JOIN sales_transactions st ON st.id = si.sales_transaction_id
            WHERE st.status = 'COMPLETED'
              ${activeMenuSalesWhere}
            GROUP BY mi.id, mi.menu_name
            ORDER BY revenue DESC, quantity_sold DESC, mi.menu_name ASC
            LIMIT 10`
        ).then(([rows]) => rows)
      : Promise.resolve([]),
    hasInventoryMovements
      ? pool.query(
          `SELECT im.id, im.created_at, im.movement_type, im.quantity_change,
                  ${inventoryMovementCols.reason ? "im.reason" : "NULL AS reason"},
                  ${inventoryMovementCols.reference_number ? "im.reference_number" : "NULL AS reference_number"},
                  i.ingredient_name, u.full_name AS actor_name
             FROM inventory_movements im
             JOIN ingredients i ON i.id = im.ingredient_id
             LEFT JOIN users u ON u.id = im.created_by_user_id
            WHERE im.movement_type IN ('WASTAGE', 'SPOILAGE', 'DAMAGED', 'EXPIRED')
            ORDER BY im.created_at DESC, im.id DESC
            LIMIT 50`
        ).then(([rows]) => rows)
      : Promise.resolve([]),
    getSalesStatusSummary(),
  ]);

  const lowStock = ingredientRows
    .filter((row) => Number(row.quantity || 0) <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));

  const inventoryValuation = ingredientRows
    .filter((row) => Number(row.quantity || 0) > 0 || Number(row.inventory_value || 0) > 0)
    .sort((a, b) => Number(b.inventory_value || 0) - Number(a.inventory_value || 0));

  const quickPurchases = quickPurchaseRowsResult.map((row) => ({
        reference_number: `PUR-${String(row.id).padStart(4, "0")}`,
        source_type: "Quick Purchase",
        supplier_name: null,
        activity_date: row.created_at,
        item_name: row.ingredient_name,
        quantity: Number(row.quantity || 0),
        total_amount: Number(row.price || 0),
      }));

  const purchaseOrders = purchaseOrderRowsResult.map((row) => ({
        reference_number: row.receipt_no || row.invoice_no || `PO-${String(row.id).padStart(4, "0")}`,
        source_type: "Purchase Record",
        supplier_name: row.store_name,
        activity_date: row.purchase_date,
        item_name: `${row.item_count || 0} item(s)`,
        quantity: Number(row.item_count || 0),
        total_amount: Number(row.total_amount || 0),
      }));

  const purchaseHistory = [...quickPurchases, ...purchaseOrders].sort(
    (a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime()
  );

  const salesSummary = salesTransactions.reduce(
    (acc, row) => {
      const day = dateKey(row.sale_datetime);
      const week = startOfWeekKey(row.sale_datetime);
      const month = monthKey(row.sale_datetime);

      acc.byDay[day] = round2(Number(acc.byDay[day] || 0) + Number(row.net_amount || 0));
      acc.byWeek[week] = round2(Number(acc.byWeek[week] || 0) + Number(row.net_amount || 0));
      acc.byMonth[month] = round2(Number(acc.byMonth[month] || 0) + Number(row.net_amount || 0));
      return acc;
    },
    { byDay: {}, byWeek: {}, byMonth: {} }
  );

  const salesSummaryRows = {
    byDay: Object.entries(salesSummary.byDay)
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => String(b.label).localeCompare(String(a.label)))
      .slice(0, 14),
    byWeek: Object.entries(salesSummary.byWeek)
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => String(b.label).localeCompare(String(a.label)))
      .slice(0, 12),
    byMonth: Object.entries(salesSummary.byMonth)
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => String(b.label).localeCompare(String(a.label)))
      .slice(0, 12),
  };

  const currentMonth = monthKey(new Date());
  const currentMonthSales = salesTransactions.filter((row) => monthKey(row.sale_datetime) === currentMonth);
  const monthlyGrossSales = round2(currentMonthSales.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0));
  const monthlyDiscounts = round2(currentMonthSales.reduce((sum, row) => sum + Number(row.discount_amount || 0), 0));
  const monthlyNetSales = round2(currentMonthSales.reduce((sum, row) => sum + Number(row.net_amount || 0), 0));

  const mostProfitableItems = [...costVsSellingPrice]
    .filter((row) => Number.isFinite(Number(row.profit_per_portion)))
    .sort((a, b) => Number(b.profit_per_portion || 0) - Number(a.profit_per_portion || 0))
    .slice(0, 5);
  const costingAlerts = costVsSellingPrice.filter((row) => PROFIT_ALERT_STATUSES.has(row.status));
  const costedMenuItems = costVsSellingPrice.filter(
    (row) => Number(row.current_price || 0) > 0 && Number.isFinite(Number(row.cost_per_portion))
  );
  const totalCurrentSellingPrice = costedMenuItems.reduce((sum, row) => sum + Number(row.current_price || 0), 0);
  const totalCostPerPortion = costedMenuItems.reduce((sum, row) => sum + Number(row.cost_per_portion || 0), 0);
  const estimatedFoodCostPercent = totalCurrentSellingPrice > 0
    ? round2((totalCostPerPortion / totalCurrentSellingPrice) * 100)
    : 0;
  const suggestedPriceVariance = costVsSellingPrice.reduce((sum, row) => {
    const currentPrice = Number(row.current_price || 0);
    const suggestedPrice = Number(row.suggested_price || 0);
    if (!Number.isFinite(currentPrice) || !Number.isFinite(suggestedPrice) || suggestedPrice <= 0) return sum;
    return sum + (suggestedPrice - currentPrice);
  }, 0);

  return {
    summary: {
      total_inventory_value: round2(inventoryValuation.reduce((sum, row) => sum + Number(row.inventory_value || 0), 0)),
      monthly_sales: monthlyNetSales,
      monthly_gross_sales: monthlyGrossSales,
      monthly_discount_amount: monthlyDiscounts,
      estimated_food_cost_percent: estimatedFoodCostPercent,
      estimated_gross_profit: round2(monthlyNetSales * (1 - estimatedFoodCostPercent / 100)),
      break_even_item_count: costVsSellingPrice.filter((row) => row.status === "Break-even").length,
      suggested_price_variance: round2(suggestedPriceVariance),
      low_stock_count: lowStock.length,
      costing_alert_count: costingAlerts.length,
      pending_purchase_count: Number(pendingPurchaseRows[0]?.pending_count || 0),
      active_promo_count: Number(activePromoRows[0]?.active_promos || 0),
    },
    inventoryValuation,
    lowStock,
    purchaseHistory,
    topSelling: topSellingRowsResult,
    costVsSellingPrice,
    salesSummary: salesSummaryRows,
    salesStatusSummary,
    wastageReport: wastageRowsResult.map((row) => ({
      ...row,
      quantity_change: Math.abs(Number(row.quantity_change || 0)),
    })),
    recentActivities,
    mostProfitableItems,
    costingAlerts,
  };
}

router.get("/", async (_req, res) => {
  try {
    const payload = await buildReportsPayload();
    res.json(payload);
  } catch (err) {
    console.error("GET /reports failed:", err.message);
    res.status(500).json({ message: "Failed to fetch reports" });
  }
});

router.get("/snapshots", async (_req, res) => {
  try {
    if (!(await tableExists("report_snapshots"))) {
      return res.json([]);
    }
    const [rows] = await pool.query(
      `SELECT rs.id,
              rs.snapshot_name,
              rs.summary_json,
              rs.created_at,
              u.full_name AS created_by_name
         FROM report_snapshots rs
         LEFT JOIN users u ON u.id = rs.created_by_user_id
        ORDER BY rs.created_at DESC, rs.id DESC
        LIMIT 20`
    );
    res.json(
      rows.map((row) => {
        let summary = {};
        try {
          summary = JSON.parse(row.summary_json || "{}");
        } catch {
          summary = {};
        }
        return {
          id: row.id,
          snapshot_name: row.snapshot_name,
          summary,
          created_at: row.created_at,
          created_by_name: row.created_by_name,
        };
      })
    );
  } catch (err) {
    console.error("GET /reports/snapshots failed:", err.message);
    res.status(500).json({ message: "Failed to fetch report snapshots" });
  }
});

router.post("/snapshots", async (req, res) => {
  const snapshotName = String(req.body?.snapshot_name || "").trim().slice(0, 140);
  if (!(await tableExists("report_snapshots"))) {
    return res.status(503).json({ message: "Report snapshots are unavailable until the latest database setup is applied." });
  }
  const conn = await pool.getConnection();
  try {
    const payload = await buildReportsPayload();
    const name = snapshotName || `Reports Snapshot ${dateKey(new Date())}`;
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO report_snapshots (snapshot_name, summary_json, payload_json, created_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [
        name,
        JSON.stringify(payload.summary || {}),
        JSON.stringify(payload),
        req.user?.id || null,
      ]
    );
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "REPORTS",
        action_name: "SNAPSHOT_CREATE",
        entity_type: "report_snapshot",
        entity_id: result.insertId,
        summary: `Saved report snapshot "${name}".`,
        metadata: {
          total_inventory_value: payload.summary?.total_inventory_value || 0,
          monthly_sales: payload.summary?.monthly_sales || 0,
          low_stock_count: payload.summary?.low_stock_count || 0,
          costing_alert_count: payload.summary?.costing_alert_count || 0,
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, snapshot_name: name, summary: payload.summary });
  } catch (err) {
    await conn.rollback();
    console.error("POST /reports/snapshots failed:", err.message);
    res.status(500).json({ message: "Failed to save report snapshot" });
  } finally {
    conn.release();
  }
});

router.get("/dashboard", async (_req, res) => {
  try {
    const payload = await buildReportsPayload();
    res.json({
      summary: payload.summary,
      recentActivities: payload.recentActivities,
      mostProfitableItems: payload.mostProfitableItems,
      costingAlerts: payload.costingAlerts,
    });
  } catch (err) {
    console.error("GET /reports/dashboard failed:", err.message);
    res.status(500).json({ message: "Failed to fetch dashboard report summary" });
  }
});

module.exports = router;
