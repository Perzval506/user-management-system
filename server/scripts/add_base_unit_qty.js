const pool = require('../db');

(async () => {
  try {
    console.log('Adding column base_unit_qty to ingredients if missing...');
    try {
      await pool.query("ALTER TABLE ingredients ADD COLUMN base_unit_qty DECIMAL(12,3) NULL");
      console.log('Added base_unit_qty');
    } catch (e) {
      console.log('base_unit_qty maybe exists or ALTER failed:', e.message);
    }

    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed', err);
    process.exit(1);
  }
})();
