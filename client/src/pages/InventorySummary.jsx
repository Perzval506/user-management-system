import React, { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { formatNumber } from "../utils/formatters";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";
import { compareInventoryCategories, normalizeInventoryCategory } from "../utils/inventoryCategories";

export default function InventorySummary() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [weeklyReview, setWeeklyReview] = useState({ recommendations: [], categories: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, weeklyRes] = await Promise.all([api.get("/inventory/summary"), api.get("/inventory/weekly-review")]);
      setRows(summaryRes.data || []);
      setWeeklyReview(weeklyRes.data || { recommendations: [], categories: [] });
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const groupedRows = rows.reduce((acc, row) => {
    const category = normalizeInventoryCategory(row.category);
    acc[category] = acc[category] || [];
    acc[category].push({ ...row, category });
    return acc;
  }, {});
  const sortedCategories = Object.keys(groupedRows).sort(compareInventoryCategories);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Inventory Summary</h2>
          <div className="pageSub">Review current stock levels across all tracked ingredients.</div>
        </div>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      {/* UX cleanup: the watchlist is surfaced here so stock risks are visible before scanning the full table. */}
      <ToDoNext items={rows} loading={loading} />

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 900 }}>Weekly Stock Review</div>
            <div style={{ color: "#6B7280", marginTop: 4 }}>
              Use this review before buying. It combines current stock, last 7 days of purchases, and last 7 days of usage.
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {(weeklyReview.categories || [])
            .slice()
            .sort((a, b) => compareInventoryCategories(a.category, b.category))
            .map((group) => (
              <div key={group.category} className="card" style={{ background: "#f8fafc" }}>
                <div style={{ color: "#6B7280", marginBottom: 6 }}>{group.category}</div>
                <div style={{ fontWeight: 800 }}>{group.recommended_buy_count} to review</div>
                <div style={{ color: "#6B7280", marginTop: 6, fontSize: 12 }}>
                  {group.low_stock_count} low stock, {group.out_of_stock_count} out of stock
                </div>
              </div>
            ))}
        </div>
        <div className="tableWrap" style={{ marginTop: 14 }}>
          <div className="tableTopBar">Recommended Buys This Week</div>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Bought (7d)</th>
                  <th className="text-right">Used (7d)</th>
                  <th className="text-right">Suggested buy</th>
                </tr>
              </thead>
              <tbody>
                {(weeklyReview.recommendations || []).filter((item) => item.needs_attention).slice(0, 20).map((item) => (
                  <tr key={`review-${item.id}`}>
                    <td>{normalizeInventoryCategory(item.category)}</td>
                    <td style={{ fontWeight: 700 }}>{item.ingredient_name}</td>
                    <td>{item.base_unit || "-"}</td>
                    <td className="text-right mono">{formatNumber(item.total_stock)}</td>
                    <td className="text-right mono">{formatNumber(item.weekly_purchased)}</td>
                    <td className="text-right mono">{formatNumber(item.weekly_used)}</td>
                    <td className="text-right mono">{formatNumber(item.recommended_buy_qty)}</td>
                  </tr>
                ))}
                {!loading && !(weeklyReview.recommendations || []).some((item) => item.needs_attention) && (
                  <tr><td colSpan="7" style={{ padding: 12, opacity: 0.7 }}>No urgent weekly buys suggested right now.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {sortedCategories.map((category) => (
        <div key={category} className="tableWrap" style={{ marginTop: 14 }}>
          <div className="tableTopBar">{category}</div>
          {loading ? (
            <div style={{ padding: 12 }}>Loading...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ tableLayout: "fixed", width: "100%" }}>
                <colgroup>
                  <col />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 220 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th style={{ textAlign: "left" }}>Unit</th>
                    <th className="text-right">Total Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows[category].map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 700, wordBreak: "break-word" }}>{row.ingredient_name}</td>
                      <td style={{ textAlign: "left" }}>{row.base_unit || "-"}</td>
                      <td className="text-right mono">{formatNumber(row.total_stock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
