const express = require("express");
const pool = require("../db");
const router = express.Router();
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { getColumns, tableExists } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { writeInventoryMovement } = require("../utils/inventoryMovements");

// Basic purchases ledger (palengke-style buying) stays owner-controlled.
router.use(requireAuth, requireAnyRole(["OWNER"]));

function startOfWeek(dateValue) {
  const date = new Date(dateValue);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekLabel(dateValue) {
  const start = startOfWeek(dateValue);
  return start.toISOString().slice(0, 10);
}

router.get("/", async (_req, res) => {
  try {
    if (!(await tableExists("purchases"))) {
      return res.json({ items: [], total: 0, weeklyTotal: 0, weeklyHistory: [], setupRequired: true });
    }
    const [rows] = await pool.query(
      "SELECT id, ingredient_name, quantity, price, created_at FROM purchases ORDER BY created_at DESC"
    );
    const total = rows.reduce((sum, r) => sum + Number(r.price || 0), 0);
    const currentWeek = weekLabel(new Date());
    const weeklyBuckets = rows.reduce((acc, row) => {
      const key = weekLabel(row.created_at);
      const existing = acc[key] || { week_start: key, purchase_total: 0, purchase_count: 0 };
      existing.purchase_total += Number(row.price || 0);
      existing.purchase_count += 1;
      acc[key] = existing;
      return acc;
    }, {});
    const weeklyHistory = Object.values(weeklyBuckets)
      .map((row) => ({
        ...row,
        purchase_total: Number(row.purchase_total.toFixed(2)),
      }))
      .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
    const weeklyTotal = weeklyHistory.find((row) => row.week_start === currentWeek)?.purchase_total || 0;

    return res.json({
      items: rows.map((r) => ({ ...r, ingredient_name: String(r.ingredient_name || "").toUpperCase(), createdAt: r.created_at })),
      total,
      weeklyTotal,
      weeklyHistory,
    });
  } catch (err) {
    console.error("GET /purchases failed", err);
    return res.status(500).json({ message: "Failed to fetch purchases" });
  }
});

router.post("/", async (req, res) => {
  const { ingredientId, ingredientName, quantity, price } = req.body;
  const ingredientIdNum = Number(ingredientId);
  const qty = Number(quantity);
  const cost = Number(price);

  if (!Number.isFinite(ingredientIdNum) || ingredientIdNum <= 0) {
    return res.status(400).json({ message: "ingredientId is required" });
  }
  if (!isFinite(qty) || qty <= 0) {
    return res.status(400).json({ message: "quantity must be > 0" });
  }
  if (!isFinite(cost) || cost < 0) {
    return res.status(400).json({ message: "price must be >= 0" });
  }

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("purchases"))) {
      return res.status(503).json({ message: "Purchases setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();

    const [[ingredient]] = await conn.query(
      "SELECT id, ingredient_name FROM ingredients WHERE id=? FOR UPDATE",
      [ingredientIdNum]
    );
    if (!ingredient) {
      await conn.rollback();
      return res.status(404).json({ message: "Selected ingredient was not found." });
    }

    const [result] = await conn.query(
      "INSERT INTO purchases (ingredient_name, quantity, price, created_at) VALUES (?,?,?,NOW())",
      [String(ingredient.ingredient_name || ingredientName || "").trim().toUpperCase(), qty, cost]
    );

    const ingredientCols = await getColumns("ingredients");
    const hasQuantity = Boolean(ingredientCols.quantity);
    const hasLastUpdated = Boolean(ingredientCols.last_updated);
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
      values.push(ingredient.id);
      await conn.query(`UPDATE ingredients SET ${updates.join(", ")} WHERE id=?`, values);
    }
    const nextQty = hasQuantity ? qty + Number(ingredient.quantity || 0) : null;
    if (hasQuantity) {
      await writeInventoryMovement(
        {
          ingredient_id: ingredient.id,
          movement_type: "PURCHASE_IN",
          quantity_change: qty,
          resulting_quantity: nextQty,
          unit: null,
          source_module: "PURCHASES",
          reference_type: "purchase",
          reference_id: result.insertId,
          notes: `Quick purchase recorded for ${String(ingredient.ingredient_name || "").trim().toUpperCase()}.`,
          created_by_user_id: req.user?.id || null,
        },
        conn
      );
    }

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASES",
        action_name: "CREATE",
        entity_type: "purchase",
        entity_id: result.insertId,
        summary: `Recorded purchase for ${String(ingredient.ingredient_name || "").trim().toUpperCase()} (${qty.toFixed(2)} units, ${cost.toFixed(2)} total).`,
      },
      conn
    );

    await conn.commit();
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /purchases failed", err);
    return res.status(500).json({ message: "Failed to save purchase" });
  } finally {
    conn.release();
  }
});

router.delete("/:id", async (req, res) => {
  const purchaseId = Number(req.params.id);
  if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({ message: "Invalid purchase id." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[purchase]] = await conn.query("SELECT id, ingredient_name, quantity FROM purchases WHERE id=? FOR UPDATE", [purchaseId]);
    if (!purchase) {
      await conn.rollback();
      return res.status(404).json({ message: "Purchase not found." });
    }

    const ingredientCols = await getColumns("ingredients");
    if (ingredientCols.quantity) {
      const [[ingredient]] = await conn.query(
        "SELECT id, quantity FROM ingredients WHERE LOWER(ingredient_name) = LOWER(?) FOR UPDATE",
        [purchase.ingredient_name]
      );
      if (ingredient) {
        const currentQty = Number(ingredient.quantity || 0);
        const reversalQty = Number(purchase.quantity || 0);
        if (currentQty < reversalQty) {
          await conn.rollback();
          return res.status(409).json({
            message: `Cannot delete this purchase because only ${currentQty.toFixed(2)} units remain in stock for ${purchase.ingredient_name}.`,
          });
        }
        await conn.query("UPDATE ingredients SET quantity = quantity - ?, last_updated = NOW() WHERE id=?", [
          reversalQty,
          ingredient.id,
        ]);
        await writeInventoryMovement(
          {
            ingredient_id: ingredient.id,
            movement_type: "PURCHASE_DELETE_OUT",
            quantity_change: -reversalQty,
            resulting_quantity: currentQty - reversalQty,
            unit: null,
            source_module: "PURCHASES",
            reference_type: "purchase",
            reference_id: purchaseId,
            notes: `Quick purchase deletion reversed stock for ${purchase.ingredient_name}.`,
            created_by_user_id: req.user?.id || null,
          },
          conn
        );
      }
    }

    await conn.query("DELETE FROM purchases WHERE id=?", [purchaseId]);
    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASES",
        action_name: "DELETE",
        entity_type: "purchase",
        entity_id: purchaseId,
        summary: `Deleted purchase record for ${purchase.ingredient_name}.`,
      },
      conn
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE /purchases/:id failed", err);
    res.status(500).json({ message: "Failed to delete purchase" });
  } finally {
    conn.release();
  }
});

module.exports = router;
