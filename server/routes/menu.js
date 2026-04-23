const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { computeMenuItemCosting } = require("../utils/costing");
const router = express.Router();

const MENU_STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const MENU_TYPES = new Set(["FOOD", "DRINK", "ADD_ON"]);

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function validateMenuPayload(body, { requireName = true } = {}) {
  const menuName = String(body.menu_name || "").trim();
  const description = normalizeOptionalText(body.description);
  const recipeName = String(body.recipe_name || "").trim();
  const recipeDescription = normalizeOptionalText(body.recipe_description);
  const status = String(body.status || "ACTIVE").trim().toUpperCase();
  const menuType = String(body.menu_type || "FOOD").trim().toUpperCase();
  const result = {
    menuName,
    description,
    recipeName: recipeName || null,
    recipeDescription,
    status,
    menuType,
    targetFoodCostPercent: null,
    sellingPrice: undefined,
  };

  if (requireName && !menuName) {
    return { error: "menu_name is required" };
  }
  if (!MENU_STATUSES.has(status)) {
    return { error: "status must be ACTIVE or INACTIVE" };
  }
  if (!MENU_TYPES.has(menuType)) {
    return { error: "menu_type must be FOOD, DRINK, or ADD_ON" };
  }

  if (typeof body.target_food_cost_percent !== "undefined" && body.target_food_cost_percent !== "" && body.target_food_cost_percent !== null) {
    const tfcp = Number(body.target_food_cost_percent);
    if (!Number.isFinite(tfcp) || tfcp <= 0 || tfcp >= 1) {
      return { error: "target_food_cost_percent must be greater than 0 and less than 1" };
    }
    result.targetFoodCostPercent = tfcp;
  }

  if (typeof body.selling_price !== "undefined") {
    const sellingPrice = Number(body.selling_price);
    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      return { error: "selling_price must be greater than 0" };
    }
    result.sellingPrice = sellingPrice;
  }

  return { value: result };
}

let cachedMenuCols = null;
async function getMenuColumns() {
  if (cachedMenuCols) return cachedMenuCols;
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM menu_items");
    cachedMenuCols = rows.reduce((acc, row) => {
      acc[row.Field] = true;
      return acc;
    }, {});
  } catch (err) {
    console.error("Unable to inspect menu_items table:", err.message);
    cachedMenuCols = {};
  }
  return cachedMenuCols;
}

