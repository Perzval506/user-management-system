const express = require("express");
const pool = require("../db");
const { requireAuth, requireAnyRole } = require("../middleware/auth");
const { tableExists, getColumns } = require("../utils/dbIntrospection");
const { buildActor, writeAuditLog } = require("../utils/auditLog");
const { convertQuantity } = require("../utils/unitConversion");

const router = express.Router();

const ORDER_STATUSES = new Set(["DRAFT", "QUOTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const round2 = (num) => Number(Number(num || 0).toFixed(2));

router.use(requireAuth, requireAnyRole(["OWNER"]));

async function getPurchaseRequestColumns() {
  if (!(await tableExists("purchase_requests"))) return {};
  return getColumns("purchase_requests");
}

async function getCateringOrderColumns() {
  if (!(await tableExists("catering_orders"))) return {};
  return getColumns("catering_orders");
}

async function buildRequirementsForMenuItem(conn, menuItemId, orderedQty) {
  const [[menuRow]] = await conn.query(
    `SELECT m.id, m.menu_name, m.recipe_version_id, rv.yield_amount, rv.portion_size
       FROM menu_items m
       LEFT JOIN recipe_versions rv ON rv.id = m.recipe_version_id
      WHERE m.id = ?`,
    [menuItemId]
  );
  if (!menuRow) {
    throw new Error(`Menu item ${menuItemId} was not found.`);
  }
  if (!menuRow.recipe_version_id) {
    return {
      itemName: menuRow.menu_name,
      requirements: [],
      warning: "No linked recipe version.",
    };
  }

  const [recipeLines] = await conn.query(
    `SELECT ri.ingredient_id, ri.qty_used, ri.qty_unit, i.ingredient_name, i.base_unit, i.quantity
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_version_id = ?`,
    [menuRow.recipe_version_id]
  );

  if (!recipeLines.length) {
    return {
      itemName: menuRow.menu_name,
      requirements: [],
      warning: "Recipe version has no ingredient lines.",
    };
  }

  const yieldAmount = Number(menuRow.yield_amount || 0);
  const portionSize = Number(menuRow.portion_size || 0);
  const portionsPerBatch = yieldAmount > 0 && portionSize > 0 ? yieldAmount / portionSize : 1;
  const batchFactor = orderedQty / (portionsPerBatch > 0 ? portionsPerBatch : 1);

  return {
    itemName: menuRow.menu_name,
    warning: null,
    requirements: recipeLines.map((line) => {
      const baseQty = convertQuantity(Number(line.qty_used || 0), line.qty_unit, line.base_unit);
      if (!Number.isFinite(baseQty)) {
        return {
          ingredientId: line.ingredient_id,
          ingredientName: line.ingredient_name,
          baseUnit: line.base_unit,
          currentStock: Number(line.quantity || 0),
          qtyRequired: null,
          warning: `Cannot convert ${line.qty_unit} to ${line.base_unit}.`,
        };
      }
      return {
        ingredientId: line.ingredient_id,
        ingredientName: line.ingredient_name,
        baseUnit: line.base_unit,
        currentStock: Number(line.quantity || 0),
        qtyRequired: round2(baseQty * batchFactor),
        warning: null,
      };
    }),
  };
}

async function buildCateringRequirements(conn, cateringOrderId) {
  const purchaseRequestCols = await getPurchaseRequestColumns();
  const cateringCols = await getCateringOrderColumns();
  const linkedRequestSelect = purchaseRequestCols.catering_order_id
    ? `,
       (
         SELECT pr.id
           FROM purchase_requests pr
          WHERE pr.catering_order_id = co.id
          ORDER BY pr.id DESC
          LIMIT 1
       ) AS linked_purchase_request_id`
    : ", NULL AS linked_purchase_request_id";
  const inventoryDeductedSelect = cateringCols.inventory_deducted_at ? ", co.inventory_deducted_at" : ", NULL AS inventory_deducted_at";
  const [[order]] = await conn.query(
    `SELECT co.id, co.customer_name, co.event_date, co.pax_count, co.status${linkedRequestSelect}${inventoryDeductedSelect}
       FROM catering_orders co
      WHERE co.id = ?`,
    [cateringOrderId]
  );
  if (!order) {
    const error = new Error("Catering order not found.");
    error.statusCode = 404;
    throw error;
  }

  const [items] = await conn.query(
    `SELECT id, menu_item_id, item_name_snapshot, quantity
       FROM catering_order_items
      WHERE catering_order_id = ?
      ORDER BY id ASC`,
    [cateringOrderId]
  );

  const totals = {};
  const itemWarnings = [];

  for (const item of items) {
    const orderedQty = Number(item.quantity || 0);
    if (!item.menu_item_id) {
      itemWarnings.push({
        itemId: item.id,
        itemName: item.item_name_snapshot || "Custom item",
        warning: "Custom items do not have recipe-based ingredient requirements yet.",
      });
      continue;
    }

    const result = await buildRequirementsForMenuItem(conn, item.menu_item_id, orderedQty);
    if (result.warning) {
      itemWarnings.push({
        itemId: item.id,
        itemName: result.itemName,
        warning: result.warning,
      });
    }

    result.requirements.forEach((requirement) => {
      if (requirement.warning) {
        itemWarnings.push({
          itemId: item.id,
          itemName: result.itemName,
          warning: `${requirement.ingredientName}: ${requirement.warning}`,
        });
        return;
      }
      if (!totals[requirement.ingredientId]) {
        totals[requirement.ingredientId] = {
          ingredientId: requirement.ingredientId,
          ingredientName: requirement.ingredientName,
          baseUnit: requirement.baseUnit,
          currentStock: Number(requirement.currentStock || 0),
          requiredQty: 0,
        };
      }
      totals[requirement.ingredientId].requiredQty = round2(totals[requirement.ingredientId].requiredQty + Number(requirement.qtyRequired || 0));
    });
  }

  const requirements = Object.values(totals)
    .map((row) => ({
      ...row,
      shortageQty: round2(Math.max(row.requiredQty - row.currentStock, 0)),
      status: row.currentStock >= row.requiredQty ? "ENOUGH" : "SHORT",
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "SHORT" ? -1 : 1;
      return a.ingredientName.localeCompare(b.ingredientName);
    });

  return {
    order,
    summary: {
      ingredientCount: requirements.length,
      shortageCount: requirements.filter((row) => row.status === "SHORT").length,
    },
    requirements,
    warnings: itemWarnings,
  };
}

router.get("/", async (_req, res) => {
  try {
    if (!(await tableExists("catering_orders")) || !(await tableExists("catering_order_items"))) {
      return res.json([]);
    }

    const [rows] = await pool.query(
      `SELECT co.id, co.customer_name, co.contact_number, co.event_date, co.event_time, co.venue,
              co.pax_count, co.status, co.total_amount, co.deposit_amount, co.balance_amount,
              co.created_at, creator.full_name AS created_by_name, COUNT(coi.id) AS item_count
         FROM catering_orders co
         LEFT JOIN users creator ON creator.id = co.created_by_user_id
         LEFT JOIN catering_order_items coi ON coi.catering_order_id = co.id
        GROUP BY co.id
        ORDER BY co.event_date DESC, co.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /catering-orders failed:", err.message);
    res.status(500).json({ message: "Failed to fetch catering orders" });
  }
});

router.get("/:id", async (req, res) => {
  const cateringOrderId = Number(req.params.id);
  if (!Number.isFinite(cateringOrderId) || cateringOrderId <= 0) {
    return res.status(400).json({ message: "Invalid catering order id." });
  }

  try {
    if (!(await tableExists("catering_orders")) || !(await tableExists("catering_order_items"))) {
      return res.status(404).json({ message: "Catering order storage is not set up yet." });
    }
    const purchaseRequestCols = await getPurchaseRequestColumns();
    const cateringCols = await getCateringOrderColumns();
    const linkedRequestSelect = purchaseRequestCols.catering_order_id
      ? `,
         (
           SELECT pr.id
             FROM purchase_requests pr
            WHERE pr.catering_order_id = co.id
            ORDER BY pr.id DESC
            LIMIT 1
         ) AS linked_purchase_request_id`
      : ", NULL AS linked_purchase_request_id";

    const inventoryDeductedSelect = cateringCols.inventory_deducted_at ? ", co.inventory_deducted_at" : ", NULL AS inventory_deducted_at";
    const [[order]] = await pool.query(
      `SELECT co.*, creator.full_name AS created_by_name${linkedRequestSelect}${inventoryDeductedSelect}
         FROM catering_orders co
         LEFT JOIN users creator ON creator.id = co.created_by_user_id
        WHERE co.id = ?`,
      [cateringOrderId]
    );
    if (!order) return res.status(404).json({ message: "Catering order not found." });

    const [items] = await pool.query(
      `SELECT coi.*, mi.menu_name
         FROM catering_order_items coi
         LEFT JOIN menu_items mi ON mi.id = coi.menu_item_id
        WHERE coi.catering_order_id = ?
        ORDER BY coi.id ASC`,
      [cateringOrderId]
    );

    res.json({ order, items });
  } catch (err) {
    console.error("GET /catering-orders/:id failed:", err.message);
    res.status(500).json({ message: "Failed to fetch catering order" });
  }
});

router.get("/:id/requirements", async (req, res) => {
  const cateringOrderId = Number(req.params.id);
  if (!Number.isFinite(cateringOrderId) || cateringOrderId <= 0) {
    return res.status(400).json({ message: "Invalid catering order id." });
  }

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("catering_orders")) || !(await tableExists("catering_order_items"))) {
      return res.status(404).json({ message: "Catering order storage is not set up yet." });
    }
    res.json(await buildCateringRequirements(conn, cateringOrderId));
  } catch (err) {
    console.error("GET /catering-orders/:id/requirements failed:", err.message);
    res.status(err.statusCode || 500).json({ message: err?.message || "Failed to build catering requirements" });
  } finally {
    conn.release();
  }
});

router.post("/:id/create-purchase-request", async (req, res) => {
  const cateringOrderId = Number(req.params.id);
  if (!Number.isFinite(cateringOrderId) || cateringOrderId <= 0) {
    return res.status(400).json({ message: "Invalid catering order id." });
  }

  const conn = await pool.getConnection();
  try {
    if (
      !(await tableExists("catering_orders")) ||
      !(await tableExists("catering_order_items")) ||
      !(await tableExists("purchase_requests")) ||
      !(await tableExists("purchase_request_items"))
    ) {
      return res.status(503).json({ message: "Purchase request setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();
    const requirementData = await buildCateringRequirements(conn, cateringOrderId);
    const purchaseRequestCols = await getPurchaseRequestColumns();
    if (purchaseRequestCols.catering_order_id) {
      const [[existingRequest]] = await conn.query(
        "SELECT id, status FROM purchase_requests WHERE catering_order_id = ? LIMIT 1",
        [cateringOrderId]
      );
      if (existingRequest) {
        await conn.rollback();
        return res.status(409).json({
          message: `Purchase request #${existingRequest.id} already exists for this catering order.`,
          existingRequestId: existingRequest.id,
        });
      }
    }
    const shortageRows = requirementData.requirements.filter((row) => row.status === "SHORT" && Number(row.shortageQty || 0) > 0);
    if (!shortageRows.length) {
      await conn.rollback();
      return res.status(400).json({ message: "This catering order has no shortages to convert into a purchase request." });
    }

    const noteParts = [`Auto-generated from catering order #${cateringOrderId} for ${requirementData.order.customer_name}.`];
    if (requirementData.warnings.length) {
      noteParts.push(`Warnings: ${requirementData.warnings.length}`);
    }

    const requestFields = ["request_date", "needed_by_date", "status", "notes", "requested_by_user_id", "created_at"];
    const requestPlaceholders = ["?", "?", "'PENDING'", "?", "?", "NOW()"];
    const requestValues = [new Date(), requirementData.order.event_date, noteParts.join(" "), req.user?.id || null];
    if (purchaseRequestCols.catering_order_id) {
      requestFields.splice(4, 0, "catering_order_id");
      requestPlaceholders.splice(4, 0, "?");
      requestValues.splice(3, 0, cateringOrderId);
    }
    const [requestResult] = await conn.query(
      `INSERT INTO purchase_requests (${requestFields.join(", ")})
       VALUES (${requestPlaceholders.join(", ")})`,
      requestValues
    );
    const purchaseRequestId = requestResult.insertId;

    await conn.query(
      `INSERT INTO purchase_request_items
        (purchase_request_id, ingredient_id, ingredient_name, quantity, unit, reason, created_at)
       VALUES ?`,
      [
        shortageRows.map((row) => [
          purchaseRequestId,
          row.ingredientId,
          row.ingredientName,
          row.shortageQty,
          row.baseUnit || "",
          `Shortage from catering order #${cateringOrderId}`,
          new Date(),
        ]),
      ]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "CATERING",
        action_name: "CREATE_PURCHASE_REQUEST",
        entity_type: "purchase_request",
        entity_id: purchaseRequestId,
        summary: `Created purchase request #${purchaseRequestId} from catering order #${cateringOrderId}.`,
      },
      conn
    );

    await conn.commit();
    res.status(201).json({ id: purchaseRequestId, shortageCount: shortageRows.length });
  } catch (err) {
    await conn.rollback();
    console.error("POST /catering-orders/:id/create-purchase-request failed:", err.message);
    res.status(err.statusCode || 500).json({ message: err?.message || "Failed to create purchase request from shortages" });
  } finally {
    conn.release();
  }
});

