require("dotenv").config();
const pool = require("../db");

(async () => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    console.log("DB OK:", rows);
    process.exit(0);
  } catch (err) {
    console.error("DB ERROR:", err.message);
    process.exit(1);
  }
})();
