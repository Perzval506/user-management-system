import { Link, Navigate, useNavigate } from "react-router-dom";
import boydsLogo from "../assets/boyds-logo.png";
import pizzaImg from "../assets/pizza.png";
import "../styles/landing.css";

export default function Landing() {
  const navigate = useNavigate();

  const token = localStorage.getItem("token");
  let user = null;
  try {
    const rawUser = localStorage.getItem("user");
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    user = null;
  }

  if (token && user) {
    if (user.role === "OWNER") return <Navigate to="/admin" replace />;
    if (user.role === "CASHIER" || user.role === "STOCKROOM_STAFF") {
      return <Navigate to="/staff" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="lp">
      <img className="lp-pizzaBg" src={pizzaImg} alt="" aria-hidden="true" />

      <div className="lp-topLogo">
        <img src={boydsLogo} alt="Boyd's Pizza House" />
      </div>

      <div className="lp-centerWrap">
        <div className="lp-hero">
          <h1 className="lp-title">Boyd's Pizza House</h1>
          <h2 className="lp-subtitle">Restaurant Operations</h2>

          <div className="lp-actions">
            <Link className="lp-btn lp-btnSolid" to="/login">
              Login
            </Link>

            <button
              className="lp-btn lp-btnOutline"
              type="button"
              onClick={() => navigate("/info")}
            >
              Info
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
