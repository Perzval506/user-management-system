const express = require("express");
const pool = require("../db");
const router = express.Router();
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { tableExists, getColumns } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");

router.use(requireAuth, requireAnyRole(["OWNER", "STOCKROOM_STAFF"]));

const REQUEST_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);
const round2 = (num) => Number(Number(num || 0).toFixed(2));

async function getPurchaseOrderColumns() {
  if (!(await tableExists("purchase_orders"))) return {};
  return getColumns("purchase_orders");
}

router.get("/", async (req, res) => {
  try {
    if (!(await tableExists("purchase_requests")) || !(await tableExists("purchase_request_items"))) {
      return res.json([]);
    }

    const isOwner = req.user?.role === "OWNER";
    const where = isOwner ? "" : "WHERE pr.requested_by_user_id = ?";
    const params = isOwner ? [] : [req.user?.id || 0];
    const purchaseOrderCols = await getPurchaseOrderColumns();
    const linkedOrderSelect = purchaseOrderCols.purchase_request_id
      ? ", po.id AS linked_purchase_order_id"
      : ", NULL AS linked_purchase_order_id";
    const linkedOrderJoin = purchaseOrderCols.purchase_request_id
      ? "LEFT JOIN purchase_orders po ON po.purchase_request_id = pr.id"
      : "";
    const cateringSelect = (await tableExists("catering_orders"))
      ? ", pr.catering_order_id, co.customer_name AS catering_customer_name"
      : ", pr.catering_order_id, NULL AS catering_customer_name";
    const cateringJoin = (await tableExists("catering_orders"))
      ? "LEFT JOIN catering_orders co ON co.id = pr.catering_order_id"
      : "";
    const [rows] = await pool.query(
      `SELECT pr.id, pr.request_date, pr.needed_by_date, pr.status, pr.notes, pr.created_at,
              pr.requested_by_user_id, requester.full_name AS requested_by_name,
              pr.reviewed_by_user_id, reviewer.full_name AS reviewed_by_name,
              ${linkedOrderSelect.slice(2)},
              ${cateringSelect.slice(2)},
              COUNT(pri.id) AS item_count,
              COALESCE(ROUND(SUM(pri.quantity), 2), 0) AS total_quantity
         FROM purchase_requests pr
         LEFT JOIN users requester ON requester.id = pr.requested_by_user_id
         LEFT JOIN users reviewer ON reviewer.id = pr.reviewed_by_user_id
         ${linkedOrderJoin}
         ${cateringJoin}
         LEFT JOIN purchase_request_items pri ON pri.purchase_request_id = pr.id
         ${where}
        GROUP BY pr.id
        ORDER BY pr.created_at DESC, pr.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /purchase-requests failed:", err.message);
    res.status(500).json({ message: "Failed to fetch purchase requests" });
  }
});

router.get("/:id", async (req, res) => {
  const requestId = Number(req.params.id);
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ message: "Invalid purchase request id." });
  }

  try {
    if (!(await tableExists("purchase_requests")) || !(await tableExists("purchase_request_items"))) {
      return res.status(404).json({ message: "Purchase request storage is not set up yet." });
    }

    const isOwner = req.user?.role === "OWNER";
    const purchaseOrderCols = await getPurchaseOrderColumns();
    const linkedOrderSelect = purchaseOrderCols.purchase_request_id
      ? ", po.id AS linked_purchase_order_id"
      : ", NULL AS linked_purchase_order_id";
    const linkedOrderJoin = purchaseOrderCols.purchase_request_id
      ? "LEFT JOIN purchase_orders po ON po.purchase_request_id = pr.id"
      : "";
    const cateringSelect = (await tableExists("catering_orders"))
      ? ", co.customer_name AS catering_customer_name"
      : ", NULL AS catering_customer_name";
    const cateringJoin = (await tableExists("catering_orders"))
      ? "LEFT JOIN catering_orders co ON co.id = pr.catering_order_id"
      : "";
    const [requests] = await pool.query(
      `SELECT pr.*, requester.full_name AS requested_by_name, reviewer.full_name AS reviewed_by_name${linkedOrderSelect}${cateringSelect}
         FROM purchase_requests pr
         LEFT JOIN users requester ON requester.id = pr.requested_by_user_id
         LEFT JOIN users reviewer ON reviewer.id = pr.reviewed_by_user_id
         ${linkedOrderJoin}
         ${cateringJoin}
        WHERE pr.id = ?`,
      [requestId]
    );
    const requestRow = requests[0];
    if (!requestRow) return res.status(404).json({ message: "Purchase request not found." });
    if (!isOwner && Number(requestRow.requested_by_user_id) !== Number(req.user?.id || 0)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const [items] = await pool.query(
      `SELECT pri.*, i.base_unit
         FROM purchase_request_items pri
         LEFT JOIN ingredients i ON i.id = pri.ingredient_id
        WHERE pri.purchase_request_id = ?
        ORDER BY pri.id ASC`,
      [requestId]
    );
    res.json({ request: requestRow, items });
  } catch (err) {
    console.error("GET /purchase-requests/:id failed:", err.message);
    res.status(500).json({ message: "Failed to fetch purchase request" });
  }
});

router.post("/:id/create-purchase-order", async (req, res) => {
  if (req.user?.role !== "OWNER") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const requestId = Number(req.params.id);
  const storeName = String(req.body?.storeName || "").trim();
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ message: "Invalid purchase request id." });
  }
  if (!storeName) {
    return res.status(400).json({ message: "storeName is required." });
  }

  const conn = await pool.getConnection();
  try {
    if (
      !(await tableExists("purchase_requests")) ||
      !(await tableExists("purchase_request_items")) ||
      !(await tableExists("purchase_orders")) ||
      !(await tableExists("purchase_order_details"))
    ) {
      return res.status(503).json({ message: "Purchase order setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();
    const purchaseOrderCols = await getPurchaseOrderColumns();
    const [[requestRow]] = await conn.query("SELECT * FROM purchase_requests WHERE id=? FOR UPDATE", [requestId]);
    if (!requestRow) {
      await conn.rollback();
      return res.status(404).json({ message: "Purchase request not found." });
    }
    if (requestRow.status !== "APPROVED") {
      await conn.rollback();
      return res.status(400).json({ message: "Only approved purchase requests can be converted to purchase orders." });
    }

    if (purchaseOrderCols.purchase_request_id) {
      const [[existingOrder]] = await conn.query("SELECT id FROM purchase_orders WHERE purchase_request_id = ? LIMIT 1", [requestId]);
      if (existingOrder) {
        await conn.rollback();
        return res.status(409).json({ message: `Purchase order #${existingOrder.id} already exists for this request.`, existingOrderId: existingOrder.id });
      }
    }

    const [requestItems] = await conn.query(
      `SELECT ingredient_id, ingredient_name, quantity, unit
         FROM purchase_request_items
        WHERE purchase_request_id = ?
        ORDER BY id ASC`,
      [requestId]
    );
    if (!requestItems.length) {
      await conn.rollback();
      return res.status(400).json({ message: "This purchase request has no items to convert." });
    }

    const purchaseOrderFields = ["store_name", "purchase_date", "total_amount", "created_at"];
    const purchaseOrderPlaceholders = ["?", "?", "?", "NOW()"];
    const purchaseOrderValues = [storeName, requestRow.needed_by_date || requestRow.request_date || new Date(), 0];
    if (purchaseOrderCols.purchase_request_id) {
      purchaseOrderFields.splice(3, 0, "purchase_request_id");
      purchaseOrderPlaceholders.splice(3, 0, "?");
      purchaseOrderValues.splice(2, 0, requestId);
    }

    const [orderResult] = await conn.query(
      `INSERT INTO purchase_orders (${purchaseOrderFields.join(", ")}) VALUES (${purchaseOrderPlaceholders.join(", ")})`,
      purchaseOrderValues
    );
    const orderId = orderResult.insertId;

    const detailRows = requestItems.map((item) => [
      orderId,
      item.ingredient_id,
      item.ingredient_name || null,
      null,
      item.unit || null,
      round2(item.quantity || 0),
      0,
      0,
    ]);
    await conn.query(
      `INSERT INTO purchase_order_details
        (purchase_order_id, ingredient_id, ingredient_name, brand, unit, quantity, price, subtotal)
       VALUES ?`,
      [detailRows]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASE_ORDERS",
        action_name: "CREATE_FROM_REQUEST",
        entity_type: "purchase_order",
        entity_id: orderId,
        summary: `Created purchase order #${orderId} from purchase request #${requestId}.`,
      },
      conn
    );

    await conn.commit();
    res.status(201).json({ id: orderId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /purchase-requests/:id/create-purchase-order failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to create purchase order from request" });
  } finally {
    conn.release();
  }
});

