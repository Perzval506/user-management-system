import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

const emptyForm = {
  ingredient_name: "",
  category: "",
  base_unit: "",
  base_unit_qty: "",
  quantity: "",
  status: "ACTIVE",
};

const emptyApForm = {
  supplierName: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
  unit: "",
  apCostPerUnit: "",
  notes: "",
};

const emptyQuoteForm = {
  supplierName: "",
  quoteDate: new Date().toISOString().slice(0, 10),
  validUntil: "",
  brand: "",
  unit: "",
  quantity: "",
  quotedPrice: "",
  notes: "",
};

export default function AdminIngredients() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySaving, setHistorySaving] = useState(false);
  const [historyData, setHistoryData] = useState({
    ingredient: null,
    history: [],
    ap_prices: [],
    supplier_quotes: [],
    current_ap_cost: null,
  });
  const [apForm, setApForm] = useState(emptyApForm);
  const [quoteForm, setQuoteForm] = useState(emptyQuoteForm);
  const [categories, setCategories] = useState([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const units = useUnits();

  const visibleItems = useMemo(() => {
    if (showInactive) return items;
    return items.filter((item) => item.status !== "INACTIVE");
  }, [items, showInactive]);
  const activeCount = useMemo(
    () => items.filter((item) => item.status !== "INACTIVE").length,
    [items]
  );
  const inactiveCount = useMemo(
    () => items.filter((item) => item.status === "INACTIVE").length,
    [items]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ingredientsRes, categoriesRes] = await Promise.all([
        api.get("/ingredients"),
        api.get("/ingredients/categories"),
      ]);
      setItems(ingredientsRes.data || []);
      setCategories((categoriesRes.data || []).map((row) => String(row.category_name || "").trim()).filter(Boolean));
    } catch (e) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: e?.response?.data?.message || e.message || "Failed to load ingredients",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadHistory = useCallback(
    async (ingredientId, fallbackRow = null) => {
      const res = await api.get(`/ingredients/${ingredientId}/history`);
      const payload = res.data || {
        ingredient: fallbackRow,
        history: [],
        ap_prices: [],
        supplier_quotes: [],
        current_ap_cost: null,
      };
      setHistoryData(payload);
      setApForm((current) => ({
        ...current,
        unit: payload.ingredient?.base_unit || fallbackRow?.base_unit || "",
      }));
      setQuoteForm((current) => ({
        ...current,
        unit: payload.ingredient?.base_unit || fallbackRow?.base_unit || "",
      }));
    },
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("create") === "1") {
      openCreate();
      params.delete("create");
      const next = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: next ? `?${next}` : "",
        },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

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
      quantity: row.quantity ?? "",
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

  function closeCategoryModal() {
    setCategoryOpen(false);
    setNewCategoryName("");
    setSavingCategory(false);
  }

  function onChange(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submitCategory() {
    const categoryName = newCategoryName.trim();
    if (!categoryName) {
      return toast.push({ type: "error", title: "Missing field", message: "Category name is required." });
    }

    setSavingCategory(true);
    try {
      await api.post("/ingredients/categories", { category_name: categoryName });
      setCategories((previous) => Array.from(new Set([...previous, categoryName])).sort((a, b) => a.localeCompare(b)));
      setForm((previous) => ({ ...previous, category: categoryName }));
      toast.push({ type: "success", title: "Saved", message: "Ingredient category created." });
      closeCategoryModal();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to create category",
      });
    } finally {
      setSavingCategory(false);
    }
  }

  async function submitForm() {
    if (!form.ingredient_name.trim()) {
      return toast.push({ type: "error", title: "Missing field", message: "Ingredient name is required." });
    }
    if (!form.base_unit_qty && form.base_unit_qty !== 0) {
      return toast.push({ type: "error", title: "Missing field", message: "Base unit quantity is required." });
    }

    const qty = Number(String(form.base_unit_qty).trim());
    if (!isFinite(qty) || qty <= 0) {
      return toast.push({ type: "error", title: "Invalid value", message: "Base unit quantity must be greater than 0." });
    }

    if (!form.base_unit.trim()) {
      return toast.push({ type: "error", title: "Missing field", message: "Base unit is required." });
    }

    const baseUnit = String(form.base_unit).trim().toLowerCase();
    if (!units.length) {
      return toast.push({ type: "error", title: "Units not loaded", message: "Try refreshing the page." });
    }
    if (!units.includes(baseUnit)) {
      return toast.push({ type: "error", title: "Invalid unit", message: `Allowed: ${units.join(", ")}` });
    }

    const qtyOnHand = form.quantity === "" ? 0 : Number(String(form.quantity).trim());
    if (!isFinite(qtyOnHand) || qtyOnHand < 0) {
      return toast.push({ type: "error", title: "Invalid stock", message: "Quantity must be 0 or more." });
    }

    try {
      const payload = {
        ingredient_name: form.ingredient_name.trim(),
        category: form.category.trim() || null,
        base_unit: baseUnit,
        base_unit_qty: qty,
        quantity: qtyOnHand,
        status: form.status || "ACTIVE",
      };

      if (mode === "create") {
        await api.post("/ingredients", payload);
        toast.push({ type: "success", title: "Saved", message: "Ingredient created." });
      } else {
        await api.put(`/ingredients/${editingId}`, payload);
        toast.push({ type: "success", title: "Saved", message: "Ingredient updated." });
      }

      closeModal();
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Save failed",
      });
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    submitForm();
  }

  async function deactivate(row) {
    try {
      await api.delete(`/ingredients/${row.id}`);
      toast.push({ type: "success", title: "Updated", message: "Ingredient set to INACTIVE." });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Deactivate failed",
        message: error?.response?.data?.message || error.message || "Deactivate failed",
      });
    }
  }

  async function activate(row) {
    try {
      await api.put(`/ingredients/${row.id}`, {
        ingredient_name: row.ingredient_name,
        category: row.category || null,
        base_unit: row.base_unit,
        base_unit_qty: row.base_unit_qty,
        quantity: row.quantity ?? 0,
        status: "ACTIVE",
      });
      toast.push({ type: "success", title: "Updated", message: "Ingredient set to ACTIVE." });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Activate failed",
        message: error?.response?.data?.message || error.message || "Activate failed",
      });
    }
  }

  async function openHistory(row) {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryData({ ingredient: null, history: [], ap_prices: [], supplier_quotes: [], current_ap_cost: null });
    setApForm({
      ...emptyApForm,
      unit: row.base_unit || "",
    });
    setQuoteForm({
      ...emptyQuoteForm,
      unit: row.base_unit || "",
    });
    try {
      await loadHistory(row.id, row);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load ingredient history",
      });
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function submitApPrice() {
    if (!historyData.ingredient?.id) return;
    const apCostPerUnit = Number(apForm.apCostPerUnit);
    if (!apForm.unit) {
      return toast.push({ type: "error", title: "Missing unit", message: "Select a unit first." });
    }
    if (!Number.isFinite(apCostPerUnit) || apCostPerUnit < 0) {
      return toast.push({ type: "error", title: "Invalid AP cost", message: "AP cost must be 0 or greater." });
    }
    setHistorySaving(true);
    try {
      await api.post(`/ingredients/${historyData.ingredient.id}/ap-prices`, {
        supplierName: apForm.supplierName,
        effectiveDate: apForm.effectiveDate,
        unit: apForm.unit,
        apCostPerUnit,
        notes: apForm.notes,
      });
      toast.push({ type: "success", title: "Saved", message: "AP price saved." });
      setApForm((current) => ({
        ...emptyApForm,
        effectiveDate: current.effectiveDate,
        unit: current.unit,
      }));
      await loadHistory(historyData.ingredient.id, historyData.ingredient);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save AP price",
      });
    } finally {
      setHistorySaving(false);
    }
  }

  async function rollbackApPrice(priceId) {
    if (!historyData.ingredient?.id) return;
    setHistorySaving(true);
    try {
      await api.post(`/ingredients/${historyData.ingredient.id}/ap-prices/${priceId}/rollback`);
      toast.push({ type: "success", title: "Rollback complete", message: "AP cost was restored from the selected history row." });
      await loadHistory(historyData.ingredient.id, historyData.ingredient);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Rollback failed",
        message: error?.response?.data?.message || error.message || "Failed to rollback AP price",
      });
    } finally {
      setHistorySaving(false);
    }
  }

  async function submitSupplierQuote() {
    if (!historyData.ingredient?.id) return;
    const quotedPrice = Number(quoteForm.quotedPrice);
    const quantity = quoteForm.quantity === "" ? null : Number(quoteForm.quantity);
    if (!quoteForm.supplierName.trim()) {
      return toast.push({ type: "error", title: "Missing supplier", message: "Supplier name is required." });
    }
    if (!quoteForm.unit) {
      return toast.push({ type: "error", title: "Missing unit", message: "Select a unit first." });
    }
    if (!Number.isFinite(quotedPrice) || quotedPrice < 0) {
      return toast.push({ type: "error", title: "Invalid quoted price", message: "Quoted price must be 0 or greater." });
    }
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      return toast.push({ type: "error", title: "Invalid quantity", message: "Quoted quantity must be greater than 0." });
    }

    setHistorySaving(true);
    try {
      await api.post(`/ingredients/${historyData.ingredient.id}/supplier-quotes`, {
        supplierName: quoteForm.supplierName,
        quoteDate: quoteForm.quoteDate,
        validUntil: quoteForm.validUntil || null,
        brand: quoteForm.brand,
        unit: quoteForm.unit,
        quantity,
        quotedPrice,
        notes: quoteForm.notes,
      });
      toast.push({ type: "success", title: "Saved", message: "Supplier quote recorded." });
      setQuoteForm((current) => ({
        ...emptyQuoteForm,
        quoteDate: current.quoteDate,
        unit: current.unit,
      }));
      await loadHistory(historyData.ingredient.id, historyData.ingredient);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save supplier quote",
      });
    } finally {
      setHistorySaving(false);
    }
  }

  async function applySupplierQuote(quoteId) {
    if (!historyData.ingredient?.id) return;
    setHistorySaving(true);
    try {
      await api.post(`/ingredients/${historyData.ingredient.id}/supplier-quotes/${quoteId}/use`);
      toast.push({ type: "success", title: "Quote applied", message: "The selected supplier quote is now part of AP price history." });
      await loadHistory(historyData.ingredient.id, historyData.ingredient);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Use Quote failed",
        message: error?.response?.data?.message || error.message || "Failed to use supplier quote",
      });
    } finally {
      setHistorySaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Ingredient Management</h2>
          <div className="pageSub">Set up ingredients, track on-hand stock, and keep recipe costing clean.</div>
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={openCreate}>Create Ingredient</button>
        </div>
      </div>

      <div className="dashboardStatGrid">
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Active ingredients</div>
          <div className="dashboardMetricValue">{activeCount}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Inactive ingredients</div>
          <div className="dashboardMetricValue">{inactiveCount}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">How this works</div>
          <div className="dashboardMetricHint">
            Create the ingredient once, define its base unit, then update stock as purchases come in.
          </div>
        </div>
      </div>

      <ToDoNext items={items} loading={loading} />

      <div className="pageFilterRow">
        <label className="toggleRow">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          <span className="toggleText">Show INACTIVE</span>
        </label>
      </div>

      <div className="tableWrap">
        <div className="tableTopBar">Ingredients</div>

        {loading ? (
          <div className="tableLoading">Loading...</div>
        ) : (
          <div className="tableScroller">
            <table className="table table-wide">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Base unit size</th>
                  <th>Quantity</th>
                  <th>Current AP Cost</th>
                  <th>Last updated</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td className="tableStrong">{row.ingredient_name}</td>
                    <td>{row.category || "-"}</td>
                    <td>{row.base_unit_qty ? `${formatNumber(row.base_unit_qty)} ${row.base_unit}` : row.base_unit || "-"}</td>
                    <td className="text-right mono">{formatNumber(row.quantity ?? 0)}</td>
                    <td className="text-right mono">
                      {row.current_ap_cost != null ? `${formatMoney(row.current_ap_cost)} / ${row.base_unit || "-"}` : "-"}
                    </td>
                    <td>{row.lastUpdated ? formatDateTimeFriendly(row.lastUpdated) : "-"}</td>
                    <td>
                      <span className={`badge ${row.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openEdit(row)}>Manage</button>
                        <button className="btn btn-ghost" onClick={() => openHistory(row)}>View History</button>
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
                    <td colSpan="8" className="tableEmpty">
                      No ingredients found. Create your first ingredient to start tracking stock and recipes.
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
          <div className="modalCard modalCard-md" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <h3 className="modalTitle">{mode === "create" ? "Create Ingredient" : `Manage ${form.ingredient_name || "Ingredient"}`}</h3>
              <button className="btn btn-ghost" onClick={closeModal}>Close</button>
            </div>

            <form onSubmit={onSubmit} className="formGrid">
              <div>
                <label>Ingredient Name</label>
                <input name="ingredient_name" value={form.ingredient_name} onChange={onChange} className="input" placeholder="e.g., Flour" />
              </div>

              <div>
                <label>Category</label>
                <div className="formRow2 align-end">
                  <select name="category" value={form.category} onChange={onChange} className="input">
                    <option value="">-- select category --</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => setCategoryOpen(true)}>
                    Add Category
                  </button>
                </div>
              </div>

              <div>
                <label>Base unit size</label>
                <div className="mutedHint">
                  Example: 1 kg, 1 pack, or 500 g. Recipes will use this as the ingredient&apos;s starting unit.
                </div>
                <div className="formRow2">
                  <input name="base_unit_qty" value={form.base_unit_qty} onChange={onChange} className="input" type="number" step="0.01" min="0.01" placeholder="e.g., 1.00" />
                  <select name="base_unit" value={form.base_unit} onChange={onChange} className="input">
                    <option value="">-- select unit --</option>
                    {units.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label>On-hand quantity</label>
                <div className="mutedHint">
                  Current usable stock in the same base unit you defined above.
                </div>
                <input name="quantity" value={form.quantity} onChange={onChange} className="input" type="number" step="0.01" min="0" placeholder="e.g., 5.00" />
              </div>

              <div>
                <label>Status</label>
                <select name="status" value={form.status} onChange={onChange} className="input">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>

              <div className="formActions">
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitForm}>{mode === "create" ? "Create" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {categoryOpen && (
        <div className="modalBackdrop" onClick={closeCategoryModal}>
          <div className="modalCard modalCard-sm" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <h3 className="modalTitle">Create Category</h3>
              <button className="btn btn-ghost" onClick={closeCategoryModal}>Close</button>
            </div>

            <div className="formGrid modalSection">
              <div>
                <label>Category name</label>
                <input
                  className="input"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="e.g., TAKE OUT CONTAINERS"
                />
              </div>
              <div className="formActions">
                <button type="button" className="btn btn-ghost" onClick={closeCategoryModal}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitCategory} disabled={savingCategory}>
                  {savingCategory ? "Saving..." : "Create Category"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {historyOpen && (
        <div className="modalBackdrop" onClick={() => setHistoryOpen(false)}>
          <div className="modalCard modalCard-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div>
                <h3 className="modalTitle">Ingredient History</h3>
                {historyData.ingredient && (
                  <div className="mutedHint">
                    {historyData.ingredient.ingredient_name} | Current stock: {formatNumber(historyData.ingredient.quantity || 0)} {historyData.ingredient.base_unit || ""}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost" onClick={() => setHistoryOpen(false)}>Close</button>
            </div>

            {historyLoading ? (
              <div className="tableLoading">Loading history...</div>
            ) : (
              <div className="modalSection" style={{ display: "grid", gap: 16 }}>
                <div className="dashboardStatGrid dashboardStatGridOwnerPrimary">
                  <div className="card dashboardMetricCard">
                    <div className="dashboardMetricLabel">Current AP cost</div>
                    <div className="dashboardMetricValue">
                      {historyData.current_ap_cost != null ? formatMoney(historyData.current_ap_cost) : "-"}
                    </div>
                  </div>
                  <div className="card dashboardMetricCard">
                    <div className="dashboardMetricLabel">AP price history</div>
                    <div className="dashboardMetricValue">{historyData.ap_prices?.length || 0}</div>
                  </div>
                  <div className="card dashboardMetricCard">
                    <div className="dashboardMetricLabel">Supplier quotes</div>
                    <div className="dashboardMetricValue">{historyData.supplier_quotes?.length || 0}</div>
                  </div>
                </div>

                <div className="formRow2" style={{ alignItems: "start" }}>
                  <div className="card" style={{ padding: 16 }}>
                    <div className="tableTopBar">AP Cost Management</div>
                    <div className="formGrid">
                      <div className="formRow2">
                        <div>
                          <label>Supplier</label>
                          <input
                            className="input"
                            value={apForm.supplierName}
                            onChange={(event) => setApForm((current) => ({ ...current, supplierName: event.target.value }))}
                            placeholder="Optional supplier"
                          />
                        </div>
                        <div>
                          <label>Effective date</label>
                          <input
                            className="input"
                            type="date"
                            value={apForm.effectiveDate}
                            onChange={(event) => setApForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="formRow2">
                        <div>
                          <label>Unit</label>
                          <select
                            className="input"
                            value={apForm.unit}
                            onChange={(event) => setApForm((current) => ({ ...current, unit: event.target.value }))}
                          >
                            <option value="">Select unit</option>
                            {units.map((unit) => (
                              <option key={unit} value={unit}>{unit}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>AP cost per unit</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={apForm.apCostPerUnit}
                            onChange={(event) => setApForm((current) => ({ ...current, apCostPerUnit: event.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div>
                        <label>Notes</label>
                        <input
                          className="input"
                          value={apForm.notes}
                          onChange={(event) => setApForm((current) => ({ ...current, notes: event.target.value }))}
                          placeholder="Optional note for the price change"
                        />
                      </div>
                      <div className="formActions">
                        <button type="button" className="btn btn-primary" onClick={submitApPrice} disabled={historySaving}>
                          Save AP Price
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ padding: 16 }}>
                    <div className="tableTopBar">Supplier Quotes</div>
                    <div className="formGrid">
                      <div className="formRow2">
                        <div>
                          <label>Supplier</label>
                          <input
                            className="input"
                            value={quoteForm.supplierName}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, supplierName: event.target.value }))}
                            placeholder="Supplier name"
                          />
                        </div>
                        <div>
                          <label>Quote date</label>
                          <input
                            className="input"
                            type="date"
                            value={quoteForm.quoteDate}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, quoteDate: event.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="formRow2">
                        <div>
                          <label>Valid until</label>
                          <input
                            className="input"
                            type="date"
                            value={quoteForm.validUntil}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, validUntil: event.target.value }))}
                          />
                        </div>
                        <div>
                          <label>Brand</label>
                          <input
                            className="input"
                            value={quoteForm.brand}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, brand: event.target.value }))}
                            placeholder="Optional brand"
                          />
                        </div>
                      </div>
                      <div className="formRow2">
                        <div>
                          <label>Unit</label>
                          <select
                            className="input"
                            value={quoteForm.unit}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, unit: event.target.value }))}
                          >
                            <option value="">Select unit</option>
                            {units.map((unit) => (
                              <option key={unit} value={unit}>{unit}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Quoted quantity</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={quoteForm.quantity}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, quantity: event.target.value }))}
                            placeholder="Optional quantity"
                          />
                        </div>
                      </div>
                      <div className="formRow2">
                        <div>
                          <label>Quoted price</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={quoteForm.quotedPrice}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, quotedPrice: event.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label>Notes</label>
                          <input
                            className="input"
                            value={quoteForm.notes}
                            onChange={(event) => setQuoteForm((current) => ({ ...current, notes: event.target.value }))}
                            placeholder="Optional quote note"
                          />
                        </div>
                      </div>
                      <div className="formActions">
                        <button type="button" className="btn btn-primary" onClick={submitSupplierQuote} disabled={historySaving}>
                          Save Quote
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tableScroller">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Source</th>
                        <th>Brand</th>
                        <th>Unit</th>
                        <th className="text-right">Quantity</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.history.map((entry) => (
                        <tr key={`${entry.source_type}-${entry.id}`}>
                          <td>{formatDateLong(entry.activity_date)}</td>
                          <td>{entry.source_type === "PURCHASE_ORDER" ? "Purchase Order" : "Purchase"}</td>
                          <td>{entry.brand || "-"}</td>
                          <td>{entry.unit || historyData.ingredient?.base_unit || "-"}</td>
                          <td className="text-right mono">{formatNumber(entry.quantity || 0)}</td>
                          <td className="text-right mono">{formatMoney(entry.amount || 0)}</td>
                        </tr>
                      ))}
                      {historyData.history.length === 0 && (
                        <tr>
                          <td colSpan="6" className="tableEmpty">No purchase history found for this ingredient yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="tableScroller">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Source</th>
                        <th>Supplier</th>
                        <th>Previous Cost</th>
                        <th>New Cost</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.ap_prices.map((entry, index) => {
                        const previous = historyData.ap_prices[index + 1];
                        return (
                          <tr key={`ap-${entry.id}`}>
                            <td>{formatDateLong(entry.effective_date || entry.created_at)}</td>
                            <td>AP PRICE</td>
                            <td>{entry.supplier_name || "-"}</td>
                            <td className="text-right mono">{previous ? formatMoney(previous.ap_cost_per_unit) : "-"}</td>
                            <td className="text-right mono">{formatMoney(entry.ap_cost_per_unit)}</td>
                            <td>
                              <div className="rowActions">
                                <button type="button" className="btn btn-ghost" onClick={() => rollbackApPrice(entry.id)} disabled={historySaving}>
                                  Rollback
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {historyData.ap_prices.length === 0 && (
                        <tr>
                          <td colSpan="6" className="tableEmpty">No AP price history recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="tableScroller">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Brand</th>
                        <th>Unit</th>
                        <th className="text-right">Quoted Price</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.supplier_quotes.map((entry) => (
                        <tr key={`quote-${entry.quote_item_id || entry.id}`}>
                          <td>{formatDateLong(entry.quote_date || entry.created_at)}</td>
                          <td>{entry.supplier_name}</td>
                          <td>{entry.brand || "-"}</td>
                          <td>{entry.unit || historyData.ingredient?.base_unit || "-"}</td>
                          <td className="text-right mono">{formatMoney(entry.quoted_price)}</td>
                          <td>
                            <div className="rowActions">
                              <button type="button" className="btn" onClick={() => applySupplierQuote(entry.id)} disabled={historySaving}>
                                Use Quote
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {historyData.supplier_quotes.length === 0 && (
                        <tr>
                          <td colSpan="6" className="tableEmpty">No supplier quotes recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
