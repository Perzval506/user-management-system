const express = require("express");
const pool = require("../db");
const router = express.Router();
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { writeInventoryMovement } = require("../utils/inventoryMovements");
const {
  STOCKROOM,
  SHELF,
  supportsInventoryLocations,
  getIngredientLocationBalances,
  setIngredientLocationBalance,
} = require("../utils/inventoryLocations");

router.use(requireAuth, requireAnyRole(["OWNER", "STOCKROOM_STAFF"]));

const LOW_STOCK_THRESHOLD = 5;
const WEEKLY_REVIEW_DAYS = 7;
const ADJUSTMENT_TYPES = new Set(["SPOILAGE", "WASTAGE", "DAMAGED", "MANUAL_ADD", "MANUAL_REDUCE"]);

function reviewWindowDates() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (WEEKLY_REVIEW_DAYS - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeLocation(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === STOCKROOM || normalized === SHELF) return normalized;
  return null;
}

async function fetchInventoryRows(connOrPool) {
  const ingredientCols = await getColumns("ingredients");
  const hasQuantity = Boolean(ingredientCols.quantity);
  const activeIngredientWhere = ingredientCols.status ? "WHERE i.status = 'ACTIVE'" : "";
  const hasPurchaseOrderDetails = await tableExists("purchase_order_details");
  const totalStockSql = hasQuantity
    ? "COALESCE(i.quantity, 0)"
    : hasPurchaseOrderDetails
      ? "COALESCE((SELECT SUM(pod.quantity) FROM purchase_order_details pod WHERE pod.ingredient_id = i.id), 0)"
      : "0";

  const [rows] = await connOrPool.query(`
    SELECT i.id,
           i.ingredient_name,
           i.category,
           i.base_unit,
           ${ingredientCols.status ? "i.status" : "'ACTIVE' AS status"},
           ${totalStockSql} AS total_stock
      FROM ingredients i
     ${activeIngredientWhere}
     ORDER BY i.ingredient_name ASC
  `);

  const locationsSupported = await supportsInventoryLocations();
  if (!locationsSupported) {
    return rows.map((row) => ({
      ...row,
      locations_supported: false,
      stockroom_qty: Number(row.total_stock || 0),
      shelf_qty: 0,
    }));
  }

  const enriched = [];
  for (const row of rows) {
    const balances = await getIngredientLocationBalances(connOrPool, row.id, row.total_stock);
    enriched.push({
      ...row,
      locations_supported: balances.supported,
      stockroom_qty: balances.stockroom,
      shelf_qty: balances.shelf,
    });
  }
  return enriched;
}

router.get("/summary", async (_req, res) => {
  try {
    const rows = await fetchInventoryRows(pool);
    res.json(rows);
  } catch (err) {
    console.error("GET /inventory/summary failed:", err.message);
    res.status(500).json({ message: "Failed to fetch inventory summary" });
  }
});