router.post("/", async (req, res) => {
  const customerName = String(req.body?.customerName || "").trim();
  const contactNumber = String(req.body?.contactNumber || "").trim() || null;
  const eventDate = String(req.body?.eventDate || "").trim();
  const eventTime = String(req.body?.eventTime || "").trim() || null;
  const venue = String(req.body?.venue || "").trim() || null;
  const paxCount = Number(req.body?.paxCount || 0);
  const notes = String(req.body?.notes || "").trim() || null;
  const discountAmount = round2(req.body?.discountAmount || 0);
  const depositAmount = round2(req.body?.depositAmount || 0);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!customerName) return res.status(400).json({ message: "customerName is required." });
  if (!eventDate) return res.status(400).json({ message: "eventDate is required." });
  if (!Number.isFinite(paxCount) || paxCount <= 0) return res.status(400).json({ message: "paxCount must be greater than 0." });
  if (!items.length) return res.status(400).json({ message: "At least one catering item is required." });

  const cleanedItems = [];
  for (const [index, item] of items.entries()) {
    const menuItemId = item.menuItemId == null || item.menuItemId === "" ? null : Number(item.menuItemId);
    const itemName = String(item.itemName || "").trim();
    const quantity = Number(item.quantity);
    const unitPrice = round2(item.unitPrice || 0);
    const notesValue = String(item.notes || "").trim() || null;

    if (menuItemId != null && (!Number.isFinite(menuItemId) || menuItemId <= 0)) {
      return res.status(400).json({ message: `Catering item ${index + 1} has an invalid menu item.` });
    }
    if (!menuItemId && !itemName) {
      return res.status(400).json({ message: `Catering item ${index + 1} needs a menu item or custom item name.` });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ message: `Catering item ${index + 1} needs a quantity greater than 0.` });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ message: `Catering item ${index + 1} needs a valid unit price.` });
    }

    cleanedItems.push({
      menuItemId,
      itemName,
      quantity: round2(quantity),
      unitPrice,
      lineTotal: round2(quantity * unitPrice),
      notes: notesValue,
    });
  }

  const subtotal = round2(cleanedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  const totalAmount = round2(Math.max(subtotal - discountAmount, 0));
  const finalDeposit = round2(Math.min(Math.max(depositAmount, 0), totalAmount));
  const balanceAmount = round2(totalAmount - finalDeposit);

  const conn = await pool.getConnection();
  try {
    if (!(await tableExists("catering_orders")) || !(await tableExists("catering_order_items"))) {
      return res.status(503).json({ message: "Catering setup is incomplete. Run the latest database migration first." });
    }

    await conn.beginTransaction();
    const [orderResult] = await conn.query(
      `INSERT INTO catering_orders
        (customer_name, contact_number, event_date, event_time, venue, pax_count, status, notes,
         subtotal, discount_amount, total_amount, deposit_amount, balance_amount, created_by_user_id,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'DRAFT', ?,?,?,?,?,?,?, NOW(), NOW())`,
      [
        customerName,
        contactNumber,
        eventDate,
        eventTime,
        venue,
        Math.round(paxCount),
        notes,
        subtotal,
        discountAmount,
        totalAmount,
        finalDeposit,
        balanceAmount,
        req.user?.id || null,
      ]
    );

    const cateringOrderId = orderResult.insertId;
    await conn.query(
      `INSERT INTO catering_order_items
        (catering_order_id, menu_item_id, item_name_snapshot, quantity, unit_price, line_total, notes, created_at)
       VALUES ?`,
      [
        cleanedItems.map((item) => [
          cateringOrderId,
          item.menuItemId,
          item.itemName || null,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          item.notes,
          new Date(),
        ]),
      ]
    );

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "CATERING",
        action_name: "CREATE",
        entity_type: "catering_order",
        entity_id: cateringOrderId,
        summary: `Created catering order #${cateringOrderId} for ${customerName} totaling ${totalAmount.toFixed(2)}.`,
      },
      conn
    );

    await conn.commit();
    res.status(201).json({ id: cateringOrderId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /catering-orders failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to save catering order" });
  } finally {
    conn.release();
  }
});

