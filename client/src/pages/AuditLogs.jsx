export default function AuditLogs() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Audit Logs</h2>
          <div className="pageSub">Track important user and system activities.</div>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>No audit entries yet</div>
        <div className="pageSub" style={{ marginTop: 0 }}>
          Audit table, filters, and search will appear here once logging data is connected.
        </div>
      </div>
    </div>
  );
}
