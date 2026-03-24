import React from "react";
import { formatMoney } from "../utils/formatters";

const cardStyle = { padding: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface2)" };

export default function Sales() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Sales</h2>
          <div className="pageSub">Summary and list (structure ready for next sprint).</div>
        </div>
        <button className="btn btn-ghost">Export (coming soon)</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ color: "#6B7280", marginBottom: 6 }}>Total Sales</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{formatMoney(0)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#6B7280", marginBottom: 6 }}>Today</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{formatMoney(0)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ color: "#6B7280", marginBottom: 6 }}>Average Daily</div>
          <div className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{formatMoney(0)}</div>
        </div>
      </div>

      <div className="tableWrap" style={{ marginTop: 14 }}>
        <div className="tableTopBar">Sales List</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Customer</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan="5" style={{ padding: 12, opacity: 0.7 }}>Coming soon.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
