import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";
import { compareInventoryCategories, normalizeInventoryCategory } from "../utils/inventoryCategories";

const emptyTransferForm = {
  ingredientId: "",
  fromLocation: "STOCKROOM",
  toLocation: "SHELF",
  quantity: "",
  reason: "",
};

const emptyAdjustmentForm = {
  ingredientId: "",
  type: "SPOILAGE",
  location: "SHELF",
  quantityChange: "",
  reason: "",
};

const LOW_STOCK_THRESHOLD = 5;
const STOCK_FILTERS = [
  { id: "ALL", label: "All stock" },
  { id: "NEEDS_ATTENTION", label: "Needs attention" },
  { id: "OUT", label: "Out" },
  { id: "LOW", label: "Low" },
  { id: "GOOD", label: "Good" },
];

function stockStatusFor(row) {
  const totalStock = Number(row?.total_stock || 0);
  if (totalStock <= 0) return "OUT";
  if (totalStock <= LOW_STOCK_THRESHOLD) return "LOW";
  return "GOOD";
}

export default function InventorySummary() {
  const { push: pushToast } = useToast();
  const [rows, setRows] = useState([]);
  const [weeklyReview, setWeeklyReview] = useState({ recommendations: [], categories: [] });
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [stockFilter, setStockFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");

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

  const groupedRows = useMemo(
    () =>
      rows.reduce((acc, row) => {
        const category = normalizeInventoryCategory(row.category);
        acc[category] = acc[category] || [];
        acc[category].push({ ...row, category });
        return acc;
      }, {}),
    [rows]
  );
  const sortedCategories = Object.keys(groupedRows).sort(compareInventoryCategories);
  const hasLocationSupport = rows.some((row) => row.locations_supported);
  const stockStats = useMemo(() => {
    const outOfStock = rows.filter((row) => Number(row.total_stock || 0) <= 0).length;
    const lowStock = rows.filter((row) => {
      const stock = Number(row.total_stock || 0);
      return stock > 0 && stock <= LOW_STOCK_THRESHOLD;
    }).length;
    const suggestedBuys = (weeklyReview.recommendations || []).filter((item) => item.needs_attention).length;

    return {
      totalItems: rows.length,
      outOfStock,
      lowStock,
      suggestedBuys,
    };
  }, [rows, weeklyReview.recommendations]);
  const categorySummaries = useMemo(
    () =>
      sortedCategories.reduce((acc, category) => {
        const categoryRows = groupedRows[category] || [];
        const outOfStock = categoryRows.filter((row) => Number(row.total_stock || 0) <= 0).length;
        const lowStock = categoryRows.filter((row) => {
          const stock = Number(row.total_stock || 0);
          return stock > 0 && stock <= LOW_STOCK_THRESHOLD;
        }).length;
        acc[category] = {
          total: categoryRows.length,
          outOfStock,
          lowStock,
        };
        return acc;
      }, {}),
    [groupedRows, sortedCategories]
  );
  const reviewCategoriesToShow = useMemo(
    () =>
      (weeklyReview.categories || [])
        .slice()
        .sort((a, b) => compareInventoryCategories(a.category, b.category))
        .filter(
          (group) =>
            Number(group.recommended_buy_count || 0) > 0 ||
            Number(group.low_stock_count || 0) > 0 ||
            Number(group.out_of_stock_count || 0) > 0
        ),
    [weeklyReview.categories]
  );
  const urgentRecommendations = useMemo(
    () => (weeklyReview.recommendations || []).filter((item) => item.needs_attention).slice(0, 20),
    [weeklyReview.recommendations]
  );
  const filteredGroupedRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return sortedCategories.reduce((acc, category) => {
      if (selectedCategory !== "ALL" && category !== selectedCategory) return acc;

      const categoryRows = (groupedRows[category] || []).filter((row) => {
        const status = stockStatusFor(row);
        const matchesStatus =
          stockFilter === "ALL" ||
          (stockFilter === "NEEDS_ATTENTION" && status !== "GOOD") ||
          stockFilter === status;
        const matchesSearch =
          !query ||
          String(row.ingredient_name || "").toLowerCase().includes(query) ||
          String(row.base_unit || "").toLowerCase().includes(query) ||
          String(row.category || "").toLowerCase().includes(query);

        return matchesStatus && matchesSearch;
      });

      if (categoryRows.length > 0) acc[category] = categoryRows;
      return acc;
    }, {});
  }, [groupedRows, searchTerm, selectedCategory, sortedCategories, stockFilter]);
  const filteredCategories = Object.keys(filteredGroupedRows).sort(compareInventoryCategories);
  const filteredCount = filteredCategories.reduce((sum, category) => sum + (filteredGroupedRows[category] || []).length, 0);
  const selectedAdjustmentRow = useMemo(
    () => rows.find((row) => String(row.id) === String(adjustmentForm.ingredientId)) || null,
    [rows, adjustmentForm.ingredientId]
  );

  function openTransfer(row = null) {
    setTransferForm({
      ...emptyTransferForm,
      ingredientId: row?.id ? String(row.id) : "",
      fromLocation: row?.shelf_qty > 0 ? "SHELF" : "STOCKROOM",
      toLocation: row?.shelf_qty > 0 ? "STOCKROOM" : "SHELF",
    });
    setTransferOpen(true);
  }

  function openAdjustment(row = null) {
    setAdjustmentForm({
      ...emptyAdjustmentForm,
      ingredientId: row?.id ? String(row.id) : "",
      location: row?.locations_supported ? (Number(row.shelf_qty || 0) > 0 ? "SHELF" : "STOCKROOM") : "SHELF",
    });
    setAdjustmentOpen(true);
  }

  async function submitTransfer() {
    const quantity = Number(transferForm.quantity);
    if (!transferForm.ingredientId) {
      return pushToast({ type: "error", title: "Missing ingredient", message: "Select an ingredient to transfer." });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return pushToast({ type: "error", title: "Invalid quantity", message: "Transfer quantity must be greater than 0." });
    }
    if (transferForm.fromLocation === transferForm.toLocation) {
      return pushToast({ type: "error", title: "Invalid locations", message: "Choose different source and destination locations." });
    }

    setSubmitting(true);
    try {
      await api.post("/inventory/transfer", {
        ingredientId: Number(transferForm.ingredientId),
        fromLocation: transferForm.fromLocation,
        toLocation: transferForm.toLocation,
        quantity,
        reason: transferForm.reason,
      });
      pushToast({ type: "success", title: "Transfer recorded", message: "Stock transfer has been logged." });
      setTransferOpen(false);
      setTransferForm(emptyTransferForm);
      await load();
    } catch (error) {
      pushToast({
        type: "error",
        title: "Transfer failed",
        message: error?.response?.data?.message || error.message || "Failed to transfer stock",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAdjustment() {
    const quantityChange = Number(adjustmentForm.quantityChange);
    if (!adjustmentForm.ingredientId) {
      return pushToast({ type: "error", title: "Missing ingredient", message: "Select an ingredient to adjust." });
    }
    if (!Number.isFinite(quantityChange) || quantityChange === 0) {
      return pushToast({ type: "error", title: "Invalid quantity", message: "Adjustment quantity must not be 0." });
    }

    setSubmitting(true);
    try {
      await api.post("/inventory/adjustments", {
        ingredientId: Number(adjustmentForm.ingredientId),
        type: adjustmentForm.type,
        location: adjustmentForm.location,
        quantityChange,
        reason: adjustmentForm.reason,
      });
      pushToast({ type: "success", title: "Adjustment recorded", message: "Inventory adjustment has been saved." });
      setAdjustmentOpen(false);
      setAdjustmentForm(emptyAdjustmentForm);
      await load();
    } catch (error) {
      pushToast({
        type: "error",
        title: "Adjustment failed",
        message: error?.response?.data?.message || error.message || "Failed to save adjustment",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Stock Summary</h2>
          <div className="pageSub">Restock cues, stock changes, and count adjustments.</div>
        </div>
        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn" onClick={() => openTransfer()}>Transfer Stock</button>
          <button className="btn btn-primary" onClick={() => openAdjustment()}>Record Adjustment</button>
        </div>
      </div>

      <div className="stockSummaryGrid">
        <div className="stockSummaryCard">
          <div className="stockSummaryLabel">Tracked items</div>
          <div className="stockSummaryValue">{formatNumber(stockStats.totalItems, 0)}</div>
          <div className="stockSummaryHint">Active stock records in this view.</div>
        </div>
        <div className={`stockSummaryCard ${stockStats.outOfStock > 0 ? "stockSummaryCard-danger" : "stockSummaryCard-good"}`}>
          <div className="stockSummaryLabel">Out of stock</div>
          <div className="stockSummaryValue">{formatNumber(stockStats.outOfStock, 0)}</div>
          <div className="stockSummaryHint">Restock these first.</div>
        </div>
        <div className={`stockSummaryCard ${stockStats.lowStock > 0 ? "stockSummaryCard-warning" : "stockSummaryCard-good"}`}>
          <div className="stockSummaryLabel">Low stock</div>
          <div className="stockSummaryValue">{formatNumber(stockStats.lowStock, 0)}</div>
          <div className="stockSummaryHint">At or below {LOW_STOCK_THRESHOLD} units.</div>
        </div>
        <div className="stockSummaryCard">
          <div className="stockSummaryLabel">Suggested buys</div>
          <div className="stockSummaryValue">{formatNumber(stockStats.suggestedBuys, 0)}</div>
          <div className="stockSummaryHint">Based on recent usage.</div>
        </div>
      </div>

      <div className="stockFocusGrid">
        <ToDoNext items={rows} loading={loading} />

        <div className="card inventoryReviewCard">
          <div className="inventoryReviewHead">
            <div>
              <div className="inventoryReviewTitle">Buying Suggestions</div>
              <div className="inventoryReviewSub">Current stock, purchases, and recent usage.</div>
            </div>
          </div>
          {reviewCategoriesToShow.length > 0 ? (
            <div className="inventoryReviewStats">
              {reviewCategoriesToShow.map((group) => (
                <div key={group.category} className="inventoryReviewStat">
                  <div className="inventoryReviewStatLabel">{group.category}</div>
                  <div className="inventoryReviewStatValue">{group.recommended_buy_count} to review</div>
                  <div className="inventoryReviewStatMeta">
                    {group.low_stock_count} low stock, {group.out_of_stock_count} out of stock
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="inventoryReviewClear">
              <div className="inventoryReviewClearTitle">All buying categories are clear.</div>
              <div className="inventoryReviewClearText">No category currently needs a restock review.</div>
            </div>
          )}
          <div className="tableWrap inventoryReviewTable">
            <div className="tableTopBar">Suggested Restock List</div>
            <div className="tableSectionNote">Suggested quantities based on low stock and recent usage.</div>
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
                    <th className="text-right">Current stock</th>
                    <th className="text-right">Bought (7d)</th>
                    <th className="text-right">Used (7d)</th>
                    <th className="text-right">Suggested buy</th>
                  </tr>
                </thead>
                <tbody>
                  {urgentRecommendations.map((item) => (
                    <tr key={`review-${item.id}`}>
                      <td>{normalizeInventoryCategory(item.category)}</td>
                      <td className="inventoryReviewItemName">{item.ingredient_name}</td>
                      <td>{item.base_unit || "-"}</td>
                      <td className="text-right mono">{formatNumber(item.total_stock)}</td>
                      <td className="text-right mono">{formatNumber(item.weekly_purchased)}</td>
                      <td className="text-right mono">{formatNumber(item.weekly_used)}</td>
                      <td className="text-right mono stockSuggestedQty">{formatNumber(item.recommended_buy_qty)}</td>
                    </tr>
                  ))}
                  {!loading && urgentRecommendations.length === 0 && (
                    <tr><td colSpan="7" className="inventoryReviewEmpty">No urgent weekly buys suggested right now.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="tableWrap inventoryReviewTable">
        <div className="tableTopBar">Recent Stock Changes</div>
        <div className="tableScroller">
          <table className="table table-wide">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Change type</th>
                <th className="text-right">Change</th>
                <th className="text-right">Stock after change</th>
                <th>Notes</th>
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
                  <td>{movement.notes || movement.source_module || "-"}</td>
                  <td>{formatDateTimeFriendly(movement.created_at)}</td>
                </tr>
              ))}
              {!loading && movements.length === 0 && (
                <tr><td colSpan="6" className="inventoryReviewEmpty">No stock changes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stockFilterPanel">
        <div className="stockFilterHead">
          <div>
            <div className="stockFilterTitle">Browse Stock</div>
            <div className="stockFilterMeta">
              Showing {formatNumber(filteredCount, 0)} of {formatNumber(rows.length, 0)} item{rows.length === 1 ? "" : "s"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSelectedCategory("ALL");
              setStockFilter("ALL");
              setSearchTerm("");
            }}
            disabled={selectedCategory === "ALL" && stockFilter === "ALL" && !searchTerm}
          >
            Clear filters
          </button>
        </div>

        <div className="stockFilterGroup">
          <div className="stockFilterLabel">Category</div>
          <div className="stockChipRow">
            <button
              type="button"
              className={`stockChip ${selectedCategory === "ALL" ? "active" : ""}`}
              onClick={() => setSelectedCategory("ALL")}
            >
              All
            </button>
            {sortedCategories.map((category) => (
              <button
                type="button"
                key={category}
                className={`stockChip ${selectedCategory === category ? "active" : ""}`}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="stockFilterTools">
          <div className="stockFilterGroup">
            <div className="stockFilterLabel">Status</div>
            <div className="stockChipRow">
              {STOCK_FILTERS.map((filter) => (
                <button
                  type="button"
                  key={filter.id}
                  className={`stockChip ${stockFilter === filter.id ? "active" : ""}`}
                  onClick={() => setStockFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="stockSearchBox">
            <label>Search ingredient</label>
            <input
              className="input"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Type a name, category, or unit"
            />
          </div>
        </div>
      </div>

      {!loading && filteredCount === 0 ? (
        <div className="emptyState">No stock items match the selected filters.</div>
      ) : null}

      {filteredCategories.map((category) => (
        <div key={category} className="tableWrap inventoryCategoryTable">
          <div className="inventoryCategoryHeader">
            <div>
              <div className="inventoryCategoryTitle">{category}</div>
              <div className="inventoryCategoryMeta">
                {formatNumber((filteredGroupedRows[category] || []).length, 0)} shown of {formatNumber(categorySummaries[category]?.total || 0, 0)} item{categorySummaries[category]?.total === 1 ? "" : "s"}
              </div>
            </div>
            <div className="inventoryCategoryBadges">
              <span className={`badge ${categorySummaries[category]?.outOfStock ? "badge-inactive" : "badge-active"}`}>
                {formatNumber(categorySummaries[category]?.outOfStock || 0, 0)} out
              </span>
              <span className={`badge ${categorySummaries[category]?.lowStock ? "badge-pending" : "badge-active"}`}>
                {formatNumber(categorySummaries[category]?.lowStock || 0, 0)} low
              </span>
            </div>
          </div>
          {loading ? (
            <div className="inventoryCategoryLoading">Loading...</div>
          ) : (
            <div className="tableScroller">
              <table className="table inventoryCategoryGrid">
                <colgroup>
                  <col />
                  <col style={{ width: 90 }} />
                  {hasLocationSupport && <col style={{ width: 120 }} />}
                  {hasLocationSupport && <col style={{ width: 110 }} />}
                  <col style={{ width: 130 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 190 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    {hasLocationSupport && <th className="text-right">Stockroom</th>}
                    {hasLocationSupport && <th className="text-right">Shelf</th>}
                    <th className="text-right">Total stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGroupedRows[category].map((row) => {
                    const statusId = stockStatusFor(row);
                    const status = statusId === "OUT" ? "Out" : statusId === "LOW" ? "Low" : "Good";
                    const statusClass = status === "Out" ? "badge-inactive" : status === "Low" ? "badge-pending" : "badge-active";
                    return (
                      <tr key={row.id}>
                        <td className="inventoryCategoryName">{row.ingredient_name}</td>
                        <td>{row.base_unit || "-"}</td>
                        {hasLocationSupport && <td className="text-right mono">{formatNumber(row.stockroom_qty || 0)}</td>}
                        {hasLocationSupport && <td className="text-right mono">{formatNumber(row.shelf_qty || 0)}</td>}
                        <td className={`text-right mono ${status === "Out" ? "stockQtyDanger" : status === "Low" ? "stockQtyWarning" : ""}`}>
                          {formatNumber(row.total_stock)}
                        </td>
                        <td><span className={`badge ${statusClass}`}>{status}</span></td>
                        <td>
                          <div className="rowActions">
                            {row.locations_supported && (
                              <button type="button" className="btn btn-ghost" onClick={() => openTransfer(row)}>
                                Transfer
                              </button>
                            )}
                            <button type="button" className="btn" onClick={() => openAdjustment(row)}>
                              Count / adjust
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {transferOpen && (
        <div className="modalBackdrop" onClick={() => setTransferOpen(false)}>
          <div className="modalCard modalCard-md" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <h3 className="modalTitle">Transfer Stock</h3>
              <button className="btn btn-ghost" onClick={() => setTransferOpen(false)}>Close</button>
            </div>
            <div className="formGrid modalSection">
              <div>
                <label>Ingredient</label>
                <select
                  className="input"
                  value={transferForm.ingredientId}
                  onChange={(event) => setTransferForm((current) => ({ ...current, ingredientId: event.target.value }))}
                >
                  <option value="">Select ingredient</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>{row.ingredient_name}</option>
                  ))}
                </select>
              </div>
              <div className="formRow2">
                <div>
                  <label>From</label>
                  <select
                    className="input"
                    value={transferForm.fromLocation}
                    onChange={(event) => setTransferForm((current) => ({ ...current, fromLocation: event.target.value }))}
                  >
                    <option value="STOCKROOM">STOCKROOM</option>
                    <option value="SHELF">SHELF</option>
                  </select>
                </div>
                <div>
                  <label>To</label>
                  <select
                    className="input"
                    value={transferForm.toLocation}
                    onChange={(event) => setTransferForm((current) => ({ ...current, toLocation: event.target.value }))}
                  >
                    <option value="SHELF">SHELF</option>
                    <option value="STOCKROOM">STOCKROOM</option>
                  </select>
                </div>
              </div>
              <div>
                <label>Quantity</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferForm.quantity}
                  onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label>Reason</label>
                <input
                  className="input"
                  value={transferForm.reason}
                  onChange={(event) => setTransferForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="e.g., Kitchen prep allocation"
                />
              </div>
              <div className="formActions">
                <button type="button" className="btn btn-ghost" onClick={() => setTransferOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitTransfer} disabled={submitting}>Save Transfer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {adjustmentOpen && (
        <div className="modalBackdrop" onClick={() => setAdjustmentOpen(false)}>
          <div className="modalCard modalCard-md" onClick={(event) => event.stopPropagation()}>
            <div className="modalHead">
              <div>
                <h3 className="modalTitle">Record Adjustment</h3>
                <div className="modalMessage modalMessage-compact">Log spoilage, counts, and manual stock corrections.</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setAdjustmentOpen(false)}>Close</button>
            </div>

            <div className="adjustmentModalLayout modalSection">
              <div>
                <label>Ingredient</label>
                <select
                  className="input"
                  value={adjustmentForm.ingredientId}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, ingredientId: event.target.value }))}
                >
                  <option value="">Select ingredient</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>{row.ingredient_name}</option>
                  ))}
                </select>
              </div>

              <div className="adjustmentControlRow">
                <div className="adjustmentControlField">
                  <label>Type</label>
                  <select
                    className="input"
                    value={adjustmentForm.type}
                    onChange={(event) => setAdjustmentForm((current) => ({ ...current, type: event.target.value }))}
                  >
                    <option value="SPOILAGE">SPOILAGE</option>
                    <option value="WASTAGE">WASTAGE</option>
                    <option value="DAMAGED">DAMAGED</option>
                    <option value="MANUAL_ADD">MANUAL ADD</option>
                    <option value="MANUAL_REDUCE">MANUAL REDUCE</option>
                  </select>
                </div>
                <div className="adjustmentControlField">
                  <label>Location</label>
                  <select
                    className="input"
                    value={adjustmentForm.location}
                    onChange={(event) => setAdjustmentForm((current) => ({ ...current, location: event.target.value }))}
                  >
                    <option value="SHELF">SHELF</option>
                    <option value="STOCKROOM">STOCKROOM</option>
                  </select>
                </div>
              </div>

              {selectedAdjustmentRow?.locations_supported && (
                <div className="adjustmentAvailabilityCard">
                  <div className="adjustmentAvailabilityLabel">Available by location</div>
                  <div className="adjustmentAvailabilityGrid">
                    <div className="detailCell">
                      <div className="detailCellLabel">Stockroom</div>
                      <div className="detailCellValue mono">{formatNumber(selectedAdjustmentRow.stockroom_qty || 0)}</div>
                    </div>
                    <div className="detailCell">
                      <div className="detailCellLabel">Shelf</div>
                      <div className="detailCellValue mono">{formatNumber(selectedAdjustmentRow.shelf_qty || 0)}</div>
                    </div>
                    <div className="detailCell">
                      <div className="detailCellLabel">Total</div>
                      <div className="detailCellValue mono">{formatNumber(selectedAdjustmentRow.total_stock || 0)}</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="adjustmentInputRow">
                <div className="adjustmentQuantityField">
                  <label>Quantity change</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={adjustmentForm.quantityChange}
                    onChange={(event) => setAdjustmentForm((current) => ({ ...current, quantityChange: event.target.value }))}
                    placeholder="- for loss, + for gain"
                  />
                </div>
                <div className="adjustmentReasonField">
                  <label>Reason</label>
                  <input
                    className="input"
                    value={adjustmentForm.reason}
                    onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="e.g., Spoiled due to improper storage"
                  />
                </div>
              </div>

              <div className="formActions">
                <button type="button" className="btn btn-ghost" onClick={() => setAdjustmentOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={submitAdjustment} disabled={submitting}>Save Adjustment</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSignedNumber(value) {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${formatNumber(numeric)}`;
}
