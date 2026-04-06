import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

export default function Purchases() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingredients, setIngredients] = useState([]);
  const [form, setForm] = useState({ ingredientName: "", quantity: "", price: "" });

  const total = useMemo(() => items.reduce((sum, row) => sum + Number(row.price || 0), 0), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [purchasesResponse, ingredientsResponse] = await Promise.all([api.get("/purchases"), api.get("/ingredients")]);
      setItems(purchasesResponse.data?.items || []);
      setIngredients(ingredientsResponse.data || []);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load purchases",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function onChange(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submitPurchase() {
    if (!form.ingredientName.trim()) return toast.push({ type: "error", title: "Missing field", message: "Ingredient is required." });
    const qty = Number(form.quantity);
    const price = Number(form.price);
    if (!isFinite(qty) || qty <= 0) return toast.push({ type: "error", title: "Invalid quantity", message: "Quantity must be greater than 0." });
    if (!isFinite(price) || price < 0) return toast.push({ type: "error", title: "Invalid price", message: "Price must be zero or more." });

    setSaving(true);
    try {
      await api.post("/purchases", {
        ingredientName: form.ingredientName.trim(),
        quantity: qty,
        price,
      });
      toast.push({ type: "success", title: "Saved", message: "Purchase recorded." });
      setForm({ ingredientName: "", quantity: "", price: "" });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    submitPurchase();
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchases</h2>
          <div className="pageSub">Log quick single-ingredient buys and keep inventory in sync.</div>
        </div>

        <div className="pageActions">
          <div className="badge" style={{ background: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.25)" }}>
            Total spent: {formatMoney(total)}
          </div>
        </div>
      </div>

      <div className="card">
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 12,
            background: "#f8fafc",
            border: "1px solid rgba(15,23,42,0.08)",
            color: "#475569",
            lineHeight: 1.5,
          }}
        >
          Use this for one quick ingredient purchase. If the receipt has several line items, record it in Purchase Orders instead.
        </div>

        <form className="formGrid" onSubmit={onSubmit}>
          <div>
            <label>Ingredient</label>
            <select name="ingredientName" value={form.ingredientName} onChange={onChange} className="input">
              <option value="">-- select ingredient --</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.ingredient_name}>{ingredient.ingredient_name}</option>
              ))}
            </select>
          </div>

          <div className="formRow2">
            <div>
              <label>Quantity</label>
              <input name="quantity" value={form.quantity} onChange={onChange} className="input" type="number" step="0.01" min="0.01" placeholder="0.00" />
            </div>
            <div>
              <label>Total cost</label>
              <input name="price" value={form.price} onChange={onChange} className="input" type="number" step="0.01" min="0" placeholder="0.00" />
              <div style={{ color: "#6B7280", marginTop: 4, fontSize: 13 }}>
                Enter the total amount paid for this single purchase.
              </div>
            </div>
          </div>

          <div>
            <label>Recorded at</label>
            <div className="input" style={{ background: "#f8fafc" }}>{formatDateTimeFriendly(new Date())}</div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={submitPurchase}>
              {saving ? "Saving..." : "Save purchase"}
            </button>
          </div>
        </form>
      </div>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">Recent Purchases</div>
        {loading ? (
          <div style={{ padding: 14 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Quantity</th>
                  <th>Total cost</th>
                  <th>Created at</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.ingredient_name}</td>
                    <td className="text-right mono">{formatNumber(row.quantity || 0)}</td>
                    <td className="text-right mono">{formatMoney(row.price || 0)}</td>
                    <td>{row.createdAt ? formatDateTimeFriendly(row.createdAt) : "-"}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan="4" style={{ padding: 14, opacity: 0.7 }}>No purchases yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
