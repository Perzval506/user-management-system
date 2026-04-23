import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatMoney, formatNumber } from "../utils/formatters";

function defaultItem() {
  return {
    key: Date.now() + Math.random(),
    menuItemId: "",
    itemName: "",
    quantity: "1.00",
    notes: "",
  };
}

function itemReducer(state, action) {
  switch (action.type) {
    case "add":
      return [...state, defaultItem()];
    case "update":
      return state.map((item) => (item.key === action.key ? { ...item, ...action.patch } : item));
    case "remove":
      return state.filter((item) => item.key !== action.key);
    case "reset":
      return [defaultItem()];
    default:
      return state;
  }
}

const STATUSES = ["DRAFT", "QUOTED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const emptyCateringForm = {
  customerName: "",
  contactNumber: "",
  eventDate: "",
  eventStartTime: "",
  eventEndTime: "",
  venue: "",
  paxCount: "50",
  quotePricePerPax: "0.00",
  discountAmount: "0.00",
  depositAmount: "0.00",
  notes: "",
};

function formatEventTimeRange(order = {}) {
  const start = order.event_start_time || order.eventTime || order.event_time || "";
  const end = order.event_end_time || "";
  if (start && end) return `${start} - ${end}`;
  return start || end || "-";
}

function formFromOrder(order = {}) {
  return {
    customerName: order.customer_name || "",
    contactNumber: order.contact_number || "",
    eventDate: order.event_date ? String(order.event_date).slice(0, 10) : "",
    eventStartTime: order.event_start_time || order.event_time || "",
    eventEndTime: order.event_end_time || "",
    venue: order.venue || "",
    paxCount: String(order.pax_count || "50"),
    quotePricePerPax: String(order.quote_price_per_pax ?? "0.00"),
    discountAmount: String(order.discount_amount ?? "0.00"),
    depositAmount: String(order.deposit_amount ?? "0.00"),
    notes: order.notes || "",
  };
}

function itemsFromOrder(items = []) {
  if (!items.length) return [defaultItem()];
  return items.map((item) => ({
    key: item.id || Date.now() + Math.random(),
    menuItemId: item.menu_item_id ? String(item.menu_item_id) : "",
    itemName: item.menu_item_id ? "" : item.item_name_snapshot || "",
    quantity: String(item.quantity ?? "1.00"),
    notes: item.notes || "",
  }));
}

function computeCateringTotals(form) {
  const pax = Number(form.paxCount);
  const quotePricePerPax = Number(form.quotePricePerPax);
  const subtotal =
    Number.isFinite(pax) && pax > 0 && Number.isFinite(quotePricePerPax) && quotePricePerPax >= 0
      ? pax * quotePricePerPax
      : 0;
  const discount = Number(form.discountAmount);
  const deposit = Number(form.depositAmount);
  const total = Math.max(subtotal - (Number.isFinite(discount) ? discount : 0), 0);
  const safeDeposit = Math.min(Math.max(Number.isFinite(deposit) ? deposit : 0, 0), total);
  return {
    subtotal,
    total,
    balance: total - safeDeposit,
  };
}

