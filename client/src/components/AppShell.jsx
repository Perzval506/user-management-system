import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import "../styles/shell.css";

function safeUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initials(nameOrEmail) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "U";
  if (s.includes("@")) return s.slice(0, 1).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "U") + (parts[1]?.[0] || "")).toUpperCase();
}

const Icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 13.5V6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v10.4A2.8 2.8 0 0 1 17.2 20H10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M4 17.5h6.5V11H4v6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-1.2c0-1.7-1.8-3.1-4-3.1s-4 1.4-4 3.1V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M12 12.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M7 3h10v4H7V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M6 7h12v14H6V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9 11h6M9 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M19 12a7.2 7.2 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L14.5 3h-5L9.2 5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6A7.2 7.2 0 0 0 5 12c0 .34.03.67.08 1l-2 1.6 2 3.4 2.4-1c.52.42 1.09.77 1.7 1l.3 2h5l.3-2c.61-.23 1.18-.58 1.7-1l2.4 1 2-3.4-2-1.6c.06-.33.1-.66.1-1Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
};

export default function AppShell() {
  const navigate = useNavigate();
  const user = safeUser();
  const role = user?.role || "UNKNOWN";
  const name = user?.name || user?.fullName || user?.email || "User";

  const [openItems, setOpenItems] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);

  const nav =
    role === "OWNER"
      ? [
          { to: "/admin", label: "Dashboard", icon: Icons.dashboard },
          { to: "/admin", label: "My Staff", icon: Icons.users },
          // Items & Menu dropdowns inserted below instead of list entries
          { to: "/audit", label: "Audit Logs", icon: Icons.audit },
          { to: "/settings", label: "Settings", icon: Icons.settings },
        ]
      : [{ to: "/staff", label: "My Profile", icon: Icons.users }];

  const onLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">B</div>
          <div>
            <div className="brandTitle">Boyd’s</div>
            <div className="brandSub">Pizza House</div>
          </div>
        </div>

        <nav className="nav">
          {/* Owner-specific ordered nav: Dashboard, My Staff, Items, Menu, then others */}
          {role === "OWNER" && (
            <>
              <NavLink to="/admin" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`} onClick={() => { setOpenItems(false); setOpenMenu(false); }}>
                <span className="ico">{Icons.dashboard}</span>
                <span>Dashboard</span>
              </NavLink>

              <NavLink to="/admin" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`} onClick={() => { setOpenItems(false); setOpenMenu(false); }}>
                <span className="ico">{Icons.users}</span>
                <span>My Staff</span>
              </NavLink>

              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="navLink"
                  onClick={() => { setOpenItems((s) => !s); setOpenMenu(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span className="ico">{Icons.users}</span>
                  <span>Items ▾</span>
                </button>

                {openItems && (
                  <div style={{ position: "absolute", left: 0, top: "100%", marginTop: 6, minWidth: 200, zIndex: 40 }}>
                    <div style={{ background: "white", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                      <div className="navLink" onClick={() => { navigate('/admin/items/add'); setOpenItems(false); }} style={{ cursor: 'pointer', padding: '10px 12px' }}>Add Ingredient</div>
                      <div className="navLink" onClick={() => { navigate('/admin/items/manage'); setOpenItems(false); }} style={{ cursor: 'pointer', padding: '10px 12px' }}>Manage Ingredients</div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="navLink"
                  onClick={() => { setOpenMenu((s) => !s); setOpenItems(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span className="ico">{Icons.dashboard}</span>
                  <span>Menu ▾</span>
                </button>

                {openMenu && (
                  <div style={{ position: "absolute", left: 0, top: "100%", marginTop: 6, minWidth: 220, zIndex: 40 }}>
                    <div style={{ background: "white", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)", overflow: "hidden" }}>
                      <div className="navLink" onClick={() => { navigate('/admin/menu/add'); setOpenMenu(false); }} style={{ cursor: 'pointer', padding: '10px 12px' }}>Add Menu Item</div>
                      <div className="navLink" onClick={() => { navigate('/admin/menu/manage'); setOpenMenu(false); }} style={{ cursor: 'pointer', padding: '10px 12px' }}>Manage Menu Items</div>
                      <div className="navLink" onClick={() => { navigate('/admin/menu/recipes'); setOpenMenu(false); }} style={{ cursor: 'pointer', padding: '10px 12px' }}>Recipe</div>
                    </div>
                  </div>
                )}
              </div>

              {/* render remaining owner nav entries (audit, settings) */}
              {nav.slice(2).map((i) => (
                <NavLink key={i.label} to={i.to} className={({ isActive }) => `navLink ${isActive ? "active" : ""}`} onClick={() => { setOpenItems(false); setOpenMenu(false); }}>
                  <span className="ico">{i.icon}</span>
                  <span>{i.label}</span>
                </NavLink>
              ))}
            </>
          )}

          {role !== "OWNER" && nav.map((i) => (
            <NavLink
              key={i.label}
              to={i.to}
              className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
            >
              <span className="ico">{i.icon}</span>
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>

        <button className="logoutBtn" onClick={onLogout}>
          <span className="logoutDot" />
          Log Out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="search">
            <span className="searchIcon">⌕</span>
            <input placeholder="Search" />
          </div>

          <div className="profile">
            <div className="avatar">{initials(name)}</div>
            <div>
              <div className="profileName">{name}</div>
              <div className="profileRole">{role}</div>
            </div>
          </div>
        </header>

        <main className="content">
          <div className="surface">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}