const express = require("express");
const pool = require("../db");
const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM menu_items ORDER BY menu_name ASC"
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { menu_name, description, status } = req.body;
  const [r] = await pool.query(
    "INSERT INTO menu_items (menu_name, description, status) VALUES (?,?,?)",
    [menu_name, description || null, status || "ACTIVE"]
  );
  res.status(201).json({ id: r.insertId });
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { menu_name, description, status } = req.body;
  await pool.query(
    "UPDATE menu_items SET menu_name=?, description=?, status=? WHERE id=?",
    [menu_name, description || null, status || "ACTIVE", id]
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE menu_items SET status='INACTIVE' WHERE id=?", [id]);
  res.json({ ok: true });
});

module.exports = router;
