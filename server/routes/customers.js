const express = require("express");
const pool = require("../db");
const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM customers ORDER BY customer_name ASC"
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { customer_name, email, phone, status, loyalty_points } = req.body;
  const [r] = await pool.query(
    "INSERT INTO customers (customer_name, email, phone, status, loyalty_points) VALUES (?,?,?,?,?)",
    [customer_name, email || null, phone || null, status || "ACTIVE", loyalty_points ?? 0]
  );
  res.status(201).json({ id: r.insertId });
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { customer_name, email, phone, status, loyalty_points } = req.body;
  await pool.query(
    "UPDATE customers SET customer_name=?, email=?, phone=?, status=?, loyalty_points=? WHERE id=?",
    [customer_name, email || null, phone || null, status || "ACTIVE", loyalty_points ?? 0, id]
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await pool.query("UPDATE customers SET status='INACTIVE' WHERE id=?", [id]);
  res.json({ ok: true });
});

module.exports = router;
