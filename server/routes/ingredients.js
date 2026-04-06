const express = require("express");
const pool = require("../db");
const router = express.Router();
const ALLOWED_UNITS = require("../utils/units");
const { tableExists, columnExists } = require("../utils/dbIntrospection");

let cachedCols = null;
async function getIngredientColumns() {
  if (cachedCols) return cachedCols;
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM ingredients");
    cachedCols = rows.reduce((acc, row) => {
      acc[row.Field] = true;
      return acc;
    }, {});
  } catch (err) {
    console.error("Unable to inspect ingredients table:", err.message);
    cachedCols = {};
  }
  return cachedCols;
}

function baseQtyColumn(cols) {
  if (cols.base_unit_qty) return "base_unit_qty";
  if (cols.base_qty_unit) return "base_qty_unit";
  return "base_unit_qty";
}

const currentApCostColumn = async () => {
  const cols = await getIngredientColumns();
  if (cols.current_ap_cost) return "current_ap_cost";
  return null;
};

router.get("/", async (req, res) => {
  try {
    const cols = await getIngredientColumns();
    const bqCol = baseQtyColumn(cols);
    const select = [
      "id",
      "ingredient_name",
      "category",
      "base_unit",
      `${bqCol} AS base_unit_qty`,
      "status",
      "updated_at",
      "created_at",
    ];
    if (cols.quantity) select.splice(5, 0, "quantity");
    if (cols.current_ap_cost) select.splice(6, 0, "current_ap_cost");
    if (cols.last_updated) select.push("last_updated");

    const search = (req.query.q || "").trim();
    const where = search ? "WHERE LOWER(ingredient_name) LIKE ?" : "";
    const params = search ? [`%${search.toLowerCase()}%`] : [];

    const [rows] = await pool.query(
      `SELECT ${select.join(", ")} FROM ingredients ${where} ORDER BY ingredient_name ASC`,
      params
    );

    const canReadPurchaseOrders =
      (await tableExists("purchase_orders")) && (await tableExists("purchase_order_details"));
    const canReadPurchases = await tableExists("purchases");

    const [purchaseOrderCostRows] = canReadPurchaseOrders
      ? await pool.query(
          `SELECT ranked.ingredient_id, ranked.price, ranked.unit, ranked.brand, ranked.purchased_at
             FROM (
               SELECT pod.ingredient_id, pod.price, pod.unit, pod.brand, po.purchase_date AS purchased_at,
                      ROW_NUMBER() OVER (PARTITION BY pod.ingredient_id ORDER BY po.purchase_date DESC, pod.id DESC) AS rn
                 FROM purchase_order_details pod
                 JOIN purchase_orders po ON po.id = pod.purchase_order_id
                WHERE pod.ingredient_id IS NOT NULL
                  AND pod.price IS NOT NULL
                  AND pod.price >= 0
           ) ranked
            WHERE ranked.rn = 1`
        )
      : [[]];
    const [purchaseCostRows] = canReadPurchases
      ? await pool.query(
          `SELECT ranked.ingredient_name, ranked.unit_cost, ranked.created_at
             FROM (
               SELECT LOWER(TRIM(ingredient_name)) AS ingredient_name,
                      CASE
                        WHEN quantity IS NULL OR quantity <= 0 THEN NULL
                        ELSE ROUND(price / quantity, 4)
                      END AS unit_cost,
                      created_at,
                      ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(ingredient_name)) ORDER BY created_at DESC, id DESC) AS rn
                 FROM purchases
                WHERE ingredient_name IS NOT NULL
                  AND TRIM(ingredient_name) <> ''
                  AND price IS NOT NULL
           ) ranked
            WHERE ranked.rn = 1`
        )
      : [[]];

    const purchaseOrderCostByIngredientId = purchaseOrderCostRows.reduce((acc, row) => {
      acc[row.ingredient_id] = row;
      return acc;
    }, {});
    const purchaseCostByName = purchaseCostRows.reduce((acc, row) => {
      acc[row.ingredient_name] = row;
      return acc;
    }, {});

    const mapped = rows.map((r) => {
      const purchaseOrderCost = purchaseOrderCostByIngredientId[r.id] || null;
      const purchaseCost = purchaseCostByName[String(r.ingredient_name || "").trim().toLowerCase()] || null;
      const suggestedUnitCost =
        purchaseOrderCost && isFinite(Number(purchaseOrderCost.price))
          ? Number(purchaseOrderCost.price)
          : purchaseCost && isFinite(Number(purchaseCost.unit_cost))
            ? Number(purchaseCost.unit_cost)
            : null;

      return {
        ...r,
        quantity: r.quantity ?? 0,
        lastUpdated: r.last_updated || r.updated_at || r.created_at,
        current_ap_cost: typeof r.current_ap_cost !== "undefined" ? r.current_ap_cost : suggestedUnitCost ?? null,
        suggested_unit_cost: suggestedUnitCost,
        suggested_cost_unit: purchaseOrderCost?.unit || r.base_unit || null,
        suggested_brand: purchaseOrderCost?.brand || null,
        suggested_cost_source: purchaseOrderCost ? "purchase_order" : purchaseCost ? "purchase" : null,
        suggested_cost_updated_at: purchaseOrderCost?.purchased_at || purchaseCost?.created_at || null,
      };
    });
    res.json(mapped);
  } catch (err) {
    console.error("/ingredients GET failed:", err.message);
    res.status(500).json({ message: "Failed to fetch ingredients" });
  }
});

