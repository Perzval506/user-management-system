const pool = require("../db");

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        ingredient_id INT NOT NULL,
        movement_type VARCHAR(40) NOT NULL,
        quantity_change DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        resulting_quantity DECIMAL(12,3) NULL,
        unit VARCHAR(20) NULL,
        source_module VARCHAR(60) NULL,
        reference_type VARCHAR(80) NULL,
        reference_id BIGINT NULL,
        notes VARCHAR(255) NULL,
        created_by_user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_inventory_movement_ingredient
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_inventory_movement_user
          FOREIGN KEY (created_by_user_id) REFERENCES users(id)
          ON DELETE SET NULL,
        INDEX idx_inventory_movement_ingredient_date (ingredient_id, created_at),
        INDEX idx_inventory_movement_module_date (source_module, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.commit();
    console.log("inventory_movements migration complete");
  } catch (err) {
    await conn.rollback();
    console.error("inventory_movements migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
