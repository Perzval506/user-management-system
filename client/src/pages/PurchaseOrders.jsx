import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatMoney, round2, formatDateTimeFriendly, formatNumber } from "../utils/formatters";

const todayInput = () => new Date().toISOString().slice(0, 10);

const itemReducer = (state, action) => {
  switch (action.type) {
    case "add":
      return [
        ...state,
        {
          key: Date.now() + Math.random(),
          ingredientId: null,
          ingredientName: "",
          brand: "",
          unit: "",
          quantity: "",
          price: "",
          subtotal: 0,
        },
      ];
    case "remove":
      return state.filter((row) => row.key !== action.key);
    case "update":
      return state.map((row) =>
        row.key === action.key ? { ...row, ...action.patch } : row
      );
    case "reset":
      return [];
    default:
      return state;
  }
};

const ItemRow = React.memo(function ItemRow({ row, onChange, onRemove, ingredients }) {
  const qty = Number(row.quantity || 0);
  const price = Number(row.price || 0);
  const subtotal = round2(qty * price);
  const [ingredientQuery, setIngredientQuery] = useState(row.ingredientName || "");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredIngredients = useMemo(() => {
    const query = ingredientQuery.trim().toLowerCase();
    if (!query) return ingredients;
    return ingredients.filter((ingredient) =>
      String(ingredient.ingredient_name || "").toLowerCase().includes(query)
    );
  }, [ingredientQuery, ingredients]);

  const visibleSuggestions = filteredIngredients.slice(0, 8);

  function applyIngredient(selected) {
    if (!selected) return;
    setIngredientQuery(selected ? selected.ingredient_name : "");
    setShowSuggestions(false);
    onChange(row.key, {
      ingredientId: selected.id,
      ingredientName: selected ? selected.ingredient_name : "",
      brand: selected?.suggested_brand || "",
      unit: selected?.suggested_cost_unit || selected?.base_unit || selected?.base_unit_qty || "",
      price:
        selected?.suggested_unit_cost != null && Number.isFinite(Number(selected.suggested_unit_cost))
          ? String(selected.suggested_unit_cost)
          : "",
    });
  }

  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <div style={{ position: "relative" }}>
          <input
            className="input"
            value={ingredientQuery}
            onChange={(event) => {
              setIngredientQuery(event.target.value);
              setShowSuggestions(true);
              if (!event.target.value.trim()) {
                onChange(row.key, {
                  ingredientId: null,
                  ingredientName: "",
                  brand: "",
                  unit: "",
                  price: "",
                });
              }
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 120);
            }}
            placeholder="Search ingredient"
          />
          {showSuggestions && (
            <div style={suggestionBox}>
              {visibleSuggestions.length > 0 ? (
                visibleSuggestions.map((ingredient) => (
                  <button
                    key={ingredient.id}
                    type="button"
                    style={suggestionItem}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyIngredient(ingredient)}
                  >
                    <strong>{String(ingredient.ingredient_name || "").toUpperCase()}</strong>
                    <span style={{ color: "#6B7280" }}>{ingredient.base_unit || "-"}</span>
                  </button>
                ))
              ) : (
                <div style={{ padding: 10, color: "#6B7280", fontSize: 13 }}>
                  No ingredient matches this search.
                </div>
              )}
            </div>
          )}
        </div>
      </td>
      <td>
        <input className="input" value={row.brand} onChange={(event) => onChange(row.key, { brand: event.target.value })} />
      </td>
      <td><input className="input" value={row.unit} onChange={(event) => onChange(row.key, { unit: event.target.value })} /></td>
      <td className="text-right"><input className="input text-right" type="number" step="0.01" min="0" value={row.quantity} onChange={(event) => onChange(row.key, { quantity: event.target.value })} /></td>
      <td className="text-right"><input className="input text-right" type="number" step="0.01" min="0" value={row.price} onChange={(event) => onChange(row.key, { price: event.target.value })} /></td>
      <td className="text-right mono">{formatMoney(subtotal)}</td>
      <td><button className="btn btn-ghost" type="button" onClick={() => onRemove(row.key)}>X</button></td>
    </tr>
  );
});

