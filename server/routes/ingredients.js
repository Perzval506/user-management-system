const express = require("express");
const pool = require("../db");
const router = express.Router();
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const ALLOWED_UNITS = require("../utils/units");
const { tableExists, columnExists } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { writeInventoryMovement } = require("../utils/inventoryMovements");

const canReadIngredients = requireAnyRole(["OWNER", "STOCKROOM_STAFF", "CASHIER"]);
const canManageIngredients = requireAnyRole(["OWNER", "STOCKROOM_STAFF"]);

router.use(requireAuth);

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

async function categoryTableAvailable() {
  return tableExists("ingredient_categories");
}

async function syncCategoryRegistry(conn, categoryName) {
  const normalized = String(categoryName || "").trim();
  if (!normalized) return;
  if (!(await categoryTableAvailable())) return;

  await conn.query(
    `INSERT INTO ingredient_categories (category_name, status)
     VALUES (?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE status = 'ACTIVE', category_name = VALUES(category_name)`,
    [normalized]
  );
}

router.get("/categories", canReadIngredients, async (_req, res) => {
  try {
    if (await categoryTableAvailable()) {
      const [rows] = await pool.query(
        "SELECT id, category_name, status FROM ingredient_categories WHERE status='ACTIVE' ORDER BY category_name ASC"
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT MIN(id) AS id, category AS category_name, 'ACTIVE' AS status
         FROM ingredients
        WHERE category IS NOT NULL
          AND TRIM(category) <> ''
        GROUP BY category
        ORDER BY category ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error("/ingredients/categories GET failed:", err.message);
    res.status(500).json({ message: "Failed to fetch ingredient categories" });
  }
});

router.post("/categories", canManageIngredients, async (req, res) => {
  const categoryName = String(req.body?.category_name || "").trim();
  if (!categoryName) {
    return res.status(400).json({ message: "category_name is required" });
  }

  if (!(await categoryTableAvailable())) {
    return res.status(503).json({ message: "Ingredient category setup is incomplete. Run the latest database migration first." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO ingredient_categories (category_name, status)
       VALUES (?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE status = 'ACTIVE', category_name = VALUES(category_name)`,
      [categoryName]
    );
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENT_CATEGORIES",
        action_name: "CREATE",
        entity_type: "ingredient_category",
        entity_id: result.insertId || null,
        summary: `Created ingredient category ${categoryName}.`,
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ ok: true, category_name: categoryName });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients/categories failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to create ingredient category" });
  } finally {
    conn.release();
  }
});

router.get("/", canReadIngredients, async (req, res) => {
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

router.get("/:id/history", canReadIngredients, async (req, res) => {
  const ingredientId = Number(req.params.id);
  if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ message: "Invalid ingredient id." });
  }

  try {
    const [[ingredient]] = await pool.query(
      "SELECT id, ingredient_name, base_unit, quantity, status, updated_at, last_updated FROM ingredients WHERE id=?",
      [ingredientId]
    );
    if (!ingredient) return res.status(404).json({ message: "Ingredient not found." });

    const [purchaseRows] = (await tableExists("purchases"))
      ? await pool.query(
          `SELECT id, 'PURCHASE' AS source_type, created_at AS activity_date, quantity, price AS amount, NULL AS brand, NULL AS unit
             FROM purchases
            WHERE LOWER(TRIM(ingredient_name)) = LOWER(TRIM(?))
            ORDER BY created_at DESC, id DESC`,
          [ingredient.ingredient_name]
        )
      : [[]];

    const [poRows] = (await tableExists("purchase_order_details")) && (await tableExists("purchase_orders"))
      ? await pool.query(
          `SELECT pod.id,
                  'PURCHASE_ORDER' AS source_type,
                  po.purchase_date AS activity_date,
                  pod.quantity,
                  pod.subtotal AS amount,
                  pod.brand,
                  pod.unit
             FROM purchase_order_details pod
             JOIN purchase_orders po ON po.id = pod.purchase_order_id
            WHERE pod.ingredient_id = ?
               OR LOWER(TRIM(COALESCE(pod.ingredient_name, ''))) = LOWER(TRIM(?))
            ORDER BY po.purchase_date DESC, pod.id DESC`,
          [ingredientId, ingredient.ingredient_name]
        )
      : [[]];

    const history = [...purchaseRows, ...poRows].sort(
      (a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime()
    );

    res.json({
      ingredient: {
        ...ingredient,
        ingredient_name: String(ingredient.ingredient_name || "").toUpperCase(),
      },
      history,
    });
  } catch (err) {
    console.error("GET /ingredients/:id/history failed:", err.message);
    res.status(500).json({ message: "Failed to fetch ingredient history" });
  }
});

router.post("/", canManageIngredients, async (req, res) => {
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
      await syncCategoryRegistry(conn, category);
      await writeAuditLog(
        {
          ...buildActor(req),
          module_name: "INGREDIENTS",
          action_name: "UPDATE",
          entity_type: "ingredient",
          entity_id: existing[0].id,
          summary: `Updated ingredient ${ingredient_name}.`,
        },
        conn
      );
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

    const [created] = await conn.query(`INSERT INTO ingredients (${fields.join(",")}) VALUES (${placeholders.join(",")})`, vals);
    if (qtyCol && qtyToAdd > 0) {
      await writeInventoryMovement(
        {
          ingredient_id: created.insertId,
          movement_type: "INITIAL_STOCK_IN",
          quantity_change: qtyToAdd,
          resulting_quantity: qtyToAdd,
          unit: bu,
          source_module: "INGREDIENTS",
          reference_type: "ingredient",
          reference_id: created.insertId,
          notes: `Created ingredient ${ingredient_name} with opening stock.`,
          created_by_user_id: req.user?.id || null,
        },
        conn
      );
    }
    await syncCategoryRegistry(conn, category);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "CREATE",
        entity_type: "ingredient",
        entity_id: created.insertId,
        summary: `Created ingredient ${ingredient_name}.`,
      },
      conn
    );
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

router.put("/:id", canManageIngredients, async (req, res) => {
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
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[existing]] = await conn.query(
        `SELECT id, ingredient_name, base_unit, ${qtyCol ? `${qtyCol} AS quantity` : "NULL AS quantity"} FROM ingredients WHERE id=? FOR UPDATE`,
        [id]
      );
      if (!existing) {
        await conn.rollback();
        return res.status(404).json({ message: "Ingredient not found." });
      }
      await conn.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, [...vals, id]);
      if (hasQty && qtyCol) {
        const previousQty = Number(existing.quantity || 0);
        const delta = round2(qtyVal - previousQty);
        if (delta !== 0) {
          await writeInventoryMovement(
            {
              ingredient_id: Number(id),
              movement_type: delta > 0 ? "MANUAL_ADJUSTMENT_IN" : "MANUAL_ADJUSTMENT_OUT",
              quantity_change: delta,
              resulting_quantity: qtyVal,
              unit: bu || existing.base_unit || null,
              source_module: "INGREDIENTS",
              reference_type: "ingredient",
              reference_id: Number(id),
              notes: `Manual stock adjustment for ${ingredient_name}.`,
              created_by_user_id: req.user?.id || null,
            },
            conn
          );
        }
      }
      await syncCategoryRegistry(conn, category);
      await writeAuditLog({
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "UPDATE",
        entity_type: "ingredient",
        entity_id: Number(id),
        summary: `Updated ingredient ${ingredient_name}.`,
      }, conn);
      await conn.commit();
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /ingredients failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to update ingredient" });
  }
});

router.delete("/:id", canManageIngredients, async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE ingredients SET status='INACTIVE' WHERE id=?", [id]);
  await writeAuditLog({
    ...buildActor(req),
    module_name: "INGREDIENTS",
    action_name: "DEACTIVATE",
    entity_type: "ingredient",
    entity_id: Number(id),
    summary: `Set ingredient #${id} to INACTIVE.`,
  });
  res.json({ ok: true });
});

module.exports = router;

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}
