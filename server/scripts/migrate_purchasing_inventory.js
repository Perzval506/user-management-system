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

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ingredient_name VARCHAR(140) NOT NULL,
      quantity DECIMAL(12,3) NOT NULL,
      price DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_purchases_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Ensured purchases table");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      store_name VARCHAR(150) NOT NULL,
      purchase_date DATE NOT NULL,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_po_date (purchase_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Ensured purchase_orders table");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_details (
      id INT AUTO_INCREMENT PRIMARY KEY,
      purchase_order_id INT NOT NULL,
      ingredient_id INT NULL,
      ingredient_name VARCHAR(140) NULL,
      brand VARCHAR(120) NULL,
      unit VARCHAR(40) NULL,
      quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
      price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_pod_order
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_pod_ingredient
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
        ON DELETE SET NULL,
      INDEX idx_pod_order (purchase_order_id),
      INDEX idx_pod_ingredient (ingredient_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Ensured purchase_order_details table");

  await ensureColumn("ingredients", "quantity", "DECIMAL(12,3) NOT NULL DEFAULT 0");
  await ensureColumn("ingredients", "last_updated", "TIMESTAMP NULL");

  resetDbIntrospectionCache();
  await pool.end();
  console.log("Purchasing and inventory migration complete");
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await pool.end();
  process.exit(1);
});
