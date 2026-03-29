import React, { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import RecipeBuilder from "../components/RecipeBuilder";
import ConfirmModal from "../components/ConfirmModal";
import CreateRecipeModal from "../components/CreateRecipeModal";
import { useToast } from "../components/Toast";

const emptyForm = {
  menu_name: "",
  description: "",
  status: "ACTIVE",
  price: "",
  size: "",
};

export default function AdminMenu() {
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // create/edit modal
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);
  const [editingHasRecipe, setEditingHasRecipe] = useState(false);
  const [editingMenuName, setEditingMenuName] = useState("");
  const [form, setForm] = useState(emptyForm);

  // recipe modal
  const [openRecipe, setOpenRecipe] = useState(false);
  const [recipeMenuId, setRecipeMenuId] = useState(null);

  // confirm discard recipe draft
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  // create recipe modal
  const [showCreateRecipe, setShowCreateRecipe] = useState(false);
  const [createRecipeInitialName, setCreateRecipeInitialName] = useState("");

  // update price modal (replaces prompt())
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceMenuId, setPriceMenuId] = useState(null);
  const [priceValue, setPriceValue] = useState("");

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((x) => x.status !== "INACTIVE");
  }, [items, showInactive]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/menu");
      setItems(res.data || []);
    } catch (e) {
      toast.push({ type: "error", title: "Load failed", message: e?.response?.data?.message || e.message || "Failed to load menu items" });
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
    setEditingHasRecipe(false);
    setEditingMenuName("");
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(row) {
    setMode("edit");
    setEditingId(row.id);
    setEditingHasRecipe(Boolean(row.recipe_version_id));
    setEditingMenuName(row.menu_name ?? "");
    setForm({
      menu_name: row.menu_name ?? "",
      description: row.description ?? "",
      status: row.status ?? "ACTIVE",
      price: "",
      size: "",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setMode("create");
    setEditingId(null);
    setEditingHasRecipe(false);
    setEditingMenuName("");
    setForm(emptyForm);
  }

  function onChange(e) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();

    if (!form.menu_name.trim()) {
      toast.push({ type: "error", title: "Missing field", message: "Menu name is required." });
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
          if (Number.isNaN(p)) {
            toast.push({ type: "error", title: "Invalid price", message: "Price must be numeric." });
            return;
          }
          payload.selling_price = p;
        }

        await api.post("/menu", payload);
        toast.push({ type: "success", title: "Saved", message: "Menu item created." });
      } else {
        await api.put(`/menu/${editingId}`, {
          menu_name: form.menu_name.trim(),
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
        });
        toast.push({ type: "success", title: "Saved", message: "Menu item updated." });
      }

      closeModal();
      await load();
    } catch (e2) {
      toast.push({ type: "error", title: "Save failed", message: e2?.response?.data?.message || e2.message || "Save failed" });
    }
  }

  async function deactivate(row) {
    try {
      await api.delete(`/menu/${row.id}`);
      toast.push({ type: "success", title: "Updated", message: "Menu item set to INACTIVE." });
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Deactivate failed", message: e?.response?.data?.message || e.message || "Deactivate failed" });
    }
  }

  async function activate(row) {
    try {
      await api.put(`/menu/${row.id}`, {
        menu_name: row.menu_name,
        description: row.description || null,
        status: "ACTIVE",
      });
      toast.push({ type: "success", title: "Updated", message: "Menu item set to ACTIVE." });
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Activate failed", message: e?.response?.data?.message || e.message || "Activate failed" });
    }
  }

  function openRecipeEditor(row) {
    setRecipeMenuId(row.id);
    setOpenRecipe(true);
  }

  function openCreateRecipe(row) {
    setRecipeMenuId(row.id);
    setCreateRecipeInitialName(row.menu_name || "");
    setShowCreateRecipe(true);
  }

  function openRecipeFromEditModal() {
    if (!editingId) return;
    const targetId = editingId;
    const hasRecipe = editingHasRecipe;
    const nameFromForm = String(form.menu_name || "").trim();
    const initialName = nameFromForm || editingMenuName || "";

    closeModal();

    if (hasRecipe) {
      openRecipeEditor({ id: targetId });
      return;
    }

    openCreateRecipe({ id: targetId, menu_name: initialName });
  }

  function handleCloseRecipe() {
    try {
      const key = `recipe_draft:${recipeMenuId}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        setShowConfirmDiscard(true);
        return;
      }
    } catch (e) {}
    setOpenRecipe(false);
  }

  function confirmDiscardAndClose() {
    try { localStorage.removeItem(`recipe_draft:${recipeMenuId}`); } catch (e) {}
    setShowConfirmDiscard(false);
    setOpenRecipe(false);
  }

  async function handleCreateRecipe({ recipe_name, recipe_description }) {
    try {
      await api.post(`/menu/${recipeMenuId}/create-recipe`, { recipe_name, recipe_description });
      toast.push({ type: "success", title: "Created", message: "Recipe created successfully." });
      setShowCreateRecipe(false);
      setOpenRecipe(true);
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Create recipe failed", message: e?.response?.data?.message || "Failed to create recipe" });
    }
  }

  // Price modal functions
  function openPrice(row) {
    setPriceMenuId(row.id);
    setPriceValue("");
    setPriceOpen(true);
  }

  async function submitPrice() {
    const val = parseFloat(priceValue);
    if (Number.isNaN(val)) {
      toast.push({ type: "error", title: "Invalid price", message: "Please enter a numeric value." });
      return;
    }

    try {
      await api.post(`/menu/${priceMenuId}/price`, { selling_price: val });
      toast.push({ type: "success", title: "Updated", message: "Price updated successfully." });
      setPriceOpen(false);
      await load();
    } catch (e) {
      toast.push({ type: "error", title: "Update failed", message: e?.response?.data?.message || "Price update failed" });
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Menu Management</h2>
          <div className="pageSub">Manage menu items and recipes.</div>
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={openCreate}>Create Menu Item</button>
        </div>
      </div>

      <div className="tableFilterBar">
        <label className="toggleRow">
          <span className="toggleControl">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span className="toggleSlider" />
          </span>
          <span className="toggleText">Show INACTIVE</span>
        </label>
      </div>

      <div className="tableWrap">
        <div className="tableTopBar">Menu Items</div>

        {loading ? (
          <div style={{ padding: 14 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 800 }}>{row.menu_name}</td>
                    <td style={{ maxWidth: 520, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {row.description || "-"}
                    </td>
                    <td>
                      <span className={`badge ${row.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {row.status}
                      </span>
                    </td>

                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openEdit(row)}>Edit</button>
                        <button className="btn" onClick={() => openPrice(row)}>Update Price</button>

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
                    <td colSpan="4" style={{ opacity: 0.8, padding: 14 }}>
                      No menu items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {open && (
        <div style={modalBackdrop} onClick={closeModal}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{mode === "create" ? "Create Menu Item" : "Edit Menu Item"}</h3>
              <button className="btn btn-ghost" onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={onSubmit} className="formGrid">
              <div>
                <label>Menu Name</label>
                <input name="menu_name" value={form.menu_name} onChange={onChange} className="input" placeholder="e.g., Pepperoni Pizza" />
              </div>

              {mode === "create" && (
                <div className="formRow2">
                  <div>
                    <label>Size (optional)</label>
                    <select name="size" value={form.size} onChange={onChange} className="input">
                      <option value="">None</option>
                      <option value="Double">Double</option>
                      <option value="Family">Family</option>
                      <option value="Regular">Regular</option>
                    </select>
                  </div>

                  <div>
                    <label>Price (optional)</label>
                    <input name="price" value={form.price} onChange={onChange} className="input" placeholder="0.00" />
                  </div>
                </div>
              )}

              <div>
                <label>Description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onChange}
                  className="input"
                  style={{ minHeight: 90, resize: "vertical" }}
                  placeholder="Short description (optional)"
                />
              </div>

              <div>
                <label>Status</label>
                <select name="status" value={form.status} onChange={onChange} className="input">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              {mode === "edit" && (
                <div className="menuInlineTool">
                  <div>
                    <div className="menuInlineToolTitle">Recipe</div>
                    <div className="menuInlineToolSub">
                      {editingHasRecipe
                        ? "Manage ingredient lines and costing from Recipe Builder."
                        : "No recipe yet. Create one for this menu item."}
                    </div>
                  </div>
                  <button type="button" className="btn" onClick={openRecipeFromEditModal}>
                    {editingHasRecipe ? "Edit Recipe" : "Create Recipe"}
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary">{mode === "create" ? "Create" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recipe Editor Modal */}
      {openRecipe && recipeMenuId && (
        <div style={modalBackdrop} onClick={() => handleCloseRecipe()}>
          <div style={modalWideCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Recipe Builder</h3>
              <button className="btn btn-ghost" onClick={() => handleCloseRecipe()}>✕</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <RecipeBuilder menuId={recipeMenuId} onClose={async () => { setOpenRecipe(false); await load(); }} />
            </div>
          </div>
        </div>
      )}

      {/* Create Recipe Modal */}
      <CreateRecipeModal
        open={showCreateRecipe}
        initialName={createRecipeInitialName}
        onCancel={() => setShowCreateRecipe(false)}
        onCreate={handleCreateRecipe}
      />

      {/* Confirm discard draft */}
      <ConfirmModal
        open={showConfirmDiscard}
        title="Discard changes?"
        message="You have unsaved recipe changes. Discard them and close?"
        onConfirm={confirmDiscardAndClose}
        onCancel={() => setShowConfirmDiscard(false)}
      />

      {/* Update Price Modal */}
      {priceOpen && (
        <div style={modalBackdrop} onClick={() => setPriceOpen(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0 }}>Update Price</h3>
              <button className="btn btn-ghost" onClick={() => setPriceOpen(false)}>✕</button>
            </div>

            <div className="formGrid">
              <div>
                <label>New selling price</label>
                <input
                  className="input"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  placeholder="e.g., 199.00"
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={() => setPriceOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submitPrice}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.24)",
  display: "grid",
  placeItems: "center",
  padding: 12,
  zIndex: 9999,
};

const modalCard = {
  width: "min(720px, 100%)",
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
};

const modalWideCard = {
  width: "min(980px, calc(100vw - 32px))",
  background: "white",
  borderRadius: 14,
  padding: 18,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  height: "min(920px, 60vh)",
  overflowY: "auto",
};
