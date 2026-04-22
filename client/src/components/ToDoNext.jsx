import { useMemo } from "react";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";

export default function ToDoNext({ items = [], loading = false, threshold = 5 }) {
  const lowStock = useMemo(
    () =>
      items.filter(
        (item) =>
          Number(item.quantity ?? item.total_stock ?? 0) > 0 &&
          Number(item.quantity ?? item.total_stock ?? 0) <= threshold &&
          item.status !== "INACTIVE"
      ),
    [items, threshold]
  );

  const missing = useMemo(
    () =>
      items.filter(
        (item) =>
          Number(item.quantity ?? item.total_stock ?? 0) <= 0 &&
          item.status !== "INACTIVE"
      ),
    [items]
  );

  return (
    <div className="card watchlistCard">
      <div className="watchlistHeader">
        <h4 className="watchlistTitle">To Do Next</h4>
        <span className="watchlistSub">Inventory watchlist</span>
      </div>

      <div className="watchlistLead">Restock low and out-of-stock items first.</div>

      {loading && <div className="watchlistLoading">Checking inventory...</div>}

      {!loading && lowStock.length === 0 && missing.length === 0 && (
        <div className="watchlistHealthy">All ingredients look good.</div>
      )}

      <div className="watchlistGrid">
        {lowStock.map((item) => (
          <div key={`low-${item.id}`} className="watchlistItem watchlistItem-low">
            <div className="watchlistItemTag">Low stock</div>
            <div className="watchlistItemName">{item.ingredient_name}</div>
            <div className="watchlistItemQty">Qty: {formatNumber(item.quantity ?? item.total_stock ?? 0)}</div>
            {item.lastUpdated && <div className="watchlistItemTime">Updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}

        {missing.map((item) => (
          <div key={`missing-${item.id}`} className="watchlistItem watchlistItem-out">
            <div className="watchlistItemTag">Out of stock</div>
            <div className="watchlistItemName">{item.ingredient_name}</div>
            <div className="watchlistItemQty">Qty: {formatNumber(item.quantity ?? item.total_stock ?? 0)}</div>
            {item.lastUpdated && <div className="watchlistItemTime">Last updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
