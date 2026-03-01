const express = require("express");
const pool = require("../db");
const router = express.Router();
const ALLOWED_UNITS = require('../utils/units');

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM ingredients ORDER BY ingredient_name ASC"
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { ingredient_name, category, base_unit, base_unit_qty, status } = req.body;
  const bu = (base_unit || '').toString().trim().toLowerCase();
  const qty = Number(base_unit_qty);
  if (!ALLOWED_UNITS.includes(bu)) {
    return res.status(400).json({ message: "Invalid base_unit. Allowed: kg,g,mg,cup,bottle,teaspoon,tablepoon,gallon,pack" });
  }
  if (!isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: "Invalid base_unit_qty. Must be a number > 0" });
  }
  const [r] = await pool.query(
    "INSERT INTO ingredients (ingredient_name, category, base_unit, base_unit_qty, status) VALUES (?,?,?,?,?)",
    [ingredient_name, category || null, bu, qty, status || "ACTIVE"]
  );
  res.status(201).json({ id: r.insertId });
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { ingredient_name, category, base_unit, base_unit_qty, status } = req.body;
  const bu = (base_unit || '').toString().trim().toLowerCase();
  const qty = Number(base_unit_qty);
  if (!ALLOWED_UNITS.includes(bu)) {
    return res.status(400).json({ message: "Invalid base_unit. Allowed: kg,g,mg,cup,bottle,teaspoon,tablepoon,gallon,pack" });
  }
  if (!isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: "Invalid base_unit_qty. Must be a number > 0" });
  }
  await pool.query(
    "UPDATE ingredients SET ingredient_name=?, category=?, base_unit=?, base_unit_qty=?, status=? WHERE id= ?",
    [ingredient_name, category || null, bu, qty, status || "ACTIVE", id]
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE ingredients SET status='INACTIVE' WHERE id=?", [id]);
  res.json({ ok: true });
});

module.exports = router;
