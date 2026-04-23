const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: "Username and password required" });

    const [rows] = await pool.execute(
      `SELECT u.id, u.username, u.password_hash, u.role, u.status, u.full_name, up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.username = ?`,
      [username]
    );

    if (rows.length === 0) return res.status(401).json({ message: "Invalid login" });

    const user = rows[0];

    if (user.status === "INACTIVE")
      return res.status(403).json({ message: "Account is inactive" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid login" });

    if (!process.env.JWT_SECRET)
      return res.status(500).json({ message: "Server misconfiguration: JWT_SECRET not set" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    // Update last_login_at if the column exists. Some databases may not
    // have this column yet (older schemas) — don't fail the login for that.
    try {
      await pool.execute(
        "UPDATE users SET last_login_at = NOW() WHERE id = ?",
        [user.id]
      );
    } catch (e) {
      console.warn("warning: failed to update last_login_at:", e.message);
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error("/api/auth/login error:", err);
    // Return error message for local debugging. Remove in production.
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

module.exports = router;
