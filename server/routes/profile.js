const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const SIGNATURES = {
  "image/png": "89504e47",
  "image/jpeg": "ffd8ff",
  "image/webp": "52494646",
  "image/gif": "47494638",
};

router.use(requireAuth);

router.post(
  "/avatar-upload",
  express.raw({ type: ["image/png", "image/jpeg", "image/webp", "image/gif"], limit: "5mb" }),
  async (req, res) => {
      try {
        if (!req.body || !req.body.length) {
          return res.status(400).json({ message: "Image file is required" });
        }
        if (req.body.length > MAX_AVATAR_BYTES) {
          return res.status(400).json({ message: "Image is too large. Maximum size is 5 MB." });
        }

        const contentType = String(req.headers["content-type"] || "").toLowerCase();
      const extension =
        contentType === "image/png" ? ".png" :
        contentType === "image/jpeg" ? ".jpg" :
        contentType === "image/webp" ? ".webp" :
        contentType === "image/gif" ? ".gif" :
        null;

        if (!extension) {
          return res.status(400).json({ message: "Unsupported image type" });
        }

        const fileHex = Buffer.from(req.body).subarray(0, 16).toString("hex");
        const expectedSignature = SIGNATURES[contentType];
        if (contentType === "image/webp") {
          if (!fileHex.startsWith(expectedSignature)) {
            return res.status(400).json({ message: "Uploaded file content does not match WEBP format." });
          }
        } else if (!fileHex.startsWith(expectedSignature)) {
          return res.status(400).json({ message: "Uploaded file content does not match the selected image type." });
        }

        const uploadsDir = path.join(__dirname, "..", "uploads", "avatars");
        fs.mkdirSync(uploadsDir, { recursive: true });

        const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
        const filePath = path.join(uploadsDir, fileName);
        await fs.promises.writeFile(filePath, req.body);

      const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/avatars/${fileName}`;
      res.status(201).json({ avatar_url: avatarUrl });
    } catch (err) {
      console.error("Avatar upload failed:", err.message);
      res.status(500).json({ message: "Failed to upload avatar" });
    }
  }
);

router.get("/me", async (req, res) => {
  const userId = req.user.id;

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.first_name, u.last_name, u.username, u.email, u.phone, u.role, u.status,
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

// Get staff profile by userId
router.get("/staff/:userId", requireRole("OWNER"), async (req, res) => {
  const { userId } = req.params;

  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.first_name, u.last_name, u.username, u.email, u.phone, u.role, u.status,
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


router.put("/staff/:userId", requireRole("OWNER"), async (req, res) => {
  const { userId } = req.params;

  const {
    full_name,
    first_name,
    last_name,
    email, phone,
    address, gender, birthdate, avatar_url,
    emergency_contact_name, emergency_contact_phone,
    employee_no, position_title, hire_date, shift_start, shift_end, notes
  } = req.body;

  // Update users table: include full_name if provided
  const finalFull = (full_name && String(full_name).trim()) ? String(full_name).trim() : `${(first_name||"").trim()} ${(last_name||"").trim()}`.trim() || null;
  const firstVal = (first_name && String(first_name).trim()) ? String(first_name).trim() : (finalFull ? finalFull.split(' ')[0] : null);
  const lastVal = (last_name && String(last_name).trim()) ? String(last_name).trim() : (finalFull ? finalFull.split(' ').slice(1).join(' ') : null);

  await pool.query(
    "UPDATE users SET full_name = COALESCE(?, full_name), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?",
    [finalFull, firstVal, lastVal, email || null, phone || null, userId]
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