async function createRecipeAndVersion(conn, {
  recipeName,
  recipeDescription = null,
  userId = null,
  yieldAmount = null,
  yieldUnit = null,
  portionSize = null,
  portionUnit = null,
} = {}) {
  const [recipeResult] = await conn.query(
    "INSERT INTO recipes (recipe_name, description, created_by, status) VALUES (?,?,?,?)",
    [recipeName, recipeDescription, userId, "ACTIVE"]
  );
  const recipeId = recipeResult.insertId;

  const [versionResult] = await conn.query(
    `INSERT INTO recipe_versions
      (recipe_id, version_no, yield_amount, yield_unit, portion_size, portion_unit, is_active, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [recipeId, 1, yieldAmount, yieldUnit, portionSize, portionUnit, 1, userId]
  );

  return { recipeId, recipeVersionId: versionResult.insertId };
}

async function getCurrentPriceMap(connOrPool) {
  const [rows] = await connOrPool.query(
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

async function buildMenuCostingDetails(connOrPool, menuItem) {
  if (!menuItem?.recipe_version_id) return null;

  const ingredientCols = await getColumns("ingredients");
  const recipeIngredientCols = await getColumns("recipe_ingredients");
  const hasCurrentApCost = Boolean(ingredientCols.current_ap_cost);
  const hasRecipeLinePrice = Boolean(recipeIngredientCols.price);
  const hasYieldPercent = Boolean(recipeIngredientCols.yield_percent);
  const apCostSelect = hasCurrentApCost ? ", i.current_ap_cost" : ", NULL AS current_ap_cost";
  const priceSelect = hasRecipeLinePrice ? "ri.price" : "NULL AS price";
  const yieldPercentSelect = hasYieldPercent ? "ri.yield_percent" : "NULL AS yield_percent";
  const [ingredients] = await connOrPool.query(
    `SELECT ri.ingredient_id, ri.qty_used, ri.qty_unit, ${priceSelect}, ${yieldPercentSelect},
            i.ingredient_name, i.base_unit${apCostSelect}
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_version_id = ?`,
    [menuItem.recipe_version_id]
  );

  const ingredientPayload = ingredients.map((line) => ({
    ingredient_id: line.ingredient_id,
    ingredient_name: line.ingredient_name,
    quantity_used: Number(line.qty_used || 0),
    quantity_unit: line.qty_unit,
    base_unit: line.base_unit,
    ap_cost_per_unit:
      line.price !== null && typeof line.price !== "undefined"
        ? Number(line.price || 0)
        : Number(line.current_ap_cost || 0),
    uses_manual_unit_cost: line.price !== null && typeof line.price !== "undefined",
    yield_percent:
      line.yield_percent !== null && typeof line.yield_percent !== "undefined"
        ? Number(line.yield_percent || 0)
        : 100,
  }));

  const costing = computeMenuItemCosting({
    ingredients: ingredientPayload,
    total_yield_grams: Number(menuItem.yield_amount || 0),
    portion_size_grams: Number(menuItem.portion_size || 0),
    target_food_cost_percent: Number(menuItem.target_food_cost_percent || 0),
    current_selling_price: Number(menuItem.selling_price || 0),
  });

  return {
    ingredients: costing.items,
    costing,
  };
}

function buildPromotionPricing(promo, currentPrice) {
  const price = Number(currentPrice || 0);
  const promoValue = Number(promo?.promo_value ?? promo?.discount_value ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  const promoType = String(promo?.promo_type || promo?.discount_type || "").toUpperCase();
  if (promoType === "PERCENT") {
    return Math.max(round2(price - price * (promoValue / 100)), 0);
  }
  return Math.max(round2(price - promoValue), 0);
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

// GET list with latest price (by effective_date)
router.get("/", async (req, res) => {
  try {
    const sql = `SELECT m.*, rv.yield_amount, rv.yield_unit, rv.portion_size, rv.portion_unit
      FROM menu_items m
      LEFT JOIN recipe_versions rv ON rv.id = m.recipe_version_id
      ORDER BY m.menu_name ASC`;
    const [rows] = await pool.query(sql);
    const currentPriceMap = await getCurrentPriceMap(pool);
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const currentPrice = currentPriceMap[row.id] || null;
        const baseRow = {
          ...row,
          selling_price: currentPrice?.selling_price ?? null,
          effective_date: currentPrice?.effective_date ?? null,
        };
        const costingDetails = await buildMenuCostingDetails(pool, baseRow);
        if (!costingDetails) {
          return {
            ...baseRow,
            costing_status: "No Recipe",
            suggested_price: null,
            cost_per_portion: null,
            profit_per_portion: null,
            profit_margin: null,
            actual_food_cost_percent: null,
            number_of_portions: null,
            has_unit_mismatch: false,
          };
        }
        return {
          ...baseRow,
          costing_status: costingDetails.costing.status,
          suggested_price: costingDetails.costing.suggested_price,
          cost_per_portion: costingDetails.costing.cost_per_portion,
          profit_per_portion: costingDetails.costing.profit_per_portion,
          profit_margin: costingDetails.costing.profit_margin,
          actual_food_cost_percent: costingDetails.costing.actual_food_cost_percent,
          number_of_portions: costingDetails.costing.number_of_portions,
          has_unit_mismatch: costingDetails.costing.has_unit_mismatch,
        };
      })
    );
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

router.get("/:id/costing-report", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const currentPriceMap = await getCurrentPriceMap(pool);
    const [[menu]] = await pool.query(
      `SELECT m.*, rv.yield_amount, rv.yield_unit, rv.portion_size, rv.portion_unit, r.recipe_name, r.description AS recipe_description
         FROM menu_items m
         LEFT JOIN recipe_versions rv ON rv.id = m.recipe_version_id
         LEFT JOIN recipes r ON r.id = rv.recipe_id
        WHERE m.id = ?`,
      [id]
    );
    if (!menu) return res.status(404).json({ error: "Menu item not found" });
    const currentPrice = currentPriceMap[menu.id] || null;
    const menuWithPrice = {
      ...menu,
      selling_price: currentPrice?.selling_price ?? null,
      effective_date: currentPrice?.effective_date ?? null,
    };
    const costingDetails = await buildMenuCostingDetails(pool, menuWithPrice);
    res.json({
      menu: menuWithPrice,
      recipe_name: menu.recipe_name || menu.menu_name,
      recipe_description: menu.recipe_description || null,
      costing: costingDetails?.costing || null,
      ingredients: costingDetails?.ingredients || [],
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /menu/:id/costing-report failed:", err.message);
    res.status(500).json({ error: "Failed to fetch costing report" });
  }
});

// Create menu item variant + recipe + recipe_version + initial price_history
router.post("/", requireAuth, requireRole("OWNER"), async (req, res) => {
  const validated = validateMenuPayload(req.body, { requireName: true });
  if (validated.error) return res.status(400).json({ error: validated.error });
  const {
    menuName,
    description,
    status,
    menuType,
    sellingPrice,
    recipeName,
    recipeDescription,
    targetFoodCostPercent,
  } = validated.value;
  const cols = await getMenuColumns();
  const hasTargetCost = !!cols.target_food_cost_percent;
  const hasMenuType = !!cols.menu_type;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { recipeVersionId } = await createRecipeAndVersion(conn, {
      recipeName: recipeName || menuName,
      recipeDescription,
    });

    // create menu item linked to this recipe_version
    const fields = ["menu_name", "description", "recipe_version_id"];
    const placeholders = ["?", "?", "?"];
    const values = [menuName, description, recipeVersionId];
    if (hasMenuType) {
      fields.push("menu_type");
      placeholders.push("?");
      values.push(menuType);
    }
    if (hasTargetCost) {
      fields.push("target_food_cost_percent");
      placeholders.push("?");
      values.push(targetFoodCostPercent);
    }
    fields.push("status");
    placeholders.push("?");
    values.push(status || "ACTIVE");

    const [rMenu] = await conn.query(
      `INSERT INTO menu_items (${fields.join(",")}) VALUES (${placeholders.join(",")})`,
      values
    );
    const menuItemId = rMenu.insertId;

    // initial price history
    if (typeof sellingPrice !== "undefined") {
      await conn.query(
        'INSERT INTO menu_price_history (menu_item_id, selling_price, effective_date) VALUES (?,?,?)',
        [menuItemId, sellingPrice, new Date()]
      );
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "MENU",
        action_name: "CREATE",
        entity_type: "menu_item",
        entity_id: menuItemId,
        summary: `Created menu item ${menuName}.`,
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: menuItemId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to create menu item' });
  } finally {
    conn.release();
  }
});

// Update basic menu item fields (keep recipe link intact)
router.put("/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id } = req.params;
  const validated = validateMenuPayload(req.body, { requireName: true });
  if (validated.error) return res.status(400).json({ error: validated.error });
  const {
    menuName,
    description,
    status,
    menuType,
    targetFoodCostPercent,
  } = validated.value;
  try {
    const cols = await getMenuColumns();
    const hasTargetCost = !!cols.target_food_cost_percent;
    const hasMenuType = !!cols.menu_type;
    const updates = ["menu_name=?", "description=?", "status=?"];
    const vals = [menuName, description, status];
    if (hasMenuType) {
      updates.splice(2, 0, "menu_type=?");
      vals.splice(2, 0, menuType);
    }
    if (hasTargetCost) {
      const targetIndex = hasMenuType ? 3 : 2;
      updates.splice(targetIndex, 0, "target_food_cost_percent=?");
      vals.splice(targetIndex, 0, targetFoodCostPercent);
    }
    await pool.query(
      `UPDATE menu_items SET ${updates.join(", ")} WHERE id=?`,
      [...vals, id]
    );
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "UPDATE",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Updated menu item ${menuName}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// Soft-delete / deactivate
router.delete("/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE menu_items SET status='INACTIVE' WHERE id=?", [id]);
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "DEACTIVATE",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Set menu item #${id} to INACTIVE.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to deactivate menu item' });
  }
});

// Add new price history row
router.post("/:id/price", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id } = req.params;
  const { selling_price, effective_date, reason, notes } = req.body;
  if (typeof selling_price === 'undefined') return res.status(400).json({ error: 'selling_price is required' });
  const sellingPrice = Number(selling_price);
  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return res.status(400).json({ error: "selling_price must be greater than 0" });
  }
  if (effective_date && !isValidDate(effective_date)) {
    return res.status(400).json({ error: "effective_date must be a valid date" });
  }
  try {
    const ed = effective_date ? new Date(effective_date) : new Date();
    const priceHistoryCols = (await tableExists("menu_price_history")) ? await getColumns("menu_price_history") : {};
    const fields = ["menu_item_id", "selling_price", "effective_date"];
    const placeholders = ["?", "?", "?"];
    const values = [id, sellingPrice, ed];
    if (priceHistoryCols.change_reason) {
      fields.push("change_reason");
      placeholders.push("?");
      values.push("MANUAL");
    }
    if (priceHistoryCols.notes) {
      fields.push("notes");
      placeholders.push("?");
      values.push(String(reason || notes || "").trim() || null);
    }
    if (priceHistoryCols.created_by) {
      fields.push("created_by");
      placeholders.push("?");
      values.push(req.user?.id || null);
    }
    await pool.query(
      `INSERT INTO menu_price_history (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "PRICE_UPDATE",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Updated menu price to ${sellingPrice.toFixed(2)}.`,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add price' });
  }
});

router.get("/:id/price-history", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    if (!(await tableExists("menu_price_history"))) return res.json([]);
    const cols = await getColumns("menu_price_history");
    const [rows] = await pool.query(
      `SELECT mph.id,
              mph.menu_item_id,
              mph.selling_price,
              mph.effective_date,
              ${cols.notes ? "mph.notes" : "NULL AS notes"},
              ${cols.change_reason ? "mph.change_reason" : "NULL AS change_reason"},
              ${cols.synced_to_pos ? "mph.synced_to_pos" : "0 AS synced_to_pos"},
              ${cols.synced_at ? "mph.synced_at" : "NULL AS synced_at"},
              ${cols.synced_by ? "mph.synced_by" : "NULL AS synced_by"},
              ${cols.created_by ? "mph.created_by" : "NULL AS created_by"},
              mph.created_at,
              u.full_name AS created_by_name,
              su.full_name AS synced_by_name
         FROM menu_price_history mph
         LEFT JOIN users u ON u.id = ${cols.created_by ? "mph.created_by" : "NULL"}
         LEFT JOIN users su ON su.id = ${cols.synced_by ? "mph.synced_by" : "NULL"}
        WHERE mph.menu_item_id = ?
        ORDER BY mph.effective_date DESC, mph.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /menu/:id/price-history failed:", err.message);
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

router.post("/:id/price-history/:historyId/mark-synced", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id, historyId } = req.params;
  try {
    if (!(await tableExists("menu_price_history"))) {
      return res.status(503).json({ error: "Price history setup is incomplete." });
    }
    const cols = await getColumns("menu_price_history");
    if (!cols.synced_to_pos) {
      return res.status(503).json({ error: "Price sync tracking is not available in this database yet." });
    }
    const updates = ["synced_to_pos = 1"];
    const values = [];
    if (cols.synced_at) updates.push("synced_at = NOW()");
    if (cols.synced_by) {
      updates.push("synced_by = ?");
      values.push(req.user?.id || null);
    }
    values.push(historyId, id);
    await pool.query(
      `UPDATE menu_price_history SET ${updates.join(", ")} WHERE id = ? AND menu_item_id = ?`,
      values
    );
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "PRICE_SYNC",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Marked menu price history #${historyId} as synced.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /menu/:id/price-history/:historyId/mark-synced failed:", err.message);
    res.status(500).json({ error: "Failed to mark price as synced" });
  }
});

router.get("/:id/promotions", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    if (!(await tableExists("menu_promotions"))) return res.json([]);
    const currentPriceMap = await getCurrentPriceMap(pool);
    const currentPrice = currentPriceMap[id]?.selling_price || 0;
    const cols = await getColumns("menu_promotions");
    const promoTypeExpr = cols.promo_type
      ? "mp.promo_type"
      : cols.discount_type
        ? "mp.discount_type"
        : "NULL";
    const promoValueExpr = cols.promo_value
      ? "mp.promo_value"
      : cols.discount_value
        ? "mp.discount_value"
        : "0";
    const notesExpr = cols.notes ? "mp.notes" : "NULL";
    const [rows] = await pool.query(
      `SELECT mp.*,
              ${promoTypeExpr} AS normalized_promo_type,
              ${promoValueExpr} AS normalized_promo_value,
              ${notesExpr} AS normalized_notes
         FROM menu_promotions mp
        WHERE mp.menu_item_id = ?
        ORDER BY mp.start_date DESC, mp.id DESC`,
      [id]
    );
    res.json(
      rows.map((row) => ({
        ...row,
        promo_type: row.normalized_promo_type,
        promo_value: Number(row.normalized_promo_value || 0),
        notes: row.normalized_notes,
        discounted_price: buildPromotionPricing(row, currentPrice),
      }))
    );
  } catch (err) {
    console.error("GET /menu/:id/promotions failed:", err.message);
    res.status(500).json({ error: "Failed to fetch promotions" });
  }
});

