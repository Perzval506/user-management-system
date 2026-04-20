const pool = require("../db");
const { tableExists } = require("./dbIntrospection");

let movementTableReady = null;

async function canWriteInventoryMovements() {
  if (movementTableReady !== null) return movementTableReady;
  movementTableReady = await tableExists("inventory_movements");
  return movementTableReady;
}

async function writeInventoryMovement(entry = {}, conn = null) {
  if (!(await canWriteInventoryMovements())) return;

  const target = conn || pool;
  await target.query(
    `INSERT INTO inventory_movements
      (ingredient_id, movement_type, quantity_change, resulting_quantity, unit, source_module, reference_type, reference_id, notes, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.ingredient_id,
      entry.movement_type || "ADJUSTMENT",
      entry.quantity_change || 0,
      entry.resulting_quantity ?? null,
      entry.unit || null,
      entry.source_module || null,
      entry.reference_type || null,
      entry.reference_id ?? null,
      entry.notes || null,
      entry.created_by_user_id || null,
    ]
  );
}

module.exports = {
  writeInventoryMovement,
};
