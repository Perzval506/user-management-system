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
          <h2 className="pageTitle">Inventory Summary</h2>
          <div className="pageSub">Review current stock levels, transfers, and adjustment history across all tracked ingredients.</div>
        </div>
        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <button className="btn" onClick={() => openTransfer()}>Transfer Stock</button>
          <button className="btn btn-primary" onClick={() => openAdjustment()}>Record Adjustment</button>
        </div>
      </div>

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
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Movement</th>
                <th className="text-right">Change</th>
                <th className="text-right">Resulting stock</th>
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
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    {hasLocationSupport && <th className="text-right">Stockroom</th>}
                    {hasLocationSupport && <th className="text-right">Shelf</th>}
                    <th className="text-right">Total Stock</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedRows[category].map((row) => (
                    <tr key={row.id}>
                      <td className="inventoryCategoryName">{row.ingredient_name}</td>
                      <td>{row.base_unit || "-"}</td>
                      {hasLocationSupport && <td className="text-right mono">{formatNumber(row.stockroom_qty || 0)}</td>}
                      {hasLocationSupport && <td className="text-right mono">{formatNumber(row.shelf_qty || 0)}</td>}
                      <td className="text-right mono">{formatNumber(row.total_stock)}</td>
                      <td>
                        <div className="rowActions">
                          {row.locations_supported && (
                            <button type="button" className="btn btn-ghost" onClick={() => openTransfer(row)}>
                              Transfer
                            </button>
                          )}
                          <button type="button" className="btn" onClick={() => openAdjustment(row)}>
                            Adjust
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
              <h3 className="modalTitle">Record Adjustment</h3>
              <button className="btn btn-ghost" onClick={() => setAdjustmentOpen(false)}>Close</button>
            </div>
            <div className="formGrid modalSection">
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
              <div className="formRow2">
                <div>
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
                <div>
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
                <div className="inventoryHintText">
                  Available by location: STOCKROOM {formatNumber(selectedAdjustmentRow.stockroom_qty || 0)} | SHELF{" "}
                  {formatNumber(selectedAdjustmentRow.shelf_qty || 0)} | TOTAL {formatNumber(selectedAdjustmentRow.total_stock || 0)}
                </div>
              )}
              <div>
                <label>Quantity change</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={adjustmentForm.quantityChange}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, quantityChange: event.target.value }))}
                  placeholder="Use negative for stock loss, positive for stock gain"
                />
              </div>
              <div>
                <label>Reason</label>
                <input
                  className="input"
                  value={adjustmentForm.reason}
                  onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="e.g., Spoiled due to improper storage"
                />
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
