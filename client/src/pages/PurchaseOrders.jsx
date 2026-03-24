import React, { useEffect, useMemo, useReducer, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateLong, formatMoney, round2, formatDateTimeFriendly } from "../utils/formatters";

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

  function handleIngredientChange(e) {
    const id = Number(e.target.value) || null;
    const sel = ingredients.find((i) => i.id === id);
    onChange(row.key, {
      ingredientId: id,
      ingredientName: sel ? sel.ingredient_name : "",
      unit: sel ? sel.base_unit || sel.base_unit_qty || "" : "",
    });
  }

  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <select className="input" value={row.ingredientId || ""} onChange={handleIngredientChange}>
          <option value="">-- select ingredient --</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>{i.ingredient_name}</option>
          ))}
        </select>
      </td>
      <td><input className="input" value={row.brand} onChange={(e) => onChange(row.key, { brand: e.target.value })} /></td>
      <td><input className="input" value={row.unit} onChange={(e) => onChange(row.key, { unit: e.target.value })} /></td>
      <td className="text-right"><input className="input text-right" type="number" step="0.01" min="0" value={row.quantity} onChange={(e) => onChange(row.key, { quantity: e.target.value })} /></td>
      <td className="text-right"><input className="input text-right" type="number" step="0.01" min="0" value={row.price} onChange={(e) => onChange(row.key, { price: e.target.value })} /></td>
      <td className="text-right mono">{formatMoney(subtotal)}</td>
      <td><button className="btn btn-ghost" onClick={() => onRemove(row.key)}>✕</button></td>
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

  const totalAmount = useMemo(
    () => round2(items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.price || 0), 0)),
    [items]
  );

  useEffect(() => {
    loadOrders();
    loadIngredients();
    if (items.length === 0) dispatch({ type: "add" });
  }, []);

  async function loadIngredients() {
    try {
      const res = await api.get("/ingredients");
      setIngredients(res.data || []);
    } catch (err) {
      toast.push({ type: "error", title: "Load failed", message: err?.response?.data?.message || err.message });
    }
  }

  async function loadOrders() {
    try {
      const res = await api.get("/purchase-orders");
      setOrders(res.data || []);
    } catch (err) {
      toast.push({ type: "error", title: "Load failed", message: err?.response?.data?.message || err.message });
    }
  }

  function updateRow(key, patch) {
    dispatch({ type: "update", key, patch });
  }

  function removeRow(key) {
    dispatch({ type: "remove", key });
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!storeName.trim()) return toast.push({ type: "error", title: "Missing store", message: "Store name is required." });
    if (items.length === 0) return toast.push({ type: "error", title: "Missing items", message: "Add at least one item." });

    const payloadItems = items.map((it) => ({
      ingredientId: it.ingredientId,
      ingredientName: it.ingredientName,
      brand: it.brand,
      unit: it.unit,
      quantity: round2(it.quantity || 0),
      price: round2(it.price || 0),
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
    } catch (err) {
      toast.push({ type: "error", title: "Save failed", message: err?.response?.data?.message || err.message });
    } finally {
      setSaving(false);
    }
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
    } catch (err) {
      toast.push({ type: "error", title: "Load failed", message: err?.response?.data?.message || err.message });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchase Orders</h2>
          <div className="pageSub">Record receipts (“resibo”) with item details.</div>
        </div>
        <div className="badge mono">Total: {formatMoney(totalAmount)}</div>
      </div>

      <div className="card">
        <form onSubmit={onSubmit} className="formGrid">
          <div>
            <label>Store Name</label>
            <input className="input" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="e.g., Sari-sari ni Aling Nena" />
          </div>
          <div>
            <label>Purchase Date</label>
            <input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            <div style={{ color: "#6B7280", marginTop: 4 }}>{formatDateLong(purchaseDate)}</div>
          </div>
        </form>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Brand</th>
                <th>Unit</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
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

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <button className="btn" type="button" onClick={() => dispatch({ type: "add" })}>Add item</button>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <strong>Total:</strong>
            <span className="mono">{formatMoney(totalAmount)}</span>
            <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>{saving ? "Saving..." : "Save PO"}</button>
          </div>
        </div>
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
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.store_name}</td>
                  <td>{formatDateLong(o.purchase_date)}</td>
                  <td>{o.item_count || 0}</td>
                  <td className="text-right mono">{formatMoney(o.total_amount)}</td>
                  <td>{formatDateTimeFriendly(o.created_at)}</td>
                  <td><button className="btn btn-ghost" onClick={() => openDetails(o.id)}>View</button></td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No purchase orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailOpen && (
        <div style={modalBackdrop} onClick={() => setDetailOpen(false)}>
          <div style={modalWideCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <h3 style={{ margin: 0 }}>Purchase Order Details</h3>
                {detailOrder && (
                  <div style={{ color: "#6B7280" }}>
                    {detailOrder.store_name} • {formatDateLong(detailOrder.purchase_date)} • {formatMoney(detailOrder.total_amount)}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost" onClick={() => setDetailOpen(false)}>✕</button>
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
                      <th className="text-right">Qty</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailItems.map((it) => (
                      <tr key={it.id}>
                        <td>{it.ingredient_name || "-"}</td>
                        <td>{it.brand || "-"}</td>
                        <td>{it.unit || "-"}</td>
                        <td className="text-right mono">{round2(it.quantity || 0).toFixed(2)}</td>
                        <td className="text-right mono">{formatMoney(it.price || 0)}</td>
                        <td className="text-right mono">{formatMoney(it.subtotal || 0)}</td>
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
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "grid",
  placeItems: "center",
  padding: 12,
  zIndex: 9999,
};

const modalWideCard = {
  width: "min(920px, 100%)",
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  maxHeight: "90vh",
  overflowY: "auto",
};
