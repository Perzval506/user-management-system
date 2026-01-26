const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// all routes here are OWNER-only
router.use(requireAuth, requireRole("OWNER"));

// GET /api/users
router.get("/", async (req, res) => {
  const [rows] = await pool.execute(
    "SELECT id, full_name, username, role, status, created_at, updated_at FROM users ORDER BY id DESC"
  );
  res.json(rows);
});

// POST /api/users
router.post("/", async (req, res) => {
  const { full_name, username, password, role = "STAFF", status = "ACTIVE" } = req.body;

  if (!full_name || !username || !password)
    return res.status(400).json({ message: "full_name, username, password required" });

  const password_hash = await bcrypt.hash(password, 10);

  try {
    const [result] = await pool.execute(
      "INSERT INTO users (full_name, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)",
      [full_name, username, password_hash, role, status]
    );

    res.status(201).json({ id: result.insertId, message: "User created" });
  } catch (err) {
    if (String(err.message).includes("Duplicate")) {
      return res.status(409).json({ message: "Username already exists" });
    }
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/users/:id  (update info; password optional)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { full_name, username, role, password } = req.body;

  if (!full_name || !username || !role)
    return res.status(400).json({ message: "full_name, username, role required" });

  if (password && password.trim().length > 0) {
    const password_hash = await bcrypt.hash(password, 10);
    await pool.execute(
      "UPDATE users SET full_name=?, username=?, role=?, password_hash=? WHERE id=?",
      [full_name, username, role, password_hash, id]
    );
  } else {
    await pool.execute(
      "UPDATE users SET full_name=?, username=?, role=? WHERE id=?",
      [full_name, username, role, id]
    );
  }

  res.json({ message: "User updated" });
});

// PATCH /api/users/:id/status
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["ACTIVE", "INACTIVE"].includes(status))
    return res.status(400).json({ message: "status must be ACTIVE or INACTIVE" });

  await pool.execute("UPDATE users SET status=? WHERE id=?", [status, id]);
  res.json({ message: "Status updated" });
});

module.exports = router;
