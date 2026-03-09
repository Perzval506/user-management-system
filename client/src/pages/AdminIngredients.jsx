import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useNavigate } from "react-router-dom";
import useUnits from "../hooks/useUnits";
import { useToast } from "../components/Toast";

const emptyForm = {
  ingredient_name: "",
  category: "",
  base_unit: "",
  base_unit_qty: "",
  status: "ACTIVE",
};

export default function AdminIngredients() {
  const nav = useNavigate();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showInactive, setShowInactive] = useState(false);

  // modal state
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const units = useUnits();

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((x) => x.status !== "INACTIVE");
  }, [items, showInactive]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/ingredients");
      setItems(res.data || []);
    } catch (e) {
      toast.push({ type: "error", title: "Load failed", message: e?.response?.data?.message || e.message || "Failed to load ingredients" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setMode("create");
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row) {
    setMode("edit");
    setEditingId(row.id);
    setForm({
      ingredient_name: row.ingredient_name ?? "",
      category: row.category ?? "",
      base_unit: row.base_unit ?? "",
      base_unit_qty: row.base_unit_qty ?? "",
      status: row.status ?? "ACTIVE",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditingId(null);
    setMode("create");
    setForm(emptyForm);
  }

  function onChange(e) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (!form.ingredient_name.trim()) return toast.push({ type: "error", title: "Missing field", message: "Ingredient name is required." });
    if (!form.base_unit_qty && form.base_unit_qty !== 0) return toast.push({ type: "error", title: "Missing field", message: "Base unit quantity is required." });

    const qty = Number(String(form.base_unit_qty).trim());
    if (!isFinite(qty) || qty <= 0) return toast.push({ type: "error", title: "Invalid value", message: "Base unit quantity must be greater than 0." });

    if (!form.base_unit.trim()) return toast.push({ type: "error", title: "Missing field", message: "Base unit is required." });

    const bu = String(form.base_unit).trim().toLowerCase();
    if (!units.length) return toast.push({ type: "error", title: "Units not loaded", message: "Try refreshing the page." });
    if (!units.includes(bu)) return toast.push({ type: "error", title: "Invalid unit", message: `Allowed: ${units.join(", ")}` });

    try {
      if (mode === "create") {
        await api.post("/ingredients", {
          ingredient_name: form.ingredient_name.trim(),
          category: form.category.trim() || null,
          base_unit: bu,
          base_unit_qty: qty,
          status: form.status || "ACTIVE",
        });
        toast.push({ type: "success", title: "Saved", message: "Ingredient created." });
      } else {
        await api.put(`/ingredients/${editingId}`, {
          ingredient_name: form.ingredient_name.trim(),
          category: form.category.trim() || null,
          base_unit: bu,
          base_unit_qty: qty,
          status: form.status || "ACTIVE",
        });
        toast.push({ type: "success", title: "Saved", message: "Ingredient updated." });
      }

      closeModal();
      await load();
    } catch (e2) {
      toast.push({ type: "error", title: "Save failed", message: e2?.response?.data?.message || e2.message || "Save failed" });
    }
  }

  async function deactivate(row) {
    try {
      await api.delete(`/ingredients/${row.id}`);
      toast.push({ type: "success", title: "Updated", message: "Ingredient set to INACTIVE." });
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Deactivate failed", message: e?.response?.data?.message || e.message || "Deactivate failed" });
    }
  }

  async function activate(row) {
    try {
      await api.put(`/ingredients/${row.id}`, {
        ingredient_name: row.ingredient_name,
        category: row.category || null,
        base_unit: row.base_unit,
        base_unit_qty: row.base_unit_qty,
        status: "ACTIVE",
      });
      toast.push({ type: "success", title: "Updated", message: "Ingredient set to ACTIVE." });
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Activate failed", message: e?.response?.data?.message || e.message || "Activate failed" });
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Ingredient Management</h2>
          <div className="pageSub">Manage ingredients used in menu costing & recipes.</div>
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" onClick={() => nav("/admin")}>Back</button>
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={openCreate}>Create Ingredient</button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show INACTIVE
        </label>
      </div>

      <div className="tableWrap">
        <div className="tableTopBar">Ingredients</div>

        {loading ? (
          <div style={{ padding: 14 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Base unit size</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 800 }}>{row.ingredient_name}</td>
                    <td>{row.category || "-"}</td>
                    <td>{row.base_unit_qty ? `${row.base_unit_qty} ${row.base_unit}` : (row.base_unit || "-")}</td>
                    <td>
                      <span className={`badge ${row.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openEdit(row)}>Edit</button>
                        {row.status === "INACTIVE" ? (
                          <button className="btn" onClick={() => activate(row)}>Activate</button>
                        ) : (
                          <button className="btn" onClick={() => deactivate(row)}>Deactivate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ opacity: 0.8, padding: 14 }}>No ingredients found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {open && (
        <div style={modalBackdrop} onClick={closeModal}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{mode === "create" ? "Create Ingredient" : "Edit Ingredient"}</h3>
              <button className="btn btn-ghost" onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={onSubmit} className="formGrid">
              <div>
                <label>Ingredient Name</label>
                <input name="ingredient_name" value={form.ingredient_name} onChange={onChange} className="input" placeholder="e.g., Flour" />
              </div>

              <div>
                <label>Category</label>
                <input name="category" value={form.category} onChange={onChange} className="input" placeholder="e.g., Baking" />
              </div>

              <div>
                <label>Base unit size</label>
                <div className="formRow2">
                  <input name="base_unit_qty" value={form.base_unit_qty} onChange={onChange} className="input" type="number" step="0.001" min="0.001" placeholder="e.g., 1.000" />
                  <select name="base_unit" value={form.base_unit} onChange={onChange} className="input">
                    <option value="">-- select unit --</option>
                    {units.map((u) => (<option key={u} value={u}>{u}</option>))}
                  </select>
                </div>
              </div>

              <div>
                <label>Status</label>
                <select name="status" value={form.status} onChange={onChange} className="input">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary">{mode === "create" ? "Create" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 12, zIndex: 9999 };
const modalCard = { width: "min(720px, 100%)", background: "white", borderRadius: 14, padding: 16, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" };