router.post("/:id/promotions", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id } = req.params;
  const promoName = String(req.body?.promo_name || req.body?.promoName || "").trim();
  const promoType = String(req.body?.promo_type || req.body?.promoType || "FIXED").trim().toUpperCase();
  const promoValue = Number(req.body?.promo_value ?? req.body?.promoValue);
  const startDate = req.body?.start_date || req.body?.startDate;
  const rawEndDate = req.body?.end_date || req.body?.endDate || null;
  const endDate = rawEndDate || startDate;
  const rawStatus = String(req.body?.status || "ACTIVE").trim().toUpperCase();
  const statusMap = {
    DRAFT: "SCHEDULED",
    INACTIVE: "ENDED",
  };
  const status = statusMap[rawStatus] || rawStatus;
  const notes = String(req.body?.notes || "").trim() || null;

  if (!(await tableExists("menu_promotions"))) {
    return res.status(503).json({ error: "Promotion setup is incomplete. Run the latest database setup first." });
  }
  if (!promoName) return res.status(400).json({ error: "promo_name is required" });
  if (!["FIXED", "PERCENT"].includes(promoType)) return res.status(400).json({ error: "promo_type must be FIXED or PERCENT" });
  if (!Number.isFinite(promoValue) || promoValue < 0) return res.status(400).json({ error: "promo_value must be 0 or greater" });
  if (!isValidDate(startDate)) return res.status(400).json({ error: "start_date must be a valid date" });
  if (!isValidDate(endDate)) return res.status(400).json({ error: "end_date must be a valid date" });
  if (!["SCHEDULED", "ACTIVE", "ENDED"].includes(status)) {
    return res.status(400).json({ error: "status must be SCHEDULED, ACTIVE, or ENDED" });
  }

  try {
    const cols = await getColumns("menu_promotions");
    const fields = ["menu_item_id", "promo_name", "start_date", "end_date", "status"];
    const placeholders = ["?", "?", "?", "?", "?"];
    const values = [id, promoName, startDate, endDate, status];
    if (cols.promo_type) {
      fields.push("promo_type");
      placeholders.push("?");
      values.push(promoType);
    }
    if (cols.discount_type) {
      fields.push("discount_type");
      placeholders.push("?");
      values.push(promoType);
    }
    if (cols.promo_value) {
      fields.push("promo_value");
      placeholders.push("?");
      values.push(promoValue);
    }
    if (cols.discount_value) {
      fields.push("discount_value");
      placeholders.push("?");
      values.push(promoValue);
    }
    if (cols.notes) {
      fields.push("notes");
      placeholders.push("?");
      values.push(notes);
    }
    if (cols.created_by) {
      fields.push("created_by");
      placeholders.push("?");
      values.push(req.user?.id || null);
    }

    const [result] = await pool.query(
      `INSERT INTO menu_promotions (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      values
    );
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "PROMOTION_CREATE",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Created promotion ${promoName}.`,
    });
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error("POST /menu/:id/promotions failed:", err.message);
    res.status(500).json({ error: "Failed to create promotion" });
  }
});

