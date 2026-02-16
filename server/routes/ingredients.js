const express = require("express");
const pool = require("../db");
const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM ingredients ORDER BY ingredient_name ASC"
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { ingredient_name, category, base_unit, status } = req.body;
  const [r] = await pool.query(
    "INSERT INTO ingredients (ingredient_name, category, base_unit, status) VALUES (?,?,?,?)",
    [ingredient_name, category || null, base_unit, status || "ACTIVE"]
  );
  res.status(201).json({ id: r.insertId });
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { ingredient_name, category, base_unit, status } = req.body;
  await pool.query(
    "UPDATE ingredients SET ingredient_name=?, category=?, base_unit=?, status=? WHERE id=?",
    [ingredient_name, category || null, base_unit, status || "ACTIVE", id]
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE ingredients SET status='INACTIVE' WHERE id=?", [id]);
  res.json({ ok: true });
});

module.exports = router;
