import { useNavigate } from "react-router-dom";
import "../styles/landing.css";

export default function Info() {
  const navigate = useNavigate();

  return (
    <div className="lp">
      <div className="lp-wrap lp-wrapCenter">
        <div className="lp-center">
          <h1 className="lp-title lp-titleInfo">Boyd’s Pizza House</h1>
          <p className="lp-subtitle lp-subtitleInfo">
            This User Management System is for Boyd&apos;s staff and owner use only. Use
            this portal to securely manage accounts, roles, and access.
          </p>

          <div className="lp-infoCard">
            <div className="lp-infoRow">
              <span className="lp-label">System</span>
              <span className="lp-value">User Management System</span>
            </div>
            <div className="lp-infoRow">
              <span className="lp-label">Access</span>
              <span className="lp-value">Owner, Cashier, Stockroom Staff</span>
            </div>
            <div className="lp-infoRow">
              <span className="lp-label">Purpose</span>
              <span className="lp-value">Account management + audit logging</span>
            </div>
          </div>

          <div className="lp-actions lp-actionsCenter">
            <button className="lp-btn lp-btnOutline" onClick={() => navigate(-1)}>
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
