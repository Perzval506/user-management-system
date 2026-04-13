import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
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

export default function PurchaseOrders() {
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

  async function openDetails(id) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailOrder(null);
    setDetailItems([]);
    try {
      const res = await api.get(`/purchase-orders/${id}`);
      setDetailOrder(res.data?.order || null);
      setDetailItems(res.data?.items || []);
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

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchase Orders</h2>
          <div className="pageSub">Record supplier receipts with quantities, unit prices, and item-level totals.</div>
        </div>
        <div className="badge mono">This week: {formatMoney(weeklyTotal)}</div>
      </div>

      <div className="card">
        {/* UX cleanup: one form and one save action makes purchase-order entry less confusing. */}
        <form onSubmit={onSubmit}>
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            Use this screen for receipts with several line items. If you only bought one ingredient quickly, use the Purchases screen instead.
          </div>

          <div className="formGrid">
            <div>
              <label>Store Name</label>
              <input className="input" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="e.g., Sari-sari ni Aling Nena" />
            </div>
            <div>
              <label>Purchase Date</label>
              <input className="input" type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
              <div style={{ color: "#6B7280", marginTop: 4 }}>{formatDateLong(purchaseDate)}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700 }}>Receipt items</div>
              <div style={{ color: "#6B7280" }}>Type an ingredient name and click a suggested match, then review the auto-filled brand, unit, and recent unit price. Incomplete rows will not be saved.</div>
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
                  <th className="text-right">Unit Price</th>
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
              <button className="btn btn-primary" type="button" disabled={saving} onClick={submitPurchaseOrder}>{saving ? "Saving..." : "Save purchase order"}</button>
            </div>
          </div>
        </form>
      </div>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">Recent Purchase Orders</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Purchase Date</th>
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
                  <td>{formatDateTimeFriendly(order.created_at)}</td>
                  <td>
                    <div className="rowActions">
                      <button className="btn btn-ghost" onClick={() => openDetails(order.id)}>View</button>
                      <button className="btn btn-ghost" onClick={() => setDeletingOrder(order)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No purchase orders yet.</td></tr>
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
                <tr><td colSpan="3" style={{ padding: 12, opacity: 0.7 }}>Weekly purchase-order history will appear here once records exist.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailOpen && (
        <div style={modalBackdrop} onClick={() => setDetailOpen(false)}>
          <div style={modalWideCard} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Purchase Order Details</h3>
                {detailOrder && (
                  <div style={{ color: "#6B7280" }}>
                    {detailOrder.store_name} | {formatDateLong(detailOrder.purchase_date)} | {formatMoney(detailOrder.total_amount)}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost" onClick={() => setDetailOpen(false)}>X</button>
            </div>

            {detailLoading ? (
              <div style={{ padding: 12 }}>Loading...</div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Brand</th>
                      <th>Unit</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Unit Price</th>
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
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deletingOrder)}
        title="Delete purchase order?"
        message={deletingOrder ? `Delete the purchase order from ${deletingOrder.store_name}?` : ""}
        confirmLabel="Delete Order"
        onCancel={() => setDeletingOrder(null)}
        onConfirm={confirmDeleteOrder}
      />
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.24)",
  display: "grid",
  placeItems: "center",
  padding: 12,
  zIndex: 200000,
};

const modalWideCard = {
  width: "min(920px, 100%)",
  background: "var(--surface)",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  maxHeight: "90vh",
  overflowY: "auto",
};
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
