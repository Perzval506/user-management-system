require("dotenv").config();
const pool = require("../db");
const { resetDbIntrospectionCache } = require("../utils/dbIntrospection");

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (!rows.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added column ${table}.${column}`);
  } else {
    console.log(`Column ${table}.${column} already exists`);
  }
}

async function ensureIndex(table, indexName, definition) {
  const [rows] = await pool.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
  if (!rows.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
    console.log(`Added index ${indexName} on ${table}`);
  } else {
    console.log(`Index ${indexName} on ${table} already exists`);
  }
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_date DATE NOT NULL,
      needed_by_date DATE NULL,
      status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
      notes VARCHAR(255) NULL,
      review_notes VARCHAR(255) NULL,
      catering_order_id BIGINT NULL,
      requested_by_user_id INT NULL,
      reviewed_by_user_id INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_purchase_request_requester
        FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL,
      CONSTRAINT fk_purchase_request_reviewer
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL,
      UNIQUE KEY uq_purchase_request_catering_order (catering_order_id),
      INDEX idx_purchase_request_status (status),
      INDEX idx_purchase_request_requested_by (requested_by_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Ensured purchase_requests table");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_request_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      purchase_request_id INT NOT NULL,
      ingredient_id INT NOT NULL,
      ingredient_name VARCHAR(140) NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
      unit VARCHAR(40) NOT NULL,
      reason VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_purchase_request_item_request
        FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_purchase_request_item_ingredient
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
        ON DELETE RESTRICT,
      INDEX idx_purchase_request_item_request (purchase_request_id),
      INDEX idx_purchase_request_item_ingredient (ingredient_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Ensured purchase_request_items table");

  await ensureColumn("purchase_orders", "purchase_request_id", "INT NULL");
  await ensureIndex(
    "purchase_orders",
    "uq_purchase_order_request",
    "UNIQUE KEY `uq_purchase_order_request` (`purchase_request_id`)"
  );

  resetDbIntrospectionCache();
  await pool.end();
  console.log("Purchase request migration complete");
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await pool.end();
  process.exit(1);
});
