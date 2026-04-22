const express = require("express");
const pool = require("../db");
const router = express.Router();
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const ALLOWED_UNITS = require("../utils/units");
const { tableExists, getColumns } = require("../utils/dbIntrospection");
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
  return cols.current_ap_cost ? "current_ap_cost" : null;
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

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeDateInput(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function updateIngredientCurrentApCost(conn, ingredientId, apCostPerUnit) {
  const column = await currentApCostColumn();
  if (!column) return;
  await conn.query(`UPDATE ingredients SET ${column}=?, last_updated=NOW() WHERE id=?`, [
    Number(apCostPerUnit || 0),
    ingredientId,
  ]);
}

async function getApPriceTableColumns() {
  if (!(await tableExists("ingredient_ap_prices"))) return {};
  return getColumns("ingredient_ap_prices");
}

async function getSupplierQuoteItemColumns() {
  if (!(await tableExists("supplier_quote_items"))) return {};
  return getColumns("supplier_quote_items");
}

async function getIngredientById(ingredientId) {
  const [rows] = await pool.query(
    "SELECT id, ingredient_name, base_unit, quantity, status, updated_at, last_updated FROM ingredients WHERE id=?",
    [ingredientId]
  );
  return rows[0] || null;
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

    const search = String(req.query.q || "").trim();
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
    const ingredient = await getIngredientById(ingredientId);
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

    const apPriceCols = await getApPriceTableColumns();
    const apCostExpr = apPriceCols.ap_cost_per_unit
      ? apPriceCols.ap_unit_cost
        ? "COALESCE(iap.ap_cost_per_unit, iap.ap_unit_cost) AS ap_cost_per_unit"
        : "iap.ap_cost_per_unit"
      : apPriceCols.ap_unit_cost
        ? "iap.ap_unit_cost AS ap_cost_per_unit"
        : "0 AS ap_cost_per_unit";
    const [apPrices] = (await tableExists("ingredient_ap_prices"))
      ? await pool.query(
          `SELECT iap.id, iap.supplier_name, iap.unit, ${apCostExpr}, iap.effective_date, iap.notes, iap.created_at
             FROM ingredient_ap_prices iap
            WHERE iap.ingredient_id = ?
            ORDER BY iap.effective_date DESC, iap.id DESC`,
          [ingredientId]
        )
      : [[]];

    const [quoteRows] = (await tableExists("supplier_quotes")) && (await tableExists("supplier_quote_items"))
      ? await pool.query(
          `SELECT sq.id,
                  sq.supplier_name,
                  sq.quote_date,
                  sq.valid_until,
                  sq.status,
                  sq.notes,
                  sq.created_at,
                  sqi.id AS quote_item_id,
                  sqi.brand,
                  sqi.unit,
                  sqi.quantity,
                  sqi.quoted_price,
                  sqi.notes AS item_notes
             FROM supplier_quotes sq
             JOIN supplier_quote_items sqi ON sqi.supplier_quote_id = sq.id
            WHERE sqi.ingredient_id = ?
               OR LOWER(TRIM(COALESCE(sqi.ingredient_name, ''))) = LOWER(TRIM(?))
            ORDER BY sq.quote_date DESC, sq.id DESC, sqi.id DESC`,
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
      current_ap_cost: apPrices.length ? Number(apPrices[0].ap_cost_per_unit || 0) : null,
      history,
      ap_prices: apPrices,
      supplier_quotes: quoteRows,
    });
  } catch (err) {
    console.error("GET /ingredients/:id/history failed:", err.message);
    res.status(500).json({ message: "Failed to fetch ingredient history" });
  }
});

