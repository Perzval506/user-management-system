const express = require("express");
const pool = require("../db");
const router = express.Router();
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");

const round2 = (num) => Number(Number(num || 0).toFixed(2));

router.use(requireAuth, requireAnyRole(["OWNER", "STOCKROOM_STAFF"]));

function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function startOfWeek(dateValue) {
  const date = new Date(dateValue);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekLabel(dateValue) {
  return startOfWeek(dateValue).toISOString().slice(0, 10);
}

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

router.get("/summary/weekly", async (_req, res) => {
  try {
    if (!(await tableExists("purchase_orders"))) {
      return res.json({ weeklyTotal: 0, weeklyHistory: [] });
    }

    const [rows] = await pool.query(
      "SELECT id, purchase_date, total_amount FROM purchase_orders ORDER BY purchase_date DESC, id DESC"
    );
    const currentWeek = weekLabel(new Date());
    const weeklyBuckets = rows.reduce((acc, row) => {
      const key = weekLabel(row.purchase_date);
      const existing = acc[key] || { week_start: key, total_spent: 0, order_count: 0 };
      existing.total_spent += Number(row.total_amount || 0);
      existing.order_count += 1;
      acc[key] = existing;
      return acc;
    }, {});

    const weeklyHistory = Object.values(weeklyBuckets)
      .map((row) => ({
        ...row,
        total_spent: round2(row.total_spent),
      }))
      .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));

    const weeklyTotal = weeklyHistory.find((row) => row.week_start === currentWeek)?.total_spent || 0;
    res.json({ weeklyTotal, weeklyHistory });
  } catch (err) {
    console.error("GET /purchase-orders/summary/weekly failed:", err.message);
    res.status(500).json({ message: "Failed to fetch weekly purchase-order history" });
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
  const { purchaseDate, items = [] } = req.body;
  const storeName = String(req.body.storeName || "").trim();
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!storeName) {
    return res.status(400).json({ message: "storeName is required" });
  }
  if (purchaseDate && !isValidDate(purchaseDate)) {
    return res.status(400).json({ message: "purchaseDate must be a valid date" });
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
      if (ingredientId && ingredientName && ingredientName.length > 255) {
        validationErrors.push(`Item ${index + 1} has an ingredient name that is too long.`);
      }
      if (brand.length > 255) {
        validationErrors.push(`Item ${index + 1} has a brand name that is too long.`);
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

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASE_ORDERS",
        action_name: "CREATE",
        entity_type: "purchase_order",
        entity_id: orderId,
        summary: `Created purchase order from ${storeName} totaling ${computedTotal.toFixed(2)}.`,
        metadata: {
          item_count: cleanedItems.length,
          total_amount: computedTotal,
        },
      },
      conn
    );
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

router.delete("/:id", async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return res.status(400).json({ message: "Invalid purchase order id." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query("SELECT id, store_name FROM purchase_orders WHERE id=? FOR UPDATE", [orderId]);
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: "Purchase order not found." });
    }

    const [details] = await conn.query(
      "SELECT ingredient_id, quantity FROM purchase_order_details WHERE purchase_order_id=? AND ingredient_id IS NOT NULL",
      [orderId]
    );
    const ingredientCols = await getColumns("ingredients");
    if (ingredientCols.quantity && details.length) {
      for (const detail of details) {
        const [[ingredient]] = await conn.query("SELECT id, quantity FROM ingredients WHERE id=? FOR UPDATE", [detail.ingredient_id]);
        if (!ingredient) continue;
        const currentQty = Number(ingredient.quantity || 0);
        const reversalQty = Number(detail.quantity || 0);
        if (currentQty < reversalQty) {
          await conn.rollback();
          return res.status(409).json({
            message: `Cannot delete this purchase order because ingredient #${detail.ingredient_id} only has ${currentQty.toFixed(2)} units remaining.`,
          });
        }
      }

      for (const detail of details) {
        await conn.query("UPDATE ingredients SET quantity = quantity - ?, last_updated = NOW() WHERE id=?", [
          Number(detail.quantity || 0),
          detail.ingredient_id,
        ]);
      }
    }

    await conn.query("DELETE FROM purchase_orders WHERE id=?", [orderId]);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASE_ORDERS",
        action_name: "DELETE",
        entity_type: "purchase_order",
        entity_id: orderId,
        summary: `Deleted purchase order from ${order.store_name}.`,
      },
      conn
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE /purchase-orders/:id failed:", err.message);
    res.status(500).json({ message: "Failed to delete purchase order" });
  } finally {
    conn.release();
  }
});

module.exports = router;
