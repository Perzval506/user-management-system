import { useNavigate } from "react-router-dom";

export default function Info() {
  const navigate = useNavigate();

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 52 }}>
      <div className="card card-pad">
        <h1 className="h1">System Info</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Boyd’s Pizza House User Management System (UMS)
        </p>

        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <div className="card card-pad" style={{ boxShadow: "none" }}>
            <div className="small muted">Access</div>
            <div style={{ fontWeight: 800 }}>OWNER, CASHIER, STOCKROOM_STAFF</div>
          </div>

          <div className="card card-pad" style={{ boxShadow: "none" }}>
            <div className="small muted">Purpose</div>
            <div style={{ fontWeight: 800 }}>Account management + audit logs</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>Back</button>
        </div>
      </div>
    </div>
  );
}