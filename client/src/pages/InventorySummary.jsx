import React, { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { formatNumber } from "../utils/formatters";
import { useToast } from "../components/Toast";
import ToDoNext from "../components/ToDoNext";

export default function InventorySummary() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/inventory/summary");
      setRows(res.data || []);
    } catch (error) {
      toast.push({ type: "error", title: "Load failed", message: error?.response?.data?.message || error.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

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

      <div className="tableWrap">
        <div className="tableTopBar">Stock</div>
        {loading ? (
          <div style={{ padding: 12 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Unit</th>
                  <th className="text-right" style={{ width: 180 }}>Total Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700 }}>{row.ingredient_name}</td>
                    <td>{row.base_unit || "-"}</td>
                    <td className="text-right mono" style={{ width: 180 }}>{formatNumber(row.total_stock)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan="3" style={{ padding: 12, opacity: 0.7 }}>No ingredients found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