function makeEditableItem(item = {}) {
  return {
    key: item.key || Date.now() + Math.random(),
    ingredientId: item.ingredient_id || item.ingredientId || null,
    ingredientName: item.ingredient_name || item.ingredientName || "",
    brand: item.brand || "",
    unit: item.unit || "",
    quantity: item.quantity != null ? String(item.quantity) : "",
    price: item.price != null ? String(item.price) : "",
  };
}

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const toast = useToast();
  const [storeName, setStoreName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayInput());
  const [items, dispatch] = useReducer(itemReducer, []);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [editStoreName, setEditStoreName] = useState("");
  const [editPurchaseDate, setEditPurchaseDate] = useState(todayInput());
  const [editItems, setEditItems] = useState([]);
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [weeklyTotal, setWeeklyTotal] = useState(0);
  const [deletingOrder, setDeletingOrder] = useState(null);

  const totalAmount = useMemo(
    () => round2(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0)),
    [items]
  );
  const itemCount = items.length;

  const loadIngredients = useCallback(async () => {
    try {
      const res = await api.get("/ingredients");
      setIngredients(res.data || []);
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
    }
  }, [toast]);

  const loadOrders = useCallback(async () => {
    try {
      const [ordersResponse, weeklyResponse] = await Promise.all([
        api.get("/purchase-orders"),
        api.get("/purchase-orders/summary/weekly"),
      ]);
      setOrders(ordersResponse.data || []);
      setWeeklyHistory(weeklyResponse.data?.weeklyHistory || []);
      setWeeklyTotal(Number(weeklyResponse.data?.weeklyTotal || 0));
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
    loadIngredients();
    if (items.length === 0) dispatch({ type: "add" });
  }, [items.length, loadIngredients, loadOrders]);

  function updateRow(key, patch) {
    dispatch({ type: "update", key, patch });
  }

  function removeRow(key) {
    if (items.length === 1) {
      dispatch({
        type: "update",
        key,
        patch: { ingredientId: null, ingredientName: "", brand: "", unit: "", quantity: "", price: "" },
      });
      return;
    }
    dispatch({ type: "remove", key });
  }

  async function submitPurchaseOrder() {
    if (!storeName.trim()) return toast.push({ type: "error", title: "Missing store", message: "Store name is required." });
    if (items.length === 0) return toast.push({ type: "error", title: "Missing items", message: "Add at least one item." });

    const relevantItems = items.filter((item) =>
      item.ingredientId ||
      String(item.ingredientName || "").trim() ||
      String(item.brand || "").trim() ||
      String(item.unit || "").trim() ||
      String(item.quantity || "").trim() ||
      String(item.price || "").trim()
    );
    if (!relevantItems.length) {
      return toast.push({ type: "error", title: "Missing items", message: "Add at least one completed item." });
    }

    for (let index = 0; index < relevantItems.length; index += 1) {
      const item = relevantItems[index];
      if (!item.ingredientId) {
        return toast.push({ type: "error", title: "Missing ingredient", message: `Item ${index + 1} needs an ingredient.` });
      }
      if (!String(item.unit || "").trim()) {
        return toast.push({ type: "error", title: "Missing unit", message: `Item ${index + 1} needs a unit.` });
      }
      if (!isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
        return toast.push({ type: "error", title: "Invalid quantity", message: `Item ${index + 1} needs a quantity greater than 0.` });
      }
      if (!isFinite(Number(item.price)) || Number(item.price) < 0) {
        return toast.push({ type: "error", title: "Invalid unit price", message: `Item ${index + 1} needs a unit price of 0 or more.` });
      }
    }

    const payloadItems = relevantItems.map((item) => ({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      brand: item.brand,
      unit: item.unit,
      quantity: round2(item.quantity || 0),
      price: round2(item.price || 0),
    }));

    setSaving(true);
    try {
      await api.post("/purchase-orders", {
        storeName: storeName.trim(),
        purchaseDate,
        items: payloadItems,
      });
      toast.push({ type: "success", title: "Saved", message: "Purchase order recorded." });
      dispatch({ type: "reset" });
      dispatch({ type: "add" });
      setStoreName("");
      setPurchaseDate(todayInput());
      await loadOrders();
    } catch (error) {
      toast.push({ type: "error", title: "Save failed", message: error?.response?.data?.message || error.message });
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    submitPurchaseOrder();
  }

  function updateEditRow(key, patch) {
    setEditItems((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeEditRow(key) {
    setEditItems((current) => {
      if (current.length === 1) {
        return [makeEditableItem()];
      }
      return current.filter((row) => row.key !== key);
    });
  }

  async function openDetails(id) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailEditing(false);
    setDetailOrder(null);
    setDetailItems([]);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      setDetailOrder(res.data?.order || null);
      setDetailItems(res.data?.items || []);
      setEditStoreName(res.data?.order?.store_name || "");
      setEditPurchaseDate(res.data?.order?.purchase_date ? String(res.data.order.purchase_date).slice(0, 10) : todayInput());
      setEditItems((res.data?.items || []).map((item) => makeEditableItem(item)));
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmDeleteOrder() {
    if (!deletingOrder) return;
    try {
      await api.delete(`/purchase-orders/${deletingOrder.id}`);
      toast.push({ type: "success", title: "Deleted", message: "Purchase order deleted." });
      setDeletingOrder(null);
      if (detailOrder?.id === deletingOrder.id) {
        setDetailOpen(false);
      }
      await loadOrders();
    } catch (error) {
      toast.push({ type: "error", title: "Delete failed", message: error?.response?.data?.message || error.message });
    }
  }

  async function saveEditedOrder(finalize = false) {
    if (!detailOrder?.id) return;
    const relevantItems = editItems.filter((item) =>
      item.ingredientId || String(item.ingredientName || "").trim() || String(item.brand || "").trim() || String(item.unit || "").trim() || String(item.quantity || "").trim() || String(item.price || "").trim()
    );
    if (!editStoreName.trim()) {
      return toast.push({ type: "error", title: "Missing store", message: "Store name is required." });
    }
    if (!relevantItems.length) {
      return toast.push({ type: "error", title: "Missing items", message: "Add at least one completed item." });
    }

    for (let index = 0; index < relevantItems.length; index += 1) {
      const item = relevantItems[index];
      if (!item.ingredientId) return toast.push({ type: "error", title: "Missing ingredient", message: `Item ${index + 1} needs an ingredient.` });
      if (!String(item.unit || "").trim()) return toast.push({ type: "error", title: "Missing unit", message: `Item ${index + 1} needs a unit.` });
      if (!isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return toast.push({ type: "error", title: "Invalid quantity", message: `Item ${index + 1} needs a quantity greater than 0.` });
      if (!isFinite(Number(item.price)) || Number(item.price) < 0) return toast.push({ type: "error", title: "Invalid unit price", message: `Item ${index + 1} needs a unit price of 0 or more.` });
    }

    setDetailSaving(true);
    try {
      await api.put(`/purchase-orders/${detailOrder.id}`, {
        storeName: editStoreName.trim(),
        purchaseDate: editPurchaseDate,
        finalize,
        items: relevantItems.map((item) => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          brand: item.brand,
          unit: item.unit,
          quantity: round2(item.quantity || 0),
          price: round2(item.price || 0),
        })),
      });
      toast.push({
        type: "success",
        title: finalize ? "Purchase order finalized" : "Purchase order updated",
        message: finalize ? "Inventory was posted from this purchase receipt." : "Purchase receipt draft updated.",
      });
      await openDetails(detailOrder.id);
      await loadOrders();
    } catch (error) {
      toast.push({ type: "error", title: finalize ? "Finalize failed" : "Save failed", message: error?.response?.data?.message || error.message });
    } finally {
      setDetailSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchase Receipts</h2>
          <div className="pageSub">Multi-item supplier receipts and inventory posting.</div>
        </div>
        <div className="badge mono">This week: {formatMoney(weeklyTotal)}</div>
      </div>

      <div className="card">
        {/* UX cleanup: one form and one save action makes purchase-order entry less confusing. */}
        <form onSubmit={onSubmit}>
          <div className="formGrid">
            <div>
              <label>Supplier or store</label>
              <input className="input" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="e.g., Sari-sari ni Aling Nena" />
            </div>
            <div>
              <label>Purchase date</label>
              <input className="input" type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
              <div style={{ color: "#6B7280", marginTop: 4 }}>{formatDateLong(purchaseDate)}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>Receipt items</div>
              <div className="compactHint">Incomplete rows are skipped.</div>
            </div>
            <div className="badge mono">{itemCount} item{itemCount === 1 ? "" : "s"}</div>
          </div>

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Brand</th>
                  <th>Unit</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Purchase cost / unit</th>
                  <th className="text-right">Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <ItemRow key={row.key} row={row} onChange={updateRow} onRemove={removeRow} ingredients={ingredients} />
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => dispatch({ type: "add" })}>Add item</button>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>Total:</strong>
              <span className="mono">{formatMoney(totalAmount)}</span>
              <button className="btn btn-primary" type="button" disabled={saving} onClick={submitPurchaseOrder}>{saving ? "Saving..." : "Save receipt"}</button>
            </div>
          </div>
        </form>
      </div>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">Recent Purchase Receipts</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Supplier / store</th>
                <th>Purchase date</th>
                <th>Items</th>
                <th className="text-right">Total</th>
                <th>Recorded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.store_name}</td>
                  <td>{formatDateLong(order.purchase_date)}</td>
                  <td>{order.item_count || 0}</td>
                  <td className="text-right mono">{formatMoney(order.total_amount)}</td>
                  <td>
                    <div>{formatDateTimeFriendly(order.created_at)}</div>
                    {order.purchase_request_id ? (
                      <div style={{ color: "#6B7280" }}>
                        PR #{order.purchase_request_id}
                        {order.catering_order_id ? ` | Catering #${order.catering_order_id}` : ""}
                      </div>
                    ) : null}
                    {order.inventory_posted_at ? <div style={{ color: "#16A34A" }}>Posted</div> : <div style={{ color: "#B45309" }}>Draft</div>}
                  </td>
                  <td>
                    <div className="rowActions">
                      <button className="btn btn-ghost" onClick={() => openDetails(order.id)}>View</button>
                      <button className="btn btn-ghost" onClick={() => setDeletingOrder(order)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No purchase receipts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">Weekly Spending History</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Week starting</th>
                <th className="text-right">Orders</th>
                <th className="text-right">Total spent</th>
              </tr>
            </thead>
            <tbody>
              {weeklyHistory.map((row) => (
                <tr key={row.week_start}>
                  <td>{formatDateLong(row.week_start)}</td>
                  <td className="text-right mono">{formatNumber(row.order_count || 0, 0)}</td>
                  <td className="text-right mono">{formatMoney(row.total_spent || 0)}</td>
                </tr>
              ))}
              {weeklyHistory.length === 0 && (
                <tr><td colSpan="3" style={{ padding: 12, opacity: 0.7 }}>No weekly history yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailOpen && (
        <div className="modalBackdrop" onClick={() => setDetailOpen(false)}>
          <div className="modalCard modalCard-wide" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Purchase Receipt Details</h3>
                {detailOrder && (
                  <div style={{ color: "#6B7280" }}>
                    {detailOrder.store_name} | {formatDateLong(detailOrder.purchase_date)} | {formatMoney(detailOrder.total_amount)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {detailOrder?.purchase_request_id ? (
                  <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/purchase-requests")}>
                    PR #{detailOrder.purchase_request_id}
                  </button>
                ) : null}
                {detailOrder?.catering_order_id ? (
                  <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/catering-orders")}>
                    Catering #{detailOrder.catering_order_id}
                  </button>
                ) : null}
                {!detailOrder?.inventory_posted_at ? (
                  <button className="btn btn-ghost" onClick={() => setDetailEditing((current) => !current)}>
                    {detailEditing ? "View Mode" : "Edit Draft"}
                  </button>
                ) : null}
                <button className="btn btn-ghost" onClick={() => setDetailOpen(false)}>X</button>
              </div>
            </div>

            {detailLoading ? (
              <div style={{ padding: 12 }}>Loading...</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 12, marginBottom: 12 }}>
                  <DetailCell label="Store" value={detailOrder?.store_name || "-"} />
                  <DetailCell label="Purchase date" value={detailOrder?.purchase_date ? formatDateLong(detailOrder.purchase_date) : "-"} />
                  <DetailCell label="Status" value={detailOrder?.inventory_posted_at ? "POSTED TO INVENTORY" : "DRAFT"} />
                  <DetailCell label="Total" value={formatMoney(detailOrder?.total_amount || 0)} />
                </div>

                {detailEditing && !detailOrder?.inventory_posted_at ? (
                  <>
                    <div className="formGrid">
                      <div>
                        <label>Supplier or store</label>
                        <input className="input" value={editStoreName} onChange={(event) => setEditStoreName(event.target.value)} />
                      </div>
                      <div>
                        <label>Purchase date</label>
                        <input className="input" type="date" value={editPurchaseDate} onChange={(event) => setEditPurchaseDate(event.target.value)} />
                      </div>
                    </div>
                    <div style={{ overflowX: "auto", marginTop: 12 }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Ingredient</th>
                            <th>Brand</th>
                            <th>Unit</th>
                            <th className="text-right">Quantity</th>
                            <th className="text-right">Purchase cost / unit</th>
                            <th className="text-right">Subtotal</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editItems.map((row) => (
                            <ItemRow key={row.key} row={row} onChange={updateEditRow} onRemove={removeEditRow} ingredients={ingredients} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => setEditItems((current) => [...current, makeEditableItem()])}>Add item</button>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-ghost" disabled={detailSaving} onClick={() => saveEditedOrder(false)}>Save draft</button>
                        <button type="button" className="btn btn-primary" disabled={detailSaving} onClick={() => saveEditedOrder(true)}>
                          {detailSaving ? "Saving..." : "Post to inventory"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ingredient</th>
                          <th>Brand</th>
                          <th>Unit</th>
                          <th className="text-right">Quantity</th>
                          <th className="text-right">Purchase cost / unit</th>
                          <th className="text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((item) => (
                          <tr key={item.id}>
                            <td>{item.ingredient_name ? String(item.ingredient_name).toUpperCase() : "-"}</td>
                            <td>{item.brand || "-"}</td>
                            <td>{item.unit || "-"}</td>
                            <td className="text-right mono">{round2(item.quantity || 0).toFixed(2)}</td>
                            <td className="text-right mono">{formatMoney(item.price || 0)}</td>
                            <td className="text-right mono">{formatMoney(item.subtotal || 0)}</td>
                          </tr>
                        ))}
                        {detailItems.length === 0 && (
                          <tr><td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No items found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deletingOrder)}
        title="Delete purchase receipt?"
        message={deletingOrder ? `Delete the purchase receipt from ${deletingOrder.store_name}?` : ""}
        confirmLabel="Delete Order"
        onCancel={() => setDeletingOrder(null)}
        onConfirm={confirmDeleteOrder}
      />
    </div>
  );
}

function DetailCell({ label, value }) {
  return (
    <div className="detailCell">
      <div className="detailCellLabel">{label}</div>
      <div className="detailCellValue">{value}</div>
    </div>
  );
}

const suggestionBox = {
  position: "absolute",
  left: 0,
  right: 0,
  top: "calc(100% + 6px)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  boxShadow: "0 18px 40px rgba(15,23,42,0.10)",
  overflow: "hidden",
  zIndex: 20,
};
const suggestionItem = {
  width: "100%",
  border: 0,
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  padding: 10,
  textAlign: "left",
  cursor: "pointer",
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
};
