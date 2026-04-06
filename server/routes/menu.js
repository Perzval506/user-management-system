const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getColumns } = require("../utils/dbIntrospection");
const router = express.Router();

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
// GET list with latest price (by effective_date)
router.get("/", async (req, res) => {
  try {
    const sql = `SELECT m.*, ph.selling_price, ph.effective_date
      FROM menu_items m
      LEFT JOIN menu_price_history ph ON ph.id = (
        SELECT id FROM menu_price_history WHERE menu_item_id = m.id ORDER BY effective_date DESC LIMIT 1
      )
      ORDER BY m.menu_name ASC`;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
});

// Create menu item variant + recipe + recipe_version + initial price_history
router.post("/", async (req, res) => {
  const { menu_name, description, status, selling_price, recipe_name, recipe_description, target_food_cost_percent } = req.body;
  if (!menu_name) return res.status(400).json({ error: 'menu_name is required' });
  const cols = await getMenuColumns();
  const hasTargetCost = !!cols.target_food_cost_percent;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { recipeVersionId } = await createRecipeAndVersion(conn, {
      recipeName: recipe_name || menu_name,
      recipeDescription: recipe_description || null,
    });

    // create menu item linked to this recipe_version
    const fields = ["menu_name", "description", "recipe_version_id"];
    const placeholders = ["?", "?", "?"];
    const values = [menu_name, description || null, recipeVersionId];
    if (hasTargetCost) {
      fields.push("target_food_cost_percent");
      placeholders.push("?");
      const tfcp = parseFloat(target_food_cost_percent);
      values.push(Number.isFinite(tfcp) ? tfcp : null);
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
    if (typeof selling_price !== 'undefined') {
      await conn.query(
        'INSERT INTO menu_price_history (menu_item_id, selling_price, effective_date) VALUES (?,?,?)',
        [menuItemId, selling_price, new Date()]
      );
    }

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
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { menu_name, description, status, target_food_cost_percent } = req.body;
  try {
    const cols = await getMenuColumns();
    const hasTargetCost = !!cols.target_food_cost_percent;
    const updates = ["menu_name=?", "description=?", "status=?"];
    const vals = [menu_name, description || null, status || "ACTIVE"];
    if (hasTargetCost) {
      updates.splice(2, 0, "target_food_cost_percent=?");
      const tfcp = parseFloat(target_food_cost_percent);
      vals.splice(2, 0, Number.isFinite(tfcp) ? tfcp : null);
    }

    await pool.query(
      `UPDATE menu_items SET ${updates.join(", ")} WHERE id=?`,
      [...vals, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// Soft-delete / deactivate
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("UPDATE menu_items SET status='INACTIVE' WHERE id=?", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to deactivate menu item' });
  }
});

// Add new price history row
router.post("/:id/price", async (req, res) => {
  const { id } = req.params;
  const { selling_price, effective_date } = req.body;
  if (typeof selling_price === 'undefined') return res.status(400).json({ error: 'selling_price is required' });
  try {
    const ed = effective_date ? new Date(effective_date) : new Date();
    await pool.query(
      'INSERT INTO menu_price_history (menu_item_id, selling_price, effective_date) VALUES (?,?,?)',
      [id, selling_price, ed]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add price' });
  }
});

// Get recipe version and ingredient lines for a menu item
router.get("/:id/recipe", async (req, res) => {
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
  const { recipe_name, recipe_description } = req.body;
  const conn = await pool.getConnection();
  try {
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
      recipeName: recipe_name || menu.menu_name,
      recipeDescription: recipe_description || null,
      userId,
    });

    // link menu to this recipe_version
    await conn.query('UPDATE menu_items SET recipe_version_id = ? WHERE id = ?', [recipeVersionId, id]);

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
