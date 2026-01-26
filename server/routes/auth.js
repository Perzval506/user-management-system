const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ message: "Username and password required" });

  const [rows] = await pool.execute(
    "SELECT id, username, password_hash, role, status, full_name FROM users WHERE username = ?",
    [username]
  );

  if (rows.length === 0) return res.status(401).json({ message: "Invalid login" });

  const user = rows[0];

  if (user.status === "INACTIVE")
    return res.status(403).json({ message: "Account is inactive" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ message: "Invalid login" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
  });
});

module.exports = router;
