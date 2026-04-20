import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import RecipeBuilder from "../components/RecipeBuilder";
import { useToast } from "../components/Toast";
import { formatMoney } from "../utils/formatters";

const emptyForm = {
  menu_name: "",
  description: "",
  status: "ACTIVE",
  menu_type: "FOOD",
  price: "",
  size: "",
  target_food_cost_percent: 0.3,
  dine_in_packaging_cost: "0.00",
  takeout_packaging_cost: "0.00",
  delivery_packaging_cost: "0.00",
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
      menu_type: row.menu_type ?? "FOOD",
      price: "",
      size: "",
      target_food_cost_percent: row.target_food_cost_percent ?? 0.3,
      dine_in_packaging_cost: row.dine_in_packaging_cost != null ? String(row.dine_in_packaging_cost) : "0.00",
      takeout_packaging_cost: row.takeout_packaging_cost != null ? String(row.takeout_packaging_cost) : "0.00",
      delivery_packaging_cost: row.delivery_packaging_cost != null ? String(row.delivery_packaging_cost) : "0.00",
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
    const { name, value } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: name === "target_food_cost_percent" ? value : value,
    }));
  }

  async function submitMenuItem() {
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
          menu_type: form.menu_type || "FOOD",
        };
        const tfcp = parseFloat(form.target_food_cost_percent);
        if (Number.isFinite(tfcp)) {
          payload.target_food_cost_percent = tfcp;
        }
        for (const field of ["dine_in_packaging_cost", "takeout_packaging_cost", "delivery_packaging_cost"]) {
          const parsed = parseFloat(form[field]);
          if (Number.isFinite(parsed)) payload[field] = parsed;
        }

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
        const tfcp = parseFloat(form.target_food_cost_percent);
        await api.put(`/menu/${editingItem.id}`, {
          menu_name: form.menu_name.trim(),
          description: form.description.trim() || null,
          status: form.status || "ACTIVE",
          menu_type: form.menu_type || "FOOD",
          target_food_cost_percent: Number.isFinite(tfcp) ? tfcp : null,
          dine_in_packaging_cost: Number.isFinite(parseFloat(form.dine_in_packaging_cost)) ? parseFloat(form.dine_in_packaging_cost) : 0,
          takeout_packaging_cost: Number.isFinite(parseFloat(form.takeout_packaging_cost)) ? parseFloat(form.takeout_packaging_cost) : 0,
          delivery_packaging_cost: Number.isFinite(parseFloat(form.delivery_packaging_cost)) ? parseFloat(form.delivery_packaging_cost) : 0,
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

  function onSubmit(event) {
    event.preventDefault();
    submitMenuItem();
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
        menu_type: row.menu_type || "FOOD",
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

  async function saveTargetPercent() {
    if (!editingItem) return;
    const tfcp = parseFloat(form.target_food_cost_percent);
    if (!Number.isFinite(tfcp) || tfcp <= 0) {
      toast.push({
        type: "error",
        title: "Invalid target",
        message: "Enter a decimal like 0.30 for 30%.",
      });
      return;
    }

    try {
      await api.put(`/menu/${editingItem.id}`, {
        menu_name: editingItem.menu_name,
        description: editingItem.description || null,
        status: editingItem.status || "ACTIVE",
        menu_type: editingItem.menu_type || form.menu_type || "FOOD",
        target_food_cost_percent: tfcp,
        dine_in_packaging_cost: Number.isFinite(parseFloat(form.dine_in_packaging_cost)) ? parseFloat(form.dine_in_packaging_cost) : 0,
        takeout_packaging_cost: Number.isFinite(parseFloat(form.takeout_packaging_cost)) ? parseFloat(form.takeout_packaging_cost) : 0,
        delivery_packaging_cost: Number.isFinite(parseFloat(form.delivery_packaging_cost)) ? parseFloat(form.delivery_packaging_cost) : 0,
      });
      toast.push({
        type: "success",
        title: "Updated",
        message: "Target food cost saved.",
      });
      await load();
      setEditingItem((current) =>
        current ? { ...current, target_food_cost_percent: tfcp } : current
      );
    } catch (error) {
      toast.push({
        type: "error",
        title: "Update failed",
        message: error?.response?.data?.message || "Target save failed",
      });
    }
  }

  async function handleCreateRecipe() {
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

  async function quickCreateRecipe(row) {
    try {
      await api.post(`/menu/${row.id}/create-recipe`, {
        recipe_name: row.menu_name,
        recipe_description: row.description || null,
      });
      toast.push({
        type: "success",
        title: "Recipe created",
        message: `Linked recipe to ${row.menu_name}.`,
      });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Create recipe failed",
        message: error?.response?.data?.message || "Failed to create recipe",
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
                  <th>Type</th>
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
                      <span className="badge">{String(row.menu_type || "FOOD").replace("_", " ")}</span>
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
                        {!row.recipe_version_id && (
                          <button className="btn" onClick={() => quickCreateRecipe(row)}>
                            Create recipe
                          </button>
                        )}

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
                    <td colSpan="7" style={{ opacity: 0.8, padding: 14 }}>
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

                <div>
                  <label>Menu type</label>
                  <select name="menu_type" value={form.menu_type} onChange={onChange} className="input">
                    <option value="FOOD">FOOD</option>
                    <option value="DRINK">DRINK</option>
                    <option value="ADD_ON">ADD ON</option>
                  </select>
                </div>

                <div>
                  <label>
                    Target food cost (decimal)
                    <span style={{ color: "#6B7280", fontWeight: 400 }}> — e.g., 0.30 = 30%</span>
                  </label>
                  <input
                    name="target_food_cost_percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.target_food_cost_percent}
                    onChange={onChange}
                    className="input"
                    placeholder="0.30"
                  />
                </div>

                <div className="formRow2">
                  <div>
                    <label>Dine-in packaging cost</label>
                    <input
                      name="dine_in_packaging_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.dine_in_packaging_cost}
                      onChange={onChange}
                      className="input"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label>Takeout packaging cost</label>
                    <input
                      name="takeout_packaging_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.takeout_packaging_cost}
                      onChange={onChange}
                      className="input"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label>Delivery packaging cost</label>
                  <input
                    name="delivery_packaging_cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.delivery_packaging_cost}
                    onChange={onChange}
                    className="input"
                    placeholder="0.00"
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-ghost" onClick={closeModal}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={submitMenuItem}>
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

                <div>
                  <label>
                    Target food cost (decimal)
                    <span style={{ color: "#6B7280", fontWeight: 400 }}> — 0.30 = 30%</span>
                  </label>
                  <div className="formRow2" style={{ alignItems: "center", gap: 8 }}>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      name="target_food_cost_percent"
                      value={form.target_food_cost_percent}
                      onChange={onChange}
                      placeholder="0.30"
                    />
                    <button className="btn" type="button" onClick={saveTargetPercent}>
                      Save target %
                    </button>
                  </div>
                  <div style={{ color: "#6B7280", marginTop: 6, fontSize: 12 }}>
                    Used for suggested pricing and profitability.
                  </div>
                </div>

                <div className="formRow2">
                  <div>
                    <label>Dine-in packaging cost</label>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      name="dine_in_packaging_cost"
                      value={form.dine_in_packaging_cost}
                      onChange={onChange}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label>Takeout packaging cost</label>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      name="takeout_packaging_cost"
                      value={form.takeout_packaging_cost}
                      onChange={onChange}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label>Delivery packaging cost</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    name="delivery_packaging_cost"
                    value={form.delivery_packaging_cost}
                    onChange={onChange}
                    placeholder="0.00"
                  />
                  <div style={{ color: "#6B7280", marginTop: 6, fontSize: 12 }}>
                    Use these for containers, utensils, bags, and other order-type-specific packaging.
                  </div>
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
                    <form className="formGrid" onSubmit={(event) => {
                      event.preventDefault();
                      handleCreateRecipe();
                    }}>
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
                        <button type="button" className="btn btn-primary" onClick={handleCreateRecipe}>
                          Create Recipe
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <RecipeBuilder
                    menuId={editingId}
                    currentSellingPrice={editingItem?.selling_price}
                    targetFoodCostPercent={
                      Number.isFinite(parseFloat(form.target_food_cost_percent))
                        ? parseFloat(form.target_food_cost_percent)
                        : 0.3
                    }
                    dineInPackagingCost={parseFloat(form.dine_in_packaging_cost) || 0}
                    takeoutPackagingCost={parseFloat(form.takeout_packaging_cost) || 0}
                    deliveryPackagingCost={parseFloat(form.delivery_packaging_cost) || 0}
                    onTargetChange={(next) =>
                      setForm((prev) => ({
                        ...prev,
                        target_food_cost_percent: next,
                      }))
                    }
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
  background: "rgba(15, 23, 42, 0.24)",
  display: "grid",
  placeItems: "center",
  padding: 12,
  zIndex: 200000, // above toasts and other overlays
  pointerEvents: "auto",
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
const sectionTabStyle = (active) => ({
  padding: "10px 14px",
  borderRadius: 999,
  border: active ? "1px solid rgba(209, 122, 45, 0.35)" : "1px solid #E7EAF3",
  background: active ? "rgba(209, 122, 45, 0.14)" : "#FFFFFF",
  color: "#111827",
  fontWeight: 700,
  cursor: "pointer",
});
