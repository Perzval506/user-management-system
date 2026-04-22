const pool = require("../db");
const { tableExists } = require("./dbIntrospection");

const STOCKROOM = "STOCKROOM";
const SHELF = "SHELF";

async function supportsInventoryLocations() {
  return (await tableExists("inventory_locations")) && (await tableExists("inventory_location_balances"));
}

async function seedIngredientLocationBalances(conn, ingredientId, totalQty = 0) {
  if (!(await supportsInventoryLocations())) return;
  const [[countRow]] = await conn.query(
    `SELECT COUNT(*) AS balance_count
       FROM inventory_location_balances
      WHERE ingredient_id = ?`,
    [ingredientId]
  );
  if (Number(countRow?.balance_count || 0) > 0) return;
  await conn.query(
    `INSERT INTO inventory_location_balances (ingredient_id, location_code, quantity)
     VALUES (?, ?, ?), (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
    [ingredientId, STOCKROOM, Number(totalQty || 0), ingredientId, SHELF, 0]
  );
}

async function getIngredientLocationBalances(conn, ingredientId, totalQty = 0) {
  if (!(await supportsInventoryLocations())) {
    return {
      supported: false,
      stockroom: Number(totalQty || 0),
      shelf: 0,
    };
  }
  await seedIngredientLocationBalances(conn, ingredientId, totalQty);
  const [rows] = await conn.query(
    `SELECT location_code, quantity
       FROM inventory_location_balances
      WHERE ingredient_id = ?`,
    [ingredientId]
  );
  const balances = rows.reduce(
    (acc, row) => {
      acc[String(row.location_code || "").toUpperCase()] = Number(row.quantity || 0);
      return acc;
    },
    {}
  );
  return {
    supported: true,
    stockroom: Number(balances[STOCKROOM] || 0),
    shelf: Number(balances[SHELF] || 0),
  };
}

async function setIngredientLocationBalance(conn, ingredientId, locationCode, quantity) {
  await conn.query(
    `INSERT INTO inventory_location_balances (ingredient_id, location_code, quantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
    [ingredientId, locationCode, Number(quantity || 0)]
  );
}

async function adjustIngredientLocationBalance(conn, ingredientId, locationCode, delta, totalQty = 0) {
  const balances = await getIngredientLocationBalances(conn, ingredientId, totalQty);
  if (!balances.supported) return balances;
  const current = locationCode === SHELF ? balances.shelf : balances.stockroom;
  const next = Number((current + Number(delta || 0)).toFixed(2));
  if (next < 0) {
    throw new Error(`Adjustment would make ${locationCode} stock negative.`);
  }
  await setIngredientLocationBalance(conn, ingredientId, locationCode, next);
  return {
    ...balances,
    [locationCode === SHELF ? "shelf" : "stockroom"]: next,
  };
}

async function consumeIngredientLocationBalance(conn, ingredientId, qtyNeeded, totalQty = 0) {
  const balances = await getIngredientLocationBalances(conn, ingredientId, totalQty);
  if (!balances.supported) {
    return {
      supported: false,
      stockroomUsed: 0,
      shelfUsed: 0,
      sourceLabel: null,
    };
  }
  let remaining = Number(qtyNeeded || 0);
  const shelfUsed = Math.min(balances.shelf, remaining);
  remaining = Number((remaining - shelfUsed).toFixed(2));
  const stockroomUsed = Math.min(balances.stockroom, remaining);
  remaining = Number((remaining - stockroomUsed).toFixed(2));
  if (remaining > 0) {
    throw new Error("Not enough stock across shelf and stockroom.");
  }
  await setIngredientLocationBalance(conn, ingredientId, SHELF, Number((balances.shelf - shelfUsed).toFixed(2)));
  await setIngredientLocationBalance(conn, ingredientId, STOCKROOM, Number((balances.stockroom - stockroomUsed).toFixed(2)));
  let sourceLabel = null;
  if (shelfUsed > 0 && stockroomUsed > 0) sourceLabel = "SHELF+STOCKROOM";
  else if (shelfUsed > 0) sourceLabel = SHELF;
  else if (stockroomUsed > 0) sourceLabel = STOCKROOM;
  return {
    supported: true,
    stockroomUsed,
    shelfUsed,
    sourceLabel,
  };
}

module.exports = {
  STOCKROOM,
  SHELF,
  supportsInventoryLocations,
  seedIngredientLocationBalances,
  getIngredientLocationBalances,
  adjustIngredientLocationBalance,
  consumeIngredientLocationBalance,
};