router.patch("/:id/status", async (req, res) => {
  const cateringOrderId = Number(req.params.id);
  const status = String(req.body?.status || "").trim().toUpperCase();
  if (!Number.isFinite(cateringOrderId) || cateringOrderId <= 0) {
    return res.status(400).json({ message: "Invalid catering order id." });
  }
  if (!ORDER_STATUSES.has(status)) {
    return res.status(400).json({ message: "Invalid catering status." });
  }

  const conn = await pool.getConnection();
  try {
    const cateringCols = await getCateringOrderColumns();
    await conn.beginTransaction();
    const [[orderRow]] = await conn.query("SELECT id, status FROM catering_orders WHERE id = ? FOR UPDATE", [cateringOrderId]);
    if (!orderRow) {
      await conn.rollback();
      return res.status(404).json({ message: "Catering order not found." });
    }

    if (cateringCols.inventory_deducted_at) {
      const [[fullOrderRow]] = await conn.query("SELECT inventory_deducted_at FROM catering_orders WHERE id = ?", [cateringOrderId]);
      if (fullOrderRow?.inventory_deducted_at && status !== "COMPLETED") {
        await conn.rollback();
        return res.status(409).json({ message: "This catering order already deducted inventory and can no longer move away from COMPLETED." });
      }
    }

    if (status === "COMPLETED") {
      if (!cateringCols.inventory_deducted_at) {
        await conn.rollback();
        return res.status(503).json({ message: "Catering completion inventory tracking is incomplete. Run the latest database migration first." });
      }
      const requirementData = await buildCateringRequirements(conn, cateringOrderId);
      if (requirementData.summary.shortageCount > 0) {
        await conn.rollback();
        return res.status(409).json({ message: "This catering order still has ingredient shortages. Convert them into a purchase request first." });
      }
      if (requirementData.warnings.length > 0) {
        await conn.rollback();
        return res.status(409).json({ message: "This catering order still has recipe warnings. Fix the menu recipes before completing it." });
      }
      const [[deductionRow]] = await conn.query("SELECT inventory_deducted_at FROM catering_orders WHERE id = ?", [cateringOrderId]);
      if (!deductionRow?.inventory_deducted_at) {
        for (const row of requirementData.requirements) {
          await conn.query("UPDATE ingredients SET quantity = quantity - ?, last_updated = NOW() WHERE id = ?", [Number(row.requiredQty || 0), row.ingredientId]);
        }
        await conn.query("UPDATE catering_orders SET inventory_deducted_at = NOW() WHERE id = ?", [cateringOrderId]);
      }
    }

    await conn.query("UPDATE catering_orders SET status = ?, updated_at = NOW() WHERE id = ?", [status, cateringOrderId]);

    await writeAuditLog(
      {
        ...buildActor(req),
        module_name: "CATERING",
        action_name: "UPDATE_STATUS",
        entity_type: "catering_order",
        entity_id: cateringOrderId,
        summary: `Updated catering order #${cateringOrderId} to ${status}.`,
      },
      conn
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PATCH /catering-orders/:id/status failed:", err.message);
    res.status(500).json({ message: err?.message || "Failed to update catering status" });
  } finally {
    conn.release();
  }
});

module.exports = router;
