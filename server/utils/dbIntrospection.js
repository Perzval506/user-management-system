const pool = require("../db");

// Cache per-table column sets to reduce repeated information_schema hits.
const columnCache = new Map();

function resetDbIntrospectionCache(tableName = null) {
  if (tableName) {
    columnCache.delete(tableName);
    return;
  }
  columnCache.clear();
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(tableName, columnName) {
  const cols = await getColumns(tableName);
  return !!cols[columnName];
}

async function getColumns(tableName) {
  if (columnCache.has(tableName)) {
    return columnCache.get(tableName);
  }
  const [rows] = await pool.query(
    "SELECT column_name AS col FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  const cols = rows.reduce((acc, row) => {
    acc[row.col] = true;
    return acc;
  }, {});
  columnCache.set(tableName, cols);
  return cols;
}
module.exports = { tableExists, columnExists, getColumns, resetDbIntrospectionCache };
