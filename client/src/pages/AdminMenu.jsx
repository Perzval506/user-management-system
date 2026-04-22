import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import RecipeBuilder from "../components/RecipeBuilder";
import { useToast } from "../components/Toast";
import { formatDateLong, formatMoney, formatNumber } from "../utils/formatters";

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

const emptyPromoForm = {
  promo_name: "",
  promo_type: "PERCENT",
  promo_value: "",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  status: "ACTIVE",
  notes: "",
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
  const [priceReason, setPriceReason] = useState("");
  const [priceHistory, setPriceHistory] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promoForm, setPromoForm] = useState(emptyPromoForm);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [recipeCreateForm, setRecipeCreateForm] = useState({
    recipe_name: "",
    recipe_description: "",
  });

  const profitabilitySummary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        if (item.costing_status === "Loss") acc.loss += 1;
        if (item.costing_status === "Low Profit") acc.low += 1;
        return acc;
      },
      { loss: 0, low: 0 }
    );
  }, [items]);

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
    setPriceReason("");
    setPriceHistory([]);
    setPromotions([]);
    setPromoForm(emptyPromoForm);
    setForm(emptyForm);
    setRecipeCreateForm({ recipe_name: "", recipe_description: "" });
    setOpen(true);
  }

  function openManage(row, section = MANAGE_SECTIONS.details) {
    setMode("edit");
    setEditingItem(row);
    setActiveSection(section);
    setPriceValue(row?.selling_price != null ? String(row.selling_price) : "");
    setPriceReason("");
    setPromoForm(emptyPromoForm);
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
    loadMenuExtras(row.id);
  }

  async function loadMenuExtras(menuId) {
    setDetailsLoading(true);
    try {
      const [priceHistoryRes, promotionsRes] = await Promise.all([
        api.get(`/menu/${menuId}/price-history`),
        api.get(`/menu/${menuId}/promotions`),
      ]);
      setPriceHistory(priceHistoryRes.data || []);
      setPromotions(promotionsRes.data || []);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.error || error.message || "Failed to load menu details.",
      });
    } finally {
      setDetailsLoading(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setMode("create");
    setEditingItem(null);
    setActiveSection(MANAGE_SECTIONS.details);
    setPriceValue("");
    setPriceReason("");
    setPriceHistory([]);
    setPromotions([]);
    setPromoForm(emptyPromoForm);
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
      await api.post(`/menu/${editingItem.id}/price`, { selling_price: parsedPrice, reason: priceReason });
      toast.push({
        type: "success",
        title: "Updated",
        message: "Price updated successfully.",
      });
      await load();
      await loadMenuExtras(editingItem.id);
      setEditingItem((current) =>
        current ? { ...current, selling_price: parsedPrice } : current
      );
      setPriceReason("");
    } catch (error) {
      toast.push({
        type: "error",
        title: "Update failed",
        message: error?.response?.data?.message || "Price update failed",
      });
    }
  }

  async function markPriceSynced(historyId) {
    if (!editingItem) return;
    try {
      await api.post(`/menu/${editingItem.id}/price-history/${historyId}/mark-synced`);
      toast.push({
        type: "success",
        title: "Marked synced",
        message: "Manual POS sync status was updated.",
      });
      await loadMenuExtras(editingItem.id);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Sync failed",
        message: error?.response?.data?.error || error.message || "Failed to mark price as synced.",
      });
    }
  }

  async function submitPromotion() {
    if (!editingItem) return;
    const promoValue = parseFloat(promoForm.promo_value);
    if (!promoForm.promo_name.trim()) {
      return toast.push({ type: "error", title: "Missing field", message: "Promotion name is required." });
    }
    if (!Number.isFinite(promoValue) || promoValue < 0) {
      return toast.push({ type: "error", title: "Invalid value", message: "Promotion value must be 0 or greater." });
    }
    try {
      await api.post(`/menu/${editingItem.id}/promotions`, {
        ...promoForm,
        promo_value: promoValue,
      });
      toast.push({
        type: "success",
        title: "Promotion saved",
        message: "Promotion created successfully.",
      });
      setPromoForm(emptyPromoForm);
      await loadMenuExtras(editingItem.id);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Promotion failed",
        message: error?.response?.data?.error || error.message || "Failed to create promotion",
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
        message: "Target ingredient cost saved.",
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

  async function printCostingReport() {
    if (!editingItem) return;
    try {
      const response = await api.get(`/menu/${editingItem.id}/costing-report`);
      const report = response.data;
      if (!report?.costing) {
        toast.push({
          type: "error",
          title: "Report unavailable",
          message: "Create and save a recipe first so the costing report has data to print.",
        });
        return;
      }

      const popup = window.open("", "_blank", "width=980,height=760");
      if (!popup) {
        toast.push({
          type: "error",
          title: "Popup blocked",
          message: "Allow popups so the costing report can open.",
        });
        return;
      }

      const ingredientRows = (report.ingredients || [])
        .map(
          (line) => `
            <tr>
              <td>${escapeHtml(line.ingredient_name || "-")}</td>
              <td style="text-align:right">${escapeHtml(formatNumber(line.quantity_used || 0))}</td>
              <td>${escapeHtml(line.quantity_unit || "-")}</td>
              <td style="text-align:right">${escapeHtml(formatMoney(line.ap_cost_per_unit || 0))}</td>
              <td style="text-align:right">${escapeHtml(formatMoney(line.ingredient_cost || 0))}</td>
            </tr>`
        )
        .join("");

      popup.document.write(`<!DOCTYPE html>
        <html>
          <head>
            <title>Costing Report - ${escapeHtml(report.menu?.menu_name || "Menu Item")}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
              h1, h2 { margin: 0 0 8px; }
              .meta { color: #4b5563; margin-bottom: 18px; }
              .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
              .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
              .label { color: #6b7280; font-size: 12px; margin-bottom: 6px; }
              .value { font-size: 18px; font-weight: 800; }
              table { width: 100%; border-collapse: collapse; margin-top: 10px; }
              th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; }
              th { background: #f3f4f6; text-align: left; }
            </style>
          </head>
          <body>
            <h1>Costing Report</h1>
            <div class="meta">
              ${escapeHtml(report.menu?.menu_name || "-")} | Recipe: ${escapeHtml(report.recipe_name || "-")} | Generated ${escapeHtml(formatDateLong(report.generated_at))}
            </div>
            <div class="cards">
              <div class="card"><div class="label">Current selling price</div><div class="value">${escapeHtml(formatMoney(report.menu?.selling_price || 0))}</div></div>
              <div class="card"><div class="label">Suggested selling price</div><div class="value">${escapeHtml(formatMoney(report.costing?.suggested_price || 0))}</div></div>
              <div class="card"><div class="label">Costing status</div><div class="value">${escapeHtml(report.costing?.status || "-")}</div></div>
              <div class="card"><div class="label">Total cost per serving</div><div class="value">${escapeHtml(formatMoney(report.costing?.cost_per_portion || 0))}</div></div>
              <div class="card"><div class="label">Profit per serving</div><div class="value">${escapeHtml(formatMoney(report.costing?.profit_per_portion || 0))}</div></div>
              <div class="card"><div class="label">Margin</div><div class="value">${escapeHtml(formatNumber((report.costing?.profit_margin || 0) * 100))}%</div></div>
            </div>
            <h2>Ingredient Lines</h2>
            <table>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th style="text-align:right">Qty used</th>
                  <th>Unit</th>
                  <th style="text-align:right">Unit cost</th>
                  <th style="text-align:right">Line cost</th>
                </tr>
              </thead>
              <tbody>${ingredientRows || '<tr><td colspan="5">No recipe ingredients saved yet.</td></tr>'}</tbody>
            </table>
          </body>
        </html>`);
      popup.document.close();
      popup.focus();
      popup.print();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Report failed",
        message: error?.response?.data?.error || error.message || "Failed to load costing report.",
      });
    }
  }

  async function exportCostingCsv() {
    if (!editingItem) return;
    try {
      const response = await api.get(`/menu/${editingItem.id}/costing-report`);
      const report = response.data;
      if (!report?.costing) {
        toast.push({
          type: "error",
          title: "Export unavailable",
          message: "Create and save a recipe first so the costing report has data to export.",
        });
        return;
      }

      const lines = [
        ["Menu Item", report.menu?.menu_name || ""],
        ["Recipe", report.recipe_name || ""],
        ["Current Selling Price", formatMoney(report.menu?.selling_price || 0)],
        ["Suggested Selling Price", formatMoney(report.costing?.suggested_price || 0)],
        ["Total Cost Per Serving", formatMoney(report.costing?.cost_per_portion || 0)],
        ["Profit Per Serving", formatMoney(report.costing?.profit_per_portion || 0)],
        ["Profit Margin", `${formatNumber((report.costing?.profit_margin || 0) * 100)}%`],
        [],
        ["Ingredient", "Qty Used", "Unit", "Unit Cost", "Line Cost"],
        ...(report.ingredients || []).map((line) => [
          line.ingredient_name || "",
          formatNumber(line.quantity_used || 0),
          line.quantity_unit || "",
          formatMoney(line.ap_cost_per_unit || 0),
          formatMoney(line.ingredient_cost || 0),
        ]),
      ];
      const csv = lines
        .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(report.menu?.menu_name || "costing-report").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push({ type: "success", title: "Exported", message: "Costing report CSV downloaded." });
    } catch (error) {
      toast.push({
        type: "error",
        title: "Export failed",
        message: error?.response?.data?.error || error.message || "Failed to export costing report.",
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
          <div className="pageSub">Menu items, recipes, and profitability.</div>
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

      <div className="dashboardStatGrid dashboardStatGridOwnerPrimary" style={{ marginBottom: 14 }}>
        <div className="card dashboardMetricCard dashboardMetricCard-danger">
          <div className="dashboardMetricHead">
            <div className="dashboardMetricLabel">Loss items</div>
            <span className="dashboardMetricTone dashboardMetricTone-danger">Urgent</span>
          </div>
          <div className="dashboardMetricValue">{profitabilitySummary.loss}</div>
        </div>
        <div className="card dashboardMetricCard dashboardMetricCard-warning">
          <div className="dashboardMetricHead">
            <div className="dashboardMetricLabel">Low-profit items</div>
            <span className="dashboardMetricTone dashboardMetricTone-warning">Review</span>
          </div>
          <div className="dashboardMetricValue">{profitabilitySummary.low}</div>
        </div>
      </div>

      <div className="pageFilterRow">
        <label className="toggleRow">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          <span className="toggleText">Show INACTIVE</span>
        </label>
      </div>

      <div className="tableWrap">
        <div className="tableTopBar">Menu Items</div>

        {loading ? (
          <div className="tableLoading">Loading...</div>
        ) : (
          <div className="tableScroller">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Recipe</th>
                  <th>Status</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Suggested</th>
                  <th className="text-right">Margin</th>
                  <th>Profitability</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td className="tableStrong">{row.menu_name}</td>
                    <td className="menuDescCell">
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
                    <td className="text-right mono">{row.cost_per_portion != null ? formatMoney(row.cost_per_portion) : "-"}</td>
                    <td className="text-right mono">{row.suggested_price != null ? formatMoney(row.suggested_price) : "-"}</td>
                    <td className="text-right mono">{row.profit_margin != null ? `${formatNumber((row.profit_margin || 0) * 100)}%` : "-"}</td>
                    <td>
                      <span className={`badge ${profitabilityBadgeClass(row.costing_status)}`}>
                        {row.costing_status || "No data"}
                      </span>
                    </td>

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
                    <td colSpan="11" className="tableEmpty">
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
        <div className="modalBackdrop" onClick={closeModal}>
          <div className="modalCard modalCard-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <h3 className="modalTitle">
                {mode === "create" ? "Create Menu Item" : `Manage ${editingItem?.menu_name || "Menu Item"}`}
              </h3>
              <button className="btn btn-ghost" onClick={closeModal}>
                Close
              </button>
            </div>

            {mode === "edit" && (
              <div className="segmentTabs">
                <button
                  className={`segmentTab ${activeSection === MANAGE_SECTIONS.details ? "active" : ""}`}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.details)}
                >
                  Details
                </button>
                <button
                  className={`segmentTab ${activeSection === MANAGE_SECTIONS.pricing ? "active" : ""}`}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.pricing)}
                >
                  Pricing
                </button>
                <button
                  className={`segmentTab ${activeSection === MANAGE_SECTIONS.recipe ? "active" : ""}`}
                  onClick={() => setActiveSection(MANAGE_SECTIONS.recipe)}
                >
                  Recipe
                </button>
              </div>
            )}

            {(mode === "create" || activeSection === MANAGE_SECTIONS.details) && (
              <form onSubmit={onSubmit} className="formGrid modalSection menuManageForm">
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
                    placeholder="Short description (optional)"
                  />
                </div>

                <div className="menuManageCompactRow">
                  <div className="menuManageCompactField">
                    <label>Status</label>
                    <select name="status" value={form.status} onChange={onChange} className="input">
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </div>

                  <div className="menuManageCompactField">
                    <label>Menu type</label>
                    <select name="menu_type" value={form.menu_type} onChange={onChange} className="input">
                      <option value="FOOD">FOOD</option>
                      <option value="DRINK">DRINK</option>
                      <option value="ADD_ON">ADD ON</option>
                    </select>
                  </div>

                  <div className="menuManageCompactField menuManageCompactField-wide">
                    <label>
                      Target ingredient cost %
                      <span className="inlineMuted"> - e.g., 0.30 = 30%</span>
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
                </div>

                <div className="formRow3">
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
                </div>

                <div className="formActions">
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
              <div className="formGrid modalSection">
                {/* New consolidation: pricing edits now live inside the same manage modal. */}
                <div>
                  <label>Current selling price</label>
                  <div className="input">
                    {editingItem?.selling_price != null ? formatMoney(editingItem.selling_price) : "No price set yet"}
                  </div>
                </div>

                <div className="formRow3">
                  <div className="metricMiniCard">
                    <div className="metricMiniLabel">Total cost per serving</div>
                    <div className="metricMiniValue">
                      {editingItem?.cost_per_portion != null ? formatMoney(editingItem.cost_per_portion) : "-"}
                    </div>
                  </div>
                  <div className="metricMiniCard">
                    <div className="metricMiniLabel">Suggested selling price</div>
                    <div className="metricMiniValue">
                      {editingItem?.suggested_price != null ? formatMoney(editingItem.suggested_price) : "-"}
                    </div>
                  </div>
                  <div className="metricMiniCard">
                    <div className="metricMiniLabel">Profitability</div>
                    <div className="metricMiniValue" style={{ fontSize: 18 }}>
                      {editingItem?.costing_status || "No data"}
                    </div>
                    <div className="metricMiniHelper">
                      {editingItem?.profit_margin != null ? `Margin ${formatNumber((editingItem.profit_margin || 0) * 100)}%` : "Save a recipe to calculate this"}
                    </div>
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
                  <label>Reason for change (optional)</label>
                  <input
                    className="input"
                    value={priceReason}
                    onChange={(event) => setPriceReason(event.target.value)}
                    placeholder="Why was the price changed?"
                  />
                </div>

                <div>
                  <label>
                    Target ingredient cost %
                    <span className="inlineMuted"> - 0.30 = 30%</span>
                  </label>
                  <div className="formRow2 align-center">
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
                  <div className="formNote">Example: 0.35 = 35%.</div>
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
                  <div className="formNote">Containers, utensils, bags, etc.</div>
                </div>

                <div className="formActions">
                  <button className="btn" onClick={printCostingReport} type="button">
                    Print Costing Report
                  </button>
                  <button className="btn" onClick={exportCostingCsv} type="button">
                    Export CSV
                  </button>
                  <button className="btn btn-ghost" onClick={closeModal}>
                    Close
                  </button>
                  <button className="btn btn-primary" onClick={submitPrice}>
                    Save Price
                  </button>
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="tableTopBar">Price History</div>
                  {detailsLoading ? (
                    <div className="tableLoading">Loading history...</div>
                  ) : (
                    <div className="tableScroller">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th className="text-right">Selling Price</th>
                            <th>Reason</th>
                            <th>Sync Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {priceHistory.map((entry) => (
                            <tr key={entry.id}>
                              <td>{formatDateLong(entry.effective_date || entry.created_at)}</td>
                              <td className="text-right mono">{formatMoney(entry.selling_price)}</td>
                              <td>{entry.notes || entry.change_reason || "-"}</td>
                              <td>
                                <span className={`badge ${entry.synced_to_pos ? "badge-active" : "badge-pending"}`}>
                                  {entry.synced_to_pos ? "Synced" : "Pending"}
                                </span>
                              </td>
                              <td>
                                {!entry.synced_to_pos && (
                                  <button type="button" className="btn btn-ghost" onClick={() => markPriceSynced(entry.id)}>
                                    Mark Synced
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {priceHistory.length === 0 && (
                            <tr><td colSpan="5" className="tableEmpty">No price history recorded yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="tableTopBar">Promotions</div>
                  <div className="formGrid">
                    <div className="formRow2">
                      <div>
                        <label>Promo name</label>
                        <input
                          className="input"
                          value={promoForm.promo_name}
                          onChange={(event) => setPromoForm((current) => ({ ...current, promo_name: event.target.value }))}
                          placeholder="e.g., Lunch Promo"
                        />
                      </div>
                      <div>
                        <label>Promo type</label>
                        <select
                          className="input"
                          value={promoForm.promo_type}
                          onChange={(event) => setPromoForm((current) => ({ ...current, promo_type: event.target.value }))}
                        >
                          <option value="PERCENT">PERCENT</option>
                          <option value="FIXED">FIXED</option>
                        </select>
                      </div>
                    </div>
                    <div className="formRow2">
                      <div>
                        <label>Promo value</label>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={promoForm.promo_value}
                          onChange={(event) => setPromoForm((current) => ({ ...current, promo_value: event.target.value }))}
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label>Status</label>
                        <select
                          className="input"
                          value={promoForm.status}
                          onChange={(event) => setPromoForm((current) => ({ ...current, status: event.target.value }))}
                        >
                          <option value="SCHEDULED">SCHEDULED</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="ENDED">ENDED</option>
                        </select>
                      </div>
                    </div>
                    <div className="formRow2">
                      <div>
                        <label>Start date</label>
                        <input
                          className="input"
                          type="date"
                          value={promoForm.start_date}
                          onChange={(event) => setPromoForm((current) => ({ ...current, start_date: event.target.value }))}
                        />
                      </div>
                      <div>
                        <label>End date</label>
                        <input
                          className="input"
                          type="date"
                          value={promoForm.end_date}
                          onChange={(event) => setPromoForm((current) => ({ ...current, end_date: event.target.value }))}
                        />
                      </div>
                    </div>
                    <div>
                      <label>Notes (optional)</label>
                      <input
                        className="input"
                        value={promoForm.notes}
                        onChange={(event) => setPromoForm((current) => ({ ...current, notes: event.target.value }))}
                        placeholder="Optional promo note"
                      />
                    </div>
                    <div className="formActions">
                      <button type="button" className="btn btn-primary" onClick={submitPromotion}>
                        Save Promotion
                      </button>
                    </div>
                  </div>
                  <div className="tableScroller" style={{ marginTop: 12 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th className="text-right">Value</th>
                          <th className="text-right">Discounted Price</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {promotions.map((promo) => (
                          <tr key={promo.id}>
                            <td>{promo.promo_name}</td>
                            <td>{promo.promo_type}</td>
                            <td className="text-right mono">
                              {promo.promo_type === "PERCENT" ? `${formatNumber(promo.promo_value)}%` : formatMoney(promo.promo_value)}
                            </td>
                            <td className="text-right mono">{promo.discounted_price != null ? formatMoney(promo.discounted_price) : "-"}</td>
                            <td>
                              <span className={`badge ${promo.status === "ACTIVE" ? "badge-active" : "badge-pending"}`}>
                                {promo.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {promotions.length === 0 && (
                          <tr><td colSpan="5" className="tableEmpty">No promotions recorded yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {mode === "edit" && activeSection === MANAGE_SECTIONS.recipe && (
              <div className="modalSection">
                {!hasRecipe ? (
                  <div className="card">
                    {/* New consolidation: recipe creation now stays inside the same management surface. */}
                    <h4 className="h2">No recipe linked yet</h4>
                    <p className="mutedHint">Create a recipe to add ingredient lines.</p>
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
                          value={recipeCreateForm.recipe_description}
                          onChange={(event) =>
                            setRecipeCreateForm((current) => ({ ...current, recipe_description: event.target.value }))
                          }
                          placeholder="Short description (optional)"
                        />
                      </div>

                      <div className="formActions">
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

function profitabilityBadgeClass(status) {
  if (status === "Loss") return "badge-inactive";
  if (status === "Low Profit") return "badge-pending";
  if (status === "Moderate Profit" || status === "High Profit") return "badge-active";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
