const bcrypt = require('bcrypt');
const pool = require('../db');

// usage: node server/scripts/reset-passwords.js <username> <newPassword>
async function main() {
  const [, , username, newPassword] = process.argv;
  if (!username || !newPassword) {
    console.error('Usage: node server/scripts/reset-passwords.js <username> <newPassword>');
    process.exit(2);
  }

  try {
    const password_hash = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ? WHERE username = ?',
      [password_hash, username]
    );

    if (result.affectedRows === 0) {
      console.error('No user updated. Check the username.');
      process.exit(1);
    }

    console.log(`Password for '${username}' updated successfully.`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
