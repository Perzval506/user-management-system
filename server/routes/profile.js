const express = require("express");
const pool = require("../db");
const router = express.Router();

// Get staff profile by userId
router.get("/staff/:userId", async (req, res) => {
  const { userId } = req.params;

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.role, u.status,
            up.address, up.gender, up.birthdate, up.avatar_url,
            up.emergency_contact_name, up.emergency_contact_phone,
            sd.employee_no, sd.position_title, sd.hire_date, sd.shift_start, sd.shift_end, sd.notes
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN staff_details sd ON sd.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );

  res.json(rows[0] || null);
});


router.put("/staff/:userId", async (req, res) => {
  const { userId } = req.params;

  const {
    full_name,
    email, phone,
    address, gender, birthdate, avatar_url,
    emergency_contact_name, emergency_contact_phone,
    employee_no, position_title, hire_date, shift_start, shift_end, notes
  } = req.body;

  // Update users table: include full_name if provided
  await pool.query(
    "UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?",
    [full_name || null, email || null, phone || null, userId]
  );

  await pool.query(
    `INSERT INTO user_profiles
      (user_id, address, gender, birthdate, avatar_url, emergency_contact_name, emergency_contact_phone)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      address=VALUES(address),
      gender=VALUES(gender),
      birthdate=VALUES(birthdate),
      avatar_url=VALUES(avatar_url),
      emergency_contact_name=VALUES(emergency_contact_name),
      emergency_contact_phone=VALUES(emergency_contact_phone)`,
    [userId, address || null, gender || null, birthdate || null, avatar_url || null,
     emergency_contact_name || null, emergency_contact_phone || null]
  );

  await pool.query(
    `INSERT INTO staff_details
      (user_id, employee_no, position_title, hire_date, shift_start, shift_end, notes)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      employee_no=VALUES(employee_no),
      position_title=VALUES(position_title),
      hire_date=VALUES(hire_date),
      shift_start=VALUES(shift_start),
      shift_end=VALUES(shift_end),
      notes=VALUES(notes)`,
    [userId, employee_no || null, position_title || null, hire_date || null,
     shift_start || null, shift_end || null, notes || null]
  );

  res.json({ ok: true });
});

module.exports = router;
