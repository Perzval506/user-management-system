import React, { useEffect, useState } from "react";
import api from "../services/api";
import { formatNumber } from "../utils/formatters";
import { useToast } from "../components/Toast";

export default function InventorySummary() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/inventory/summary");
      setRows(res.data || []);
    } catch (err) {
      toast.push({ type: "error", title: "Load failed", message: err?.response?.data?.message || err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Inventory Summary</h2>
          <div className="pageSub">All ingredients with total stock (current + purchased).</div>
        </div>
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

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
                  <th className="text-right">Total Stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.ingredient_name}</td>
                    <td>{r.base_unit || "-"}</td>
                    <td className="text-right mono">{formatNumber(r.total_stock)}</td>
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
