const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildActor, writeAuditLog } = require("../utils/auditLog");

const router = express.Router();
const ALLOWED_ROLES = ["OWNER", "CASHIER", "STOCKROOM_STAFF"];

// all routes here are OWNER-only
router.use(requireAuth, requireRole("OWNER"));

// GET /api/users
router.get("/", async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.username, u.role, u.status, u.created_at, u.updated_at, up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
      ORDER BY u.id DESC`
  );
  res.json(rows);
});

// POST /api/users
router.post("/", async (req, res) => {
  const { full_name, username, password, role = "CASHIER", status = "ACTIVE", avatar_url = null } = req.body;

  if (!full_name || !username || !password)
    return res.status(400).json({ message: "full_name, username, password required" });
  if (!ALLOWED_ROLES.includes(role))
    return res.status(400).json({ message: "Invalid role" });
  if (!["ACTIVE", "INACTIVE"].includes(status))
    return res.status(400).json({ message: "Invalid status" });

  const password_hash = await bcrypt.hash(password, 10);

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.execute(
        "INSERT INTO users (full_name, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)",
        [full_name, username, password_hash, role, status]
      );

      if (avatar_url && String(avatar_url).trim()) {
        await conn.execute(
          `INSERT INTO user_profiles (user_id, avatar_url)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url)`,
          [result.insertId, String(avatar_url).trim()]
        );
      }

      await writeAuditLog(
        {
          ...buildActor(req),
          module_name: "STAFF",
          action_name: "CREATE",
          entity_type: "user",
          entity_id: result.insertId,
          summary: `Created staff account for ${full_name}.`,
        },
        conn
      );

      await conn.commit();
      res.status(201).json({ id: result.insertId, message: "User created" });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
  const cleanFullName = String(full_name || "").trim();
  const cleanUsername = String(username || "").trim();

  if (!cleanFullName || !cleanUsername || !role)
    return res.status(400).json({ message: "full_name, username, role required" });
  if (!ALLOWED_ROLES.includes(role))
    return res.status(400).json({ message: "Invalid role" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[existingUser]] = await conn.execute(
      "SELECT id FROM users WHERE id = ? FOR UPDATE",
      [id]
    );
    if (!existingUser) {
      await conn.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    const [[duplicateUser]] = await conn.execute(
      "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
      [cleanUsername, id]
    );
    if (duplicateUser) {
      await conn.rollback();
      return res.status(409).json({ message: "Username already exists" });
    }

    if (password && password.trim().length > 0) {
      const password_hash = await bcrypt.hash(password, 10);
      await conn.execute(
        "UPDATE users SET full_name=?, username=?, role=?, password_hash=? WHERE id=?",
        [cleanFullName, cleanUsername, role, password_hash, id]
      );
    } else {
      await conn.execute(
        "UPDATE users SET full_name=?, username=?, role=? WHERE id=?",
        [cleanFullName, cleanUsername, role, id]
      );
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "STAFF",
        action_name: "UPDATE",
        entity_type: "user",
        entity_id: Number(id),
        summary: `Updated staff account for ${cleanFullName}.`,
      },
      conn
    );

    await conn.commit();
    res.json({ message: "User updated" });
  } catch (err) {
    await conn.rollback();
    if (err?.code === "ER_DUP_ENTRY" || String(err.message).includes("Duplicate")) {
      return res.status(409).json({ message: "Username already exists" });
    }
    console.error("PUT /users/:id failed:", err.message);
    res.status(500).json({ message: "Failed to update user" });
  } finally {
    conn.release();
  }
});

// PATCH /api/users/:id/status
router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["ACTIVE", "INACTIVE"].includes(status))
    return res.status(400).json({ message: "status must be ACTIVE or INACTIVE" });

  await pool.execute("UPDATE users SET status=? WHERE id=?", [status, id]);
  await writeAuditLog({
    ...buildActor(req),
    module_name: "STAFF",
    action_name: status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE",
    entity_type: "user",
    entity_id: Number(id),
    summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} staff user #${id}.`,
  });
  res.json({ message: "Status updated" });
});

module.exports = router;