router.get("/:id/recipe-versions", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[menu]] = await pool.query("SELECT * FROM menu_items WHERE id=?", [id]);
    if (!menu || !menu.recipe_version_id) return res.json([]);

    const [[activeVersion]] = await pool.query("SELECT * FROM recipe_versions WHERE id=?", [menu.recipe_version_id]);
    if (!activeVersion) return res.json([]);

    const [versions] = await pool.query(
      `SELECT rv.*,
              (SELECT COUNT(*) FROM recipe_ingredients ri WHERE ri.recipe_version_id = rv.id) AS ingredient_count
         FROM recipe_versions rv
        WHERE rv.recipe_id = ?
        ORDER BY rv.version_no DESC, rv.id DESC`,
      [activeVersion.recipe_id]
    );

    const currentPriceMap = await getCurrentPriceMap(pool);
    const currentPrice = currentPriceMap[id]?.selling_price ?? 0;
    const payload = [];
    let currentCost = null;

    for (const version of versions) {
      const costingDetails = await buildMenuCostingDetails(pool, {
        ...menu,
        recipe_version_id: version.id,
        yield_amount: version.yield_amount,
        yield_unit: version.yield_unit,
        portion_size: version.portion_size,
        portion_unit: version.portion_unit,
        selling_price: currentPrice,
      });
      const costPerPortion = costingDetails?.costing?.cost_per_portion ?? null;
      if (Number(version.id) === Number(menu.recipe_version_id)) {
        currentCost = costPerPortion;
      }
      payload.push({
        id: version.id,
        version_no: version.version_no,
        is_locked: Boolean(version.is_locked),
        is_active: Boolean(version.is_active),
        created_at: version.created_at,
        ingredient_count: Number(version.ingredient_count || 0),
        cost_per_portion: costPerPortion,
      });
    }

    res.json(
      payload.map((version) => ({
        ...version,
        diff_vs_current:
          currentCost == null || version.cost_per_portion == null
            ? null
            : round2(Number(version.cost_per_portion || 0) - Number(currentCost || 0)),
      }))
    );
  } catch (err) {
    console.error("GET /menu/:id/recipe-versions failed:", err.message);
    res.status(500).json({ error: "Failed to fetch recipe versions" });
  }
});

