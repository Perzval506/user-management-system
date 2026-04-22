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

  const primaryMetrics = [
    {
      label: "Inventory value",
      value: formatMoney(reports.summary.total_inventory_value),
      tone: "neutral",
    },
    {
      label: "Net sales",
      value: formatMoney(reports.summary.monthly_sales),
      tone: "success",
    },
    {
      label: "Low stock",
      value: formatNumber(reports.summary.low_stock_count, 0),
      tone: reports.summary.low_stock_count > 0 ? "warning" : "neutral",
    },
    {
      label: "Costing alerts",
      value: formatNumber(reports.summary.costing_alert_count, 0),
      tone: reports.summary.costing_alert_count > 0 ? "danger" : "neutral",
    },
  ];

  const secondaryMetrics = [
    { label: "Gross sales", value: formatMoney(reports.summary.monthly_gross_sales) },
    { label: "Food cost", value: `${formatNumber(reports.summary.estimated_food_cost_percent)}%` },
    { label: "Gross profit", value: formatMoney(reports.summary.estimated_gross_profit) },
    { label: "Discounts", value: formatMoney(reports.summary.monthly_discount_amount) },
    { label: "Break-even items", value: formatNumber(reports.summary.break_even_item_count, 0) },
    { label: "Price gap", value: formatMoney(reports.summary.suggested_price_variance) },
    { label: "Pending requests", value: formatNumber(reports.summary.pending_purchase_count, 0) },
    { label: "Active promos", value: formatNumber(reports.summary.active_promo_count, 0) },
  ];

  return (
    <div className="page reportsPage">
      <div className="card reportsHero">
        <div className="reportsHeroCopy">
          <div className="sectionEyebrow">Reporting center</div>
          <h2 className="pageTitle">Reports</h2>
          <div className="pageSub">Stock, sales, purchasing, and pricing in one cleaner workspace.</div>
        </div>
        <div className="pageActions reportsHeroActions">
          <button className="btn" onClick={saveSnapshot} disabled={snapshotSaving}>
            {snapshotSaving ? "Saving..." : "Save Snapshot"}
          </button>
          <button className="btn btn-ghost" onClick={printPage}>Print</button>
          <button className="btn btn-ghost" onClick={load}>{loading ? "Refreshing..." : "Refresh"}</button>
        </div>
      </div>

      <div className="reportsOverview">
        <div className="reportsPrimaryMetrics">
          {primaryMetrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
          ))}
        </div>
        <div className="card reportsSecondaryCard">
          <div className="reportsSectionHead reportsSectionHead-compact">
            <div>
              <div className="reportsSectionTitle">Supporting metrics</div>
              <div className="reportsSectionSub">Additional sales, pricing, and purchasing totals.</div>
            </div>
          </div>
          <div className="reportsMiniGrid">
            {secondaryMetrics.map((metric) => (
              <MiniMetricCard key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
        </div>
      </div>

      <div className="reportGrid reportGridTop">
        <ReportTable
          title="Saved snapshots"
          subtitle="Point-in-time summaries for later review."
          className="reportTableCard-emphasis"
        >
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

        <div className="reportsStack">
          <ReportTable title="Costing alerts" subtitle="Items that need price review.">
            <table className="table reportTable reportTableMedium reportAlertsTable">
              <thead>
                <tr>
                  <th>Menu Item</th>
                  <th>Status</th>
                  <th className="text-right">Current price</th>
                  <th className="text-right">Suggested price</th>
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

          <ReportTable title="Most profitable items" subtitle="Current best margin items.">
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
                {!loading && (reports.mostProfitableItems || []).length === 0 && (
                  <tr><td colSpan="3" className="tableEmpty">No pricing data available yet.</td></tr>
                )}
              </tbody>
            </table>
          </ReportTable>
        </div>
      </div>

      <ReportSection
        eyebrow="Inventory"
        title="Stock and purchasing"
        sub="Current inventory value, restock risk, and recent buying activity."
      >
        <ReportTable
          title="Inventory valuation"
          subtitle="Current on-hand value by ingredient."
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
            title="Low stock"
            subtitle="Items that need attention soon."
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
            title="Purchase history"
            subtitle="Latest purchasing activity."
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
        </div>
      </ReportSection>

      <ReportSection
        eyebrow="Sales"
        title="Sales and pricing"
        sub="Revenue trends, top sellers, and menu price review."
      >
        <div className="reportGrid reportGridTwo">
          <ReportTable
            title="Top sellers"
            subtitle="Best-selling menu items."
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

          <ReportTable
            title="Menu price review"
            subtitle="Current price versus recipe cost."
            actionLabel="Export CSV"
            onAction={() =>
              exportCsv(
                "cost-vs-selling-price-report.csv",
                ["Menu Item", "Current Selling Price", "Total Cost Per Serving", "Suggested Selling Price", "Profit Per Serving", "Profit Margin", "Status"],
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
                  <th className="text-right">Current price</th>
                  <th className="text-right">Cost / Serving</th>
                  <th className="text-right">Suggested price</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Margin</th>
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
        </div>

        <div className="reportGrid reportGridThree">
          <ReportTable title="Sales by day" subtitle="Daily totals.">
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

          <ReportTable title="Sales by week" subtitle="Weekly totals.">
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

          <ReportTable title="Sales by month" subtitle="Monthly totals.">
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

        <ReportTable title="Sales treatment" subtitle="Which statuses count toward revenue.">
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
      </ReportSection>

      <ReportSection
        eyebrow="Exceptions"
        title="Waste and spoilage"
        sub="Inventory losses and reasons recorded by the team."
      >
        <ReportTable title="Wastage log" subtitle="Recent spoilage and wastage activity.">
          <table className="table reportTable reportTableCompact reportSalesSummaryTable">
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
      </ReportSection>
    </div>
  );
}

function MetricCard({ label, value, tone = "neutral" }) {
  return (
    <div className={`card dashboardMetricCard reportsMetricCard reportsMetricCard-${tone}`}>
      <div className="dashboardMetricLabel">{label}</div>
      <div className="dashboardMetricValue">{value}</div>
    </div>
  );
}

function MiniMetricCard({ label, value }) {
  return (
    <div className="reportsMiniStat">
      <div className="reportsMiniLabel">{label}</div>
      <div className="reportsMiniValue">{value}</div>
    </div>
  );
}

function ReportSection({ eyebrow, title, sub, children }) {
  return (
    <section className="reportsSection">
      <div className="reportsSectionHead">
        <div>
          <div className="sectionEyebrow">{eyebrow}</div>
          <h3 className="reportsSectionTitle">{title}</h3>
          {sub ? <div className="reportsSectionSub">{sub}</div> : null}
        </div>
      </div>
      <div className="reportsSectionBody">{children}</div>
    </section>
  );
}

function ReportTable({ title, subtitle, children, actionLabel, onAction, className = "" }) {
  return (
    <div className={`tableWrap reportTableCard ${className}`.trim()}>
      <div className="tableTopBar reportTableTopBar">
        <div className="reportTableHeading">
          <span className="reportTableTitle">{title}</span>
          {subtitle ? <span className="reportTableSub">{subtitle}</span> : null}
        </div>
        {actionLabel ? <button className="btn btn-ghost reportTableAction" onClick={onAction}>{actionLabel}</button> : null}
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
