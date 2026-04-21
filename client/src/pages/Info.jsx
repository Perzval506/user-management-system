import { useNavigate } from "react-router-dom";
import "../styles/landing.css";

export default function Info() {
  const navigate = useNavigate();

  return (
    <div className="lp lp-infoPage">
      <div className="lp-infoWrap">
        <button
          type="button"
          className="lp-backBtn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <span aria-hidden="true">←</span>
          Back
        </button>

        <div className="lp-infoPanel">
          <h1 className="lp-titleInfo">System Info</h1>
          <p className="lp-subtitleInfo">
            Boyd&apos;s Pizza House User Management System
          </p>

          <div className="lp-infoCard">
            <div className="lp-infoRow">
              <span className="lp-label">Access Roles</span>
              <span className="lp-value">OWNER, CASHIER, STOCKROOM_STAFF</span>
            </div>
            <div className="lp-infoRow">
              <span className="lp-label">Purpose</span>
              <span className="lp-value">Account management and audit logs</span>
            </div>
            <div className="lp-infoRow">
              <span className="lp-label">Focus</span>
              <span className="lp-value">Reliable day-to-day restaurant operations</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
