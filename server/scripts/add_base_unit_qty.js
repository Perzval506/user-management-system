const pool = require("../db");

const columnMigrations = [
  {
    name: "base_unit_qty",
    sql: "ALTER TABLE ingredients ADD COLUMN base_unit_qty DECIMAL(12,3) NULL AFTER base_unit",
  },
  {
    name: "quantity",
    sql: "ALTER TABLE ingredients ADD COLUMN quantity DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER base_unit_qty",
  },
  {
    name: "last_updated",
    sql: "ALTER TABLE ingredients ADD COLUMN last_updated TIMESTAMP NULL AFTER updated_at",
  },
];

(async () => {
  try {
    for (const migration of columnMigrations) {
      console.log(`Ensuring ingredients.${migration.name} exists...`);
      try {
        await pool.query(migration.sql);
        console.log(`Added ${migration.name}`);
      } catch (error) {
        console.log(`${migration.name} already exists or ALTER failed:`, error.message);
      }
    }

    console.log("Ingredient column migration complete");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed", err);
    process.exit(1);
  }
})();