router.get("/weekly-review", async (_req, res) => {
  try {
    const ingredientCols = await getColumns("ingredients");
    const hasQuantity = Boolean(ingredientCols.quantity);
    const activeIngredientWhere = ingredientCols.status ? "WHERE i.status = 'ACTIVE'" : "";
    const lastUpdatedSql = ingredientCols.last_updated
      ? "i.last_updated"
      : ingredientCols.updated_at
        ? "i.updated_at AS last_updated"
        : "NULL AS last_updated";
    const hasPurchaseOrderDetails = await tableExists("purchase_order_details");
    const totalStockSql = hasQuantity
      ? "COALESCE(i.quantity, 0)"
      : hasPurchaseOrderDetails
        ? "COALESCE((SELECT SUM(pod.quantity) FROM purchase_order_details pod WHERE pod.ingredient_id = i.id), 0)"
        : "0";

    const [inventoryRows] = await pool.query(`
      SELECT i.id,
             i.ingredient_name,
             i.category,
             i.base_unit,
             ${ingredientCols.status ? "i.status" : "'ACTIVE' AS status"},
             ${totalStockSql} AS total_stock,
             ${lastUpdatedSql}
        FROM ingredients i
       ${activeIngredientWhere}
       ORDER BY COALESCE(i.category, 'UNCATEGORIZED') ASC, i.ingredient_name ASC
    `);

    const { start, end } = reviewWindowDates();
    const purchaseByKey = {};
    const usageById = {};

    if (await tableExists("purchases")) {
      const [purchaseRows] = await pool.query(
        "SELECT ingredient_name, quantity, created_at FROM purchases WHERE created_at >= ? ORDER BY created_at DESC",
        [start]
      );
      purchaseRows.forEach((row) => {
        const key = normalizeKey(row.ingredient_name);
        purchaseByKey[key] = Number(purchaseByKey[key] || 0) + Number(row.quantity || 0);
      });
    }

    if ((await tableExists("purchase_orders")) && (await tableExists("purchase_order_details"))) {
      const [poRows] = await pool.query(
        `SELECT pod.ingredient_id, pod.ingredient_name, pod.quantity, po.purchase_date
           FROM purchase_order_details pod
           JOIN purchase_orders po ON po.id = pod.purchase_order_id
          WHERE po.purchase_date >= ?`,
        [start]
      );
      poRows.forEach((row) => {
        if (row.ingredient_id) {
          usageById[`purchase:${row.ingredient_id}`] = Number(usageById[`purchase:${row.ingredient_id}`] || 0) + Number(row.quantity || 0);
        } else {
          const key = normalizeKey(row.ingredient_name);
          purchaseByKey[key] = Number(purchaseByKey[key] || 0) + Number(row.quantity || 0);
        }
      });
    }

    if ((await tableExists("sales_item_inventory_usage")) && (await tableExists("sales_items")) && (await tableExists("sales_transactions"))) {
      const [usageRows] = await pool.query(
        `SELECT siiu.ingredient_id, siiu.qty_used_base_unit, st.sale_datetime
           FROM sales_item_inventory_usage siiu
           JOIN sales_items si ON si.id = siiu.sales_item_id
           JOIN sales_transactions st ON st.id = si.sales_transaction_id
          WHERE st.status = 'COMPLETED'
            AND st.sale_datetime >= ?`,
        [start]
      );
      usageRows.forEach((row) => {
        usageById[row.ingredient_id] = Number(usageById[row.ingredient_id] || 0) + Number(row.qty_used_base_unit || 0);
      });
    }

    const recommendations = inventoryRows
      .map((row) => {
        const purchaseById = Number(usageById[`purchase:${row.id}`] || 0);
        const purchased = purchaseById || Number(purchaseByKey[normalizeKey(row.ingredient_name)] || 0);
        const used = Number(usageById[row.id] || 0);
        const stock = Number(row.total_stock || 0);
        const recommendedBuyQty = Math.max(round2(used + LOW_STOCK_THRESHOLD - stock), 0);
        return {
          id: row.id,
          ingredient_name: row.ingredient_name,
          category: row.category || "UNCATEGORIZED",
          base_unit: row.base_unit,
          total_stock: stock,
          weekly_purchased: round2(purchased),
          weekly_used: round2(used),
          recommended_buy_qty: round2(recommendedBuyQty),
          needs_attention: stock <= LOW_STOCK_THRESHOLD || recommendedBuyQty > 0,
        };
      })
      .sort((a, b) => {
        if (Number(a.needs_attention) !== Number(b.needs_attention)) return Number(b.needs_attention) - Number(a.needs_attention);
        if (a.total_stock !== b.total_stock) return a.total_stock - b.total_stock;
        return String(a.ingredient_name).localeCompare(String(b.ingredient_name));
      });

    const categorySummary = recommendations.reduce((acc, row) => {
      const key = row.category || "UNCATEGORIZED";
      const existing = acc[key] || {
        category: key,
        item_count: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        recommended_buy_count: 0,
      };
      existing.item_count += 1;
      if (row.total_stock <= LOW_STOCK_THRESHOLD) existing.low_stock_count += 1;
      if (row.total_stock <= 0) existing.out_of_stock_count += 1;
      if (row.recommended_buy_qty > 0) existing.recommended_buy_count += 1;
      acc[key] = existing;
      return acc;
    }, {});

    res.json({
      review_start: start,
      review_end: end,
      low_stock_threshold: LOW_STOCK_THRESHOLD,
      recommendations,
      categories: Object.values(categorySummary),
    });
  } catch (err) {
    console.error("GET /inventory/weekly-review failed:", err.message);
    res.status(500).json({ message: "Failed to fetch weekly inventory review" });
  }
});

