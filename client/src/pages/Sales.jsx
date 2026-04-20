import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

function todayInManila() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

function dateKeyInManila(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = parts.reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${map.year}-${map.month}-${map.day}`;
}

function defaultSaleLine() {
  return {
    menuItemId: "",
    quantity: "1.00",
    takeoutContainerId: "",
    takeoutContainerQty: "1.00",
    takeoutContainerUnitPrice: "0.00",
  };
}

function isTakeoutContainerCategory(category) {
  const normalized = String(category || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return normalized === "TAKE OUT CONTAINERS" || normalized === "TAKEOUT CONTAINERS" || normalized.includes("CONTAINER");
}

function supportsContainerCharge(orderType) {
  return orderType === "TAKEOUT" || orderType === "DELIVERY";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function Sales() {
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const canOverrideClosedDay = currentUser?.role === "OWNER";
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [containerItems, setContainerItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [summary, setSummary] = useState({ totalRevenue: 0, totalTransactions: 0, todayRevenue: 0, selectedDayRevenue: 0, selectedDayTransactions: 0 });
  const [dayStatus, setDayStatus] = useState({ saleDate: todayInManila(), isClosed: false, closedAt: null, closedByName: null, totalRevenue: 0, totalTransactions: 0 });
  const [form, setForm] = useState({
    saleDate: todayInManila(),
    orderType: "DINE_IN",
    guestName: "",
    notes: "",
    lines: [defaultSaleLine()],
  });
  const [voidingSale, setVoidingSale] = useState(null);
  const [completingDay, setCompletingDay] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [salesResponse, menuResponse, ingredientsResponse] = await Promise.all([
        api.get("/sales", { params: { date: form.saleDate } }),
        api.get("/menu"),
        api.get("/ingredients"),
      ]);
      setSummary(salesResponse.data?.summary || { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0, selectedDayRevenue: 0, selectedDayTransactions: 0 });
      setSales(salesResponse.data?.items || []);
      setBreakdown(salesResponse.data?.breakdown || []);
      setDayStatus(salesResponse.data?.dayStatus || { saleDate: form.saleDate, isClosed: false, closedAt: null, closedByName: null, totalRevenue: 0, totalTransactions: 0 });
      setMenuItems((menuResponse.data || []).filter((item) => item.status !== "INACTIVE"));
      setContainerItems(
        (ingredientsResponse.data || [])
          .filter((item) => item.status !== "INACTIVE" && isTakeoutContainerCategory(item.category))
          .map((item) => ({
            ...item,
            unitPrice: Number(item.current_ap_cost || 0),
          }))
      );
    } catch (error) {
      pushToast({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load sales",
      });
    } finally {
      setLoading(false);
    }
  }, [form.saleDate, pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  const salePreviewTotal = useMemo(
    () =>
      form.lines.reduce((sum, line) => {
        const selected = menuItems.find((item) => String(item.id) === String(line.menuItemId));
        const qty = Number(line.quantity);
        const price = Number(selected?.selling_price || 0);
        const containerQty = Number(line.takeoutContainerQty);
        const containerUnitPrice = Number(line.takeoutContainerUnitPrice);
        if (!selected || !Number.isFinite(qty) || qty <= 0) return sum;
        const containerTotal =
          supportsContainerCharge(form.orderType) &&
          line.takeoutContainerId &&
          Number.isFinite(containerQty) &&
          containerQty > 0 &&
          Number.isFinite(containerUnitPrice) &&
          containerUnitPrice >= 0
            ? containerQty * containerUnitPrice
            : 0;
        return sum + qty * price + containerTotal;
      }, 0),
    [form.lines, form.orderType, menuItems]
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
      lines: [...current.lines, defaultSaleLine()],
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
        takeoutContainerIngredientId:
          supportsContainerCharge(form.orderType) && Number(line.takeoutContainerId) > 0 ? Number(line.takeoutContainerId) : null,
        takeoutContainerQty:
          supportsContainerCharge(form.orderType) && Number(line.takeoutContainerId) > 0 ? Number(line.takeoutContainerQty) : 0,
        takeoutContainerUnitPrice:
          supportsContainerCharge(form.orderType) && Number(line.takeoutContainerId) > 0 ? Number(line.takeoutContainerUnitPrice) : 0,
      }))
      .filter((line) => Number.isFinite(line.menuItemId) && line.menuItemId > 0);

    if (!cleanedLines.length) {
      return pushToast({ type: "error", title: "Missing item", message: "Add at least one menu item to the sale." });
    }
    if (cleanedLines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      return pushToast({ type: "error", title: "Invalid quantity", message: "Each sale line needs a quantity greater than 0." });
    }
    if (
      supportsContainerCharge(form.orderType) &&
      cleanedLines.some(
        (line) =>
          line.takeoutContainerIngredientId &&
          (!Number.isFinite(line.takeoutContainerQty) ||
            line.takeoutContainerQty <= 0 ||
            !Number.isFinite(line.takeoutContainerUnitPrice) ||
            line.takeoutContainerUnitPrice < 0)
      )
    ) {
      return pushToast({
        type: "error",
        title: "Invalid takeout container",
        message: "Each selected takeout container needs a quantity greater than 0 and a valid unit price.",
      });
    }
    if (dayStatus.isClosed) {
      return pushToast({ type: "error", title: "Day already completed", message: `Sales for ${formatDateLong(form.saleDate)} are already closed.` });
    }

    setSaving(true);
    try {
      await api.post("/sales", {
        saleDate: form.saleDate,
        orderType: form.orderType,
        guestName: form.guestName.trim() || null,
        notes: form.notes.trim() || null,
        items: cleanedLines,
      });
      pushToast({ type: "success", title: "Saved", message: "Sale recorded successfully." });
      setForm({
        saleDate: todayInManila(),
        orderType: "DINE_IN",
        guestName: "",
        notes: "",
        lines: [defaultSaleLine()],
      });
      await load();
    } catch (error) {
      pushToast({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to record sale",
      });
    } finally {
      setSaving(false);
    }
  }

  async function completeSalesDay() {
    if (!form.saleDate) return;
    setCompletingDay(true);
    try {
      const response = await api.post("/sales/complete-day", { saleDate: form.saleDate });
      pushToast({
        type: "success",
        title: "Day completed",
        message: `${formatDateLong(response.data?.saleDate || form.saleDate)} is now closed.`,
      });
      await load();
    } catch (error) {
      pushToast({
        type: "error",
        title: "Unable to complete day",
        message: error?.response?.data?.message || error.message || "Failed to complete sales for the day",
      });
    } finally {
      setCompletingDay(false);
    }
  }

  async function confirmVoidSale() {
    if (!voidingSale) return;
    try {
      await api.patch(`/sales/${voidingSale.id}/void`);
      pushToast({ type: "success", title: "Sale voided", message: `Sale #${voidingSale.id} was voided.` });
      setVoidingSale(null);
      await load();
    } catch (error) {
      pushToast({
        type: "error",
        title: "Void failed",
        message: error?.response?.data?.message || error.message || "Failed to void sale",
      });
    }
  }

  function printSalesSummary() {
    const popup = window.open("", "_blank", "width=980,height=720");
    if (!popup) {
      pushToast({ type: "error", title: "Popup blocked", message: "Allow popups first so the sales summary can open." });
      return;
    }

    const salesRows = sales
      .map(
        (sale) => `
          <tr>
            <td>${escapeHtml(formatGuestCheckNo(sale.id))}</td>
            <td>${escapeHtml(formatDateTimeFriendly(sale.sale_datetime))}</td>
            <td>${escapeHtml(String(sale.order_type || "DINE_IN").replace("_", " "))}</td>
            <td>${escapeHtml(sale.guest_name || "-")}</td>
            <td>${escapeHtml(sale.cashier_name || "-")}</td>
            <td style="text-align:right">${escapeHtml(formatNumber(sale.line_count || 0, 0))}</td>
            <td style="text-align:right">${escapeHtml(formatMoney(sale.net_amount || 0))}</td>
            <td>${escapeHtml(sale.status || "-")}</td>
          </tr>`
      )
      .join("");

    const breakdownRows = breakdown
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.menu_name || "-")}</td>
            <td style="text-align:right">${escapeHtml(formatNumber(item.quantity_sold || 0))}</td>
            <td style="text-align:right">${escapeHtml(formatMoney(item.revenue || 0))}</td>
          </tr>`
      )
      .join("");

    popup.document.write(`<!DOCTYPE html>
      <html>
        <head>
          <title>Sales Summary - ${escapeHtml(formatDateLong(form.saleDate))}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1, h2 { margin: 0 0 8px; }
            .meta { margin-bottom: 18px; color: #4b5563; }
            .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 20px; }
            .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
            .label { color: #6b7280; font-size: 12px; margin-bottom: 6px; }
            .value { font-size: 20px; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; vertical-align: top; }
            th { background: #f3f4f6; text-align: left; }
            .section { margin-top: 24px; }
          </style>
        </head>
        <body>
          <h1>Sales Summary</h1>
          <div class="meta">Selected day: ${escapeHtml(formatDateLong(form.saleDate))}</div>
          <div class="cards">
            <div class="card"><div class="label">Selected day revenue</div><div class="value">${escapeHtml(formatMoney(summary.selectedDayRevenue || 0))}</div></div>
            <div class="card"><div class="label">Completed sales</div><div class="value">${escapeHtml(formatNumber(summary.selectedDayTransactions || 0, 0))}</div></div>
            <div class="card"><div class="label">Day status</div><div class="value">${escapeHtml(dayStatus.isClosed ? "DAY COMPLETED" : "OPEN")}</div></div>
            <div class="card"><div class="label">Printed at</div><div class="value">${escapeHtml(formatDateTimeFriendly(new Date()))}</div></div>
          </div>

          <div class="section">
            <h2>Sales History</h2>
            <table>
              <thead>
                <tr>
                  <th>Guest Check</th>
                  <th>Date</th>
                  <th>Order Type</th>
                  <th>Guest / Table</th>
                  <th>Cashier</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${salesRows || '<tr><td colspan="8">No sales recorded for this date.</td></tr>'}</tbody>
            </table>
          </div>

          <div class="section">
            <h2>Revenue Breakdown</h2>
            <table>
              <thead>
                <tr>
                  <th>Menu Item</th>
                  <th>Qty Sold</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>${breakdownRows || '<tr><td colspan="3">No revenue breakdown for this date.</td></tr>'}</tbody>
            </table>
          </div>
        </body>
      </html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Sales</h2>
          <div className="pageSub">Record completed sales and compare revenue using the same clean workflow as purchasing.</div>
        </div>
        <div className="pageActions">
          <button type="button" className="btn" onClick={printSalesSummary}>Print Summary</button>
          <button type="button" className="btn btn-ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="salesSummaryGrid">
        <SummaryCard label="Total revenue" value={formatMoney(summary.totalRevenue)} />
        <SummaryCard label="Today" value={formatMoney(summary.todayRevenue)} />
        <SummaryCard label={`Selected day (${formatDateLong(form.saleDate)})`} value={formatMoney(summary.selectedDayRevenue)} />
        <SummaryCard label="Completed sales" value={formatNumber(summary.totalTransactions || 0, 0)} />
        <SummaryCard label="Current sale preview" value={formatMoney(salePreviewTotal)} />
      </div>

      <div className="card salesDayCard">
        <div>
          <div className="salesDayMetaLabel">Sales day status</div>
          <div className="salesDayMetaRow">
            <span className={`badge ${dayStatus.isClosed ? "badge-active" : "badge-muted"}`}>
              {dayStatus.isClosed ? "DAY COMPLETED" : "OPEN"}
            </span>
            <span className="salesDayDate">{formatDateLong(dayStatus.saleDate || form.saleDate)}</span>
            <span className="salesDayNote">
              {dayStatus.isClosed
                ? `Closed by ${dayStatus.closedByName || "staff"} on ${formatDateTimeFriendly(dayStatus.closedAt)}`
                : `${formatNumber(summary.selectedDayTransactions || 0, 0)} completed sale(s) totaling ${formatMoney(summary.selectedDayRevenue || 0)}`}
            </span>
            {dayStatus.isClosed && canOverrideClosedDay ? (
              <span className="salesDayWarning">
                Owner may void existing sales for corrections, but cannot add new ones.
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={completeSalesDay} disabled={completingDay || dayStatus.isClosed}>
          {dayStatus.isClosed ? "Day Completed" : completingDay ? "Completing..." : "Complete Sales Day"}
        </button>
      </div>

      <div className="card salesFormCard">
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
              <label>Order type</label>
              <select
                className="input"
                value={form.orderType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    orderType: event.target.value,
                    lines:
                      supportsContainerCharge(event.target.value)
                        ? current.lines
                        : current.lines.map((line) => ({
                            ...line,
                            takeoutContainerId: "",
                            takeoutContainerQty: "1.00",
                            takeoutContainerUnitPrice: "0.00",
                          })),
                  }))
                }
              >
                <option value="DINE_IN">DINE IN</option>
                <option value="TAKEOUT">TAKEOUT</option>
                <option value="DELIVERY">DELIVERY</option>
              </select>
            </div>
          </div>

          <div className="formRow2">
            <div>
              <label>Guest / Table</label>
              <input
                className="input"
                value={form.guestName}
                onChange={(event) => setForm((current) => ({ ...current, guestName: event.target.value }))}
                placeholder="e.g., GC 12, Table 4, Umbay"
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

          <div className="tableWrap salesItemsTableWrap">
            <div className="tableTopBar">Sale Items</div>
            <div className="tableScroller">
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>Menu item</th>
                    <th className="text-right">Quantity</th>
                    <th className="text-right">Current price</th>
                    {supportsContainerCharge(form.orderType) ? <th>Takeout container</th> : null}
                    {supportsContainerCharge(form.orderType) ? <th className="text-right">Container total</th> : null}
                    <th className="text-right">Line total</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => {
                    const selected = menuItems.find((item) => String(item.id) === String(line.menuItemId));
                    const qty = Number(line.quantity);
                    const containerQty = Number(line.takeoutContainerQty);
                    const containerUnitPrice = Number(line.takeoutContainerUnitPrice);
                    const containerTotal =
                      supportsContainerCharge(form.orderType) &&
                      line.takeoutContainerId &&
                      Number.isFinite(containerQty) &&
                      containerQty > 0 &&
                      Number.isFinite(containerUnitPrice) &&
                      containerUnitPrice >= 0
                        ? containerQty * containerUnitPrice
                        : 0;
                    const lineTotal = (Number.isFinite(qty) && qty > 0 ? qty * Number(selected?.selling_price || 0) : 0) + containerTotal;

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
                                {item.menu_name} [{item.menu_type || "FOOD"}]
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
                        {supportsContainerCharge(form.orderType) ? (
                          <td>
                            <div className="salesContainerGrid">
                              <select
                                className="input"
                                value={line.takeoutContainerId}
                                onChange={(event) => {
                                  const selectedContainer = containerItems.find((item) => String(item.id) === String(event.target.value));
                                  updateLine(index, {
                                    takeoutContainerId: event.target.value,
                                    takeoutContainerQty: event.target.value ? line.takeoutContainerQty || line.quantity || "1.00" : "1.00",
                                    takeoutContainerUnitPrice: selectedContainer ? String(Number(selectedContainer.unitPrice || 0).toFixed(2)) : "0.00",
                                  });
                                }}
                              >
                                <option value="">No container charge</option>
                                {containerItems.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {String(item.ingredient_name || "").toUpperCase()} [{item.base_unit || "-"}]
                                  </option>
                                ))}
                              </select>
                              {line.takeoutContainerId ? (
                                <div className="formRow2">
                                  <input
                                    className="input"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={line.takeoutContainerQty}
                                    onChange={(event) => updateLine(index, { takeoutContainerQty: event.target.value })}
                                    placeholder="Qty"
                                  />
                                  <input
                                    className="input"
                                    type="number"
                                    min="0.00"
                                    step="0.01"
                                    value={line.takeoutContainerUnitPrice}
                                    onChange={(event) => updateLine(index, { takeoutContainerUnitPrice: event.target.value })}
                                    placeholder="Unit price"
                                  />
                                </div>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                        {supportsContainerCharge(form.orderType) ? <td className="text-right mono">{formatMoney(containerTotal)}</td> : null}
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

          <div className="salesActionsBar">
            <button type="button" className="btn" onClick={addLine}>Add Line</button>
            <button type="submit" className="btn btn-primary" disabled={saving || dayStatus.isClosed}>
              {dayStatus.isClosed ? "Sales Closed For This Day" : saving ? "Saving..." : "Record Sale"}
            </button>
          </div>
        </form>
      </div>

      <div className="salesBottomGrid">
        <div className="tableWrap">
          <div className="tableTopBar">Sales History</div>
          {loading ? (
            <div className="tableLoading">Loading...</div>
          ) : (
            <div className="tableScroller">
              <table className="table table-wide-xl">
                <thead>
                  <tr>
                    <th>Guest Check</th>
                    <th>Date</th>
                    <th>Order Type</th>
                    <th>Guest / Table</th>
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
                      <td className="mono">{formatGuestCheckNo(sale.id)}</td>
                      <td>{formatDateTimeFriendly(sale.sale_datetime)}</td>
                      <td>{String(sale.order_type || "DINE_IN").replace("_", " ")}</td>
                      <td>{sale.guest_name || "-"}</td>
                      <td>{sale.cashier_name || "-"}</td>
                      <td className="text-right mono">{formatNumber(sale.line_count || 0, 0)}</td>
                      <td className="text-right mono">{formatMoney(sale.net_amount || 0)}</td>
                      <td>
                        <span className={`badge ${sale.status === "COMPLETED" ? "badge-active" : "badge-inactive"}`}>
                          {sale.status}
                        </span>
                      </td>
                      <td>
                        {sale.status === "COMPLETED" && (!(dayStatus.isClosed && dateKeyInManila(sale.sale_datetime) === form.saleDate) || canOverrideClosedDay) ? (
                          <button type="button" className="btn btn-ghost" onClick={() => setVoidingSale(sale)}>
                            Void
                          </button>
                        ) : (
                          <span className="salesLocked">Locked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sales.length === 0 && (
                    <tr>
                      <td colSpan="9" className="tableEmpty">No sales recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="tableWrap">
          <div className="tableTopBar">Revenue Breakdown</div>
          <div className="tableScroller">
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
                    <td className="tableStrong">{item.menu_name}</td>
                    <td className="text-right mono">{formatNumber(item.quantity_sold || 0)}</td>
                    <td className="text-right mono">{formatMoney(item.revenue || 0)}</td>
                  </tr>
                ))}
                {breakdown.length === 0 && (
                  <tr>
                    <td colSpan="3" className="tableEmpty">Revenue breakdown will appear here once sales are recorded.</td>
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
        message={voidingSale ? `Void ${formatGuestCheckNo(voidingSale.id)} from ${formatDateLong(voidingSale.sale_datetime)}?` : ""}
        confirmLabel="Void Sale"
        onCancel={() => setVoidingSale(null)}
        onConfirm={confirmVoidSale}
      />
    </div>
  );
}

function formatGuestCheckNo(id) {
  return `GC-${String(id || "").padStart(5, "0")}`;
}

function SummaryCard({ label, value }) {
  return (
    <div className="card dashboardMetricCard">
      <div className="salesSummaryCardLabel">{label}</div>
      <div className="mono salesSummaryCardValue">{value}</div>
    </div>
  );
}
