const pool = require("../db");

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT NULL,
        actor_name VARCHAR(120) NULL,
        actor_role VARCHAR(60) NULL,
        module_name VARCHAR(80) NOT NULL,
        action_name VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80) NULL,
        entity_id BIGINT NULL,
        summary VARCHAR(255) NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_audit_actor
          FOREIGN KEY (actor_user_id) REFERENCES users(id)
          ON DELETE SET NULL,
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_module (module_name, created_at),
        INDEX idx_audit_entity (entity_type, entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.commit();
    console.log("audit_logs table is ready.");
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
