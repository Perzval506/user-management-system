const bcrypt = require("bcrypt");
require("dotenv").config();
const pool = require("../db");

(async () => {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const full_name = process.env.ADMIN_FULLNAME || "System Admin";

  const [rows] = await pool.execute("SELECT id FROM users WHERE username = ?", [username]);

  if (rows.length > 0) {
    console.log("Admin already exists:", username);
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(password, 10);

  await pool.execute(
    "INSERT INTO users (full_name, username, password_hash, role, status) VALUES (?, ?, ?, 'OWNER', 'ACTIVE')",
    [full_name, username, password_hash]
  );

  console.log("Seeded admin:", username, "password:", password);
  process.exit(0);
})();
