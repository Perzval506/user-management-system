import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

export default function AdminIngredientAdd() {
  const nav = useNavigate();
  const [form, setForm] = useState({ ingredient_name: "", category: "", base_unit: "pcs", status: "ACTIVE" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.ingredient_name.trim()) return setErr("Ingredient name is required");
    if (!form.base_unit.trim()) return setErr("Base unit is required");

    try {
      setSaving(true);
      await api.post("/ingredients", {
        ingredient_name: form.ingredient_name.trim(),
        category: form.category.trim() || null,
        base_unit: form.base_unit.trim(),
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
          <label>Base unit</label>
          <input value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })} className="input" />
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
