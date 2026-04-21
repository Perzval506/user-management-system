const pool = require("../db");

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function uniqueIndexExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
        AND non_unique = 0
      LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(conn, sql, checkColumn, successLabel) {
  if (await columnExists(conn, "users", checkColumn)) {
    console.log(`${checkColumn} already exists`);
    return;
  }
  await conn.query(sql);
  console.log(successLabel);
}

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await addColumnIfMissing(
      conn,
      "ALTER TABLE users ADD COLUMN first_name VARCHAR(50) NULL",
      "first_name",
      "Added users.first_name"
    );

    await addColumnIfMissing(
      conn,
      "ALTER TABLE users ADD COLUMN last_name VARCHAR(50) NULL",
      "last_name",
      "Added users.last_name"
    );

    await addColumnIfMissing(
      conn,
      "ALTER TABLE users ADD COLUMN email VARCHAR(120) NULL",
      "email",
      "Added users.email"
    );

    await addColumnIfMissing(
      conn,
      "ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL",
      "phone",
      "Added users.phone"
    );

    await addColumnIfMissing(
      conn,
      "ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL",
      "last_login_at",
      "Added users.last_login_at"
    );

    if (await columnExists(conn, "users", "email")) {
      const hasUnique = await uniqueIndexExists(conn, "users", "email");
      if (!hasUnique) {
        try {
          await conn.query("ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)");
          console.log("Added unique index uq_users_email");
        } catch (err) {
          console.log(`Could not add unique index on users.email: ${err.message}`);
        }
      } else {
        console.log("Unique index on users.email already exists");
      }
    }

    if ((await columnExists(conn, "users", "first_name")) && (await columnExists(conn, "users", "last_name"))) {
      const [rows] = await conn.query(
        "SELECT id, full_name FROM users WHERE first_name IS NULL OR last_name IS NULL"
      );

      for (const row of rows) {
        const full = String(row.full_name || "").trim();
        const first = full ? full.split(/\s+/)[0] : null;
        const last = full ? full.split(/\s+/).slice(1).join(" ") || null : null;
        await conn.query("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?", [first, last, row.id]);
      }

      if (rows.length > 0) {
        console.log(`Backfilled first_name/last_name for ${rows.length} user(s)`);
      } else {
        console.log("No first_name/last_name backfill needed");
      }
    }

    await conn.commit();
    console.log("User profile columns migration complete");
  } catch (err) {
    await conn.rollback();
    console.error("migrate_user_profile_columns failed:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
