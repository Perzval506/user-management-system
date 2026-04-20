export default function Info() {
  return (
    <div className="authShell">
      <div className="card card-pad authCard infoCard">
        <h1 className="h1">System Info</h1>
        <p className="muted authSub">
          Boyd's Pizza House User Management System (UMS)
        </p>

        <div className="infoGrid">
          <div className="card card-pad infoTile">
            <div className="small muted">Access</div>
            <div className="infoTileValue">OWNER, CASHIER, STOCKROOM_STAFF</div>
          </div>

          <div className="card card-pad infoTile">
            <div className="small muted">Purpose</div>
            <div className="infoTileValue">Account management + audit logs</div>
          </div>
        </div>
      </div>
    </div>
  );
}
