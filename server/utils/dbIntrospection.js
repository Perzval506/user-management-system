const pool = require("../db");

let cachedTables = null;
const cachedColumns = new Map();

async function getTables() {
  if (cachedTables) return cachedTables;
  const [rows] = await pool.query("SHOW TABLES");
  cachedTables = new Set(
    rows.map((row) => {
      const firstValue = Object.values(row)[0];
      return String(firstValue || "");
    })
  );
  return cachedTables;
}

async function tableExists(tableName) {
  const tables = await getTables();
  return tables.has(tableName);
}

async function getColumns(tableName) {
  if (cachedColumns.has(tableName)) return cachedColumns.get(tableName);
  if (!(await tableExists(tableName))) {
    const empty = {};
    cachedColumns.set(tableName, empty);
    return empty;
  }
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
  const cols = rows.reduce((acc, row) => {
    acc[row.Field] = true;
    return acc;
  }, {});
  cachedColumns.set(tableName, cols);
  return cols;
}

function resetDbIntrospectionCache() {
  cachedTables = null;
  cachedColumns.clear();
}

module.exports = {
  getColumns,
  resetDbIntrospectionCache,
  tableExists,
};
