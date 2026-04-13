const express = require("express");
const pool = require("../db");
const router = express.Router();
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { requireAuth, requireAnyRole } = require("../middleware/auth");

router.use(requireAuth, requireAnyRole(["OWNER", "STOCKROOM_STAFF"]));

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

module.exports = router;
