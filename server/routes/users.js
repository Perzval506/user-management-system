// server/routes/users.js
const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ROLES = ["ADMINISTRATOR", "OWNER", "CASHIER", "STOCKROOM_STAFF", "CUSTOMER"];
const CREATE_ROLES = ["CASHIER", "STOCKROOM_STAFF"];
const STATUSES = ["ACTIVE", "INACTIVE"];
const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];

function isValidEmail(email) {
  if (email === null) return true; // allow NULL
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

// undefined => "not provided" (do not touch on PUT)
// null/"" => null
// string => trimmed string
function normalizeNullableString(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// expects YYYY-MM-DD if provided
function normalizeNullableDate(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function handleDupError(err, res) {
  if (err && (err.code === "ER_DUP_ENTRY" || String(err.message).toLowerCase().includes("duplicate"))) {
    const msg = String(err.message).toLowerCase();
    if (msg.includes("username")) return res.status(409).json({ message: "Username already exists" });
    if (msg.includes("email")) return res.status(409).json({ message: "Email already exists" });
    return res.status(409).json({ message: "Duplicate value" });
  }
  return res.status(500).json({ message: "Server error" });
}

// OWNER or ADMINISTRATOR only
router.use(requireAuth, (req, res, next) => {
  const allowed = ["OWNER", "ADMINISTRATOR"];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
  next();
});

// GET /api/users (exclude own account) - list view
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name, username, email, phone, role, status, created_at, updated_at
       FROM users
       WHERE id <> ?
       ORDER BY id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
// GET /api/users/:id - full details for edit modal (also blocks own id)
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  if (id === req.user.id) return res.status(403).json({ message: "Forbidden" });

  try {
    const [rows] = await pool.execute(
      `SELECT
         id, full_name, username, email, phone,
         role, status,
         address, birthdate, gender, avatar_url,
         created_by, updated_by, last_login_at,
         created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/users - Create only CASHIER or STOCKROOM_STAFF
router.post("/", async (req, res) => {
  const {
    full_name,
    username,
    password,
    role,
    status = "ACTIVE",
    email,
    phone,
    address,
    birthdate,
    gender,
    avatar_url,
  } = req.body;

  if (!full_name || !username || !password || !role) {
    return res.status(400).json({ message: "full_name, username, password, role required" });
  }
  if (!CREATE_ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be CASHIER or STOCKROOM_STAFF" });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ message: "status must be ACTIVE or INACTIVE" });
  }

  // For CREATE: if not provided => NULL in DB
  const cleanEmail = normalizeNullableString(email);
  const cleanPhone = normalizeNullableString(phone);
  const cleanAddress = normalizeNullableString(address);
  const cleanBirthdate = normalizeNullableDate(birthdate);
  const cleanAvatar = normalizeNullableString(avatar_url);
  const cleanGender = normalizeNullableString(gender);

  const dbEmail = cleanEmail === undefined ? null : cleanEmail;
  const dbPhone = cleanPhone === undefined ? null : cleanPhone;
  const dbAddress = cleanAddress === undefined ? null : cleanAddress;
  const dbBirthdate = cleanBirthdate === undefined ? null : cleanBirthdate;
  const dbAvatar = cleanAvatar === undefined ? null : cleanAvatar;
  const dbGender = cleanGender === undefined ? null : cleanGender;

  if (!isValidEmail(dbEmail)) return res.status(400).json({ message: "Invalid email" });
  if (dbGender !== null && !GENDERS.includes(dbGender)) return res.status(400).json({ message: "Invalid gender" });

  try {
    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      `INSERT INTO users
        (full_name, username, email, phone, password_hash, role, status, address, birthdate, gender, avatar_url, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        full_name,
        username,
        dbEmail,
        dbPhone,
        password_hash,
        role,
        status,
        dbAddress,
        dbBirthdate,
        dbGender,
        dbAvatar,
        req.user.id,
        req.user.id,
      ]
    );

    res.status(201).json({ id: result.insertId, message: "User created" });
  } catch (err) {
    return handleDupError(err, res);
  }
});

// PUT /api/users/:id - Edit (any role), safely merges missing fields
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  if (id === req.user.id) return res.status(403).json({ message: "Cannot edit your own account here" });

  const {
    full_name,
    username,
    role,
    password, // optional
    email,
    phone,
    address,
    birthdate,
    gender,
    avatar_url,
  } = req.body;

  if (!full_name || !username || !role) {
    return res.status(400).json({ message: "full_name, username, role required" });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });

  try {
    // Fetch existing so undefined fields won't wipe them out
    const [existingRows] = await pool.execute(
      `SELECT email, phone, address, birthdate, gender, avatar_url
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    if (!existingRows.length) return res.status(404).json({ message: "User not found" });
    const existing = existingRows[0];

    const cleanEmail = normalizeNullableString(email);
    const cleanPhone = normalizeNullableString(phone);
    const cleanAddress = normalizeNullableString(address);
    const cleanBirthdate = normalizeNullableDate(birthdate);
    const cleanAvatar = normalizeNullableString(avatar_url);
    const cleanGender = normalizeNullableString(gender);

    // If undefined => keep existing; if null => set null; else set new value
    const nextEmail = cleanEmail === undefined ? existing.email : cleanEmail;
    const nextPhone = cleanPhone === undefined ? existing.phone : cleanPhone;
    const nextAddress = cleanAddress === undefined ? existing.address : cleanAddress;
    const nextBirthdate = cleanBirthdate === undefined ? existing.birthdate : cleanBirthdate;
    const nextAvatar = cleanAvatar === undefined ? existing.avatar_url : cleanAvatar;
    const nextGender = cleanGender === undefined ? existing.gender : cleanGender;

    if (!isValidEmail(nextEmail)) return res.status(400).json({ message: "Invalid email" });
    if (nextGender !== null && nextGender !== undefined && !GENDERS.includes(nextGender)) {
      return res.status(400).json({ message: "Invalid gender" });
    }

    if (password && String(password).trim().length > 0) {
      const password_hash = await bcrypt.hash(password, 10);
      await pool.execute(
        `UPDATE users
         SET full_name=?, username=?, email=?, phone=?, role=?, address=?, birthdate=?, gender=?, avatar_url=?, password_hash=?, updated_by=?
         WHERE id=?`,
        [
          full_name,
          username,
          nextEmail,
          nextPhone,
          role,
          nextAddress,
          nextBirthdate,
          nextGender,
          nextAvatar,
          password_hash,
          req.user.id,
          id,
        ]
      );
    } else {
      await pool.execute(
        `UPDATE users
         SET full_name=?, username=?, email=?, phone=?, role=?, address=?, birthdate=?, gender=?, avatar_url=?, updated_by=?
         WHERE id=?`,
        [
          full_name,
          username,
          nextEmail,
          nextPhone,
          role,
          nextAddress,
          nextBirthdate,
          nextGender,
          nextAvatar,
          req.user.id,
          id,
        ]
      );
    }

    res.json({ message: "User updated" });
  } catch (err) {
    return handleDupError(err, res);
  }
});

// PATCH /api/users/:id/status
router.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
  if (id === req.user.id) return res.status(403).json({ message: "Cannot change your own status here" });

  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ message: "status must be ACTIVE or INACTIVE" });

  try {
    await pool.execute("UPDATE users SET status=?, updated_by=? WHERE id=?", [status, req.user.id, id]);
    res.json({ message: "Status updated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
