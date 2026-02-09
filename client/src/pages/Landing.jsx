import { Link, Navigate, useNavigate } from "react-router-dom";
import boydsLogo from "../assets/boyds-logo.png";
import pizzaImg from "../assets/pizza.png";
import "../styles/landing.css";

export default function Landing() {
  const navigate = useNavigate();

  // Auto-redirect if already logged in
  const token = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");
  const user = rawUser ? JSON.parse(rawUser) : null;

  if (token && user) {
    if (user.role === "OWNER") return <Navigate to="/admin" replace />;
    if (user.role === "CASHIER" || user.role === "STOCKROOM_STAFF")
      return <Navigate to="/staff" replace />;
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="lp">
      <div className="lp-topLogo">
        <img src={boydsLogo} alt="Boyd’s Pizza House" />
      </div>

      <div className="lp-wrap">
        <div className="lp-left">
          <img className="lp-pizza" src={pizzaImg} alt="Pizza" />
        </div>

        <div className="lp-right lp-rightTuned">
          <h1 className="lp-title">Boyd’s Pizza House</h1>
          <h2 className="lp-subtitle">User Management System</h2>

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
