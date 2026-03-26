const express = require("express");
const pool = require("../db");
const router = express.Router();
const { getColumns, tableExists } = require("../utils/dbIntrospection");

// Basic purchases ledger (palengke-style buying)

router.get("/", async (_req, res) => {
  try {
    if (!(await tableExists("purchases"))) {
      return res.json({ items: [], total: 0, setupRequired: true });
    }
    const [rows] = await pool.query(
      "SELECT id, ingredient_name, quantity, price, created_at FROM purchases ORDER BY created_at DESC"
    );
    const total = rows.reduce((sum, r) => sum + Number(r.price || 0), 0);
    return res.json({ items: rows.map((r) => ({ ...r, createdAt: r.created_at })), total });
  } catch (err) {
    console.error("GET /purchases failed", err);
    return res.status(500).json({ message: "Failed to fetch purchases" });
  }
});

router.post("/", async (req, res) => {
  const { ingredientName, quantity, price } = req.body;
  const qty = Number(quantity);
  const cost = Number(price);

  if (!ingredientName || !ingredientName.trim()) {
    return res.status(400).json({ message: "ingredientName is required" });
  }
  if (!isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: "quantity must be > 0" });
  }
  if (!isFinite(cost) || cost < 0) {
    return res.status(400).json({ message: "price must be >= 0" });
  }

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("purchases"))) {
      return res.status(503).json({ message: "Purchases setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      "INSERT INTO purchases (ingredient_name, quantity, price, created_at) VALUES (?,?,?,NOW())",
      [ingredientName.trim(), qty, cost]
    );

    // Keep inventory in sync. If ingredient exists, add to its stock; otherwise create a lightweight record.
    const ingredientCols = await getColumns("ingredients");
    const hasQuantity = Boolean(ingredientCols.quantity);
    const hasLastUpdated = Boolean(ingredientCols.last_updated);

    const [existing] = await conn.query(
      "SELECT id FROM ingredients WHERE LOWER(ingredient_name) = LOWER(?) FOR UPDATE",
      [ingredientName]
    );

    if (existing.length) {
      const updates = [];
      const values = [];
      if (hasQuantity) {
        updates.push("quantity = COALESCE(quantity,0)+?");
        values.push(qty);
      }
      if (hasLastUpdated) {
        updates.push("last_updated = NOW()");
      }
      if (updates.length) {
        values.push(existing[0].id);
        await conn.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, values);
      }
    } else {
      // fall back defaults so we don't block purchases even if base unit is unknown
      const fields = ["ingredient_name", "category", "base_unit", "base_unit_qty", "status"];
      const values = [ingredientName.trim(), null, "pack", 1, "ACTIVE"];
      const placeholders = ["?", "?", "?", "?", "?"];
      if (hasQuantity) {
        fields.push("quantity");
        placeholders.push("?");
        values.push(qty);
      }
      if (hasLastUpdated) {
        fields.push("last_updated");
        placeholders.push("NOW()");
      }
      await conn.query(
        `INSERT INTO ingredients (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
        values
      );
    }

    await conn.commit();
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /purchases failed", err);
    return res.status(500).json({ message: "Failed to save purchase" });
  } finally {
    conn.release();
  }
});

module.exports = router;
