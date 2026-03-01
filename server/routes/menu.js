const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();
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
  const { menu_name, description, status, selling_price, recipe_name, recipe_description } = req.body;
  if (!menu_name) return res.status(400).json({ error: 'menu_name is required' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // create recipe
    const [rRecipe] = await conn.query(
      'INSERT INTO recipes (recipe_name, description, created_by, status) VALUES (?,?,?,?)',
      [recipe_name || menu_name, recipe_description || null, null, 'ACTIVE']
    );
    const recipeId = rRecipe.insertId;

    // create recipe version
    const [rVer] = await conn.query(
      'INSERT INTO recipe_versions (recipe_id, version_no, yield_amount, yield_unit, portion_size, portion_unit, is_active) VALUES (?,?,?,?,?,?,?)',
      [recipeId, 1, null, null, null, null, 1]
    );
    const recipeVersionId = rVer.insertId;

    // create menu item linked to this recipe_version
    const [rMenu] = await conn.query(
      'INSERT INTO menu_items (menu_name, description, recipe_version_id, status) VALUES (?,?,?,?)',
      [menu_name, description || null, recipeVersionId, status || 'ACTIVE']
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
  const { menu_name, description, status } = req.body;
  try {
    await pool.query(
      'UPDATE menu_items SET menu_name=?, description=?, status=? WHERE id=?',
      [menu_name, description || null, status || 'ACTIVE', id]
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
    const [ings] = await pool.query(
      `SELECT ri.*, i.ingredient_name, i.base_unit
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_version_id = ?`,
      [recipeVersionId]
    );
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
    // only OWNER/ADMIN allowed to modify recipes
    const role = req.user && req.user.role ? req.user.role : null;
    const allowed = ['OWNER', 'ADMIN', 'ADMINISTRATOR'];
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await conn.beginTransaction();
    const [[menu]] = await conn.query('SELECT * FROM menu_items WHERE id=? FOR UPDATE', [id]);
    if (!menu) {
      await conn.rollback();
      return res.status(404).json({ error: 'Menu item not found' });
    }
    const recipeVersionId = menu.recipe_version_id;
    if (!recipeVersionId) {
      await conn.rollback();
      return res.status(400).json({ error: 'Menu item has no linked recipe version' });
    }

    // Optionally update recipe_versions fields
    if (recipe_version && typeof recipe_version === 'object') {
      const fields = ['yield_amount','yield_unit','portion_size','portion_unit','is_active'];
      const updates = [];
      const vals = [];
      fields.forEach(f => {
        if (Object.prototype.hasOwnProperty.call(recipe_version, f)) {
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
    }

    // Delete existing lines and insert new ones
    await conn.query('DELETE FROM recipe_ingredients WHERE recipe_version_id = ?', [recipeVersionId]);
    if (ingredients.length) {
      const insertSql = 'INSERT INTO recipe_ingredients (recipe_version_id, ingredient_id, qty_used, qty_unit, yield_percent) VALUES ?';
      const rows = ingredients.map(i => [recipeVersionId, i.ingredient_id, i.qty_used, i.qty_unit, i.yield_percent || null]);
      await conn.query(insertSql, [rows]);
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to update recipe' });
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

    // create recipe (attributed to authenticated user)
    const userId = req.user && req.user.id ? req.user.id : null;
    const [rRecipe] = await conn.query(
      'INSERT INTO recipes (recipe_name, description, created_by, status) VALUES (?,?,?,?)',
      [recipe_name || menu.menu_name, recipe_description || null, userId, 'ACTIVE']
    );
    const recipeId = rRecipe.insertId;

    // create recipe version
    const [rVer] = await conn.query(
      'INSERT INTO recipe_versions (recipe_id, version_no, yield_amount, yield_unit, portion_size, portion_unit, is_active, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [recipeId, 1, null, null, null, null, 1, userId]
    );
    const recipeVersionId = rVer.insertId;

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