router.post("/:id/recipe-versions", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[menu]] = await conn.query("SELECT * FROM menu_items WHERE id=? FOR UPDATE", [id]);
    if (!menu || !menu.recipe_version_id) {
      await conn.rollback();
      return res.status(404).json({ error: "Menu item does not have a recipe yet." });
    }
    const [[currentVersion]] = await conn.query("SELECT * FROM recipe_versions WHERE id=? FOR UPDATE", [menu.recipe_version_id]);
    if (!currentVersion) {
      await conn.rollback();
      return res.status(404).json({ error: "Current recipe version not found." });
    }

    const [[nextVersionRow]] = await conn.query(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version_no FROM recipe_versions WHERE recipe_id=?",
      [currentVersion.recipe_id]
    );
    const nextVersionNo = Number(nextVersionRow?.next_version_no || 1);
    const [insertResult] = await conn.query(
      `INSERT INTO recipe_versions
        (recipe_id, version_no, yield_amount, yield_unit, portion_size, portion_unit, is_locked, is_active, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        currentVersion.recipe_id,
        nextVersionNo,
        currentVersion.yield_amount,
        currentVersion.yield_unit,
        currentVersion.portion_size,
        currentVersion.portion_unit,
        0,
        1,
        req.user?.id || null,
      ]
    );

    const recipeIngredientCols = await getColumns("recipe_ingredients");
    const insertColumns = ["recipe_version_id", "ingredient_id", "qty_used", "qty_unit"];
    if (recipeIngredientCols.price) insertColumns.push("price");
    if (recipeIngredientCols.yield_percent) insertColumns.push("yield_percent");
    const [currentLines] = await conn.query(
      `SELECT ingredient_id, qty_used, qty_unit${recipeIngredientCols.price ? ", price" : ""}${recipeIngredientCols.yield_percent ? ", yield_percent" : ""}
         FROM recipe_ingredients
        WHERE recipe_version_id = ?`,
      [currentVersion.id]
    );
    if (currentLines.length) {
      const values = currentLines.map((line) => {
        const row = [insertResult.insertId, line.ingredient_id, line.qty_used, line.qty_unit];
        if (recipeIngredientCols.price) row.push(line.price ?? null);
        if (recipeIngredientCols.yield_percent) row.push(line.yield_percent ?? null);
        return row;
      });
      await conn.query(
        `INSERT INTO recipe_ingredients (${insertColumns.join(", ")}) VALUES ?`,
        [values]
      );
    }

    await conn.query("UPDATE recipe_versions SET is_active = 0 WHERE recipe_id = ?", [currentVersion.recipe_id]);
    await conn.query("UPDATE recipe_versions SET is_active = 1 WHERE id = ?", [insertResult.insertId]);
    await conn.query("UPDATE menu_items SET recipe_version_id = ? WHERE id = ?", [insertResult.insertId, id]);

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "MENU",
        action_name: "RECIPE_VERSION_CREATE",
        entity_type: "menu_item",
        entity_id: Number(id),
        summary: `Created recipe version v${nextVersionNo}.`,
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ id: insertResult.insertId, version_no: nextVersionNo, ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /menu/:id/recipe-versions failed:", err.message);
    res.status(500).json({ error: "Failed to create recipe version" });
  } finally {
    conn.release();
  }
});

router.post("/:id/recipe-versions/:versionId/lock", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id, versionId } = req.params;
  try {
    await pool.query(
      `UPDATE recipe_versions rv
       JOIN menu_items m ON m.recipe_version_id = rv.id OR m.id = ?
          SET rv.is_locked = 1
        WHERE rv.id = ?`,
      [id, versionId]
    );
    await writeAuditLog({
      ...buildActor(req),
      module_name: "MENU",
      action_name: "RECIPE_VERSION_LOCK",
      entity_type: "menu_item",
      entity_id: Number(id),
      summary: `Locked recipe version #${versionId}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /menu/:id/recipe-versions/:versionId/lock failed:", err.message);
    res.status(500).json({ error: "Failed to lock recipe version" });
  }
});

