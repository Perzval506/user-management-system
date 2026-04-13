import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateTimeFriendly } from "../utils/formatters";

const MODULE_OPTIONS = ["", "INGREDIENTS", "PURCHASES", "PURCHASE_ORDERS", "MENU", "STAFF", "SALES"];

export default function AuditLogs() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ module: "", q: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/audit-logs", {
        params: {
          module: filters.module || undefined,
          q: filters.q.trim() || undefined,
        },
      });
      setRows(res.data || []);
    } catch (error) {
      toast.push({
        type: "error",
        title: "Load failed",
        message: error?.response?.data?.message || error.message || "Failed to fetch audit logs",
      });
    } finally {
      setLoading(false);
    }
  }, [filters.module, filters.q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Audit Logs</h2>
          <div className="pageSub">Track create, update, activation, deactivation, pricing, and sales actions across the system.</div>
        </div>
        <div className="pageActions">
          <button type="button" className="btn btn-ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="formRow2">
          <div>
            <label>Module</label>
            <select
              className="input"
              value={filters.module}
              onChange={(event) => setFilters((current) => ({ ...current, module: event.target.value }))}
            >
              {MODULE_OPTIONS.map((option) => (
                <option key={option || "ALL"} value={option}>
                  {option || "All modules"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Search</label>
            <input
              className="input"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="Search action, user, or summary"
            />
          </div>
        </div>
      </div>

      <div className="tableWrap">
        <div className="tableTopBar">Audit Entries</div>
        {loading ? (
          <div style={{ padding: 12 }}>Loading...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeFriendly(row.created_at)}</td>
                    <td>{row.actor_name || "System"}</td>
                    <td>{row.module_name}</td>
                    <td>{row.action_name}</td>
                    <td>{row.summary || "-"}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: 12, opacity: 0.7 }}>No audit entries match the current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
