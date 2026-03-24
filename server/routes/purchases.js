const express = require("express");
const pool = require("../db");
const router = express.Router();

// Basic purchases ledger (palengke-style buying)

router.get("/", async (_req, res) => {
  try {
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
    await conn.beginTransaction();

    const [result] = await conn.query(
      "INSERT INTO purchases (ingredient_name, quantity, price, created_at) VALUES (?,?,?,NOW())",
      [ingredientName.trim(), qty, cost]
    );

    // Keep inventory in sync. If ingredient exists, add to its stock; otherwise create a lightweight record.
    const [existing] = await conn.query(
      "SELECT id FROM ingredients WHERE LOWER(ingredient_name) = LOWER(?) FOR UPDATE",
      [ingredientName]
    );

    if (existing.length) {
      await conn.query(
        "UPDATE ingredients SET quantity = COALESCE(quantity,0)+?, last_updated = NOW() WHERE id=?",
        [qty, existing[0].id]
      );
    } else {
      // fall back defaults so we don't block purchases even if base unit is unknown
      await conn.query(
        "INSERT INTO ingredients (ingredient_name, category, base_unit, base_unit_qty, status, quantity, last_updated) VALUES (?,?,?,?,?,?,NOW())",
        [ingredientName.trim(), null, "pack", 1, "ACTIVE", qty]
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