router.post("/:id/recipe-versions/:versionId/activate", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { id, versionId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[targetVersion]] = await conn.query(
      `SELECT rv.*, m.id AS menu_id
         FROM recipe_versions rv
         JOIN recipes r ON r.id = rv.recipe_id
         JOIN menu_items m ON m.id = ?
        WHERE rv.id = ?`,
      [id, versionId]
    );
    if (!targetVersion) {
      await conn.rollback();
      return res.status(404).json({ error: "Recipe version not found." });
    }
    await conn.query("UPDATE recipe_versions SET is_active = 0 WHERE recipe_id = ?", [targetVersion.recipe_id]);
    await conn.query("UPDATE recipe_versions SET is_active = 1 WHERE id = ?", [versionId]);
    await conn.query("UPDATE menu_items SET recipe_version_id = ? WHERE id = ?", [versionId, id]);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "MENU",
        action_name: "RECIPE_VERSION_ACTIVATE",
        entity_type: "menu_item",
        entity_id: Number(id),
        summary: `Activated recipe version #${versionId}.`,
      },
      conn
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /menu/:id/recipe-versions/:versionId/activate failed:", err.message);
    res.status(500).json({ error: "Failed to activate recipe version" });
  } finally {
    conn.release();
  }
});

// Get recipe version and ingredient lines for a menu item
router.get("/:id/recipe", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[menu]] = await pool.query('SELECT * FROM menu_items WHERE id=?', [id]);
    if (!menu) return res.status(404).json({ error: 'Menu item not found' });
    const recipeVersionId = menu.recipe_version_id;
    if (!recipeVersionId) return res.json({ recipe_version: null, ingredients: [] });

    const [[rv]] = await pool.query('SELECT * FROM recipe_versions WHERE id=?', [recipeVersionId]);
    let ings = [];
    try {
      [ings] = await pool.query(
        `SELECT ri.*, i.ingredient_name, i.base_unit, i.current_ap_cost
         FROM recipe_ingredients ri
         JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_version_id = ?`,
        [recipeVersionId]
      );
    } catch (err) {
      // fallback if current_ap_cost column does not exist
      [ings] = await pool.query(
        `SELECT ri.*, i.ingredient_name, i.base_unit
         FROM recipe_ingredients ri
         JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE ri.recipe_version_id = ?`,
        [recipeVersionId]
      );
    }
    res.json({ recipe_version: rv, ingredients: ings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipe' });
  }
});

