import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateTimeFriendly } from "../utils/formatters";

export default function Purchases() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingredients, setIngredients] = useState([]);
  const [form, setForm] = useState({ ingredientName: "", quantity: "", price: "" });

  const total = useMemo(() => items.reduce((sum, r) => sum + Number(r.price || 0), 0), [items]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [p, ing] = await Promise.all([api.get("/purchases"), api.get("/ingredients")]);
      setItems(p.data?.items || []);
      setIngredients(ing.data || []);
    } catch (e) {
      toast.push({ type: "error", title: "Load failed", message: e?.response?.data?.message || e.message || "Failed to load purchases" });
    } finally {
      setLoading(false);
    }
  }

  function onChange(e) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
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
    } catch (e2) {
      toast.push({ type: "error", title: "Save failed", message: e2?.response?.data?.message || e2.message || "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Purchases</h2>
          <div className="pageSub">Log palengke buys and keep inventory in sync.</div>
        </div>

        <div className="pageActions">
          <div className="badge" style={{ background: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.25)" }}>
            Total spent: PHP {total.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="card">
        <form className="formGrid" onSubmit={onSubmit}>
          <div>
            <label>Ingredient</label>
            <select
              name="ingredientName"
              value={form.ingredientName}
              onChange={onChange}
              className="input"
            >
              <option value="">-- select ingredient --</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.ingredient_name}>{i.ingredient_name}</option>
              ))}
            </select>
          </div>

          <div className="formRow2">
            <div>
              <label>Quantity</label>
              <input name="quantity" value={form.quantity} onChange={onChange} className="input" type="number" step="0.001" min="0.001" placeholder="0.000" />
            </div>
            <div>
              <label>Price</label>
              <input name="price" value={form.price} onChange={onChange} className="input" type="number" step="0.01" min="0" placeholder="0.00" />
            </div>
          </div>

          <div>
            <label>Recorded at</label>
            <div className="input" style={{ background: "#f8fafc" }}>{formatDateTimeFriendly(new Date())}</div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
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
                  <th>Price</th>
                  <th>Created at</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.ingredient_name}</td>
                    <td>{Number(row.quantity || 0).toFixed(2)}</td>
                    <td>PHP {Number(row.price || 0).toFixed(2)}</td>
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
