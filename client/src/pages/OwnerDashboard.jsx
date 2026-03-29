export default function OwnerDashboard() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Dashboard</h2>
          <div className="pageSub">Overview of your operations will appear here.</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="card">
          <div className="pageSub" style={{ marginTop: 0 }}>Users</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>0</div>
        </div>
        <div className="card">
          <div className="pageSub" style={{ marginTop: 0 }}>Active Sessions</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>0</div>
        </div>
        <div className="card">
          <div className="pageSub" style={{ marginTop: 0 }}>System Alerts</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>0</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800 }}>Coming next</div>
        <div className="pageSub">Dashboard widgets and trend charts will be added in this panel.</div>
      </div>
    </div>
  );
}
