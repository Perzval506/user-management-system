import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatNumber } from "../utils/formatters";

const todayInput = () => new Date().toISOString().slice(0, 10);

const requestItemReducer = (state, action) => {
  switch (action.type) {
    case "add":
      return [
        ...state,
        {
          key: Date.now() + Math.random(),
          ingredientId: null,
          ingredientName: "",
          quantity: "",
          unit: "",
          reason: "",
        },
      ];
    case "update":
      return state.map((row) => (row.key === action.key ? { ...row, ...action.patch } : row));
    case "remove":
      return state.filter((row) => row.key !== action.key);
    case "reset":
      return [];
    default:
      return state;
  }
};

function safeUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export default function PurchaseRequests() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = safeUser();
  const isOwner = user?.role === "OWNER";
  const [ingredients, setIngredients] = useState([]);
  const [requests, setRequests] = useState([]);
  const [items, dispatch] = useReducer(requestItemReducer, []);
  const [requestDate, setRequestDate] = useState(todayInput());
  const [neededByDate, setNeededByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState({ request: null, items: [] });
  const [detailLoading, setDetailLoading] = useState(false);
  const [decision, setDecision] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [convertingRequestId, setConvertingRequestId] = useState(null);

  const requestCount = useMemo(() => requests.filter((row) => row.status === "PENDING").length, [requests]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestsRes, ingredientsRes] = await Promise.all([
        api.get("/purchase-requests"),
        api.get("/ingredients"),
      ]);
      setRequests(requestsRes.data || []);
      setIngredients(ingredientsRes.data || []);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load purchase requests",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    if (items.length === 0) dispatch({ type: "add" });
  }, [items.length, load]);

  function updateRow(key, patch) {
    dispatch({ type: "update", key, patch });
  }

  function removeRow(key) {
    if (items.length === 1) {
      dispatch({ type: "update", key, patch: { ingredientId: null, ingredientName: "", quantity: "", unit: "", reason: "" } });
      return;
    }
    dispatch({ type: "remove", key });
  }

  async function submitRequest() {
    const relevantItems = items.filter((item) =>
      item.ingredientId || item.ingredientName || item.quantity || item.unit || item.reason
    );
    if (!relevantItems.length) {
      return toast.push({ type: "error", title: "Missing items", message: "Add at least one request item." });
    }

    for (let index = 0; index < relevantItems.length; index += 1) {
      const item = relevantItems[index];
      if (!item.ingredientId) return toast.push({ type: "error", title: "Missing ingredient", message: `Item ${index + 1} needs an ingredient.` });
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return toast.push({ type: "error", title: "Invalid quantity", message: `Item ${index + 1} needs a quantity greater than 0.` });
      if (!String(item.unit || "").trim()) return toast.push({ type: "error", title: "Missing unit", message: `Item ${index + 1} needs a unit.` });
    }

    setSaving(true);
    try {
      await api.post("/purchase-requests", {
        requestDate,
        neededByDate: neededByDate || null,
        notes: notes.trim() || null,
        items: relevantItems.map((item) => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          quantity: Number(item.quantity),
          unit: item.unit,
          reason: item.reason || null,
        })),
      });
      toast.push({ type: "success", title: "Submitted", message: "Purchase request submitted." });
      dispatch({ type: "reset" });
      dispatch({ type: "add" });
      setRequestDate(todayInput());
      setNeededByDate("");
      setNotes("");
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save purchase request",
      });
    } finally {
      setSaving(false);
    }
  }

  async function openDetails(id) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData({ request: null, items: [] });
    try {
      const res = await api.get(`/purchase-requests/${id}`);
      setDetailData({ request: res.data?.request || null, items: res.data?.items || [] });
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmDecision() {
    if (!decision) return;
    try {
      await api.patch(`/purchase-requests/${decision.id}/status`, {
        status: decision.status,
        review_notes: reviewNotes.trim() || null,
      });
      toast.push({
        type: "success",
        title: "Updated",
        message: `Purchase request ${decision.status === "APPROVED" ? "approved" : "rejected"}.`,
      });
      setDecision(null);
      setReviewNotes("");
      if (detailData.request?.id === decision.id) {
        await openDetails(decision.id);
      }
      await load();
    } catch (error) {
      toast.push({ type: "error", title: "Update failed", message: error?.response?.data?.message || error.message });
    }
  }

  async function convertToPurchaseOrder(requestRow) {
    if (!requestRow?.id) return;
    const storeName = window.prompt("Enter the supplier/store name for this purchase order:");
    if (!storeName || !String(storeName).trim()) return;

    setConvertingRequestId(requestRow.id);
    try {
      const response = await api.post(`/purchase-requests/${requestRow.id}/create-purchase-order`, {
        storeName: String(storeName).trim(),
      });
      toast.push({
        type: "success",
        title: "Purchase order created",
        message: `Created purchase order #${response.data?.id} from request PR-${String(requestRow.id).padStart(4, "0")}.`,
      });
      if (detailData.request?.id === requestRow.id) {
        setDetailData((current) => ({
          ...current,
          request: current.request ? { ...current.request, linked_purchase_order_id: response.data?.id } : current.request,
        }));
      }
      await load();
    } catch (error) {
      const existingOrderId = error?.response?.data?.existingOrderId;
      if (existingOrderId && detailData.request?.id === requestRow.id) {
        setDetailData((current) => ({
          ...current,
          request: current.request ? { ...current.request, linked_purchase_order_id: existingOrderId } : current.request,
        }));
      }
      toast.push({
        type: "error",
        title: "Conversion failed",
        message: error?.response?.data?.message || error.message || "Failed to create purchase order from request",
      });
    } finally {
      setConvertingRequestId(null);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchase Requests</h2>
          <div className="pageSub">
            {isOwner ? "Review stockroom requests before turning them into actual purchases." : "Request ingredients that need to be bought. Admin reviews these before purchasing."}
          </div>
        </div>
        <div className="badge mono">Pending: {formatNumber(requestCount, 0)}</div>
      </div>

      {!isOwner && (
        <div className="card">
          <form className="formGrid" onSubmit={(event) => { event.preventDefault(); submitRequest(); }}>
            <div className="formRow2">
              <div>
                <label>Request date</label>
                <input className="input" type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} />
              </div>
              <div>
                <label>Needed by</label>
                <input className="input" type="date" value={neededByDate} onChange={(event) => setNeededByDate(event.target.value)} />
              </div>
            </div>

            <div>
              <label>Request notes</label>
              <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note for admin" />
            </div>

            <div className="tableWrap" style={{ marginTop: 8 }}>
              <div className="tableTopBar">Requested Items</div>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th className="text-right">Quantity</th>
                      <th>Unit</th>
                      <th>Reason</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => {
                      const selected = ingredients.find((ingredient) => ingredient.id === row.ingredientId);
                      return (
                        <tr key={row.key}>
                          <td>
                            <select
                              className="input"
                              value={row.ingredientId || ""}
                              onChange={(event) => {
                                const ingredientId = Number(event.target.value) || null;
                                const ingredient = ingredients.find((item) => item.id === ingredientId);
                                updateRow(row.key, {
                                  ingredientId,
                                  ingredientName: ingredient?.ingredient_name || "",
                                  unit: ingredient?.base_unit || row.unit,
                                });
                              }}
                            >
                              <option value="">Select ingredient</option>
                              {ingredients.map((ingredient) => (
                                <option key={ingredient.id} value={ingredient.id}>{ingredient.ingredient_name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right">
                            <input className="input text-right" type="number" step="0.01" min="0.01" value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} />
                          </td>
                          <td>
                            <input className="input" value={row.unit || selected?.base_unit || ""} onChange={(event) => updateRow(row.key, { unit: event.target.value })} />
                          </td>
                          <td>
                            <input className="input" value={row.reason} onChange={(event) => updateRow(row.key, { reason: event.target.value })} placeholder="Low stock, weekly review, etc." />
                          </td>
                          <td>
                            <button type="button" className="btn btn-ghost" onClick={() => removeRow(row.key)}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => dispatch({ type: "add" })}>Add Item</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={submitRequest}>
                {saving ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">{isOwner ? "Incoming Purchase Requests" : "My Purchase Requests"}</div>
        {loading ? (
          <div style={{ padding: 14 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Request Date</th>
                  <th>Needed By</th>
                  <th>Requested By</th>
                  <th className="text-right">Items</th>
                  <th>Status</th>
                  <th>Reviewed By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">PR-{String(row.id).padStart(4, "0")}</td>
                    <td>{formatDateLong(row.request_date)}</td>
                    <td>{row.needed_by_date ? formatDateLong(row.needed_by_date) : "-"}</td>
                    <td>{row.requested_by_name || "-"}</td>
                    <td className="text-right mono">{formatNumber(row.item_count || 0, 0)}</td>
                    <td><span className={`badge ${row.status === "PENDING" ? "badge-pending" : row.status === "APPROVED" ? "badge-active" : "badge-inactive"}`}>{row.status}</span></td>
                    <td>{row.reviewed_by_name || "-"}</td>
                    <td>
                      <div className="rowActions">
                        <button type="button" className="btn btn-ghost" onClick={() => openDetails(row.id)}>View</button>
                        {isOwner && row.status === "PENDING" ? (
                          <>
                            <button type="button" className="btn" onClick={() => { setDecision({ id: row.id, status: "APPROVED" }); setReviewNotes(""); }}>Approve</button>
                            <button type="button" className="btn" onClick={() => { setDecision({ id: row.id, status: "REJECTED" }); setReviewNotes(""); }}>Reject</button>
                          </>
                        ) : null}
                        {isOwner && row.status === "APPROVED" ? (
                          row.linked_purchase_order_id ? (
                            <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/purchase-orders")}>
                              PO #{row.linked_purchase_order_id}
                            </button>
                          ) : (
                            <button type="button" className="btn" disabled={convertingRequestId === row.id} onClick={() => convertToPurchaseOrder(row)}>
                              {convertingRequestId === row.id ? "Converting..." : "Create PO"}
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan="8" style={{ padding: 14, opacity: 0.7 }}>No purchase requests found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(decision)}
        title={decision?.status === "APPROVED" ? "Approve request?" : "Reject request?"}
        message={
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              {decision?.status === "APPROVED" ? "Approve this stockroom purchase request?" : "Reject this stockroom purchase request?"}
            </div>
            <div>
              <label>Review notes</label>
              <input className="input" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Optional admin note" />
            </div>
          </div>
        }
        confirmLabel={decision?.status === "APPROVED" ? "Approve" : "Reject"}
        onCancel={() => { setDecision(null); setReviewNotes(""); }}
        onConfirm={confirmDecision}
      />

      {detailOpen && (
        <div style={modalBackdrop} onClick={() => setDetailOpen(false)}>
          <div style={modalCard} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Purchase Request Details</h3>
                {detailData.request ? (
                  <div style={{ color: "#6B7280", marginTop: 4 }}>
                    PR-{String(detailData.request.id).padStart(4, "0")} | Requested {formatDateTimeFriendly(detailData.request.created_at)}
                  </div>
                ) : null}
              </div>
              <button className="btn btn-ghost" onClick={() => setDetailOpen(false)}>Close</button>
            </div>

            {detailLoading ? (
              <div style={{ padding: 12 }}>Loading details...</div>
            ) : (
              <>
                {detailData.request && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
                    <DetailCell label="Status" value={detailData.request.status} />
                    <DetailCell label="Requested By" value={detailData.request.requested_by_name || "-"} />
                    <DetailCell label="Needed By" value={detailData.request.needed_by_date ? formatDateLong(detailData.request.needed_by_date) : "-"} />
                    <DetailCell label="Review Notes" value={detailData.request.review_notes || "-"} />
                    <DetailCell
                      label="Purchase Order"
                      value={detailData.request.linked_purchase_order_id ? `PO #${detailData.request.linked_purchase_order_id}` : "-"}
                    />
                  </div>
                )}

                {isOwner && detailData.request?.status === "APPROVED" ? (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    {detailData.request.linked_purchase_order_id ? (
                      <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/purchase-orders")}>
                        Open Linked Purchase Order
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={convertingRequestId === detailData.request.id}
                        onClick={() => convertToPurchaseOrder(detailData.request)}
                      >
                        {convertingRequestId === detailData.request.id ? "Converting..." : "Convert to Purchase Order"}
                      </button>
                    )}
                  </div>
                ) : null}

                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Ingredient</th>
                        <th className="text-right">Quantity</th>
                        <th>Unit</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailData.items.map((item) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 700 }}>{item.ingredient_name || "-"}</td>
                          <td className="text-right mono">{formatNumber(item.quantity || 0)}</td>
                          <td>{item.unit || item.base_unit || "-"}</td>
                          <td>{item.reason || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCell({ label, value }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, border: "1px solid #E7EAF3", background: "#FBFBFE" }}>
      <div style={{ color: "#6B7280", marginBottom: 4, fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.24)",
  backdropFilter: "blur(3px) saturate(104%)",
  WebkitBackdropFilter: "blur(3px) saturate(104%)",
  display: "grid",
  placeItems: "center",
  padding: 16,
  zIndex: 200000,
  overflowY: "auto",
};
const modalCard = { width: "min(920px, 100%)", background: "white", borderRadius: 14, padding: 16, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" };
