const express = require("express");
const pool = require("../db");
const router = express.Router();
const { getColumns, tableExists } = require("../utils/dbIntrospection");

const round2 = (num) => Number(Number(num || 0).toFixed(2));

// List purchase orders with basic summary
router.get("/", async (_req, res) => {
  try {
    if (!(await tableExists("purchase_orders")) || !(await tableExists("purchase_order_details"))) {
      return res.json([]);
    }
    const [rows] = await pool.query(
      `SELECT po.id, po.store_name, po.purchase_date, po.total_amount, po.created_at,
              COUNT(pod.id) AS item_count
         FROM purchase_orders po
         LEFT JOIN purchase_order_details pod ON pod.purchase_order_id = po.id
        GROUP BY po.id
        ORDER BY po.purchase_date DESC, po.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /purchase-orders failed:", err.message);
    res.status(500).json({ message: "Failed to fetch purchase orders" });
  }
});

// Retrieve a single purchase order with items
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (!(await tableExists("purchase_orders")) || !(await tableExists("purchase_order_details"))) {
      return res.status(404).json({ message: "Purchase order storage is not set up yet." });
    }
    const [[order]] = await pool.query("SELECT * FROM purchase_orders WHERE id=?", [id]);
    if (!order) return res.status(404).json({ message: "Not found" });
    const [items] = await pool.query(
      "SELECT * FROM purchase_order_details WHERE purchase_order_id=? ORDER BY id ASC",
      [id]
    );
    res.json({ order, items });
  } catch (err) {
    console.error("GET /purchase-orders/:id failed:", err.message);
    res.status(500).json({ message: "Failed to fetch purchase order" });
  }
});

// Create a new purchase order with details
router.post("/", async (req, res) => {
  const { storeName, purchaseDate, items = [] } = req.body;
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!storeName || !String(storeName).trim()) {
    return res.status(400).json({ message: "storeName is required" });
  }
  if (!normalizedItems.length) {
    return res.status(400).json({ message: "At least one purchase-order item is required" });
  }

  const validationErrors = [];
  const cleanedItems = normalizedItems
    .map((item, index) => {
      const ingredientId = item.ingredientId ? Number(item.ingredientId) : null;
      const ingredientName = String(item.ingredientName || "").trim();
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      const brand = String(item.brand || "").trim();
      const unit = String(item.unit || "").trim();

      if (!ingredientId && !ingredientName) {
        validationErrors.push(`Item ${index + 1} is missing an ingredient.`);
      }
      if (!isFinite(quantity) || quantity <= 0) {
        validationErrors.push(`Item ${index + 1} needs a quantity greater than 0.`);
      }
      if (!isFinite(price) || price < 0) {
        validationErrors.push(`Item ${index + 1} needs a unit price of 0 or more.`);
      }
      if (!unit) {
        validationErrors.push(`Item ${index + 1} is missing a unit.`);
      }

      return {
        ingredientId,
        ingredientName: ingredientName || null,
        brand: brand || null,
        unit: unit || null,
        quantity,
        price,
      };
    })
    .filter((item) => item.ingredientId || item.ingredientName || item.brand || item.unit || item.quantity || item.price);

  if (validationErrors.length) {
    return res.status(400).json({ message: validationErrors[0], details: validationErrors });
  }

  const computedTotal = round2(
    cleanedItems.reduce((sum, it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);
      return sum + qty * price;
    }, 0)
  );

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("purchase_orders")) || !(await tableExists("purchase_order_details"))) {
      return res.status(503).json({ message: "Purchase order setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();
    const [rOrder] = await conn.query(
      "INSERT INTO purchase_orders (store_name, purchase_date, total_amount, created_at) VALUES (?,?,?,NOW())",
      [storeName, purchaseDate ? new Date(purchaseDate) : new Date(), computedTotal]
    );
    const orderId = rOrder.insertId;

    if (cleanedItems.length) {
      const rows = cleanedItems.map((it) => {
        const qty = round2(it.quantity || 0);
        const price = round2(it.price || 0);
        const subtotal = round2(qty * price);
        return [
          orderId,
          it.ingredientId || null,
          it.ingredientName || null,
          it.brand || null,
          it.unit || null,
          qty,
          price,
          subtotal,
        ];
      });
      await conn.query(
        `INSERT INTO purchase_order_details
          (purchase_order_id, ingredient_id, ingredient_name, brand, unit, quantity, price, subtotal)
         VALUES ?`,
        [rows]
      );

      // Update inventory balances for each detail (best-effort inside txn)
      const ingredientCols = await getColumns("ingredients");
      const hasQuantity = Boolean(ingredientCols.quantity);
      const hasLastUpdated = Boolean(ingredientCols.last_updated);
      for (const it of cleanedItems) {
        if (!it.ingredientId) continue;
        const qty = round2(it.quantity || 0);
        const updates = [];
        const values = [];
        if (hasQuantity) {
          updates.push("quantity = COALESCE(quantity,0)+?");
          values.push(qty);
        }
        if (hasLastUpdated) {
          updates.push("last_updated = NOW()");
        }
        if (updates.length) {
          values.push(it.ingredientId);
          await conn.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, values);
        }
      }
    }

    await conn.commit();
    res.status(201).json({ id: orderId, totalAmount: computedTotal });
  } catch (err) {
    await conn.rollback();
    console.error("POST /purchase-orders failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to create purchase order" });
  } finally {
    conn.release();
  }
});

module.exports = router;
