import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

export default function Sales() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [summary, setSummary] = useState({ totalRevenue: 0, totalTransactions: 0, todayRevenue: 0 });
  const [form, setForm] = useState({
    saleDate: new Date().toISOString().slice(0, 10),
    notes: "",
    lines: [{ menuItemId: "", quantity: "1.00" }],
  });
  const [voidingSale, setVoidingSale] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [salesResponse, menuResponse] = await Promise.all([api.get("/sales"), api.get("/menu")]);
      setSummary(salesResponse.data?.summary || { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0 });
      setSales(salesResponse.data?.items || []);
      setBreakdown(salesResponse.data?.breakdown || []);
      setMenuItems((menuResponse.data || []).filter((item) => item.status !== "INACTIVE"));
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load sales",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const salePreviewTotal = useMemo(
    () =>
      form.lines.reduce((sum, line) => {
        const selected = menuItems.find((item) => String(item.id) === String(line.menuItemId));
        const qty = Number(line.quantity);
        const price = Number(selected?.selling_price || 0);
        if (!selected || !Number.isFinite(qty) || qty <= 0) return sum;
        return sum + qty * price;
      }, 0),
    [form.lines, menuItems]
  );

  function updateLine(index, patch) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, { menuItemId: "", quantity: "1.00" }],
    }));
  }

  function removeLine(index) {
    setForm((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  async function submitSale(event) {
    event?.preventDefault();
    const cleanedLines = form.lines
      .map((line) => ({
        menuItemId: Number(line.menuItemId),
        quantity: Number(line.quantity),
      }))
      .filter((line) => Number.isFinite(line.menuItemId) && line.menuItemId > 0);

    if (!cleanedLines.length) {
      return toast.push({ type: "error", title: "Missing item", message: "Add at least one menu item to the sale." });
    }
    if (cleanedLines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      return toast.push({ type: "error", title: "Invalid quantity", message: "Each sale line needs a quantity greater than 0." });
    }

    setSaving(true);
    try {
      await api.post("/sales", {
        saleDate: form.saleDate,
        notes: form.notes.trim() || null,
        items: cleanedLines,
      });
      toast.push({ type: "success", title: "Saved", message: "Sale recorded successfully." });
      setForm({
        saleDate: new Date().toISOString().slice(0, 10),
        notes: "",
        lines: [{ menuItemId: "", quantity: "1.00" }],
      });
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to record sale",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmVoidSale() {
    if (!voidingSale) return;
    try {
      await api.patch(`/sales/${voidingSale.id}/void`);
      toast.push({ type: "success", title: "Sale voided", message: `Sale #${voidingSale.id} was voided.` });
      setVoidingSale(null);
      await load();
    } catch (error) {
      toast.push({
        type: "error",
        title: "Void failed",
        message: error?.response?.data?.message || error.message || "Failed to void sale",
      });
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Sales</h2>
          <div className="pageSub">Record completed sales and compare revenue using the same clean workflow as purchasing.</div>
        </div>
        <div className="pageActions">
          <button type="button" className="btn btn-ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <SummaryCard label="Total revenue" value={formatMoney(summary.totalRevenue)} />
        <SummaryCard label="Today" value={formatMoney(summary.todayRevenue)} />
        <SummaryCard label="Completed sales" value={formatNumber(summary.totalTransactions || 0, 0)} />
        <SummaryCard label="Current sale preview" value={formatMoney(salePreviewTotal)} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <form className="formGrid" onSubmit={submitSale}>
          <div className="formRow2">
            <div>
              <label>Sale date</label>
              <input
                className="input"
                type="date"
                value={form.saleDate}
                onChange={(event) => setForm((current) => ({ ...current, saleDate: event.target.value }))}
              />
            </div>
            <div>
              <label>Notes</label>
              <input
                className="input"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional note"
              />
            </div>
          </div>

          <div className="tableWrap" style={{ marginTop: 8 }}>
            <div className="tableTopBar">Sale Items</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Menu item</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Current price</th>
                    <th className="text-right">Line total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => {
                    const selected = menuItems.find((item) => String(item.id) === String(line.menuItemId));
                    const qty = Number(line.quantity);
                    const lineTotal = Number.isFinite(qty) && qty > 0 ? qty * Number(selected?.selling_price || 0) : 0;

                    return (
                      <tr key={`sale-line-${index}`}>
                        <td>
                          <select
                            className="input"
                            value={line.menuItemId}
                            onChange={(event) => updateLine(index, { menuItemId: event.target.value })}
                          >
                            <option value="">Select menu item</option>
                            {menuItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.menu_name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="text-right">
                          <input
                            className="input"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={line.quantity}
                            onChange={(event) => updateLine(index, { quantity: event.target.value })}
                          />
                        </td>
                        <td className="text-right mono">{selected?.selling_price != null ? formatMoney(selected.selling_price) : "-"}</td>
                        <td className="text-right mono">{formatMoney(lineTotal)}</td>
                        <td>
                          <div className="rowActions">
                            <button type="button" className="btn btn-ghost" onClick={() => removeLine(index)} disabled={form.lines.length === 1}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={addLine}>Add Line</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Record Sale"}
            </button>
          </div>
        </form>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 1fr)", marginTop: 14 }}>
        <div className="tableWrap">
          <div className="tableTopBar">Sales History</div>
          {loading ? (
            <div style={{ padding: 12 }}>Loading...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Cashier</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDateTimeFriendly(sale.sale_datetime)}</td>
                      <td>{sale.cashier_name || "-"}</td>
                      <td className="text-right mono">{formatNumber(sale.line_count || 0, 0)}</td>
                      <td className="text-right mono">{formatMoney(sale.net_amount || 0)}</td>
                      <td>
                        <span className={`badge ${sale.status === "COMPLETED" ? "badge-active" : "badge-inactive"}`}>
                          {sale.status}
                        </span>
                      </td>
                      <td>
                        {sale.status === "COMPLETED" ? (
                          <button type="button" className="btn btn-ghost" onClick={() => setVoidingSale(sale)}>
                            Void
                          </button>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>Locked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sales.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>No sales recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tableWrap">
          <div className="tableTopBar">Revenue Breakdown</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Menu item</th>
                  <th className="text-right">Qty sold</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((item) => (
                  <tr key={item.menu_item_id}>
                    <td style={{ fontWeight: 700 }}>{item.menu_name}</td>
                    <td className="text-right mono">{formatNumber(item.quantity_sold || 0)}</td>
                    <td className="text-right mono">{formatMoney(item.revenue || 0)}</td>
                  </tr>
                ))}
                {breakdown.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ padding: 12, opacity: 0.7 }}>Revenue breakdown will appear here once sales are recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(voidingSale)}
        title="Void sale?"
        message={voidingSale ? `Void sale #${voidingSale.id} from ${formatDateLong(voidingSale.sale_datetime)}?` : ""}
        confirmLabel="Void Sale"
        onCancel={() => setVoidingSale(null)}
        onConfirm={confirmVoidSale}
      />
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="card">
      <div style={{ color: "#6B7280", marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
