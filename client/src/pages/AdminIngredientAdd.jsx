import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import useUnits from "../hooks/useUnits";

export default function AdminIngredientAdd() {
  const nav = useNavigate();
  const [form, setForm] = useState({ ingredient_name: "", category: "", base_unit: "", base_unit_qty: "", status: "ACTIVE" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const units = useUnits();

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.ingredient_name.trim()) return setErr("Ingredient name is required");
    if (!form.base_unit_qty && form.base_unit_qty !== 0) return setErr("Base unit quantity is required");
    const qty = Number(String(form.base_unit_qty).trim());
    if (!isFinite(qty) || qty <= 0) return setErr("Base unit quantity must be a number greater than 0");
    if (!form.base_unit.trim()) return setErr("Base unit is required");
    const bu = String(form.base_unit).trim().toLowerCase();
    if (!units.length) return setErr('Units not loaded');
    if (!units.includes(bu)) return setErr(`Invalid base unit. Allowed: ${units.join(',')}`);

    try {
      setSaving(true);
        await api.post("/ingredients", {
          ingredient_name: form.ingredient_name.trim(),
          category: form.category.trim() || null,
          base_unit: bu,
          base_unit_qty: qty,
          status: form.status || "ACTIVE",
        });
      nav("/admin/items/manage");
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "30px auto", padding: 16 }}>
      <h2>Add Ingredient</h2>
      {err && <div style={{ color: "var(--danger)", marginBottom: 8 }}>{err}</div>}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <div>
          <label>Ingredient name</label>
          <input value={form.ingredient_name} onChange={(e) => setForm({ ...form, ingredient_name: e.target.value })} className="input" />
        </div>

        <div>
          <label>Category (optional)</label>
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input" />
        </div>

        <div>
          <label>Base unit size</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input name="base_unit_qty" value={form.base_unit_qty} onChange={(e) => setForm({ ...form, base_unit_qty: e.target.value })} className="input" type="number" step="0.001" min="0.001" placeholder="e.g., 1.000" />
            <select name="base_unit" value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} className="input">
              <option value="">-- select unit --</option>
              {units.map(u => (<option key={u} value={u}>{u}</option>))}
            </select>
          </div>
        </div>

        <div>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Create"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => nav('/admin')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
