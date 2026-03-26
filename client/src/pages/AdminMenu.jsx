import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import RecipeBuilder from "../components/RecipeBuilder";
import { useToast } from "../components/Toast";
import { formatMoney } from "../utils/formatters";

const emptyForm = {
  menu_name: "",
  description: "",
  status: "ACTIVE",
  price: "",
  size: "",
};

const MANAGE_SECTIONS = {
  details: "details",
  pricing: "pricing",
  recipe: "recipe",
};

export default function AdminMenu() {
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // New consolidation: one management modal now handles details, pricing, and recipe work.
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [activeSection, setActiveSection] = useState(MANAGE_SECTIONS.details);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [priceValue, setPriceValue] = useState("");

  const [recipeCreateForm, setRecipeCreateForm] = useState({
    recipe_name: "",
    recipe_description: "",
  });

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((item) => item.status !== "INACTIVE");
  }, [items, showInactive]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/menu");
      setItems(res.data || []);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message:
          error?.response?.data?.message || error.message || "Failed to load menu items",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setMode("create");
    setEditingItem(null);
    setActiveSection(MANAGE_SECTIONS.details);
    setPriceValue("");
    setForm(emptyForm);
    setRecipeCreateForm({ recipe_name: "", recipe_description: "" });
    setOpen(true);
  }

  function openManage(row, section = MANAGE_SECTIONS.details) {
    setMode("edit");
    setEditingItem(row);
    setActiveSection(section);
    setPriceValue(row?.selling_price != null ? String(row.selling_price) : "");
    setForm({
      menu_name: row.menu_name ?? "",
      description: row.description ?? "",
      status: row.status ?? "ACTIVE",
      price: "",
      size: "",
    });
    setRecipeCreateForm({
      recipe_name: row.menu_name || "",
      recipe_description: row.description || "",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setMode("create");
    setEditingItem(null);
    setActiveSection(MANAGE_SECTIONS.details);
    setPriceValue("");
    setForm(emptyForm);
    setRecipeCreateForm({ recipe_name: "", recipe_description: "" });
  }

  function onChange(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function onSubmit(event) {
    event.preventDefault();

    if (!form.menu_name.trim()) {
      toast.push({
        type: "error",
        title: "Missing field",
        message: "Menu name is required.",
      });
      return;
    }

    try {
      if (mode === "create") {
        let finalName = form.menu_name.trim();
        if (form.size && form.size.trim()) {
          finalName = `${finalName} (${form.size.trim()})`;
        }

        const payload = {
          menu_name: finalName,
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
        };

        if (form.price !== undefined && form.price !== null && form.price !== "") {
          const parsedPrice = parseFloat(form.price);
          if (Number.isNaN(parsedPrice)) {
            toast.push({
              type: "error",
              title: "Invalid price",
              message: "Price must be numeric.",
            });
            return;
          }
          payload.selling_price = parsedPrice;
        }

        await api.post("/menu", payload);
        toast.push({
          type: "success",
          title: "Saved",
          message: "Menu item created.",
        });
      } else {
        await api.put(`/menu/${editingItem.id}`, {
          menu_name: form.menu_name.trim(),
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
        });
        toast.push({
          type: "success",
          title: "Saved",
          message: "Menu item updated.",
        });
      }

      await load();
      closeModal();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message:
          error?.response?.data?.message || error.message || "Save failed",
      });
    }
  }

  async function deactivate(row) {
    try {
      await api.delete(`/menu/${row.id}`);
      toast.push({
        type: "success",
        title: "Updated",
        message: "Menu item set to INACTIVE.",
      });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Deactivate failed",
        message:
          error?.response?.data?.message || error.message || "Deactivate failed",
      });
    }
  }

  async function activate(row) {
    try {
      await api.put(`/menu/${row.id}`, {
        menu_name: row.menu_name,
        description: row.description || null,
        status: "ACTIVE",
      });
      toast.push({
        type: "success",
        title: "Updated",
        message: "Menu item set to ACTIVE.",
      });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Activate failed",
        message:
          error?.response?.data?.message || error.message || "Activate failed",
      });
    }
  }

  async function submitPrice() {
    if (!editingItem) return;

    const parsedPrice = parseFloat(priceValue);
    if (Number.isNaN(parsedPrice)) {
      toast.push({
        type: "error",
        title: "Invalid price",
        message: "Please enter a numeric value.",
      });
      return;
    }

    try {
      await api.post(`/menu/${editingItem.id}/price`, { selling_price: parsedPrice });
      toast.push({
        type: "success",
        title: "Updated",
        message: "Price updated successfully.",
      });
      await load();
      setEditingItem((current) =>
        current ? { ...current, selling_price: parsedPrice } : current
      );
    } catch (error) {
      toast.push({
        type: "error",
        title: "Update failed",
        message: error?.response?.data?.message || "Price update failed",
      });
    }
  }

  async function handleCreateRecipe(event) {
    event.preventDefault();
    if (!editingItem) return;

    try {
      await api.post(`/menu/${editingItem.id}/create-recipe`, {
        recipe_name: recipeCreateForm.recipe_name.trim() || editingItem.menu_name,
        recipe_description: recipeCreateForm.recipe_description.trim() || null,
      });
      toast.push({
        type: "success",
        title: "Created",
        message: "Recipe created successfully.",
      });
      setActiveSection(MANAGE_SECTIONS.recipe);
      await load();
      setEditingItem((current) =>
        current ? { ...current, recipe_version_id: current.recipe_version_id || true } : current
      );
    } catch (error) {
      toast.push({
        type: "error",
        title: "Create recipe failed",
        message:
          error?.response?.data?.message || "Failed to create recipe",
      });
    }
  }

  const editingId = editingItem?.id || null;
  const hasRecipe = Boolean(editingItem?.recipe_version_id);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Menu Management</h2>
          <div className="pageSub">Manage menu items and recipes.</div>
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            Create Menu Item
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          Show INACTIVE
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
                  <th>Recipe</th>
                  <th>Status</th>
                  <th className="text-right">Price</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 800 }}>{row.menu_name}</td>
                    <td
                      style={{
                        maxWidth: 520,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.description || "-"}
                    </td>
                    <td>
                      <span className={`badge ${row.recipe_version_id ? "badge-active" : "badge-inactive"}`}>
                        {row.recipe_version_id ? "Linked" : "Not linked"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${row.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="text-right mono">{row.selling_price != null ? formatMoney(row.selling_price) : "-"}</td>

                    <td>
                      <div className="rowActions">
                        <button
                          className="btn"
                          onClick={() => openManage(row, MANAGE_SECTIONS.details)}
                        >
                          Manage
                        </button>

                        {row.status === "INACTIVE" ? (
                          <button className="btn" onClick={() => activate(row)}>
                            Activate
                          </button>
                        ) : (
                          <button className="btn" onClick={() => deactivate(row)}>
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ opacity: 0.8, padding: 14 }}>
                      No menu items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div style={modalBackdrop} onClick={closeModal}>
          <div style={modalWideCard} onClick={(event) => event.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>
                {mode === "create" ? "Create Menu Item" : `Manage ${editingItem?.menu_name || "Menu Item"}`}
              </h3>
              <button className="btn btn-ghost" onClick={closeModal}>
                X
              </button>
            </div>

            {mode === "edit" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <button
                  style={sectionTabStyle(activeSection === MANAGE_SECTIONS.details)}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.details)}
                >
                  Details
                </button>
                <button
                  style={sectionTabStyle(activeSection === MANAGE_SECTIONS.pricing)}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.pricing)}
                >
                  Pricing
                </button>
                <button
                  style={sectionTabStyle(activeSection === MANAGE_SECTIONS.recipe)}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.recipe)}
                >
                  Recipe
                </button>
              </div>
            )}

            {(mode === "create" || activeSection === MANAGE_SECTIONS.details) && (
              <form onSubmit={onSubmit} className="formGrid" style={{ marginTop: 16 }}>
                <div>
                  <label>Menu Name</label>
                  <input
                    name="menu_name"
                    value={form.menu_name}
                    onChange={onChange}
                    className="input"
                    placeholder="e.g., Pepperoni Pizza"
                  />
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
                      <label>Starting Price (optional)</label>
                      <input
                        name="price"
                        value={form.price}
                        onChange={onChange}
                        className="input"
                        placeholder="0.00"
                      />
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

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-ghost" onClick={closeModal}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {mode === "create" ? "Create" : "Save Details"}
                  </button>
                </div>
              </form>
            )}

            {mode === "edit" && activeSection === MANAGE_SECTIONS.pricing && (
              <div className="formGrid" style={{ marginTop: 16 }}>
                {/* New consolidation: pricing edits now live inside the same manage modal. */}
                <div>
                  <label>Current selling price</label>
                  <div className="input" style={{ display: "flex", alignItems: "center" }}>
                    {editingItem?.selling_price != null ? formatMoney(editingItem.selling_price) : "No price set yet"}
                  </div>
                </div>

                <div>
                  <label>New selling price</label>
                  <input
                    className="input"
                    value={priceValue}
                    onChange={(event) => setPriceValue(event.target.value)}
                    placeholder="e.g., 199.00"
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={closeModal}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={submitPrice}>
                    Save Price
                  </button>
                </div>
              </div>
            )}

            {mode === "edit" && activeSection === MANAGE_SECTIONS.recipe && (
              <div style={{ marginTop: 16 }}>
                {!hasRecipe ? (
                  <div className="card" style={{ padding: 16 }}>
                    {/* New consolidation: recipe creation now stays inside the same management surface. */}
                    <h4 style={{ marginTop: 0 }}>No recipe linked yet</h4>
                    <p style={{ marginTop: 0, opacity: 0.8 }}>
                      Create a recipe to start managing ingredient lines for this menu item.
                    </p>
                    <form className="formGrid" onSubmit={handleCreateRecipe}>
                      <div>
                        <label>Recipe name</label>
                        <input
                          className="input"
                          value={recipeCreateForm.recipe_name}
                          onChange={(event) =>
                            setRecipeCreateForm((current) => ({ ...current, recipe_name: event.target.value }))
                          }
                          placeholder="Recipe name"
                        />
                      </div>

                      <div>
                        <label>Recipe description</label>
                        <textarea
                          className="input"
                          style={{ minHeight: 90, resize: "vertical" }}
                          value={recipeCreateForm.recipe_description}
                          onChange={(event) =>
                            setRecipeCreateForm((current) => ({ ...current, recipe_description: event.target.value }))
                          }
                          placeholder="Short description (optional)"
                        />
                      </div>

                      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        <button type="submit" className="btn btn-primary">
                          Create Recipe
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <RecipeBuilder
                    menuId={editingId}
                    onClose={async () => {
                      await load();
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "grid",
  placeItems: "center",
  padding: 12,
  zIndex: 9999,
};

const modalWideCard = {
  width: "min(980px, 100%)",
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  maxHeight: "90vh",
  overflowY: "auto",
};
const sectionTabStyle = (active) => ({
  padding: "10px 14px",
  borderRadius: 999,
  border: active ? "1px solid rgba(209, 122, 45, 0.35)" : "1px solid #E7EAF3",
  background: active ? "rgba(209, 122, 45, 0.14)" : "#FFFFFF",
  color: "#111827",
  fontWeight: 700,
  cursor: "pointer",
});
