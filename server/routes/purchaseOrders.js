const express = require("express");
const pool = require("../db");
const router = express.Router();

const round2 = (num) => Number(Number(num || 0).toFixed(2));

// List purchase orders with basic summary
router.get("/", async (_req, res) => {
  try {
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
  const computedTotal = round2(
    normalizedItems.reduce((sum, it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);
      return sum + qty * price;
    }, 0)
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rOrder] = await conn.query(
      "INSERT INTO purchase_orders (store_name, purchase_date, total_amount, created_at) VALUES (?,?,?,NOW())",
      [storeName, purchaseDate ? new Date(purchaseDate) : new Date(), computedTotal]
    );
    const orderId = rOrder.insertId;

    if (normalizedItems.length) {
      const rows = normalizedItems.map((it) => {
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
      for (const it of normalizedItems) {
        if (!it.ingredientId) continue;
        const qty = round2(it.quantity || 0);
        await conn.query(
          "UPDATE ingredients SET quantity = COALESCE(quantity,0)+?, last_updated = NOW() WHERE id=?",
          [qty, it.ingredientId]
        );
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
