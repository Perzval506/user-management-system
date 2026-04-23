import React, { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

export default function Purchases() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingredients, setIngredients] = useState([]);
  const [form, setForm] = useState({ ingredientName: "", quantity: "", price: "" });
  const [weeklyHistory, setWeeklyHistory] = useState([]);
  const [weeklyTotal, setWeeklyTotal] = useState(0);
  const [deletingPurchase, setDeletingPurchase] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [purchasesResponse, ingredientsResponse] = await Promise.all([api.get("/purchases"), api.get("/ingredients")]);
      setItems(purchasesResponse.data?.items || []);
      setWeeklyHistory(purchasesResponse.data?.weeklyHistory || []);
      setWeeklyTotal(Number(purchasesResponse.data?.weeklyTotal || 0));
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
      const selectedIngredient = ingredients.find(
        (ingredient) => String(ingredient.ingredient_name || "").toUpperCase() === form.ingredientName.trim().toUpperCase()
      );
      if (!selectedIngredient) {
        return toast.push({ type: "error", title: "Missing ingredient", message: "Select a valid ingredient from the list." });
      }

      await api.post("/purchases", {
        ingredientId: selectedIngredient.id,
        ingredientName: form.ingredientName.trim().toUpperCase(),
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

  async function confirmDeletePurchase() {
    if (!deletingPurchase) return;
    try {
      await api.delete(`/purchases/${deletingPurchase.id}`);
      toast.push({ type: "success", title: "Deleted", message: "Purchase record deleted." });
      setDeletingPurchase(null);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Delete failed",
        message: error?.response?.data?.message || error.message || "Failed to delete purchase",
      });
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Quick Purchases</h2>
          <div className="pageSub">Single-ingredient purchase entries.</div>
        </div>

        <div className="pageActions">
          <div className="badge badge-active">
            This week: {formatMoney(weeklyTotal)}
          </div>
        </div>
      </div>

      <div className="card">
        <form className="formGrid" onSubmit={onSubmit}>
          <div>
            <label>Ingredient</label>
            <select name="ingredientName" value={form.ingredientName} onChange={onChange} className="input">
              <option value="">-- select ingredient --</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.ingredient_name}>{String(ingredient.ingredient_name || "").toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="formRow2">
            <div>
              <label>Quantity</label>
              <input name="quantity" value={form.quantity} onChange={onChange} className="input" type="number" step="0.01" min="0.01" placeholder="0.00" />
            </div>
            <div>
              <label>Amount paid</label>
              <input name="price" value={form.price} onChange={onChange} className="input" type="number" step="0.01" min="0" placeholder="0.00" />
              <div className="formNote">Total paid for this ingredient.</div>
            </div>
          </div>

          <div>
            <label>Recorded at</label>
            <div className="input">{formatDateTimeFriendly(new Date())}</div>
          </div>

          <div className="formActions">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={submitPurchase}>
              {saving ? "Saving..." : "Save purchase"}
            </button>
          </div>
        </form>
      </div>

      <div className="tableWrap inventoryCategoryTable">
        <div className="tableTopBar">Recent Purchases</div>
        {loading ? (
          <div className="tableLoading">Loading...</div>
        ) : (
          <div className="tableScroller">
            <table className="table quickPurchaseTable">
              <colgroup>
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th className="text-right">Quantity</th>
                <th className="text-right">Amount paid</th>
                  <th>Created at</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className="tableStrong">{row.ingredient_name}</td>
                    <td className="text-right mono">{formatNumber(row.quantity || 0)}</td>
                    <td className="text-right mono">{formatMoney(row.price || 0)}</td>
                    <td>{row.createdAt ? formatDateTimeFriendly(row.createdAt) : "-"}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => setDeletingPurchase(row)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan="5" className="tableEmpty">No purchases yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="tableWrap inventoryCategoryTable">
        <div className="tableTopBar">Weekly Spending History</div>
        <div className="tableScroller">
            <table className="table quickPurchaseHistoryTable">
              <colgroup>
                <col />
                <col style={{ width: 150 }} />
                <col style={{ width: 150 }} />
              </colgroup>
              <thead>
              <tr>
                <th>Week starting</th>
                <th className="text-right">Purchase count</th>
                <th className="text-right">Total spent</th>
              </tr>
            </thead>
            <tbody>
              {weeklyHistory.map((row) => (
                <tr key={row.week_start}>
                  <td>{formatDateLong(row.week_start)}</td>
                  <td className="text-right mono">{formatNumber(row.purchase_count || 0, 0)}</td>
                  <td className="text-right mono">{formatMoney(row.purchase_total || 0)}</td>
                </tr>
              ))}
              {weeklyHistory.length === 0 && (
                <tr>
                  <td colSpan="3" className="tableEmpty">No weekly history yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deletingPurchase)}
        title="Delete purchase?"
        message={deletingPurchase ? `Delete the purchase record for ${deletingPurchase.ingredient_name}?` : ""}
        confirmLabel="Delete Purchase"
        confirmVariant="danger"
        onCancel={() => setDeletingPurchase(null)}
        onConfirm={confirmDeletePurchase}
      />
    </div>
  );
}
