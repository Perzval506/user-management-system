const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getColumns } = require("../utils/dbIntrospection");
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
    dineInPackagingCost: null,
    takeoutPackagingCost: null,
    deliveryPackagingCost: null,
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

  for (const [field, resultKey] of [
    ["dine_in_packaging_cost", "dineInPackagingCost"],
    ["takeout_packaging_cost", "takeoutPackagingCost"],
    ["delivery_packaging_cost", "deliveryPackagingCost"],
  ]) {
    if (typeof body[field] !== "undefined" && body[field] !== "" && body[field] !== null) {
      const parsed = Number(body[field]);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${field} must be 0 or greater` };
      }
      result[resultKey] = parsed;
    }
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
    order_type: "DINE_IN",
    dine_in_packaging_cost: Number(menuItem.dine_in_packaging_cost || 0),
    takeout_packaging_cost: Number(menuItem.takeout_packaging_cost || 0),
    delivery_packaging_cost: Number(menuItem.delivery_packaging_cost || 0),
  });

  return {
    ingredients: costing.items,
    costing,
  };
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
    dineInPackagingCost,
    takeoutPackagingCost,
    deliveryPackagingCost,
  } = validated.value;
  const cols = await getMenuColumns();
  const hasTargetCost = !!cols.target_food_cost_percent;
  const hasMenuType = !!cols.menu_type;
  const hasDineInPackagingCost = !!cols.dine_in_packaging_cost;
  const hasTakeoutPackagingCost = !!cols.takeout_packaging_cost;
  const hasDeliveryPackagingCost = !!cols.delivery_packaging_cost;
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
    if (hasDineInPackagingCost) {
      fields.push("dine_in_packaging_cost");
      placeholders.push("?");
      values.push(dineInPackagingCost);
    }
    if (hasTakeoutPackagingCost) {
      fields.push("takeout_packaging_cost");
      placeholders.push("?");
      values.push(takeoutPackagingCost);
    }
    if (hasDeliveryPackagingCost) {
      fields.push("delivery_packaging_cost");
      placeholders.push("?");
      values.push(deliveryPackagingCost);
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
  const { menuName, description, status, menuType, targetFoodCostPercent, dineInPackagingCost, takeoutPackagingCost, deliveryPackagingCost } = validated.value;
  try {
    const cols = await getMenuColumns();
    const hasTargetCost = !!cols.target_food_cost_percent;
    const hasMenuType = !!cols.menu_type;
    const hasDineInPackagingCost = !!cols.dine_in_packaging_cost;
    const hasTakeoutPackagingCost = !!cols.takeout_packaging_cost;
    const hasDeliveryPackagingCost = !!cols.delivery_packaging_cost;
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
    if (hasDineInPackagingCost) {
      updates.push("dine_in_packaging_cost=?");
      vals.push(dineInPackagingCost);
    }
    if (hasTakeoutPackagingCost) {
      updates.push("takeout_packaging_cost=?");
      vals.push(takeoutPackagingCost);
    }
    if (hasDeliveryPackagingCost) {
      updates.push("delivery_packaging_cost=?");
      vals.push(deliveryPackagingCost);
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
  const { selling_price, effective_date } = req.body;
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
    await pool.query(
      'INSERT INTO menu_price_history (menu_item_id, selling_price, effective_date) VALUES (?,?,?)',
      [id, sellingPrice, ed]
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
