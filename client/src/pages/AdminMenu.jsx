import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import RecipeBuilder from "../components/RecipeBuilder";
import ConfirmModal from "../components/ConfirmModal";
import CreateRecipeModal from "../components/CreateRecipeModal";
import { useNavigate } from "react-router-dom";

const emptyForm = {
  menu_name: "",
  description: "",
  status: "ACTIVE",
  price: "",
  size: "",
};

export default function AdminMenu() {
  const nav = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // modal
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  // recipe modal
  const [openRecipe, setOpenRecipe] = useState(false);
  const [recipeMenuId, setRecipeMenuId] = useState(null);

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((x) => x.status !== "INACTIVE");
  }, [items, showInactive]);

  async function load() {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const res = await api.get("/menu");
      setItems(res.data || []);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Failed to load menu items");
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
      menu_name: row.menu_name ?? "",
      description: row.description ?? "",
      status: row.status ?? "ACTIVE",
      price: "",
      size: "",
    });
    setOpen(true);
  }

  function openRecipeEditor(row) {
    setRecipeMenuId(row.id);
    setOpenRecipe(true);
  }

  function openCreateRecipe(row) {
    setRecipeMenuId(row.id);
    setCreateRecipeInitialName(row.menu_name || '');
    setShowCreateRecipe(true);
  }

  function handleCloseRecipe() {
    try {
      const key = `recipe_draft:${recipeMenuId}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        // show modal to confirm discard
        setShowConfirmDiscard(true);
        return;
      }
    } catch (e) {}
    setOpenRecipe(false);
  }

  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  function confirmDiscardAndClose() {
    try { localStorage.removeItem(`recipe_draft:${recipeMenuId}`); } catch (e) {}
    setShowConfirmDiscard(false);
    setOpenRecipe(false);
  }
  const [showCreateRecipe, setShowCreateRecipe] = useState(false);
  const [createRecipeInitialName, setCreateRecipeInitialName] = useState('');

  async function handleCreateRecipe({ recipe_name, recipe_description }) {
    try {
      await api.post(`/menu/${recipeMenuId}/create-recipe`, { recipe_name, recipe_description });
      setShowCreateRecipe(false);
      // open editor now that recipe exists
      setOpenRecipe(true);
      await load();
    } catch (e) {
      alert('Failed to create recipe');
    }
  }

  function closeModal() {
    setOpen(false);
    setMode("create");
    setEditingId(null);
    setForm(emptyForm);
  }

  function onChange(e) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setMsg("");

    if (!form.menu_name.trim()) {
      setError("Menu name is required.");
      return;
    }

    try {
      if (mode === "create") {
        let finalName = form.menu_name.trim();
        if (form.size && form.size.trim()) finalName = `${finalName} (${form.size.trim()})`;

        const payload = {
          menu_name: finalName,
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
        };
        if (form.price !== undefined && form.price !== null && form.price !== "") {
          const p = parseFloat(form.price);
          if (Number.isNaN(p)) { setError('Price must be numeric'); return; }
          payload.selling_price = p;
        }

        await api.post("/menu", payload);
        setMsg("Menu item created.");
      } else {
        await api.put(`/menu/${editingId}`, {
          menu_name: form.menu_name.trim(),
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
        });
        setMsg("Menu item updated.");
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
      await api.delete(`/menu/${row.id}`);
      setMsg("Menu item set to INACTIVE.");
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Deactivate failed");
    }
  }

  async function activate(row) {
    setError("");
    setMsg("");
    try {
      await api.put(`/menu/${row.id}`, {
        menu_name: row.menu_name,
        description: row.description || null,
        status: "ACTIVE",
      });
      setMsg("Menu item set to ACTIVE.");
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Activate failed");
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "30px auto", padding: 16, fontFamily: "Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Menu Management</h2>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            List + Create/Edit modal (one function at a time)
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => nav("/admin")} style={btnSecondary}>Back</button>
          <button onClick={load} style={btnSecondary}>Refresh</button>
          <button onClick={openCreate} style={btnPrimary}>Create Menu Item</button>
          
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
          Menu Items
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
                  <th align="left">Description</th>
                  <th align="left">Status</th>
                  <th align="left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid #444" }}>
                    <td>{row.menu_name}</td>
                    <td style={{ maxWidth: 520, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.description || "-"}
                    </td>
                    <td>{row.status}</td>
                    <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openEdit(row)} style={btnMini}>Edit</button>
                        {row.recipe_version_id ? (
                          <button onClick={() => openRecipeEditor(row)} style={btnMini}>Edit Recipe</button>
                        ) : (
                          <button onClick={() => openCreateRecipe(row)} style={btnMini}>Create Recipe</button>
                        )}
                        <button onClick={async () => {
                          const price = prompt('Enter new selling price:');
                          if (!price) return;
                          const val = parseFloat(price);
                          if (Number.isNaN(val)) { alert('Invalid price'); return; }
                          try { await api.post(`/menu/${row.id}/price`, { selling_price: val }); alert('Price updated'); await load(); } catch(e){ alert('Price update failed'); }
                        }} style={btnMini}>Update Price</button>

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
                    <td colSpan="4" style={{ opacity: 0.8 }}>
                      No menu items found.
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
              <h3 style={{ margin: 0 }}>{mode === "create" ? "Create Menu Item" : "Edit Menu Item"}</h3>
              <button onClick={closeModal} style={btnGhost}>✕</button>
            </div>

            <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <div style={fieldWrap}>
                <label style={label}>Menu Name</label>
                <input
                  name="menu_name"
                  value={form.menu_name}
                  onChange={onChange}
                  style={input}
                  placeholder="e.g., Pepperoni Pizza"
                />
              </div>

              {mode === 'create' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                  <div style={fieldWrap}>
                    <label style={label}>Size (optional)</label>
                    <select name="size" value={form.size} onChange={onChange} style={input}>
                      <option value="">None</option>
                      <option value="Double">Double</option>
                      <option value="Family">Family</option>
                      <option value="Regular">Regular</option>
                    </select>
                  </div>

                  <div style={fieldWrap}>
                    <label style={label}>Price (optional)</label>
                    <input name="price" value={form.price} onChange={onChange} style={input} placeholder="0.00" />
                  </div>
                </div>
              )}

              <div style={fieldWrap}>
                <label style={label}>Description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onChange}
                  style={{ ...input, minHeight: 90, resize: "vertical" }}
                  placeholder="Short description (optional)"
                />
              </div>

              <div style={fieldWrap}>
                <label style={label}>Status</label>
                <select name="status" value={form.status} onChange={onChange} style={input}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
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

      {openRecipe && recipeMenuId && (
        <div style={modalBackdrop} onClick={() => handleCloseRecipe()}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Recipe Builder</h3>
              <button onClick={() => handleCloseRecipe()} style={btnGhost}>✕</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <RecipeBuilder menuId={recipeMenuId} onClose={async () => { setOpenRecipe(false); await load(); }} />
            </div>
          </div>
        </div>
      )}
      <CreateRecipeModal open={showCreateRecipe} initialName={createRecipeInitialName} onCancel={() => setShowCreateRecipe(false)} onCreate={handleCreateRecipe} />
      <ConfirmModal open={showConfirmDiscard} title="Discard changes?" message="You have unsaved recipe changes. Discard them and close?" onConfirm={confirmDiscardAndClose} onCancel={() => setShowConfirmDiscard(false)} />
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
