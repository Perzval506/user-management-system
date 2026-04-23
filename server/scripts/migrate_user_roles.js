const pool = require("../db");

async function getRoleColumnMeta(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE AS columnType, COLUMN_DEFAULT AS columnDefault
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'role'
      LIMIT 1`
  );
  return rows[0] || null;
}

function parseEnumValues(columnType = "") {
  // Example: enum('OWNER','STAFF')
  const match = String(columnType).match(/^enum\((.*)\)$/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^'/, "").replace(/'$/, ""))
    .filter(Boolean);
}

async function run() {
  const conn = await pool.getConnection();
  try {
    const roleMeta = await getRoleColumnMeta(conn);
    if (!roleMeta) {
      throw new Error("users.role column not found");
    }

    const enumValues = parseEnumValues(roleMeta.columnType);
    const hasCurrentRoles =
      enumValues.includes("OWNER") &&
      enumValues.includes("CASHIER") &&
      enumValues.includes("STOCKROOM_STAFF");

    if (hasCurrentRoles) {
      console.log("users.role enum already up-to-date");
      return;
    }

    const hasLegacyStaff = enumValues.includes("STAFF");
    if (hasLegacyStaff) {
      const [result] = await conn.query(
        "UPDATE users SET role='CASHIER' WHERE role='STAFF'"
      );
      if (result.affectedRows > 0) {
        console.log(`Mapped ${result.affectedRows} legacy STAFF user(s) to CASHIER`);
      }
    }

    await conn.query(
      "ALTER TABLE users MODIFY COLUMN role ENUM('OWNER','CASHIER','STOCKROOM_STAFF') NOT NULL DEFAULT 'CASHIER'"
    );
    console.log("users.role enum migrated to OWNER/CASHIER/STOCKROOM_STAFF");
  } catch (err) {
    console.error("migrate_user_roles failed:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
