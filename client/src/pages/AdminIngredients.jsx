import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useNavigate } from "react-router-dom";
import useUnits from "../hooks/useUnits";

const emptyForm = {
  ingredient_name: "",
  category: "",
  base_unit: "",
  base_unit_qty: "",
  status: "ACTIVE",
};

export default function AdminIngredients() {
  const nav = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [showInactive, setShowInactive] = useState(false);

  // modal state
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  // units from server meta endpoint
  const units = useUnits();

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((x) => x.status !== "INACTIVE");
  }, [items, showInactive]);

  async function load() {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const res = await api.get("/ingredients");
      setItems(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Failed to load ingredients");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    setError("");
    setMsg("");

    if (!form.ingredient_name.trim()) {
      setError("Ingredient name is required.");
      return;
    }
    if (!form.base_unit_qty && form.base_unit_qty !== 0) { setError("Base unit quantity is required."); return; }
    const qty = Number(String(form.base_unit_qty).trim());
    if (!isFinite(qty) || qty <= 0) { setError("Base unit quantity must be a number greater than 0."); return; }
    if (!form.base_unit.trim()) { setError("Base unit is required."); return; }
    const bu = String(form.base_unit).trim().toLowerCase();
    if (!units.length) { setError(`Units not loaded`); return; }
    if (!units.includes(bu)) { setError(`Invalid base unit. Allowed: ${units.join(',')}`); return; }

    try {
      if (mode === "create") {
        await api.post("/ingredients", {
          ingredient_name: form.ingredient_name.trim(),
          category: form.category.trim() || null,
          base_unit: bu,
          base_unit_qty: qty,
          status: form.status || "ACTIVE",
        });
        setMsg("Ingredient created.");
      } else {
        await api.put(`/ingredients/${editingId}`, {
          ingredient_name: form.ingredient_name.trim(),
          category: form.category.trim() || null,
          base_unit: bu,
          base_unit_qty: qty,
          status: form.status || "ACTIVE",
        });
        setMsg("Ingredient updated.");
      }

      closeModal();
      await load();
    } catch (e2) {
      setError(e2?.response?.data?.message || e2.message || "Save failed");
    }
  }

  async function deactivate(row) {
    setError("");
    setMsg("");
    try {
      await api.delete(`/ingredients/${row.id}`);
      setMsg("Ingredient set to INACTIVE.");
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Deactivate failed");
    }
  }

  async function activate(row) {
    setError("");
    setMsg("");
    try {
      // your backend has no activate endpoint, so we use PUT and set status back to ACTIVE
      await api.put(`/ingredients/${row.id}`, {
        ingredient_name: row.ingredient_name,
        category: row.category || null,
        base_unit: row.base_unit,
        status: "ACTIVE",
      });
      setMsg("Ingredient set to ACTIVE.");
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Activate failed");
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "30px auto", padding: 16, fontFamily: "Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Ingredient Management</h2>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            List + Create/Edit modal (one function at a time)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => nav("/admin")} style={btnSecondary}>Back</button>
          <button onClick={load} style={btnSecondary}>Refresh</button>
          <button onClick={openCreate} style={btnPrimary}>Create Ingredient</button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show INACTIVE
        </label>
      </div>

      {error && <div style={alertErr}>{error}</div>}
      {msg && <div style={alertOk}>{msg}</div>}

      <div style={{ marginTop: 14, border: "1px solid #333", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ background: "#1f1f1f", color: "white", padding: "10px 12px", fontWeight: 700 }}>
          Ingredients
        </div>

        {loading ? (
          <div style={{ padding: 14 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table width="100%" cellPadding="10" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#2b2b2b", color: "white" }}>
                  {/* ✅ No ID column */}
                  <th align="left">Name</th>
                  <th align="left">Category</th>
                  <th align="left">Base unit size</th>
                  <th align="left">Status</th>
                  <th align="left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid #444" }}>
                    <td>{row.ingredient_name}</td>
                    <td>{row.category || "-"}</td>
                    <td>{row.base_unit_qty ? `${row.base_unit_qty} ${row.base_unit}` : (row.base_unit || '-')}</td>
                    <td>{row.status}</td>
                    <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openEdit(row)} style={btnMini}>Edit</button>

                      {row.status === "INACTIVE" ? (
                        <button onClick={() => activate(row)} style={btnMini}>Activate</button>
                      ) : (
                        <button onClick={() => deactivate(row)} style={btnMiniDanger}>Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}

                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ opacity: 0.8 }}>
                      No ingredients found.
                    </td>
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
              <button onClick={closeModal} style={btnGhost}>✕</button>
            </div>

            <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={fieldWrap}>
                <label style={label}>Ingredient Name</label>
                <input
                  name="ingredient_name"
                  value={form.ingredient_name}
                  onChange={onChange}
                  style={input}
                  placeholder="e.g., Flour"
                />
              </div>

              <div style={fieldWrap}>
                <label style={label}>Category</label>
                <input
                  name="category"
                  value={form.category}
                  onChange={onChange}
                  style={input}
                  placeholder="e.g., Baking"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={fieldWrap}>
                  <label style={label}>Base unit size</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input name="base_unit_qty" value={form.base_unit_qty} onChange={onChange} style={input} type="number" step="0.001" min="0.001" placeholder="e.g., 1.000" />
                    <select name="base_unit" value={form.base_unit} onChange={onChange} style={input}>
                      <option value="">-- select unit --</option>
                      {units.map(u => (<option key={u} value={u}>{u}</option>))}
                    </select>
                  </div>
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Status</label>
                  <select name="status" value={form.status} onChange={onChange} style={input}>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" onClick={closeModal} style={btnSecondary}>Cancel</button>
                <button type="submit" style={btnPrimary}>
                  {mode === "create" ? "Create" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* styles */
const btnPrimary = { padding: "10px 14px", borderRadius: 10, border: "none", background: "black", color: "white", cursor: "pointer" };
const btnSecondary = { padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.35)", background: "white", cursor: "pointer", fontWeight: 700 };
const btnGhost = { padding: "8px 12px", borderRadius: 10, border: "1px solid #999", background: "transparent", cursor: "pointer" };
const btnMini = { padding: "6px 10px", borderRadius: 10, border: "1px solid #555", background: "white", cursor: "pointer" };
const btnMiniDanger = { padding: "6px 10px", borderRadius: 10, border: "1px solid #b44", background: "white", cursor: "pointer" };

const alertErr = { marginTop: 12, padding: 12, borderRadius: 10, background: "#ffe5e5" };
const alertOk = { marginTop: 12, padding: 12, borderRadius: 10, background: "#e7ffe5" };

const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 12, zIndex: 9999 };
const modalCard = { width: "min(720px, 100%)", background: "white", borderRadius: 14, padding: 16, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" };

const fieldWrap = { display: "grid", gap: 6 };
const label = { fontSize: 13, opacity: 0.85 };
const input = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", outline: "none" };