export default function CateringOrders() {
  const navigate = useNavigate();
  const toast = useToast();
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [items, dispatch] = useReducer(itemReducer, [defaultItem()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState({ open: false, loading: false, order: null, items: [] });
  const [requirements, setRequirements] = useState({ loading: false, rows: [], warnings: [], summary: { ingredientCount: 0, shortageCount: 0 } });
  const [statusDraft, setStatusDraft] = useState("");
  const [statusTarget, setStatusTarget] = useState(null);
  const [creatingPurchaseRequest, setCreatingPurchaseRequest] = useState(false);
  const [editingDetail, setEditingDetail] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState(emptyCateringForm);
  const [editItems, setEditItems] = useState([defaultItem()]);
  const [form, setForm] = useState(emptyCateringForm);

  const computed = useMemo(() => computeCateringTotals(form), [form]);
  const editComputed = useMemo(() => computeCateringTotals(editForm), [editForm]);

  function closeDetails() {
    setDetail({ open: false, loading: false, order: null, items: [] });
    setRequirements({ loading: false, rows: [], warnings: [], summary: { ingredientCount: 0, shortageCount: 0 } });
    setEditingDetail(false);
    setEditForm(emptyCateringForm);
    setEditItems([defaultItem()]);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, menuRes] = await Promise.all([api.get("/catering-orders"), api.get("/menu")]);
      setOrders(ordersRes.data || []);
      setMenuItems((menuRes.data || []).filter((item) => item.status !== "INACTIVE"));
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load catering orders",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function updateItem(key, patch) {
    dispatch({ type: "update", key, patch });
  }

  function removeItem(key) {
    if (items.length === 1) {
      dispatch({ type: "reset" });
      return;
    }
    dispatch({ type: "remove", key });
  }

  function updateEditItem(key, patch) {
    setEditItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addEditItem() {
    setEditItems((current) => [...current, defaultItem()]);
  }

  function removeEditItem(key) {
    setEditItems((current) => (current.length === 1 ? [defaultItem()] : current.filter((item) => item.key !== key)));
  }

  function buildOrderPayload(sourceForm, sourceItems) {
    const relevantItems = sourceItems.filter((item) => item.menuItemId || item.itemName || item.quantity);
    if (!sourceForm.customerName.trim()) {
      return { error: { title: "Missing customer", message: "Customer name is required." } };
    }
    if (!sourceForm.eventDate) {
      return { error: { title: "Missing event date", message: "Event date is required." } };
    }
    if (!Number.isFinite(Number(sourceForm.paxCount)) || Number(sourceForm.paxCount) <= 0) {
      return { error: { title: "Invalid pax", message: "Pax count must be greater than 0." } };
    }
    if (!Number.isFinite(Number(sourceForm.quotePricePerPax)) || Number(sourceForm.quotePricePerPax) < 0) {
      return { error: { title: "Invalid quote", message: "Price per guest must be 0 or greater." } };
    }
    if (!relevantItems.length) {
      return { error: { title: "Missing items", message: "Add at least one catering item." } };
    }

    for (let index = 0; index < relevantItems.length; index += 1) {
      const item = relevantItems[index];
      if (!item.menuItemId && !item.itemName.trim()) {
        return { error: { title: "Missing item", message: `Line ${index + 1} needs a menu item or custom item name.` } };
      }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
        return { error: { title: "Invalid quantity", message: `Line ${index + 1} needs a quantity greater than 0.` } };
      }
    }

    return {
      payload: {
        customerName: sourceForm.customerName.trim(),
        contactNumber: sourceForm.contactNumber.trim() || null,
        eventDate: sourceForm.eventDate,
        eventStartTime: sourceForm.eventStartTime.trim() || null,
        eventEndTime: sourceForm.eventEndTime.trim() || null,
        venue: sourceForm.venue.trim() || null,
        paxCount: Number(sourceForm.paxCount),
        quotePricePerPax: Number(sourceForm.quotePricePerPax || 0),
        discountAmount: Number(sourceForm.discountAmount || 0),
        depositAmount: Number(sourceForm.depositAmount || 0),
        notes: sourceForm.notes.trim() || null,
        items: relevantItems.map((item) => ({
          menuItemId: item.menuItemId ? Number(item.menuItemId) : null,
          itemName: item.itemName.trim() || null,
          quantity: Number(item.quantity),
          notes: item.notes.trim() || null,
        })),
      },
    };
  }

  function startEditingDetail() {
    if (!detail.order) return;
    setEditForm(formFromOrder(detail.order));
    setEditItems(itemsFromOrder(detail.items));
    setEditingDetail(true);
  }

  function cancelEditingDetail() {
    setEditingDetail(false);
    setEditForm(emptyCateringForm);
    setEditItems([defaultItem()]);
  }

  async function submitOrder(event) {
    event?.preventDefault();
    const { payload, error } = buildOrderPayload(form, items);
    if (error) return toast.push({ type: "error", title: error.title, message: error.message });

    setSaving(true);
    try {
      await api.post("/catering-orders", payload);
      toast.push({ type: "success", title: "Saved", message: "Catering order created." });
      setForm(emptyCateringForm);
      dispatch({ type: "reset" });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save catering order",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitEditOrder(event) {
    event?.preventDefault();
    if (!detail.order?.id) return;
    const { payload, error } = buildOrderPayload(editForm, editItems);
    if (error) return toast.push({ type: "error", title: error.title, message: error.message });

    setEditSaving(true);
    try {
      await api.put(`/catering-orders/${detail.order.id}`, payload);
      toast.push({ type: "success", title: "Updated", message: "Catering order updated." });
      setEditingDetail(false);
      await openDetails(detail.order.id);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Update failed",
        message: error?.response?.data?.message || error.message || "Failed to update catering order",
      });
    } finally {
      setEditSaving(false);
    }
  }

  async function openDetails(id) {
    setDetail({ open: true, loading: true, order: null, items: [] });
    setRequirements({ loading: true, rows: [], warnings: [], summary: { ingredientCount: 0, shortageCount: 0 } });
    setEditingDetail(false);
    try {
      const [detailResponse, requirementsResponse] = await Promise.all([
        api.get(`/catering-orders/${id}`),
        api.get(`/catering-orders/${id}/requirements`),
      ]);
      setDetail({ open: true, loading: false, order: detailResponse.data?.order || null, items: detailResponse.data?.items || [] });
      setStatusDraft(detailResponse.data?.order?.status || "");
      setRequirements({
        loading: false,
        rows: requirementsResponse.data?.requirements || [],
        warnings: requirementsResponse.data?.warnings || [],
        summary: requirementsResponse.data?.summary || { ingredientCount: 0, shortageCount: 0 },
      });
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message || "Failed to load catering order" });
      closeDetails();
    }
  }

  async function confirmStatusChange() {
    if (!statusTarget || !detail.order?.id) return;
    try {
      await api.patch(`/catering-orders/${detail.order.id}/status`, { status: statusTarget });
      toast.push({ type: "success", title: "Updated", message: `Catering order moved to ${statusTarget}.` });
      setStatusTarget(null);
      await openDetails(detail.order.id);
      await load();
    } catch (error) {
      toast.push({ type: "error", title: "Update failed", message: error?.response?.data?.message || error.message || "Failed to update catering status" });
    }
  }

  async function createPurchaseRequestFromShortages() {
    if (!detail.order?.id) return;
    setCreatingPurchaseRequest(true);
    try {
      const response = await api.post(`/catering-orders/${detail.order.id}/create-purchase-request`);
      toast.push({
        type: "success",
        title: "Purchase request created",
        message: `Created purchase request #${response.data?.id} from ${formatNumber(response.data?.shortageCount || 0, 0)} shortage line(s).`,
      });
      setDetail((current) =>
        current.order ? { ...current, order: { ...current.order, linked_purchase_request_id: response.data?.id || current.order.linked_purchase_request_id } } : current
      );
    } catch (error) {
      if (error?.response?.status === 409 && error?.response?.data?.existingRequestId) {
        setDetail((current) =>
          current.order
            ? {
                ...current,
                order: { ...current.order, linked_purchase_request_id: error.response.data.existingRequestId },
              }
            : current
        );
      }
      toast.push({
        type: "error",
        title: "Request creation failed",
        message: error?.response?.data?.message || error.message || "Failed to create purchase request from shortages",
      });
    } finally {
      setCreatingPurchaseRequest(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Catering Orders</h2>
          <div className="pageSub">Event quotes, deposits, and booking status.</div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="cateringLayout">
        <div className="card">
          <form className="formGrid" onSubmit={submitOrder}>
            <div className="formRow2">
              <div>
                <label>Customer name</label>
                <input className="input" value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} />
              </div>
              <div>
                <label>Contact number</label>
                <input className="input" value={form.contactNumber} onChange={(event) => setForm((current) => ({ ...current, contactNumber: event.target.value }))} />
              </div>
            </div>

            <div className="formRow3">
              <div>
                <label>Event date</label>
                <input className="input" type="date" value={form.eventDate} onChange={(event) => setForm((current) => ({ ...current, eventDate: event.target.value }))} />
              </div>
              <div>
                <label>Start time</label>
                <input className="input" type="time" value={form.eventStartTime} onChange={(event) => setForm((current) => ({ ...current, eventStartTime: event.target.value }))} />
              </div>
              <div>
                <label>End time</label>
                <input className="input" type="time" value={form.eventEndTime} onChange={(event) => setForm((current) => ({ ...current, eventEndTime: event.target.value }))} />
              </div>
            </div>

            <div className="formRow3">
              <div>
                <label>Number of guests</label>
                <input className="input text-right" type="number" min="1" step="1" value={form.paxCount} onChange={(event) => setForm((current) => ({ ...current, paxCount: event.target.value }))} />
              </div>
              <div>
                <label>Price per guest</label>
                <div className="mutedHint">Used for customer total.</div>
                <input className="input text-right" type="number" min="0.00" step="0.01" value={form.quotePricePerPax} onChange={(event) => setForm((current) => ({ ...current, quotePricePerPax: event.target.value }))} />
              </div>
              <div>
                <label>Guest quote subtotal</label>
                <input className="input text-right" value={formatMoney(computed.subtotal)} disabled />
              </div>
            </div>

            <div>
              <label>Venue</label>
              <input className="input" value={form.venue} onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))} />
            </div>

            <div className="tableWrap cateringItemsWrap">
              <div className="tableTopBar">Food and Service Items</div>
              <div className="tableSectionNote">Planning only. Not added to customer total.</div>
              <div className="tableScroller">
                <table className="table table-wide">
                  <thead>
                    <tr>
                      <th>Menu item</th>
                      <th>Custom item</th>
                      <th className="text-right">Quantity</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                        <tr key={item.key}>
                          <td>
                            <select
                              className="input"
                              value={item.menuItemId}
                              onChange={(event) => {
                                const selected = menuItems.find((row) => String(row.id) === String(event.target.value));
                                updateItem(item.key, {
                                  menuItemId: event.target.value,
                                  itemName: selected ? "" : item.itemName,
                                });
                              }}
                            >
                              <option value="">Custom item</option>
                              {menuItems.map((menuItem) => (
                                <option key={menuItem.id} value={menuItem.id}>{menuItem.menu_name}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="input"
                              value={item.itemName}
                              disabled={Boolean(item.menuItemId)}
                              onChange={(event) => updateItem(item.key, { itemName: event.target.value })}
                              placeholder="Buffet setup, custom dish, etc."
                            />
                          </td>
                          <td className="text-right">
                            <input className="input text-right" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} />
                          </td>
                          <td>
                            <input className="input" value={item.notes} onChange={(event) => updateItem(item.key, { notes: event.target.value })} placeholder="Serving/setup note" />
                          </td>
                          <td>
                            <button type="button" className="btn btn-ghost" onClick={() => removeItem(item.key)}>Remove</button>
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="formRow3">
              <div>
                <label>Discount</label>
                <input className="input text-right" type="number" min="0.00" step="0.01" value={form.discountAmount} onChange={(event) => setForm((current) => ({ ...current, discountAmount: event.target.value }))} />
              </div>
              <div>
                <label>Deposit</label>
                <input className="input text-right" type="number" min="0.00" step="0.01" value={form.depositAmount} onChange={(event) => setForm((current) => ({ ...current, depositAmount: event.target.value }))} />
              </div>
              <div>
                <label>Balance</label>
                <input className="input text-right" value={formatMoney(computed.balance)} disabled />
              </div>
            </div>

            <div>
              <label>Notes</label>
              <input className="input" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Inclusions, setup notes, client requests." />
            </div>

            <div className="cateringActionsBar">
              <button type="button" className="btn" onClick={() => dispatch({ type: "add" })}>Add Item</button>
              <div className="cateringActionsRight">
                <span className="mono cateringTotal">Total {formatMoney(computed.total)}</span>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Create Catering Order"}</button>
              </div>
            </div>
          </form>
        </div>

        <div className="tableWrap">
          <div className="tableTopBar">Catering History</div>
          {loading ? (
            <div className="tableLoading">Loading...</div>
          ) : (
            <div className="tableScroller">
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Event</th>
                    <th className="text-right">Pax</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <div className="cateringInfoName">{order.customer_name}</div>
                        <div className="cateringInfoSub">{order.contact_number || "-"}</div>
                      </td>
                      <td>
                        <div>{formatDateLong(order.event_date)}</div>
                        <div className="cateringInfoSub">{formatEventTimeRange(order)}</div>
                        <div className="cateringInfoSub">{order.venue || "-"}</div>
                      </td>
                      <td className="text-right mono">{formatNumber(order.pax_count || 0, 0)}</td>
                      <td className="text-right mono">{formatMoney(order.total_amount || 0)}</td>
                      <td><span className="badge badge-muted">{order.status}</span></td>
                      <td><button type="button" className="btn btn-ghost" onClick={() => openDetails(order.id)}>View</button></td>
                    </tr>
                  ))}
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="tableEmpty">No catering orders yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detail.open ? (
        <div className="modalBackdrop" onClick={closeDetails}>
          <div className="modalCard modalCard-lg" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <h3 className="modalTitle">Catering Order Details</h3>
              <div className="rowActions">
                {detail.order && !editingDetail ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={startEditingDetail}
                    disabled={Boolean(detail.order.inventory_deducted_at)}
                  >
                    Edit Order
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={closeDetails}>
                  Close
                </button>
              </div>
            </div>
            {detail.loading ? (
              <div>Loading...</div>
            ) : detail.order && editingDetail ? (
              <CateringEditForm
                form={editForm}
                setForm={setEditForm}
                items={editItems}
                menuItems={menuItems}
                computed={editComputed}
                saving={editSaving}
                onSubmit={submitEditOrder}
                onCancel={cancelEditingDetail}
                onAddItem={addEditItem}
                onUpdateItem={updateEditItem}
                onRemoveItem={removeEditItem}
              />
            ) : detail.order ? (
              <div className="formGrid">
                <div className="formRow3">
                  <Info label="Customer" value={detail.order.customer_name} />
                  <Info label="Event date" value={formatDateLong(detail.order.event_date)} />
                  <Info label="Guests" value={formatNumber(detail.order.pax_count || 0, 0)} />
                </div>
                <div className="formRow3">
                  <Info label="Event time" value={formatEventTimeRange(detail.order)} />
                  <Info label="Venue" value={detail.order.venue || "-"} />
                  <Info label="Price per guest" value={formatMoney(detail.order.quote_price_per_pax || 0)} />
                </div>
                <div className="formRow3">
                  <Info label="Deposit" value={formatMoney(detail.order.deposit_amount || 0)} />
                  <Info label="Balance" value={formatMoney(detail.order.balance_amount || 0)} />
                  <Info label="Total" value={formatMoney(detail.order.total_amount || 0)} />
                </div>
                <div className="tableWrap">
                  <div className="tableTopBar">Booked Items</div>
                  <div className="tableScroller">
                    <table className="table table-wide">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Qty</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.menu_name || item.item_name_snapshot || "-"}</td>
                            <td className="text-right mono">{formatNumber(item.quantity || 0)}</td>
                            <td>{item.notes || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="tableWrap">
                  <div className="tableTopBar">
                    Ingredient Requirement Preview
                    <span className="badge mono">
                      {formatNumber(requirements.summary.shortageCount || 0, 0)} shortage(s)
                    </span>
                  </div>
                  {requirements.loading ? (
                    <div className="tableLoading">Loading requirements...</div>
                  ) : (
                    <div className="tableScroller">
                      <table className="table table-wide">
                        <thead>
                          <tr>
                            <th>Ingredient</th>
                            <th>Unit</th>
                            <th className="text-right">Required</th>
                            <th className="text-right">On Hand</th>
                            <th className="text-right">Shortage</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {requirements.rows.map((row) => (
                            <tr key={row.ingredientId}>
                              <td>{row.ingredientName}</td>
                              <td>{row.baseUnit || "-"}</td>
                              <td className="text-right mono">{formatNumber(row.requiredQty || 0)}</td>
                              <td className="text-right mono">{formatNumber(row.currentStock || 0)}</td>
                              <td className="text-right mono">{formatNumber(row.shortageQty || 0)}</td>
                              <td>
                                <span className={`badge ${row.status === "SHORT" ? "badge-inactive" : "badge-active"}`}>
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                          {requirements.rows.length === 0 ? (
                            <tr>
                              <td colSpan="6" className="tableEmpty">No recipe-based ingredient requirements yet.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {requirements.warnings.length ? (
                  <div className="card cateringWarningCard">
                    <div className="cateringWarningTitle">Warnings</div>
                    <div className="cateringWarningList">
                      {requirements.warnings.map((warning, index) => (
                        <div key={`${warning.itemId}-${index}`}>
                          {warning.itemName}: {warning.warning}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="cateringStatusBar">
                  <div className="cateringStatusActions">
                    <label>Status</label>
                    <select className="input" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-primary" onClick={() => setStatusTarget(statusDraft)} disabled={!statusDraft || statusDraft === detail.order.status}>
                      Update Status
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={createPurchaseRequestFromShortages}
                      disabled={
                        creatingPurchaseRequest ||
                        !requirements.rows.some((row) => row.status === "SHORT") ||
                        Boolean(detail.order?.linked_purchase_request_id)
                      }
                    >
                      {detail.order?.linked_purchase_request_id
                        ? `Linked to Purchase Request #${detail.order.linked_purchase_request_id}`
                        : creatingPurchaseRequest
                          ? "Creating Request..."
                          : "Convert Shortages to Purchase Request"}
                    </button>
                    {detail.order?.linked_purchase_request_id ? (
                      <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/purchase-requests")}>
                        Open Purchase Requests
                      </button>
                    ) : null}
                  </div>
                  <div className="mono cateringTotal">Total {formatMoney(detail.order.total_amount || 0)}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(statusTarget)}
        title="Update catering status?"
        message={statusTarget ? `Move this catering order to ${statusTarget}?` : ""}
        confirmLabel="Update"
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="infoCardMini">
      <div className="infoCardMiniLabel">{label}</div>
      <div className="infoCardMiniValue">{value}</div>
    </div>
  );
}

function CateringEditForm({
  form,
  setForm,
  items,
  menuItems,
  computed,
  saving,
  onSubmit,
  onCancel,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}) {
  return (
    <form className="formGrid" onSubmit={onSubmit}>
      <div className="formRow2">
        <div>
          <label>Customer name</label>
          <input className="input" value={form.customerName} onChange={(event) => setForm((current) => ({ ...current, customerName: event.target.value }))} />
        </div>
        <div>
          <label>Contact number</label>
          <input className="input" value={form.contactNumber} onChange={(event) => setForm((current) => ({ ...current, contactNumber: event.target.value }))} />
        </div>
      </div>

      <div className="formRow3">
        <div>
          <label>Event date</label>
          <input className="input" type="date" value={form.eventDate} onChange={(event) => setForm((current) => ({ ...current, eventDate: event.target.value }))} />
        </div>
        <div>
          <label>Start time</label>
          <input className="input" type="time" value={form.eventStartTime} onChange={(event) => setForm((current) => ({ ...current, eventStartTime: event.target.value }))} />
        </div>
        <div>
          <label>End time</label>
          <input className="input" type="time" value={form.eventEndTime} onChange={(event) => setForm((current) => ({ ...current, eventEndTime: event.target.value }))} />
        </div>
      </div>

      <div className="formRow3">
        <div>
          <label>Number of guests</label>
          <input className="input text-right" type="number" min="1" step="1" value={form.paxCount} onChange={(event) => setForm((current) => ({ ...current, paxCount: event.target.value }))} />
        </div>
        <div>
          <label>Price per guest</label>
          <input className="input text-right" type="number" min="0.00" step="0.01" value={form.quotePricePerPax} onChange={(event) => setForm((current) => ({ ...current, quotePricePerPax: event.target.value }))} />
        </div>
        <div>
          <label>Guest quote subtotal</label>
          <input className="input text-right" value={formatMoney(computed.subtotal)} disabled />
        </div>
      </div>

      <div>
        <label>Venue</label>
        <input className="input" value={form.venue} onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))} />
      </div>

      <div className="tableWrap cateringItemsWrap">
        <div className="tableTopBar">Food and Service Items</div>
        <div className="tableSectionNote">Edit the food, service items, quantities, and notes for this catering order.</div>
        <div className="tableScroller">
          <table className="table table-wide">
            <thead>
              <tr>
                <th>Menu item</th>
                <th>Custom item</th>
                <th className="text-right">Quantity</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <td>
                    <select
                      className="input"
                      value={item.menuItemId}
                      onChange={(event) => {
                        const selected = menuItems.find((row) => String(row.id) === String(event.target.value));
                        onUpdateItem(item.key, {
                          menuItemId: event.target.value,
                          itemName: selected ? "" : item.itemName,
                        });
                      }}
                    >
                      <option value="">Custom item</option>
                      {menuItems.map((menuItem) => (
                        <option key={menuItem.id} value={menuItem.id}>{menuItem.menu_name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      value={item.itemName}
                      disabled={Boolean(item.menuItemId)}
                      onChange={(event) => onUpdateItem(item.key, { itemName: event.target.value })}
                      placeholder="Buffet setup, custom dish, etc."
                    />
                  </td>
                  <td className="text-right">
                    <input className="input text-right" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => onUpdateItem(item.key, { quantity: event.target.value })} />
                  </td>
                  <td>
                    <input className="input" value={item.notes} onChange={(event) => onUpdateItem(item.key, { notes: event.target.value })} placeholder="Serving/setup note" />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost" onClick={() => onRemoveItem(item.key)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="formRow3">
        <div>
          <label>Discount</label>
          <input className="input text-right" type="number" min="0.00" step="0.01" value={form.discountAmount} onChange={(event) => setForm((current) => ({ ...current, discountAmount: event.target.value }))} />
        </div>
        <div>
          <label>Deposit</label>
          <input className="input text-right" type="number" min="0.00" step="0.01" value={form.depositAmount} onChange={(event) => setForm((current) => ({ ...current, depositAmount: event.target.value }))} />
        </div>
        <div>
          <label>Balance</label>
          <input className="input text-right" value={formatMoney(computed.balance)} disabled />
        </div>
      </div>

      <div>
        <label>Notes</label>
        <input className="input" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Inclusions, setup notes, client requests." />
      </div>

      <div className="cateringActionsBar">
        <button type="button" className="btn" onClick={onAddItem}>Add Item</button>
        <div className="cateringActionsRight">
          <span className="mono cateringTotal">Total {formatMoney(computed.total)}</span>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      </div>
    </form>
  );
}
