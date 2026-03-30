import { useMemo } from "react";
import { formatDateTimeFriendly, formatNumber } from "../utils/formatters";

export default function ToDoNext({ items = [], loading = false, threshold = 5 }) {
  const lowStock = useMemo(
    () => items.filter((item) => Number(item.quantity ?? item.total_stock ?? 0) > 0 && Number(item.quantity ?? item.total_stock ?? 0) < threshold && item.status !== "INACTIVE"),
    [items, threshold]
  );

  const missing = useMemo(
    () => items.filter((item) => Number(item.quantity ?? item.total_stock ?? 0) <= 0 || item.status === "INACTIVE"),
    [items]
  );

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="watchlistHeader">
        <h4 className="watchlistTitle">To Do Next</h4>
        <span className="watchlistSub">Inventory watchlist</span>
      </div>

      <div style={{ color: "#6B7280", marginBottom: 10, lineHeight: 1.5 }}>
        Use this as your restock cue: low-stock items should be purchased soon, while out-of-stock items need immediate attention.
      </div>

      {loading && <div style={{ color: "#6B7280" }}>Checking inventory...</div>}

      {!loading && lowStock.length === 0 && missing.length === 0 && (
        <div style={{ color: "#16a34a", fontWeight: 700 }}>All ingredients look good.</div>
      )}

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {lowStock.map((item) => (
          <div key={`low-${item.id}`} className="card" style={{ borderColor: "rgba(234,179,8,0.35)" }}>
            <div style={{ fontWeight: 800 }}>Low stock</div>
            <div style={{ color: "#b45309" }}>{item.ingredient_name}</div>
            <div style={{ marginTop: 4 }}>Qty: {formatNumber(item.quantity ?? item.total_stock ?? 0)}</div>
            {item.lastUpdated && <div style={{ color: "#6B7280", marginTop: 2 }}>Updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}

        {missing.map((item) => (
          <div key={`missing-${item.id}`} className="card" style={{ borderColor: "rgba(239,68,68,0.35)" }}>
            <div style={{ fontWeight: 800 }}>Out of stock</div>
            <div style={{ color: "#b91c1c" }}>{item.ingredient_name}</div>
            <div style={{ marginTop: 4 }}>Qty: {formatNumber(item.quantity ?? item.total_stock ?? 0)}</div>
            {item.lastUpdated && <div style={{ color: "#6B7280", marginTop: 2 }}>Last updated: {formatDateTimeFriendly(item.lastUpdated)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
