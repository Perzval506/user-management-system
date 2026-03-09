import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";

export default function AdminMenuAdd() {
  const nav = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState({ menu_name: "", description: "", status: "ACTIVE" });
  const [saving, setSaving] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();

    if (!form.menu_name.trim()) {
      toast.push({ type: "error", title: "Missing field", message: "Menu name is required." });
      return;
    }

    try {
      setSaving(true);
      await api.post("/menu", {
        menu_name: form.menu_name.trim(),
        description: form.description.trim() || null,
        status: form.status || "ACTIVE",
      });

      toast.push({ type: "success", title: "Saved", message: "Menu item created." });
      nav("/admin/menu/manage");
    } catch (e) {
      toast.push({
        type: "error",
        title: "Create failed",
        message: e?.response?.data?.message || e?.message || "Create failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Add Menu Item</h2>
          <div className="pageSub">Create a new menu item for Boyd’s Pizza House.</div>
        </div>
      </div>

      <div className="card">
        <form onSubmit={onSubmit} className="formGrid">
          <div>
            <label>Menu name</label>
            <input
              className="input"
              value={form.menu_name}
              onChange={(e) => setForm({ ...form, menu_name: e.target.value })}
              placeholder="e.g., Pepperoni Pizza"
            />
          </div>

          <div>
            <label>Description (optional)</label>
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              style={{ minHeight: 90, resize: "vertical" }}
              placeholder="Short description..."
            />
          </div>

          <div>
            <label>Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Create"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => nav("/admin/menu/manage")}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}