import { useMemo } from "react";

export default function ToDoNext({ items = [], loading = false, threshold = 5 }) {
  const lowStock = useMemo(
    () => items.filter((i) => Number(i.quantity ?? 0) > 0 && Number(i.quantity ?? 0) < threshold && i.status !== "INACTIVE"),
    [items, threshold]
  );

  const missing = useMemo(
    () => items.filter((i) => Number(i.quantity ?? 0) <= 0 || i.status === "INACTIVE"),
    [items]
  );

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>To Do Next</h4>
        <span style={{ color: "#6B7280" }}>Inventory watchlist</span>
      </div>

      {loading && <div style={{ color: "#6B7280" }}>Checking inventory...</div>}

      {!loading && lowStock.length === 0 && missing.length === 0 && (
        <div style={{ color: "#16a34a", fontWeight: 700 }}>All ingredients look good.</div>
      )}

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {lowStock.map((i) => (
          <div key={`low-${i.id}`} className="card" style={{ borderColor: "rgba(234,179,8,0.35)" }}>
            <div style={{ fontWeight: 800 }}>Low stock</div>
            <div style={{ color: "#b45309" }}>{i.ingredient_name}</div>
            <div style={{ marginTop: 4 }}>Qty: {i.quantity ?? 0}</div>
            {i.lastUpdated && <div style={{ color: "#6B7280", marginTop: 2 }}>Updated: {new Date(i.lastUpdated).toLocaleString()}</div>}
          </div>
        ))}

        {missing.map((i) => (
          <div key={`missing-${i.id}`} className="card" style={{ borderColor: "rgba(239,68,68,0.35)" }}>
            <div style={{ fontWeight: 800 }}>Missing ingredient</div>
            <div style={{ color: "#b91c1c" }}>{i.ingredient_name}</div>
            <div style={{ marginTop: 4 }}>Qty: {i.quantity ?? 0}</div>
            {i.lastUpdated && <div style={{ color: "#6B7280", marginTop: 2 }}>Last updated: {new Date(i.lastUpdated).toLocaleString()}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