// Replace recipe_ingredients for the menu item's recipe_version (transactional upsert)
router.put("/:id/recipe", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { recipe_version, ingredients } = req.body;
  if (!Array.isArray(ingredients)) return res.status(400).json({ error: 'ingredients array required' });
  const conn = await pool.getConnection();
  try {
    // only OWNER allowed to modify recipes
    const role = req.user && req.user.role ? req.user.role : null;
    const allowed = ['OWNER'];
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await conn.beginTransaction();
    const [[menu]] = await conn.query('SELECT * FROM menu_items WHERE id=? FOR UPDATE', [id]);
    if (!menu) {
      await conn.rollback();
      return res.status(404).json({ error: 'Menu item not found' });
    }
    let recipeVersionId = menu.recipe_version_id;
    if (!recipeVersionId) {
      // Auto-create minimal recipe + version so users can save lines on legacy menu rows
      const recipeName = menu.menu_name || `Recipe for menu ${id}`;
      const created = await createRecipeAndVersion(conn, {
        recipeName,
        userId: req.user?.id || null,
      });
      recipeVersionId = created.recipeVersionId;
      await conn.query('UPDATE menu_items SET recipe_version_id=? WHERE id=?', [recipeVersionId, id]);
    }

    const [[currentVersion]] = await conn.query("SELECT * FROM recipe_versions WHERE id=? FOR UPDATE", [recipeVersionId]);
    if (currentVersion?.is_locked) {
      await conn.rollback();
      return res.status(409).json({ error: "This recipe version is locked. Create a new version before editing it." });
    }

    const recipeVersionCols = await getColumns("recipe_versions");
    const recipeIngredientCols = await getColumns("recipe_ingredients");

    // Optionally update recipe_versions fields, but only for columns that exist
    if (recipe_version && typeof recipe_version === 'object') {
      const fields = ['yield_amount','yield_unit','portion_size','portion_unit','is_active'];
      const updates = [];
      const vals = [];
      fields.forEach(f => {
        if (recipeVersionCols[f] && Object.prototype.hasOwnProperty.call(recipe_version, f)) {
          updates.push(`${f}=?`);
          vals.push(recipe_version[f]);
        }
      });
      if (updates.length) {
        vals.push(recipeVersionId);
        await conn.query(`UPDATE recipe_versions SET ${updates.join(',')} WHERE id=?`, vals);
      }
    }

    // Validate and replace recipe ingredient lines
    const ALLOWED_UNITS = require("../utils/units");
    // basic validation
    for (const it of ingredients) {
      if (!it.ingredient_id) {
        await conn.rollback();
        return res.status(400).json({ error: 'ingredient_id required for each line' });
      }
      const qty = Number(it.qty_used);
      if (!isFinite(qty) || qty <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'qty_used must be a number > 0' });
      }
      if (!it.qty_unit || !ALLOWED_UNITS.includes(it.qty_unit)) {
        await conn.rollback();
        return res.status(400).json({ error: `qty_unit must be one of: ${ALLOWED_UNITS.join(',')}` });
      }
      if (typeof it.price !== "undefined" && it.price !== "" && it.price !== null) {
        const price = Number(it.price);
        if (!isFinite(price) || price < 0) {
          await conn.rollback();
          return res.status(400).json({ error: "price must be a number greater than or equal to 0" });
        }
      }
    }

    // Delete existing lines and insert new ones
    await conn.query('DELETE FROM recipe_ingredients WHERE recipe_version_id = ?', [recipeVersionId]);
    if (ingredients.length) {
      // Support older schemas that may not have price/yield_percent yet.
      const insertColumns = ["recipe_version_id", "ingredient_id", "qty_used", "qty_unit"];
      if (recipeIngredientCols.price) insertColumns.push("price");
      if (recipeIngredientCols.yield_percent) insertColumns.push("yield_percent");

      const rows = ingredients.map((i) => {
        const row = [
          recipeVersionId,
          i.ingredient_id,
          i.qty_used,
          i.qty_unit,
        ];
        if (recipeIngredientCols.price) {
          row.push(i.price === "" || i.price === null || typeof i.price === "undefined" ? null : Number(i.price));
        }
        if (recipeIngredientCols.yield_percent) {
          row.push(i.yield_percent === "" || i.yield_percent === null || typeof i.yield_percent === "undefined" ? null : Number(i.yield_percent));
        }
        return row;
      });
      const insertSql = `INSERT INTO recipe_ingredients (${insertColumns.join(", ")}) VALUES ?`;
      await conn.query(insertSql, [rows]);
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "MENU",
        action_name: "RECIPE_UPDATE",
        entity_type: "menu_item",
        entity_id: Number(id),
        summary: `Updated recipe lines for menu item #${id}.`,
      },
      conn
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PUT /menu/:id/recipe failed:", err.message);
    res.status(500).json({ error: err.message || 'Failed to update recipe' });
  } finally {
    conn.release();
  }
});