router.post("/:id/ap-prices", canManageIngredients, async (req, res) => {
  const ingredientId = Number(req.params.id);
  const supplierName = String(req.body?.supplierName || req.body?.supplier_name || "").trim() || null;
  const unit = String(req.body?.unit || "").trim().toLowerCase();
  const notes = String(req.body?.notes || "").trim() || null;
  const effectiveDate = normalizeDateInput(req.body?.effectiveDate || req.body?.effective_date);
  const apCostPerUnit = Number(req.body?.apCostPerUnit ?? req.body?.ap_cost_per_unit);

  if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ message: "Invalid ingredient id." });
  }
  if (!(await tableExists("ingredient_ap_prices"))) {
    return res.status(503).json({ message: "AP pricing table is missing required columns. Run the latest database setup first." });
  }
  if (!unit || !ALLOWED_UNITS.includes(unit)) {
    return res.status(400).json({ message: `Invalid unit. Allowed: ${ALLOWED_UNITS.join(", ")}` });
  }
  if (!Number.isFinite(apCostPerUnit) || apCostPerUnit < 0) {
    return res.status(400).json({ message: "AP cost per unit must be 0 or greater." });
  }
  if (!effectiveDate) {
    return res.status(400).json({ message: "effectiveDate must be a valid date." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ingredient = await getIngredientById(ingredientId);
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }

    const apPriceCols = await getApPriceTableColumns();
    const fields = ["ingredient_id", "effective_date"];
    const placeholders = ["?", "?"];
    const values = [ingredientId, effectiveDate];
    if (apPriceCols.supplier_name) {
      fields.push("supplier_name");
      placeholders.push("?");
      values.push(supplierName);
    }
    if (apPriceCols.unit) {
      fields.push("unit");
      placeholders.push("?");
      values.push(unit);
    }
    if (apPriceCols.ap_cost_per_unit) {
      fields.push("ap_cost_per_unit");
      placeholders.push("?");
      values.push(apCostPerUnit);
    }
    if (apPriceCols.ap_unit_cost) {
      fields.push("ap_unit_cost");
      placeholders.push("?");
      values.push(round2(apCostPerUnit));
    }
    if (apPriceCols.notes) {
      fields.push("notes");
      placeholders.push("?");
      values.push(notes);
    }
    if (apPriceCols.source) {
      fields.push("source");
      placeholders.push("?");
      values.push("MANUAL");
    }
    if (apPriceCols.reference_no) {
      fields.push("reference_no");
      placeholders.push("?");
      values.push(null);
    }
    if (apPriceCols.created_by) {
      fields.push("created_by");
      placeholders.push("?");
      values.push(req.user?.id || null);
    }

    const [result] = await conn.query(
      `INSERT INTO ingredient_ap_prices (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );

    await updateIngredientCurrentApCost(conn, ingredientId, apCostPerUnit);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "AP_PRICE_CREATE",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Saved AP cost for ${ingredient.ingredient_name}.`,
        metadata: {
          supplier_name: supplierName,
          unit,
          ap_cost_per_unit: apCostPerUnit,
          effective_date: effectiveDate,
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients/:id/ap-prices failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save AP price" });
  } finally {
    conn.release();
  }
});

router.post("/:id/ap-prices/:priceId/rollback", canManageIngredients, async (req, res) => {
  const ingredientId = Number(req.params.id);
  const priceId = Number(req.params.priceId);
  if (!Number.isFinite(ingredientId) || ingredientId <= 0 || !Number.isFinite(priceId) || priceId <= 0) {
    return res.status(400).json({ message: "Invalid ingredient or AP price id." });
  }
  if (!(await tableExists("ingredient_ap_prices"))) {
    return res.status(503).json({ message: "AP pricing table is missing required columns. Run the latest database setup first." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ingredient = await getIngredientById(ingredientId);
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }
    const [rows] = await conn.query(
      `SELECT * FROM ingredient_ap_prices WHERE id=? AND ingredient_id=? LIMIT 1`,
      [priceId, ingredientId]
    );
    const apRow = rows[0];
    if (!apRow) {
      await conn.rollback();
      return res.status(404).json({ message: "AP price record not found." });
    }

    const apPriceCols = await getApPriceTableColumns();
    const fields = ["ingredient_id", "effective_date"];
    const placeholders = ["?", "?"];
    const values = [ingredientId, new Date().toISOString().slice(0, 10)];
    if (apPriceCols.supplier_name) {
      fields.push("supplier_name");
      placeholders.push("?");
      values.push(apRow.supplier_name || null);
    }
    if (apPriceCols.unit) {
      fields.push("unit");
      placeholders.push("?");
      values.push(apRow.unit || ingredient.base_unit);
    }
    if (apPriceCols.ap_cost_per_unit) {
      fields.push("ap_cost_per_unit");
      placeholders.push("?");
      values.push(Number(apRow.ap_cost_per_unit ?? apRow.ap_unit_cost ?? 0));
    }
    if (apPriceCols.ap_unit_cost) {
      fields.push("ap_unit_cost");
      placeholders.push("?");
      values.push(round2(Number(apRow.ap_unit_cost ?? apRow.ap_cost_per_unit ?? 0)));
    }
    if (apPriceCols.notes) {
      fields.push("notes");
      placeholders.push("?");
      values.push(`Rollback to AP price #${priceId}${apRow.notes ? ` | ${apRow.notes}` : ""}`);
    }
    if (apPriceCols.source) {
      fields.push("source");
      placeholders.push("?");
      values.push("ROLLBACK");
    }
    if (apPriceCols.reference_no) {
      fields.push("reference_no");
      placeholders.push("?");
      values.push(`AP-${priceId}`);
    }
    if (apPriceCols.created_by) {
      fields.push("created_by");
      placeholders.push("?");
      values.push(req.user?.id || null);
    }

    const [result] = await conn.query(
      `INSERT INTO ingredient_ap_prices (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );

    await updateIngredientCurrentApCost(conn, ingredientId, Number(apRow.ap_cost_per_unit ?? apRow.ap_unit_cost ?? 0));
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "AP_PRICE_ROLLBACK",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Rolled back AP cost for ${ingredient.ingredient_name}.`,
        metadata: {
          source_ap_price_id: priceId,
          restored_price_id: result.insertId,
          ap_cost_per_unit: Number(apRow.ap_cost_per_unit ?? apRow.ap_unit_cost ?? 0),
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients/:id/ap-prices/:priceId/rollback failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to rollback AP price" });
  } finally {
    conn.release();
  }
});

router.post("/:id/supplier-quotes", canManageIngredients, async (req, res) => {
  const ingredientId = Number(req.params.id);
  const supplierName = String(req.body?.supplierName || req.body?.supplier_name || "").trim();
  const brand = String(req.body?.brand || "").trim() || null;
  const unit = String(req.body?.unit || "").trim().toLowerCase();
  const quoteDate = normalizeDateInput(req.body?.quoteDate || req.body?.quote_date);
  const validUntil = req.body?.validUntil || req.body?.valid_until ? normalizeDateInput(req.body?.validUntil || req.body?.valid_until) : null;
  const quantity = req.body?.quantity === "" || req.body?.quantity == null ? null : Number(req.body?.quantity);
  const quotedPrice = Number(req.body?.quotedPrice ?? req.body?.quoted_price);
  const notes = String(req.body?.notes || "").trim() || null;

  if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ message: "Invalid ingredient id." });
  }
  if (!(await tableExists("supplier_quotes")) || !(await tableExists("supplier_quote_items"))) {
    return res.status(503).json({ message: "Supplier quote tables are missing required columns. Run the latest database setup first." });
  }
  if (!supplierName) {
    return res.status(400).json({ message: "Supplier name is required." });
  }
  if (!quoteDate) {
    return res.status(400).json({ message: "quoteDate must be a valid date." });
  }
  if (!unit || !ALLOWED_UNITS.includes(unit)) {
    return res.status(400).json({ message: `Invalid unit. Allowed: ${ALLOWED_UNITS.join(", ")}` });
  }
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
    return res.status(400).json({ message: "Quoted quantity must be greater than 0 when provided." });
  }
  if (!Number.isFinite(quotedPrice) || quotedPrice < 0) {
    return res.status(400).json({ message: "Quoted price must be 0 or greater." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ingredient = await getIngredientById(ingredientId);
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }

    const [quoteResult] = await conn.query(
      `INSERT INTO supplier_quotes
        (supplier_name, quote_date, valid_until, status, notes)
       VALUES (?,?,?,?,?)`,
      [supplierName, quoteDate, validUntil, "RECEIVED", notes]
    );

    const quoteItemCols = await getSupplierQuoteItemColumns();
    const itemFields = [];
    const itemPlaceholders = [];
    const itemValues = [];
    if (quoteItemCols.quote_id) {
      itemFields.push("quote_id");
      itemPlaceholders.push("?");
      itemValues.push(quoteResult.insertId);
    }
    if (quoteItemCols.supplier_quote_id) {
      itemFields.push("supplier_quote_id");
      itemPlaceholders.push("?");
      itemValues.push(quoteResult.insertId);
    }
    if (quoteItemCols.ingredient_id) {
      itemFields.push("ingredient_id");
      itemPlaceholders.push("?");
      itemValues.push(ingredientId);
    }
    if (quoteItemCols.ingredient_name) {
      itemFields.push("ingredient_name");
      itemPlaceholders.push("?");
      itemValues.push(ingredient.ingredient_name);
    }
    if (quoteItemCols.brand) {
      itemFields.push("brand");
      itemPlaceholders.push("?");
      itemValues.push(brand);
    }
    if (quoteItemCols.unit) {
      itemFields.push("unit");
      itemPlaceholders.push("?");
      itemValues.push(unit);
    }
    if (quoteItemCols.quantity) {
      itemFields.push("quantity");
      itemPlaceholders.push("?");
      itemValues.push(quantity);
    }
    if (quoteItemCols.quoted_price) {
      itemFields.push("quoted_price");
      itemPlaceholders.push("?");
      itemValues.push(quotedPrice);
    }
    if (quoteItemCols.quoted_unit_cost) {
      itemFields.push("quoted_unit_cost");
      itemPlaceholders.push("?");
      itemValues.push(round2(quotedPrice));
    }
    if (quoteItemCols.effective_date) {
      itemFields.push("effective_date");
      itemPlaceholders.push("?");
      itemValues.push(validUntil || quoteDate);
    }
    if (quoteItemCols.notes) {
      itemFields.push("notes");
      itemPlaceholders.push("?");
      itemValues.push(notes);
    }

    const [itemResult] = await conn.query(
      `INSERT INTO supplier_quote_items (${itemFields.join(", ")}) VALUES (${itemPlaceholders.join(", ")})`,
      itemValues
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "SUPPLIER_QUOTE_CREATE",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Saved supplier quote for ${ingredient.ingredient_name}.`,
        metadata: {
          supplier_name: supplierName,
          quoted_price: quotedPrice,
          quote_date: quoteDate,
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: quoteResult.insertId, quote_item_id: itemResult.insertId, ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients/:id/supplier-quotes failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save supplier quote" });
  } finally {
    conn.release();
  }
});

router.post("/:id/supplier-quotes/:quoteId/use", canManageIngredients, async (req, res) => {
  const ingredientId = Number(req.params.id);
  const quoteId = Number(req.params.quoteId);
  if (!Number.isFinite(ingredientId) || ingredientId <= 0 || !Number.isFinite(quoteId) || quoteId <= 0) {
    return res.status(400).json({ message: "Invalid ingredient or supplier quote id." });
  }
  if (!(await tableExists("supplier_quotes")) || !(await tableExists("supplier_quote_items")) || !(await tableExists("ingredient_ap_prices"))) {
    return res.status(503).json({ message: "Quote to AP conversion setup is incomplete. Run the latest database setup first." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ingredient = await getIngredientById(ingredientId);
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }

    const quoteItemCols = await getSupplierQuoteItemColumns();
    const quoteJoinColumn = quoteItemCols.supplier_quote_id
      ? "sqi.supplier_quote_id"
      : quoteItemCols.quote_id
        ? "sqi.quote_id"
        : null;
    const quotedPriceExpr = quoteItemCols.quoted_price && quoteItemCols.quoted_unit_cost
      ? "COALESCE(sqi.quoted_price, sqi.quoted_unit_cost)"
      : quoteItemCols.quoted_price
        ? "sqi.quoted_price"
        : quoteItemCols.quoted_unit_cost
          ? "sqi.quoted_unit_cost"
          : "0";
    if (!quoteJoinColumn) {
      await conn.rollback();
      return res.status(503).json({ message: "Supplier quote item link columns are missing. Run the latest database setup first." });
    }

    const [rows] = await conn.query(
      `SELECT sq.id, sq.supplier_name, sq.quote_date, sqi.id AS quote_item_id, sqi.unit,
              ${quotedPriceExpr} AS quoted_price
         FROM supplier_quotes sq
         JOIN supplier_quote_items sqi ON ${quoteJoinColumn} = sq.id
        WHERE sq.id = ?
          AND (sqi.ingredient_id = ? OR LOWER(TRIM(COALESCE(sqi.ingredient_name, ''))) = LOWER(TRIM(?)))
        ORDER BY sqi.id DESC
        LIMIT 1`,
      [quoteId, ingredientId, ingredient.ingredient_name]
    );
    const quote = rows[0];
    if (!quote) {
      await conn.rollback();
      return res.status(404).json({ message: "Supplier quote not found for this ingredient." });
    }

    const apPriceCols = await getApPriceTableColumns();
    const fields = ["ingredient_id", "effective_date"];
    const placeholders = ["?", "?"];
    const values = [ingredientId, quote.quote_date];
    if (apPriceCols.supplier_name) {
      fields.push("supplier_name");
      placeholders.push("?");
      values.push(quote.supplier_name || null);
    }
    if (apPriceCols.unit) {
      fields.push("unit");
      placeholders.push("?");
      values.push(quote.unit || ingredient.base_unit);
    }
    if (apPriceCols.ap_cost_per_unit) {
      fields.push("ap_cost_per_unit");
      placeholders.push("?");
      values.push(Number(quote.quoted_price || 0));
    }
    if (apPriceCols.ap_unit_cost) {
      fields.push("ap_unit_cost");
      placeholders.push("?");
      values.push(round2(Number(quote.quoted_price || 0)));
    }
    if (apPriceCols.notes) {
      fields.push("notes");
      placeholders.push("?");
      values.push(`Applied from supplier quote #${quoteId}`);
    }
    if (apPriceCols.source) {
      fields.push("source");
      placeholders.push("?");
      values.push("SUPPLIER_QUOTE");
    }
    if (apPriceCols.reference_no) {
      fields.push("reference_no");
      placeholders.push("?");
      values.push(`QUOTE-${quoteId}`);
    }
    if (apPriceCols.created_by) {
      fields.push("created_by");
      placeholders.push("?");
      values.push(req.user?.id || null);
    }

    const [result] = await conn.query(
      `INSERT INTO ingredient_ap_prices (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );

    await updateIngredientCurrentApCost(conn, ingredientId, quote.quoted_price);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INGREDIENTS",
        action_name: "SUPPLIER_QUOTE_APPLY",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Applied supplier quote to AP pricing for ${ingredient.ingredient_name}.`,
        metadata: {
          supplier_quote_id: quoteId,
          ap_price_id: result.insertId,
          quoted_price: Number(quote.quoted_price || 0),
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /ingredients/:id/supplier-quotes/:quoteId/use failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to use supplier quote" });
  } finally {
    conn.release();
  }
});

router.post("/", canManageIngredients, async (req, res) => {
  const { ingredient_name, category, base_unit, base_unit_qty, status, quantity } = req.body;
  const bu = String(base_unit || "").trim().toLowerCase();
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
  const bu = String(base_unit || "").trim().toLowerCase();
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
