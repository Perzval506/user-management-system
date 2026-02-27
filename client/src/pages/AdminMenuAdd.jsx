import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

export default function AdminMenuAdd() {
  const nav = useNavigate();
  const [form, setForm] = useState({ menu_name: "", description: "", status: "ACTIVE" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.menu_name.trim()) return setErr("Menu name is required");

    try {
      setSaving(true);
      await api.post("/menu", {
        menu_name: form.menu_name.trim(),
        description: form.description.trim() || null,
        status: form.status || "ACTIVE",
      });
      nav("/admin/menu/manage");
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "30px auto", padding: 16 }}>
      <h2>Add Menu Item</h2>
      {err && <div style={{ color: "var(--danger)", marginBottom: 8 }}>{err}</div>}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <div>
          <label>Menu name</label>
          <input value={form.menu_name} onChange={(e) => setForm({ ...form, menu_name: e.target.value })} className="input" />
        </div>

        <div>
          <label>Description (optional)</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" />
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
