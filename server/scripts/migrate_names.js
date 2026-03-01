const pool = require('../db');

(async () => {
  try {
    console.log('Adding columns first_name, last_name if missing...');
    try {
      await pool.query("ALTER TABLE users ADD COLUMN first_name VARCHAR(50) NULL");
      console.log('Added first_name');
    } catch (e) {
      console.log('first_name maybe exists or ALTER failed:', e.message);
    }

    try {
      await pool.query("ALTER TABLE users ADD COLUMN last_name VARCHAR(50) NULL");
      console.log('Added last_name');
    } catch (e) {
      console.log('last_name maybe exists or ALTER failed:', e.message);
    }

    console.log('Populating first_name/last_name from full_name where null...');
    const [rows] = await pool.query("SELECT id, full_name FROM users WHERE (first_name IS NULL OR last_name IS NULL)");
    for (const r of rows) {
      const full = (r.full_name || '').trim();
      const first = full.split(' ')[0] || null;
      const last = full.split(' ').slice(1).join(' ') || null;
      await pool.query('UPDATE users SET first_name=?, last_name=? WHERE id=?', [first, last, r.id]);
      console.log(`Updated user ${r.id}: ${first} ${last}`);
    }

    console.log('Migration complete');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed', err);
    process.exit(1);
  }
})();
