import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/layout.css";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = user?.role;

  const onLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand" onClick={() => navigate("/")}>
            <div className="brand-mark">UMS</div>
            <div className="brand-text">
              <div className="brand-title">User Management System</div>
              <div className="brand-sub">Role: {role || "unknown"}</div>
            </div>
          </div>

          <nav className="nav">
            {role === "owner" && (
              <>
                <NavLink to="/owner" className="navlink">
                  Users
                </NavLink>
                <NavLink to="/audit" className="navlink">
                  Audit
                </NavLink>
                <NavLink to="/settings" className="navlink">
                  Settings
                </NavLink>
              </>
            )}

            {role === "staff" && (
              <NavLink to="/staff" className="navlink">
                My Profile
              </NavLink>
            )}
          </nav>

          <div className="topbar-right">
            <div className="user-pill">
              <div className="user-email">{user?.email || "no-email"}</div>
              <div className="user-role">{role || "no-role"}</div>
            </div>

            <button className="btn btn-ghost" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
