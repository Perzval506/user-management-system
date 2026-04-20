const express = require("express");
const pool = require("../db");
const router = express.Router();
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { requireAuth, requireAnyRole } = require("../middleware/auth");

router.use(requireAuth, requireAnyRole(["OWNER", "STOCKROOM_STAFF"]));

const LOW_STOCK_THRESHOLD = 5;
const WEEKLY_REVIEW_DAYS = 7;

function reviewWindowDates() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (WEEKLY_REVIEW_DAYS - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

// Inventory summary: base quantity + purchases (optional future: minus usage)
router.get("/summary", async (_req, res) => {
  try {
    const ingredientCols = await getColumns("ingredients");
    const hasQuantity = Boolean(ingredientCols.quantity);
    const hasPurchaseOrderDetails = await tableExists("purchase_order_details");
    const totalStockSql = hasQuantity
      ? "COALESCE(i.quantity, 0)"
      : hasPurchaseOrderDetails
        ? "COALESCE((SELECT SUM(pod.quantity) FROM purchase_order_details pod WHERE pod.ingredient_id = i.id), 0)"
        : "0";

    const [rows] = await pool.query(`
      SELECT i.id,
             i.ingredient_name,
             i.category,
             i.base_unit,
             ${totalStockSql} AS total_stock
        FROM ingredients i
       ORDER BY i.ingredient_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("GET /inventory/summary failed:", err.message);
    res.status(500).json({ message: "Failed to fetch inventory summary" });
  }
});

router.get("/weekly-review", async (_req, res) => {
  try {
    const ingredientCols = await getColumns("ingredients");
    const hasQuantity = Boolean(ingredientCols.quantity);
    const lastUpdatedSql = ingredientCols.last_updated
      ? "i.last_updated"
      : ingredientCols.updated_at
        ? "i.updated_at AS last_updated"
        : "NULL AS last_updated";
    const hasPurchaseOrderDetails = await tableExists("purchase_order_details");
    const totalStockSql = hasQuantity
      ? "COALESCE(i.quantity, 0)"
      : hasPurchaseOrderDetails
        ? "COALESCE((SELECT SUM(pod.quantity) FROM purchase_order_details pod WHERE pod.ingredient_id = i.id), 0)"
        : "0";

    const [inventoryRows] = await pool.query(`
      SELECT i.id,
             i.ingredient_name,
             i.category,
             i.base_unit,
             ${totalStockSql} AS total_stock,
             ${lastUpdatedSql}
        FROM ingredients i
       ORDER BY COALESCE(i.category, 'UNCATEGORIZED') ASC, i.ingredient_name ASC
    `);

    const { start, end } = reviewWindowDates();
    const purchaseByKey = {};
    const usageById = {};

    if (await tableExists("purchases")) {
      const [purchaseRows] = await pool.query(
        "SELECT ingredient_name, quantity, created_at FROM purchases WHERE created_at >= ? ORDER BY created_at DESC",
        [start]
      );
      purchaseRows.forEach((row) => {
        const key = normalizeKey(row.ingredient_name);
        purchaseByKey[key] = Number(purchaseByKey[key] || 0) + Number(row.quantity || 0);
      });
    }

    if ((await tableExists("purchase_orders")) && (await tableExists("purchase_order_details"))) {
      const [poRows] = await pool.query(
        `SELECT pod.ingredient_id, pod.ingredient_name, pod.quantity, po.purchase_date
           FROM purchase_order_details pod
           JOIN purchase_orders po ON po.id = pod.purchase_order_id
          WHERE po.purchase_date >= ?`,
        [start]
      );
      poRows.forEach((row) => {
        if (row.ingredient_id) {
          usageById[`purchase:${row.ingredient_id}`] = Number(usageById[`purchase:${row.ingredient_id}`] || 0) + Number(row.quantity || 0);
        } else {
          const key = normalizeKey(row.ingredient_name);
          purchaseByKey[key] = Number(purchaseByKey[key] || 0) + Number(row.quantity || 0);
        }
      });
    }

    if ((await tableExists("sales_item_inventory_usage")) && (await tableExists("sales_items")) && (await tableExists("sales_transactions"))) {
      const [usageRows] = await pool.query(
        `SELECT siiu.ingredient_id, siiu.qty_used_base_unit, st.sale_datetime
           FROM sales_item_inventory_usage siiu
           JOIN sales_items si ON si.id = siiu.sales_item_id
           JOIN sales_transactions st ON st.id = si.sales_transaction_id
          WHERE st.status = 'COMPLETED'
            AND st.sale_datetime >= ?`,
        [start]
      );
      usageRows.forEach((row) => {
        usageById[row.ingredient_id] = Number(usageById[row.ingredient_id] || 0) + Number(row.qty_used_base_unit || 0);
      });
    }

    const recommendations = inventoryRows
      .map((row) => {
        const purchaseById = Number(usageById[`purchase:${row.id}`] || 0);
        const purchased = purchaseById || Number(purchaseByKey[normalizeKey(row.ingredient_name)] || 0);
        const used = Number(usageById[row.id] || 0);
        const stock = Number(row.total_stock || 0);
        const recommendedBuyQty = Math.max(round2(used + LOW_STOCK_THRESHOLD - stock), 0);
        return {
          id: row.id,
          ingredient_name: row.ingredient_name,
          category: row.category || "UNCATEGORIZED",
          base_unit: row.base_unit,
          total_stock: stock,
          weekly_purchased: round2(purchased),
          weekly_used: round2(used),
          recommended_buy_qty: round2(recommendedBuyQty),
          needs_attention: stock <= LOW_STOCK_THRESHOLD || recommendedBuyQty > 0,
        };
      })
      .sort((a, b) => {
        if (Number(a.needs_attention) !== Number(b.needs_attention)) return Number(b.needs_attention) - Number(a.needs_attention);
        if (a.total_stock !== b.total_stock) return a.total_stock - b.total_stock;
        return String(a.ingredient_name).localeCompare(String(b.ingredient_name));
      });

    const categorySummary = recommendations.reduce((acc, row) => {
      const key = row.category || "UNCATEGORIZED";
      const existing = acc[key] || {
        category: key,
        item_count: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        recommended_buy_count: 0,
      };
      existing.item_count += 1;
      if (row.total_stock <= LOW_STOCK_THRESHOLD) existing.low_stock_count += 1;
      if (row.total_stock <= 0) existing.out_of_stock_count += 1;
      if (row.recommended_buy_qty > 0) existing.recommended_buy_count += 1;
      acc[key] = existing;
      return acc;
    }, {});

    res.json({
      review_start: start,
      review_end: end,
      low_stock_threshold: LOW_STOCK_THRESHOLD,
      recommendations,
      categories: Object.values(categorySummary),
    });
  } catch (err) {
    console.error("GET /inventory/weekly-review failed:", err.message);
    res.status(500).json({ message: "Failed to fetch weekly inventory review" });
  }
});

router.get("/movements", async (req, res) => {
  try {
    if (!(await tableExists("inventory_movements"))) {
      return res.json([]);
    }

    const ingredientId = Number(req.query.ingredientId || 0);
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const where = Number.isFinite(ingredientId) && ingredientId > 0 ? "WHERE im.ingredient_id = ?" : "";
    const params = Number.isFinite(ingredientId) && ingredientId > 0 ? [ingredientId, limit] : [limit];
    const [rows] = await pool.query(
      `SELECT im.id,
              im.ingredient_id,
              i.ingredient_name,
              im.movement_type,
              im.quantity_change,
              im.resulting_quantity,
              im.unit,
              im.source_module,
              im.reference_type,
              im.reference_id,
              im.notes,
              im.created_at,
              u.full_name AS created_by_name
         FROM inventory_movements im
         JOIN ingredients i ON i.id = im.ingredient_id
         LEFT JOIN users u ON u.id = im.created_by_user_id
         ${where}
        ORDER BY im.created_at DESC, im.id DESC
        LIMIT ?`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /inventory/movements failed:", err.message);
    res.status(500).json({ message: "Failed to fetch inventory movements" });
  }
});

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

module.exports = router;
