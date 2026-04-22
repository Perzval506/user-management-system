import { useMemo } from "react";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";

export default function ToDoNext({ items = [], loading = false, threshold = 5 }) {
  const stockValueFor = (item) => Number(item.total_stock ?? item.quantity ?? 0);
  const isInactive = (item) => String(item.status || "").toUpperCase() === "INACTIVE";

  const lowStock = useMemo(
    () =>
      items.filter(
        (item) =>
          !isInactive(item) &&
          stockValueFor(item) > 0 &&
          stockValueFor(item) <= threshold
      ),
    [items, threshold]
  );

  const missing = useMemo(
    () => items.filter((item) => !isInactive(item) && stockValueFor(item) <= 0),
    [items]
  );

  return (
    <div className="card watchlistCard">
      <div className="watchlistHeader">
        <h4 className="watchlistTitle">To Do Next</h4>
        <span className="watchlistSub">Inventory watchlist</span>
      </div>

      <div className="watchlistLead">
        Use this as your restock cue: low-stock items should be purchased soon, while out-of-stock items need immediate attention.
      </div>

      {loading && <div className="watchlistLoading">Checking inventory...</div>}

      {!loading && lowStock.length === 0 && missing.length === 0 && (
        <div className="watchlistHealthy">All ingredients look good.</div>
      )}

      <div className="watchlistGrid">
        {lowStock.map((item) => (
          <div key={`low-${item.id}`} className="watchlistItem watchlistItem-low">
            <div className="watchlistItemTag">Low stock</div>
            <div className="watchlistItemName">{item.ingredient_name}</div>
            <div className="watchlistItemQty">Qty: {formatNumber(stockValueFor(item))}</div>
            {item.lastUpdated && <div className="watchlistItemTime">Updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}

        {missing.map((item) => (
          <div key={`missing-${item.id}`} className="watchlistItem watchlistItem-out">
            <div className="watchlistItemTag">Out of stock</div>
            <div className="watchlistItemName">{item.ingredient_name}</div>
            <div className="watchlistItemQty">Qty: {formatNumber(stockValueFor(item))}</div>
            {item.lastUpdated && <div className="watchlistItemTime">Last updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
