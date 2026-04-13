const pool = require("../db");

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sales_item_inventory_usage (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        sales_item_id BIGINT NOT NULL,
        ingredient_id INT NOT NULL,
        qty_used_base_unit DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        base_unit VARCHAR(20) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sales_usage_item
          FOREIGN KEY (sales_item_id) REFERENCES sales_items(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_sales_usage_ingredient
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
          ON DELETE RESTRICT,
        INDEX idx_sales_usage_item (sales_item_id),
        INDEX idx_sales_usage_ingredient (ingredient_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.commit();
    console.log("sales_item_inventory_usage table is ready.");
  } catch (err) {
    await conn.rollback();
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