router.post("/", async (req, res) => {
  const requestDate = String(req.body?.requestDate || "").trim();
  const neededByDate = String(req.body?.neededByDate || "").trim() || null;
  const notes = String(req.body?.notes || "").trim() || null;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!requestDate) {
    return res.status(400).json({ message: "requestDate is required." });
  }
  if (!items.length) {
    return res.status(400).json({ message: "At least one request item is required." });
  }

  const cleanedItems = [];
  for (const [index, item] of items.entries()) {
    const ingredientId = Number(item.ingredientId);
    const ingredientName = String(item.ingredientName || "").trim();
    const quantity = Number(item.quantity);
    const unit = String(item.unit || "").trim();
    const reason = String(item.reason || "").trim() || null;

    if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
      return res.status(400).json({ message: `Item ${index + 1} is missing an ingredient.` });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: `Item ${index + 1} needs a quantity greater than 0.` });
    }
    if (!unit) {
      return res.status(400).json({ message: `Item ${index + 1} needs a unit.` });
    }

    cleanedItems.push({
      ingredientId,
      ingredientName,
      quantity: round2(quantity),
      unit,
      reason,
    });
  }

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("purchase_requests")) || !(await tableExists("purchase_request_items"))) {
      return res.status(503).json({ message: "Purchase request setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();
    const [requestResult] = await conn.query(
      `INSERT INTO purchase_requests
        (request_date, needed_by_date, status, notes, requested_by_user_id, created_at)
       VALUES (?,?, 'PENDING', ?, ?, NOW())`,
      [requestDate, neededByDate, notes, req.user?.id || null]
    );
    const requestId = requestResult.insertId;

    await conn.query(
      `INSERT INTO purchase_request_items
        (purchase_request_id, ingredient_id, ingredient_name, quantity, unit, reason, created_at)
       VALUES ?`,
      [
        cleanedItems.map((item) => [
          requestId,
          item.ingredientId,
          item.ingredientName || null,
          item.quantity,
          item.unit,
          item.reason,
          new Date(),
        ]),
      ]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASE_REQUESTS",
        action_name: "CREATE",
        entity_type: "purchase_request",
        entity_id: requestId,
        summary: `Submitted purchase request #${requestId} with ${cleanedItems.length} item(s).`,
      },
      conn
    );

    await conn.commit();
    res.status(201).json({ id: requestId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /purchase-requests failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save purchase request" });
  } finally {
    conn.release();
  }
});

router.patch("/:id/status", async (req, res) => {
  if (req.user?.role !== "OWNER") {
    return res.status(403).json({ message: "Forbidden" });
  }

  const requestId = Number(req.params.id);
  const status = String(req.body?.status || "").trim().toUpperCase();
  const reviewNotes = String(req.body?.review_notes || "").trim() || null;
  if (!Number.isFinite(requestId) || requestId <= 0) {
    return res.status(400).json({ message: "Invalid purchase request id." });
  }
  if (!REQUEST_STATUSES.has(status) || status === "PENDING") {
    return res.status(400).json({ message: "status must be APPROVED or REJECTED." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[requestRow]] = await conn.query("SELECT id, status FROM purchase_requests WHERE id=? FOR UPDATE", [requestId]);
    if (!requestRow) {
      await conn.rollback();
      return res.status(404).json({ message: "Purchase request not found." });
    }

    await conn.query(
      `UPDATE purchase_requests
          SET status = ?, review_notes = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
        WHERE id = ?`,
      [status, reviewNotes, req.user?.id || null, requestId]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "PURCHASE_REQUESTS",
        action_name: status,
        entity_type: "purchase_request",
        entity_id: requestId,
        summary: `${status === "APPROVED" ? "Approved" : "Rejected"} purchase request #${requestId}.`,
      },
      conn
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PATCH /purchase-requests/:id/status failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to update purchase request status" });
  } finally {
    conn.release();
  }
});

module.exports = router;
