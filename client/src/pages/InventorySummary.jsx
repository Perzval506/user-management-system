import React, { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";
import { compareInventoryCategories, normalizeInventoryCategory } from "../utils/inventoryCategories";

export default function InventorySummary() {
  const { push: pushToast } = useToast();
  const [rows, setRows] = useState([]);
  const [weeklyReview, setWeeklyReview] = useState({ recommendations: [], categories: [] });
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, weeklyRes, movementRes] = await Promise.all([
        api.get("/inventory/summary"),
        api.get("/inventory/weekly-review"),
        api.get("/inventory/movements", { params: { limit: 12 } }),
      ]);
      setRows(summaryRes.data || []);
      setWeeklyReview(weeklyRes.data || { recommendations: [], categories: [] });
      setMovements(movementRes.data || []);
    } catch (error) {
      pushToast({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

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

      <div className="card inventoryReviewCard">
        <div className="inventoryReviewHead">
          <div>
            <div className="inventoryReviewTitle">Weekly Stock Review</div>
            <div className="inventoryReviewSub">
              Use this review before buying. It combines current stock, last 7 days of purchases, and last 7 days of usage.
            </div>
          </div>
        </div>
        <div className="inventoryReviewStats">
          {(weeklyReview.categories || [])
            .slice()
            .sort((a, b) => compareInventoryCategories(a.category, b.category))
            .map((group) => (
              <div key={group.category} className="inventoryReviewStat">
                <div className="inventoryReviewStatLabel">{group.category}</div>
                <div className="inventoryReviewStatValue">{group.recommended_buy_count} to review</div>
                <div className="inventoryReviewStatMeta">
                  {group.low_stock_count} low stock, {group.out_of_stock_count} out of stock
                </div>
              </div>
            ))}
        </div>
        <div className="tableWrap inventoryReviewTable">
          <div className="tableTopBar">Recommended Buys This Week</div>
          <div className="tableScroller">
            <table className="table table-wide">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 140 }} />
              </colgroup>
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
                    <td className="inventoryReviewItemName">{item.ingredient_name}</td>
                    <td>{item.base_unit || "-"}</td>
                    <td className="text-right mono">{formatNumber(item.total_stock)}</td>
                    <td className="text-right mono">{formatNumber(item.weekly_purchased)}</td>
                    <td className="text-right mono">{formatNumber(item.weekly_used)}</td>
                    <td className="text-right mono">{formatNumber(item.recommended_buy_qty)}</td>
                  </tr>
                ))}
                {!loading && !(weeklyReview.recommendations || []).some((item) => item.needs_attention) && (
                  <tr><td colSpan="7" className="inventoryReviewEmpty">No urgent weekly buys suggested right now.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="tableWrap inventoryReviewTable">
        <div className="tableTopBar">Recent Inventory Movements</div>
        <div className="tableScroller">
          <table className="table table-wide">
            <colgroup>
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 180 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Movement</th>
                <th className="text-right">Change</th>
                <th className="text-right">Resulting stock</th>
                <th>Source</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="inventoryReviewItemName">{movement.ingredient_name}</td>
                  <td>{String(movement.movement_type || "").replace(/_/g, " ")}</td>
                  <td className="text-right mono">{formatSignedNumber(movement.quantity_change)}</td>
                  <td className="text-right mono">{formatNumber(movement.resulting_quantity || 0)}</td>
                  <td>{movement.source_module || "-"}</td>
                  <td>{formatDateTimeFriendly(movement.created_at)}</td>
                </tr>
              ))}
              {!loading && movements.length === 0 && (
                <tr><td colSpan="6" className="inventoryReviewEmpty">Inventory movements will appear here once stock changes are recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sortedCategories.map((category) => (
        <div key={category} className="tableWrap inventoryCategoryTable">
          <div className="tableTopBar">{category}</div>
          {loading ? (
            <div className="inventoryCategoryLoading">Loading...</div>
          ) : (
            <div className="tableScroller">
              <table className="table inventoryCategoryGrid">
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
                      <td className="inventoryCategoryName">{row.ingredient_name}</td>
                      <td>{row.base_unit || "-"}</td>
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

function formatSignedNumber(value) {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${formatNumber(numeric)}`;
}
