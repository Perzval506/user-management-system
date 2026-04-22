import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

const EMPTY_REPORTS = {
  summary: {
    total_inventory_value: 0,
    monthly_sales: 0,
    monthly_gross_sales: 0,
    monthly_discount_amount: 0,
    estimated_food_cost_percent: 0,
    estimated_gross_profit: 0,
    break_even_item_count: 0,
    suggested_price_variance: 0,
    low_stock_count: 0,
    costing_alert_count: 0,
    pending_purchase_count: 0,
    active_promo_count: 0,
  },
  inventoryValuation: [],
  lowStock: [],
  purchaseHistory: [],
  topSelling: [],
  costVsSellingPrice: [],
  salesSummary: { byDay: [], byWeek: [], byMonth: [] },
  salesStatusSummary: [],
  wastageReport: [],
};

const REPORT_REFRESH_MS = 60000;

export default function Reports() {
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState(EMPTY_REPORTS);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotSaving, setSnapshotSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reportResponse, snapshotResponse] = await Promise.all([
        api.get("/reports"),
        api.get("/reports/snapshots"),
      ]);
      setReports({ ...EMPTY_REPORTS, ...(reportResponse.data || {}) });
      setSnapshots(snapshotResponse.data || []);
    } catch (error) {
      pushToast({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to load reports",
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      load();
    }, REPORT_REFRESH_MS);
    const handleFocus = () => {
      load();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load]);

  const costAlerts = useMemo(
    () => (reports.costVsSellingPrice || []).filter((row) => row.status === "Loss" || row.status === "Low Profit"),
    [reports.costVsSellingPrice]
  );

  function printPage() {
    window.print();
  }

  async function saveSnapshot() {
    const defaultName = `Reports Snapshot ${new Date().toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    })}`;
    const snapshotName = window.prompt("Snapshot name", defaultName);
    if (snapshotName === null) return;
    const trimmedName = snapshotName.trim();
    if (!trimmedName) {
      pushToast({ type: "error", title: "Missing name", message: "Add a snapshot name before saving." });
      return;
    }

    setSnapshotSaving(true);
    try {
      await api.post("/reports/snapshots", { snapshot_name: trimmedName });
      pushToast({ type: "success", title: "Snapshot saved", message: "The current reports were saved for future review." });
      const snapshotResponse = await api.get("/reports/snapshots");
      setSnapshots(snapshotResponse.data || []);
    } catch (error) {
      pushToast({
        type: "error",
        title: "Save failed",
        message: error?.response?.data?.message || error.message || "Failed to save report snapshot",
      });
    } finally {
      setSnapshotSaving(false);
    }
  }

  function exportCsv(filename, headers, rows) {
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page reportsPage">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Reports</h2>
          <div className="pageSub">Review cost, stock, purchasing, and sales performance in one place.</div>
        </div>
        <div className="pageActions">
          <button className="btn" onClick={saveSnapshot} disabled={snapshotSaving}>
            {snapshotSaving ? "Saving..." : "Save Snapshot"}
          </button>
          <button className="btn btn-ghost" onClick={printPage}>Print</button>
          <button className="btn btn-ghost" onClick={load}>{loading ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>

      <ReportTable title="Saved Report Snapshots">
        <table className="table reportTable reportTableWide">
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Saved By</th>
              <th>Date Saved</th>
              <th className="text-right">Inventory Value</th>
              <th className="text-right">Monthly Sales</th>
              <th className="text-right">Low Stock</th>
              <th className="text-right">Costing Alerts</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snapshot) => (
              <tr key={snapshot.id}>
                <td className="tableStrong">{snapshot.snapshot_name}</td>
                <td>{snapshot.created_by_name || "-"}</td>
                <td>{formatDateTimeFriendly(snapshot.created_at)}</td>
                <td className="text-right mono">{formatMoney(snapshot.summary?.total_inventory_value || 0)}</td>
                <td className="text-right mono">{formatMoney(snapshot.summary?.monthly_sales || 0)}</td>
                <td className="text-right mono">{formatNumber(snapshot.summary?.low_stock_count || 0, 0)}</td>
                <td className="text-right mono">{formatNumber(snapshot.summary?.costing_alert_count || 0, 0)}</td>
              </tr>
            ))}
            {!loading && snapshots.length === 0 && (
              <tr><td colSpan="7" className="tableEmpty">No saved report snapshots yet.</td></tr>
            )}
          </tbody>
        </table>
      </ReportTable>

      <div className="dashboardStatGrid dashboardStatGridOwnerPrimary">
        <MetricCard label="Inventory value" value={formatMoney(reports.summary.total_inventory_value)} />
        <MetricCard label="Monthly net sales" value={formatMoney(reports.summary.monthly_sales)} />
        <MetricCard label="Monthly gross sales" value={formatMoney(reports.summary.monthly_gross_sales)} />
        <MetricCard label="Estimated food cost %" value={`${formatNumber(reports.summary.estimated_food_cost_percent)}%`} />
        <MetricCard label="Low stock items" value={formatNumber(reports.summary.low_stock_count, 0)} />
        <MetricCard label="Costing alerts" value={formatNumber(reports.summary.costing_alert_count, 0)} />
      </div>

      <div className="dashboardStatGrid dashboardStatGridOwnerSecondary">
        <MetricCard label="Estimated gross profit" value={formatMoney(reports.summary.estimated_gross_profit)} />
        <MetricCard label="Monthly discounts" value={formatMoney(reports.summary.monthly_discount_amount)} />
        <MetricCard label="Break-even items" value={formatNumber(reports.summary.break_even_item_count, 0)} />
        <MetricCard label="Suggested price variance" value={formatMoney(reports.summary.suggested_price_variance)} />
        <MetricCard label="Pending purchase requests" value={formatNumber(reports.summary.pending_purchase_count, 0)} />
        <MetricCard label="Active promos" value={formatNumber(reports.summary.active_promo_count, 0)} />
      </div>

      <ReportTable
        title="Inventory Valuation"
        actionLabel="Export CSV"
        onAction={() =>
          exportCsv(
            "inventory-valuation-report.csv",
            ["Ingredient", "Category", "Quantity", "Unit", "Unit Cost", "Inventory Value", "Source", "Reference"],
            (reports.inventoryValuation || []).map((row) => [
              row.ingredient_name,
              row.category || "",
              formatNumber(row.quantity || 0),
              row.base_unit || "",
              formatMoney(row.unit_cost || 0),
              formatMoney(row.inventory_value || 0),
              row.cost_source || "",
              row.cost_reference || "",
            ])
          )
        }
      >
        <table className="table reportTable reportTableWide reportInventoryTable">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Category</th>
              <th className="text-right">Quantity</th>
              <th>Unit</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Inventory value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(reports.inventoryValuation || []).map((row) => (
              <tr key={row.id}>
                <td className="tableStrong">{row.ingredient_name}</td>
                <td>{row.category || "-"}</td>
                <td className="text-right mono">{formatNumber(row.quantity || 0)}</td>
                <td>{row.base_unit || "-"}</td>
                <td className="text-right mono">{formatMoney(row.unit_cost || 0)}</td>
                <td className="text-right mono">{formatMoney(row.inventory_value || 0)}</td>
                <td>{row.cost_source || "-"}</td>
              </tr>
            ))}
            {!loading && reports.inventoryValuation.length === 0 && (
              <tr><td colSpan="7" className="tableEmpty">No inventory valuation data available yet.</td></tr>
            )}
          </tbody>
        </table>
      </ReportTable>

      <div className="reportGrid reportGridTwo">
        <ReportTable
          title="Low Stock Report"
          actionLabel="Export CSV"
          onAction={() =>
            exportCsv(
              "low-stock-report.csv",
              ["Ingredient", "Category", "Quantity", "Unit", "Inventory Value"],
              (reports.lowStock || []).map((row) => [
                row.ingredient_name,
                row.category || "",
                formatNumber(row.quantity || 0),
                row.base_unit || "",
                formatMoney(row.inventory_value || 0),
              ])
            )
          }
        >
          <table className="table reportTable reportTableMedium reportLowStockTable">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Category</th>
                <th className="text-right">Quantity</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {(reports.lowStock || []).slice(0, 10).map((row) => (
                <tr key={row.id}>
                  <td className="tableStrong">{row.ingredient_name}</td>
                  <td>{row.category || "-"}</td>
                  <td className="text-right mono">{formatNumber(row.quantity || 0)}</td>
                  <td>{row.base_unit || "-"}</td>
                </tr>
              ))}
              {!loading && reports.lowStock.length === 0 && (
                <tr><td colSpan="4" className="tableEmpty">No low stock items right now.</td></tr>
              )}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable
          title="Top Selling Menu Items"
          actionLabel="Export CSV"
          onAction={() =>
            exportCsv(
              "top-selling-menu-items.csv",
              ["Menu Item", "Quantity Sold", "Revenue"],
              (reports.topSelling || []).map((row) => [
                row.menu_name,
                formatNumber(row.quantity_sold || 0),
                formatMoney(row.revenue || 0),
              ])
            )
          }
        >
          <table className="table reportTable reportTableMedium reportTopSellingTable">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th className="text-right">Quantity Sold</th>
                <th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(reports.topSelling || []).map((row) => (
                <tr key={row.menu_item_id}>
                  <td className="tableStrong">{row.menu_name}</td>
                  <td className="text-right mono">{formatNumber(row.quantity_sold || 0)}</td>
                  <td className="text-right mono">{formatMoney(row.revenue || 0)}</td>
                </tr>
              ))}
              {!loading && reports.topSelling.length === 0 && (
                <tr><td colSpan="3" className="tableEmpty">No completed sales yet.</td></tr>
              )}
            </tbody>
          </table>
        </ReportTable>
      </div>

      <ReportTable
        title="Purchase History Report"
        actionLabel="Export CSV"
        onAction={() =>
          exportCsv(
            "purchase-history-report.csv",
            ["Reference", "Source", "Supplier", "Date", "Item", "Quantity", "Total Amount"],
            (reports.purchaseHistory || []).map((row) => [
              row.reference_number,
              row.source_type,
              row.supplier_name || "",
              formatDateLong(row.activity_date),
              row.item_name || "",
              formatNumber(row.quantity || 0),
              formatMoney(row.total_amount || 0),
            ])
          )
        }
      >
        <table className="table reportTable reportTableWide reportPurchaseTable">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Source</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Item / Summary</th>
              <th className="text-right">Quantity</th>
              <th className="text-right">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {(reports.purchaseHistory || []).slice(0, 20).map((row) => (
              <tr key={`${row.source_type}-${row.reference_number}`}>
                <td className="mono">{row.reference_number}</td>
                <td>{row.source_type}</td>
                <td>{row.supplier_name || "-"}</td>
                <td>{formatDateLong(row.activity_date)}</td>
                <td>{row.item_name || "-"}</td>
                <td className="text-right mono">{formatNumber(row.quantity || 0)}</td>
                <td className="text-right mono">{formatMoney(row.total_amount || 0)}</td>
              </tr>
            ))}
            {!loading && reports.purchaseHistory.length === 0 && (
              <tr><td colSpan="7" className="tableEmpty">No purchase history available yet.</td></tr>
            )}
          </tbody>
        </table>
      </ReportTable>

      <ReportTable
        title="Cost vs Selling Price"
        actionLabel="Export CSV"
        onAction={() =>
          exportCsv(
            "cost-vs-selling-price-report.csv",
            ["Menu Item", "Current Price", "Cost Per Portion", "Suggested Price", "Profit Per Portion", "Profit Margin", "Status"],
            (reports.costVsSellingPrice || []).map((row) => [
              row.menu_name,
              row.current_price != null ? formatMoney(row.current_price) : "",
              row.cost_per_portion != null ? formatMoney(row.cost_per_portion) : "",
              row.suggested_price != null ? formatMoney(row.suggested_price) : "",
              row.profit_per_portion != null ? formatMoney(row.profit_per_portion) : "",
              row.profit_margin != null ? `${formatNumber((row.profit_margin || 0) * 100)}%` : "",
              row.status || "",
            ])
          )
        }
      >
        <table className="table reportTable reportTableWide reportCostingTable">
          <thead>
            <tr>
              <th>Menu Item</th>
              <th className="text-right">Current Price</th>
              <th className="text-right">Cost Per Portion</th>
              <th className="text-right">Suggested Price</th>
              <th className="text-right">Profit Per Portion</th>
              <th className="text-right">Profit Margin</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(reports.costVsSellingPrice || []).map((row) => (
              <tr key={row.id}>
                <td className="tableStrong">{row.menu_name}</td>
                <td className="text-right mono">{row.current_price != null ? formatMoney(row.current_price) : "-"}</td>
                <td className="text-right mono">{row.cost_per_portion != null ? formatMoney(row.cost_per_portion) : "-"}</td>
                <td className="text-right mono">{row.suggested_price != null ? formatMoney(row.suggested_price) : "-"}</td>
                <td className="text-right mono">{row.profit_per_portion != null ? formatMoney(row.profit_per_portion) : "-"}</td>
                <td className="text-right mono">{row.profit_margin != null ? `${formatNumber((row.profit_margin || 0) * 100)}%` : "-"}</td>
                <td><span className={`badge ${profitabilityBadgeClass(row.status)}`}>{row.status || "No data"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportTable>

      <div className="reportGrid reportGridThree">
        <ReportTable title="Sales Summary by Day">
          <table className="table reportTable reportTableCompact reportSalesSummaryTable">
            <thead>
              <tr>
                <th>Day</th>
                <th className="text-right">Total Sales</th>
              </tr>
            </thead>
            <tbody>
              {(reports.salesSummary.byDay || []).map((row) => (
                <tr key={row.label}>
                  <td>{formatDateLong(row.label)}</td>
                  <td className="text-right mono">{formatMoney(row.total || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable title="Sales Summary by Week">
          <table className="table reportTable reportTableCompact reportSalesSummaryTable">
            <thead>
              <tr>
                <th>Week Starting</th>
                <th className="text-right">Total Sales</th>
              </tr>
            </thead>
            <tbody>
              {(reports.salesSummary.byWeek || []).map((row) => (
                <tr key={row.label}>
                  <td>{formatDateLong(row.label)}</td>
                  <td className="text-right mono">{formatMoney(row.total || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable title="Sales Summary by Month">
          <table className="table reportTable reportTableCompact reportSalesSummaryTable">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Total Sales</th>
              </tr>
            </thead>
            <tbody>
              {(reports.salesSummary.byMonth || []).map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="text-right mono">{formatMoney(row.total || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTable>
      </div>

      <ReportTable title="Sales Inclusion / Exclusion Summary">
        <table className="table reportTable reportTableWide">
          <thead>
            <tr>
              <th>Status</th>
              <th className="text-right">Transactions</th>
              <th className="text-right">Amount</th>
              <th>Report Treatment</th>
            </tr>
          </thead>
          <tbody>
            {(reports.salesStatusSummary || []).map((row) => (
              <tr key={row.status}>
                <td><span className={`badge ${row.included_in_revenue ? "badge-active" : "badge-inactive"}`}>{row.status}</span></td>
                <td className="text-right mono">{formatNumber(row.transaction_count || 0, 0)}</td>
                <td className="text-right mono">{formatMoney(row.total_amount || 0)}</td>
                <td>{row.included_in_revenue ? "Included in daily, weekly, and monthly revenue" : "Kept for audit, excluded from revenue totals"}</td>
              </tr>
            ))}
            {!loading && (reports.salesStatusSummary || []).length === 0 && (
              <tr><td colSpan="4" className="tableEmpty">No sales transactions recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </ReportTable>

      <div className="reportGrid reportGridThree">
        <ReportTable title="Wastage / Spoilage Report">
          <table className="table reportTable reportTableMedium reportWastageTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ingredient</th>
                <th>Type</th>
                <th className="text-right">Quantity</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(reports.wastageReport || []).map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTimeFriendly(row.created_at)}</td>
                  <td className="tableStrong">{row.ingredient_name}</td>
                  <td>{String(row.movement_type || "").replace(/_/g, " ")}</td>
                  <td className="text-right mono">{formatNumber(row.quantity_change || 0)}</td>
                  <td>{row.reason || row.reference_number || "-"}</td>
                </tr>
              ))}
              {!loading && reports.wastageReport.length === 0 && (
                <tr><td colSpan="5" className="tableEmpty">No wastage or spoilage logs recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable title="Most Profitable Items">
          <table className="table reportTable reportTableCompact reportProfitTable">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th className="text-right">Profit / Portion</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(reports.mostProfitableItems || []).map((row) => (
                <tr key={row.id}>
                  <td className="tableStrong">{row.menu_name}</td>
                  <td className="text-right mono">{formatMoney(row.profit_per_portion || 0)}</td>
                  <td className="text-right mono">{formatNumber((row.profit_margin || 0) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable title="Costing Alerts">
          <table className="table reportTable reportTableMedium reportAlertsTable">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Status</th>
                <th className="text-right">Current Price</th>
                <th className="text-right">Suggested Price</th>
              </tr>
            </thead>
            <tbody>
              {costAlerts.map((row) => (
                <tr key={row.id}>
                  <td className="tableStrong">{row.menu_name}</td>
                  <td><span className={`badge ${profitabilityBadgeClass(row.status)}`}>{row.status}</span></td>
                  <td className="text-right mono">{row.current_price != null ? formatMoney(row.current_price) : "-"}</td>
                  <td className="text-right mono">{row.suggested_price != null ? formatMoney(row.suggested_price) : "-"}</td>
                </tr>
              ))}
              {!loading && costAlerts.length === 0 && (
                <tr><td colSpan="4" className="tableEmpty">No costing alerts right now.</td></tr>
              )}
            </tbody>
          </table>
        </ReportTable>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="card dashboardMetricCard">
      <div className="dashboardMetricLabel">{label}</div>
      <div className="dashboardMetricValue">{value}</div>
    </div>
  );
}

function ReportTable({ title, children, actionLabel, onAction }) {
  return (
    <div className="tableWrap reportTableCard">
      <div className="tableTopBar reportTableTopBar">
        <span>{title}</span>
        {actionLabel ? <button className="btn btn-ghost" onClick={onAction}>{actionLabel}</button> : null}
      </div>
      <div className="tableScroller">{children}</div>
    </div>
  );
}

function profitabilityBadgeClass(status) {
  if (status === "Loss") return "badge-inactive";
  if (status === "Low Profit") return "badge-pending";
  if (status === "Moderate Profit" || status === "High Profit") return "badge-active";
  return "";
}
