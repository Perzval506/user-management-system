import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";

const emptyForm = {
  ingredient_name: "",
  category: "",
  base_unit: "",
  base_unit_qty: "",
  quantity: "",
  status: "ACTIVE",
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
      const res = await api.get("/ingredients");
      setItems(res.data || []);
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

  function onChange(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
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

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          marginBottom: 14,
        }}
      >
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Active ingredients</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{activeCount}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Inactive ingredients</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{inactiveCount}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>How this works</div>
          <div style={{ lineHeight: 1.5 }}>
            Create the ingredient once, define its base unit, then update stock as purchases come in.
          </div>
        </div>
      </div>

      <ToDoNext items={items} loading={loading} />

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
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
                  <th>Quantity</th>
                  <th>Last updated</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 800 }}>{row.ingredient_name}</td>
                    <td>{row.category || "-"}</td>
                    <td>{row.base_unit_qty ? `${formatNumber(row.base_unit_qty)} ${row.base_unit}` : row.base_unit || "-"}</td>
                    <td className="text-right mono">{formatNumber(row.quantity ?? 0)}</td>
                    <td>{row.lastUpdated ? formatDateTimeFriendly(row.lastUpdated) : "-"}</td>
                    <td>
                      <span className={`badge ${row.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openEdit(row)}>Manage</button>
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
                    <td colSpan="7" style={{ opacity: 0.8, padding: 14 }}>
                      No ingredients found. Create your first ingredient to start tracking stock and recipes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* UX cleanup: ingredient setup now uses clearer management language and field guidance. */}
      {open && (
        <div style={modalBackdrop} onClick={closeModal}>
          <div style={modalCard} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{mode === "create" ? "Create Ingredient" : `Manage ${form.ingredient_name || "Ingredient"}`}</h3>
              <button className="btn btn-ghost" onClick={closeModal}>X</button>
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
                <div style={{ color: "#6B7280", marginBottom: 6, fontSize: 13 }}>
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
                <div style={{ color: "#6B7280", marginBottom: 6, fontSize: 13 }}>
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

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitForm}>{mode === "create" ? "Create" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.24)", display: "grid", placeItems: "center", padding: 12, zIndex: 200000 };
const modalCard = { width: "min(720px, 100%)", background: "white", borderRadius: 14, padding: 16, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" };