// Create a recipe + initial version and link it to the menu item
router.post('/:id/create-recipe', requireAuth, async (req, res) => {
  const { id } = req.params;
  const recipeName = String(req.body.recipe_name || "").trim();
  const recipeDescription = normalizeOptionalText(req.body.recipe_description);
  const conn = await pool.getConnection();
  try {
    if (req.user?.role !== "OWNER") {
      return res.status(403).json({ error: "Forbidden" });
    }
    await conn.beginTransaction();

    const [[menu]] = await conn.query('SELECT * FROM menu_items WHERE id=? FOR UPDATE', [id]);
    if (!menu) {
      await conn.rollback();
      return res.status(404).json({ error: 'Menu item not found' });
    }
    if (menu.recipe_version_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'Menu item already has a linked recipe version' });
    }

    const userId = req.user && req.user.id ? req.user.id : null;
    const { recipeId, recipeVersionId } = await createRecipeAndVersion(conn, {
      recipeName: recipeName || menu.menu_name,
      recipeDescription,
      userId,
    });

    // link menu to this recipe_version
    await conn.query('UPDATE menu_items SET recipe_version_id = ? WHERE id = ?', [recipeVersionId, id]);

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "MENU",
        action_name: "RECIPE_CREATE",
        entity_type: "menu_item",
        entity_id: Number(id),
        summary: `Created recipe for menu item #${id}.`,
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ recipe_id: recipeId, recipe_version_id: recipeVersionId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to create recipe' });
  } finally {
    conn.release();
  }
});

module.exports = router;