router.get("/movements", async (req, res) => {
  try {
    if (!(await tableExists("inventory_movements"))) {
      return res.json([]);
    }

    const ingredientId = Number(req.query.ingredientId || 0);
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const where = Number.isFinite(ingredientId) && ingredientId > 0 ? "WHERE im.ingredient_id = ?" : "";
    const params = Number.isFinite(ingredientId) && ingredientId > 0 ? [ingredientId, limit] : [limit];
    const [rows] = await pool.query(
      `SELECT im.id,
              im.ingredient_id,
              i.ingredient_name,
              im.movement_type,
              im.quantity_change,
              im.resulting_quantity,
              im.unit,
              im.source_module,
              im.reference_type,
              im.reference_id,
              im.notes,
              im.created_at,
              u.full_name AS created_by_name
         FROM inventory_movements im
         JOIN ingredients i ON i.id = im.ingredient_id
         LEFT JOIN users u ON u.id = im.created_by_user_id
         ${where}
        ORDER BY im.created_at DESC, im.id DESC
        LIMIT ?`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /inventory/movements failed:", err.message);
    res.status(500).json({ message: "Failed to fetch inventory movements" });
  }
});

router.post("/transfer", async (req, res) => {
  const ingredientId = Number(req.body?.ingredientId || req.body?.ingredient_id);
  const fromLocation = normalizeLocation(req.body?.fromLocation || req.body?.from_location);
  const toLocation = normalizeLocation(req.body?.toLocation || req.body?.to_location);
  const quantity = Number(req.body?.quantity);
  const reason = String(req.body?.reason || "").trim() || null;

  if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ message: "ingredientId is required." });
  }
  if (!fromLocation || !toLocation || fromLocation === toLocation) {
    return res.status(400).json({ message: "Select different from/to locations." });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: "Transfer quantity must be greater than 0." });
  }
  if (!(await supportsInventoryLocations())) {
    return res.status(503).json({ message: "Inventory locations are not set up yet. Run the latest database setup first." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ingredientRows] = await conn.query(
      "SELECT id, ingredient_name, base_unit, quantity FROM ingredients WHERE id=? FOR UPDATE",
      [ingredientId]
    );
    const ingredient = ingredientRows[0];
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }

    const balances = await getIngredientLocationBalances(conn, ingredientId, ingredient.quantity);
    const sourceQty = fromLocation === STOCKROOM ? balances.stockroom : balances.shelf;
    const targetQty = toLocation === STOCKROOM ? balances.stockroom : balances.shelf;
    if (sourceQty < quantity) {
      await conn.rollback();
      return res.status(409).json({ message: `Not enough stock in ${fromLocation}.` });
    }

    await setIngredientLocationBalance(conn, ingredientId, fromLocation, round2(sourceQty - quantity));
    await setIngredientLocationBalance(conn, ingredientId, toLocation, round2(targetQty + quantity));

    await writeInventoryMovement(
      {
        ingredient_id: ingredientId,
        movement_type: "STOCK_TRANSFER",
        quantity_change: 0,
        resulting_quantity: Number(ingredient.quantity || 0),
        unit: ingredient.base_unit,
        source_module: "INVENTORY",
        reference_type: "ingredient",
        reference_id: ingredientId,
        notes: `${fromLocation} -> ${toLocation} | Qty ${round2(quantity)}${reason ? ` | ${reason}` : ""}`,
        created_by_user_id: req.user?.id || null,
      },
      conn
    );
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INVENTORY",
        action_name: "TRANSFER",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Transferred ${round2(quantity)} ${ingredient.base_unit} of ${ingredient.ingredient_name} from ${fromLocation} to ${toLocation}.`,
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /inventory/transfer failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to transfer stock" });
  } finally {
    conn.release();
  }
});

router.post("/adjustments", async (req, res) => {
  const ingredientId = Number(req.body?.ingredientId || req.body?.ingredient_id);
  const adjustmentType = String(req.body?.type || req.body?.adjustment_type || "").trim().toUpperCase();
  const location = normalizeLocation(req.body?.location);
  const quantityChange = Number(req.body?.quantityChange ?? req.body?.quantity_change);
  const reason = String(req.body?.reason || "").trim() || null;

  if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
    return res.status(400).json({ message: "ingredientId is required." });
  }
  if (!ADJUSTMENT_TYPES.has(adjustmentType)) {
    return res.status(400).json({ message: `type must be one of: ${Array.from(ADJUSTMENT_TYPES).join(", ")}` });
  }
  if (!Number.isFinite(quantityChange) || quantityChange === 0) {
    return res.status(400).json({ message: "quantityChange must not be 0." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ingredientRows] = await conn.query(
      "SELECT id, ingredient_name, base_unit, quantity FROM ingredients WHERE id=? FOR UPDATE",
      [ingredientId]
    );
    const ingredient = ingredientRows[0];
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Ingredient not found." });
    }

    const previousTotal = Number(ingredient.quantity || 0);
    const nextTotal = round2(previousTotal + quantityChange);
    if (nextTotal < 0) {
      await conn.rollback();
      return res.status(409).json({ message: "Adjustment would make total stock negative." });
    }

    await conn.query("UPDATE ingredients SET quantity=?, last_updated=NOW() WHERE id=?", [nextTotal, ingredientId]);

    if (location && (await supportsInventoryLocations())) {
      const balances = await getIngredientLocationBalances(conn, ingredientId, previousTotal);
      const currentQty = location === STOCKROOM ? balances.stockroom : balances.shelf;
      const nextLocationQty = round2(currentQty + quantityChange);
      if (nextLocationQty < 0) {
        await conn.rollback();
        return res.status(409).json({
          message: `${location} stock would become negative. Current balances: STOCKROOM ${round2(
            balances.stockroom
          )}, SHELF ${round2(balances.shelf)}. Choose the location where the stock currently exists, or transfer stock first.`,
        });
      }
      await setIngredientLocationBalance(conn, ingredientId, location, nextLocationQty);
    }

    await writeInventoryMovement(
      {
        ingredient_id: ingredientId,
        movement_type: adjustmentType,
        quantity_change: quantityChange,
        resulting_quantity: nextTotal,
        unit: ingredient.base_unit,
        source_module: "INVENTORY",
        reference_type: "ingredient",
        reference_id: ingredientId,
        notes: `${location ? `${location} | ` : ""}${reason || "Inventory adjustment"}`,
        created_by_user_id: req.user?.id || null,
      },
      conn
    );
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "INVENTORY",
        action_name: "ADJUSTMENT",
        entity_type: "ingredient",
        entity_id: ingredientId,
        summary: `Recorded ${adjustmentType.toLowerCase()} adjustment for ${ingredient.ingredient_name}.`,
        metadata: {
          type: adjustmentType,
          location,
          quantity_change: quantityChange,
        },
      },
      conn
    );
    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("POST /inventory/adjustments failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save inventory adjustment" });
  } finally {
    conn.release();
  }
});

module.exports = router;
