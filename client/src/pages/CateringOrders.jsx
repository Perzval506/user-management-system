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
    unitPrice: "0.00",
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
  const [form, setForm] = useState({
    customerName: "",
    contactNumber: "",
    eventDate: "",
    eventTime: "",
    venue: "",
    paxCount: "50",
    discountAmount: "0.00",
    depositAmount: "0.00",
    notes: "",
  });

  const computed = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const qty = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return sum;
      return sum + qty * unitPrice;
    }, 0);
    const discount = Number(form.discountAmount);
    const deposit = Number(form.depositAmount);
    const total = Math.max(subtotal - (Number.isFinite(discount) ? discount : 0), 0);
    const safeDeposit = Math.min(Math.max(Number.isFinite(deposit) ? deposit : 0, 0), total);
    return {
      subtotal,
      total,
      balance: total - safeDeposit,
    };
  }, [form.depositAmount, form.discountAmount, items]);

  function closeDetails() {
    setDetail({ open: false, loading: false, order: null, items: [] });
    setRequirements({ loading: false, rows: [], warnings: [], summary: { ingredientCount: 0, shortageCount: 0 } });
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

  async function submitOrder(event) {
    event?.preventDefault();
    const relevantItems = items.filter((item) => item.menuItemId || item.itemName || item.quantity || item.unitPrice);
    if (!form.customerName.trim()) {
      return toast.push({ type: "error", title: "Missing customer", message: "Customer name is required." });
    }
    if (!form.eventDate) {
      return toast.push({ type: "error", title: "Missing event date", message: "Event date is required." });
    }
    if (!Number.isFinite(Number(form.paxCount)) || Number(form.paxCount) <= 0) {
      return toast.push({ type: "error", title: "Invalid pax", message: "Pax count must be greater than 0." });
    }
    if (!relevantItems.length) {
      return toast.push({ type: "error", title: "Missing items", message: "Add at least one catering item." });
    }

    for (let index = 0; index < relevantItems.length; index += 1) {
      const item = relevantItems[index];
      if (!item.menuItemId && !item.itemName.trim()) {
        return toast.push({ type: "error", title: "Missing item", message: `Line ${index + 1} needs a menu item or custom item name.` });
      }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
        return toast.push({ type: "error", title: "Invalid quantity", message: `Line ${index + 1} needs a quantity greater than 0.` });
      }
      if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
        return toast.push({ type: "error", title: "Invalid price", message: `Line ${index + 1} needs a valid unit price.` });
      }
    }

    setSaving(true);
    try {
      await api.post("/catering-orders", {
        customerName: form.customerName.trim(),
        contactNumber: form.contactNumber.trim() || null,
        eventDate: form.eventDate,
        eventTime: form.eventTime.trim() || null,
        venue: form.venue.trim() || null,
        paxCount: Number(form.paxCount),
        discountAmount: Number(form.discountAmount || 0),
        depositAmount: Number(form.depositAmount || 0),
        notes: form.notes.trim() || null,
        items: relevantItems.map((item) => ({
          menuItemId: item.menuItemId ? Number(item.menuItemId) : null,
          itemName: item.itemName.trim() || null,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          notes: item.notes.trim() || null,
        })),
      });
      toast.push({ type: "success", title: "Saved", message: "Catering order created." });
      setForm({
        customerName: "",
        contactNumber: "",
        eventDate: "",
        eventTime: "",
        venue: "",
        paxCount: "50",
        discountAmount: "0.00",
        depositAmount: "0.00",
        notes: "",
      });
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

  async function openDetails(id) {
    setDetail({ open: true, loading: true, order: null, items: [] });
    setRequirements({ loading: true, rows: [], warnings: [], summary: { ingredientCount: 0, shortageCount: 0 } });
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
          <div className="pageSub">Build custom event packages, capture deposits, and track the booking from quote to completion.</div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(360px, 0.9fr)", gap: 14 }}>
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
                <label>Event time</label>
                <input className="input" value={form.eventTime} onChange={(event) => setForm((current) => ({ ...current, eventTime: event.target.value }))} placeholder="e.g., 6:00 PM" />
              </div>
              <div>
                <label>Pax count</label>
                <input className="input text-right" type="number" min="1" step="1" value={form.paxCount} onChange={(event) => setForm((current) => ({ ...current, paxCount: event.target.value }))} />
              </div>
            </div>

            <div>
              <label>Venue</label>
              <input className="input" value={form.venue} onChange={(event) => setForm((current) => ({ ...current, venue: event.target.value }))} />
            </div>

            <div className="tableWrap" style={{ marginTop: 8 }}>
              <div className="tableTopBar">Package Items</div>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Menu item</th>
                      <th>Custom item</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Line total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
                      return (
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
                                  unitPrice: selected ? String(Number(selected.selling_price || 0).toFixed(2)) : item.unitPrice,
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
                          <td className="text-right">
                            <input className="input text-right" type="number" min="0.00" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })} />
                          </td>
                          <td className="text-right mono">{formatMoney(lineTotal)}</td>
                          <td>
                            <button type="button" className="btn btn-ghost" onClick={() => removeItem(item.key)}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
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

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => dispatch({ type: "add" })}>Add Item</button>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontWeight: 800 }}>Total {formatMoney(computed.total)}</span>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Create Catering Order"}</button>
              </div>
            </div>
          </form>
        </div>

        <div className="tableWrap">
          <div className="tableTopBar">Catering History</div>
          {loading ? (
            <div style={{ padding: 12 }}>Loading...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
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
                        <div style={{ fontWeight: 700 }}>{order.customer_name}</div>
                        <div style={{ color: "var(--muted)" }}>{order.contact_number || "-"}</div>
                      </td>
                      <td>
                        <div>{formatDateLong(order.event_date)}</div>
                        <div style={{ color: "var(--muted)" }}>{order.venue || "-"}</div>
                      </td>
                      <td className="text-right mono">{formatNumber(order.pax_count || 0, 0)}</td>
                      <td className="text-right mono">{formatMoney(order.total_amount || 0)}</td>
                      <td><span className="badge badge-muted">{order.status}</span></td>
                      <td><button type="button" className="btn btn-ghost" onClick={() => openDetails(order.id)}>View</button></td>
                    </tr>
                  ))}
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No catering orders yet.</td>
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
              <h3 style={{ margin: 0 }}>Catering Order Details</h3>
            </div>
            {detail.loading ? (
              <div>Loading...</div>
            ) : detail.order ? (
              <div className="formGrid">
                <div className="formRow3">
                  <Info label="Customer" value={detail.order.customer_name} />
                  <Info label="Event date" value={formatDateLong(detail.order.event_date)} />
                  <Info label="Pax" value={formatNumber(detail.order.pax_count || 0, 0)} />
                </div>
                <div className="formRow3">
                  <Info label="Venue" value={detail.order.venue || "-"} />
                  <Info label="Deposit" value={formatMoney(detail.order.deposit_amount || 0)} />
                  <Info label="Balance" value={formatMoney(detail.order.balance_amount || 0)} />
                </div>
                <div className="tableWrap">
                  <div className="tableTopBar">Booked Items</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Unit price</th>
                          <th className="text-right">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.menu_name || item.item_name_snapshot || "-"}</td>
                            <td className="text-right mono">{formatNumber(item.quantity || 0)}</td>
                            <td className="text-right mono">{formatMoney(item.unit_price || 0)}</td>
                            <td className="text-right mono">{formatMoney(item.line_total || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="tableWrap">
                  <div className="tableTopBar">
                    Ingredient Requirement Preview
                    <span className="badge mono" style={{ marginLeft: 10 }}>
                      {formatNumber(requirements.summary.shortageCount || 0, 0)} shortage(s)
                    </span>
                  </div>
                  {requirements.loading ? (
                    <div style={{ padding: 12 }}>Loading requirements...</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="table">
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
                              <td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No recipe-based ingredient requirements yet.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {requirements.warnings.length ? (
                  <div className="card" style={{ borderColor: "var(--warning)", background: "#FFF9ED" }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Warnings</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {requirements.warnings.map((warning, index) => (
                        <div key={`${warning.itemId}-${index}`} style={{ color: "var(--text)" }}>
                          {warning.itemName}: {warning.warning}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontWeight: 700 }}>Status</label>
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
                  <div className="mono" style={{ fontWeight: 800 }}>Total {formatMoney(detail.order.total_amount || 0)}</div>
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
    <div style={{ padding: 14, borderRadius: 14, background: "#FBFBFE", border: "1px solid #E7EAF3" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}