router.post("/", async (req, res) => {
  const { ingredient_name, category, base_unit, base_unit_qty, status, quantity } = req.body;
  const bu = (base_unit || "").toString().trim().toLowerCase();
  const packSize = Number(base_unit_qty);
  const qtyToAdd = Number(quantity ?? base_unit_qty ?? 0);

  if (!ALLOWED_UNITS.includes(bu)) {
    return res.status(400).json({ message: `Invalid base_unit. Allowed: ${ALLOWED_UNITS.join(",")}` });
  }
  if (!isFinite(packSize) || packSize <= 0) {
    return res.status(400).json({ message: "Invalid base_unit_qty. Must be a number > 0" });
  }
  if (!isFinite(qtyToAdd) || qtyToAdd < 0) {
    return res.status(400).json({ message: "Invalid quantity. Must be >= 0" });
  }

  const cols = await getIngredientColumns();
  const bqCol = baseQtyColumn(cols);
  const qtyCol = cols.quantity ? "quantity" : null;
  const lastCol = cols.last_updated ? "last_updated" : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT id, ${qtyCol ? `${qtyCol} AS quantity` : "NULL AS quantity"} FROM ingredients WHERE LOWER(ingredient_name) = LOWER(?) FOR UPDATE`,
      [ingredient_name]
    );

    if (existing.length) {
      const current = Number(existing[0].quantity ?? 0);
      const nextQty = qtyCol ? current + qtyToAdd : current;

      const updates = ["category=?", "base_unit=?", `${bqCol}=?`, "status=?"];
      const vals = [category || null, bu, packSize, status || "ACTIVE"];
      if (qtyCol) {
        updates.push(`${qtyCol}=?`);
        vals.push(nextQty);
      }
      if (lastCol) updates.push(`${lastCol}=NOW()`);

      await conn.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, [...vals, existing[0].id]);
      await conn.commit();
      return res.json({ id: existing[0].id, quantity: nextQty, updated: true });
    }

    const fields = ["ingredient_name", "category", "base_unit", bqCol, "status"];
    const placeholders = ["?", "?", "?", "?", "?"];
    const vals = [ingredient_name, category || null, bu, packSize, status || "ACTIVE"];
    if (qtyCol) {
      fields.push(qtyCol);
      placeholders.push("?");
      vals.push(qtyToAdd);
    }
    if (lastCol) {
      fields.push(lastCol);
      placeholders.push("NOW()");
    }

    await conn.query(`INSERT INTO ingredients (${fields.join(",")}) VALUES (${placeholders.join(",")})`, vals);
    await conn.commit();
    res.status(201).json({ created: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save ingredient" });
  } finally {
    conn.release();
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { ingredient_name, category, base_unit, base_unit_qty, status, quantity } = req.body;
  const bu = (base_unit || "").toString().trim().toLowerCase();
  const packSize = Number(base_unit_qty);
  const hasQty = typeof quantity !== "undefined";
  const qtyVal = Number(quantity);

  if (!ALLOWED_UNITS.includes(bu)) {
    return res.status(400).json({ message: `Invalid base_unit. Allowed: ${ALLOWED_UNITS.join(",")}` });
  }
  if (!isFinite(packSize) || packSize <= 0) {
    return res.status(400).json({ message: "Invalid base_unit_qty. Must be a number > 0" });
  }
  if (hasQty && (!isFinite(qtyVal) || qtyVal < 0)) {
    return res.status(400).json({ message: "Invalid quantity. Must be >= 0" });
  }

  const cols = await getIngredientColumns();
  const bqCol = baseQtyColumn(cols);
  const qtyCol = cols.quantity ? "quantity" : null;
  const lastCol = cols.last_updated ? "last_updated" : null;

  const updates = ["ingredient_name=?", "category=?", "base_unit=?", `${bqCol}=?`, "status=?"];
  const vals = [ingredient_name, category || null, bu, packSize, status || "ACTIVE"];
  if (hasQty && qtyCol) {
    updates.push(`${qtyCol}=?`);
    vals.push(qtyVal);
  }
  if (hasQty && lastCol) updates.push(`${lastCol}=NOW()`);

  try {
    await pool.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, [...vals, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /ingredients failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to update ingredient" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE ingredients SET status='INACTIVE' WHERE id=?", [id]);
  res.json({ ok: true });
});

module.exports = router;
