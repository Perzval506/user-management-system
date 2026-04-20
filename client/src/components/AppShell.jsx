import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../styles/shell.css";
import boydsLogo from "../assets/boyds-logo.png";
import { ToastProvider, ToastViewport, useToast } from "./Toast";
import { getQuickActions, getQuickActionSelection, quickActionEvents } from "../utils/quickActions";
import { applyUiPreferences, getFontSizePreference, getThemePreference } from "../utils/preferences";

const SIDEBAR_PREF_KEY = "ums.sidebar.collapsed";

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

function homePathForRole(role) {
  return role === "OWNER" ? "/admin" : "/staff";
}

function staffNavItemsForRole(role) {
  if (role === "CASHIER") {
    return [
      { to: "/staff", label: "My Profile", icon: "users" },
      { to: "/staff/sales", label: "Sales", icon: "sales" },
    ];
  }

  if (role === "STOCKROOM_STAFF") {
    return [
      { to: "/staff", label: "My Profile", icon: "users" },
      { to: "/staff/ingredients", label: "Ingredients", icon: "box" },
      { to: "/staff/inventory-summary", label: "Stock Summary", icon: "box" },
      { to: "/staff/purchase-requests", label: "Purchase Requests", icon: "purchasing" },
    ];
  }

  return [{ to: "/staff", label: "My Profile", icon: "users" }];
}

const Icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 13.5V6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v10.4A2.8 2.8 0 0 1 17.2 20H10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17.5h6.5V11H4v6.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-1.2c0-1.7-1.8-3.1-4-3.1s-4 1.4-4 3.1V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 12.5a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 8l8-4 8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 8v8l8 4 8-4V8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 7h12M6 12h12M6 17h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  sales: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 15V9M12 15V6M17 15v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  purchasing: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 6h2l1.3 7.2A2 2 0 0 0 10.3 15h6.9a2 2 0 0 0 2-1.6L20 8H8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11" cy="18.2" r="1.2" fill="currentColor" />
      <circle cx="17" cy="18.2" r="1.2" fill="currentColor" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M7 3h10v4H7V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 7h12v14H6V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 11h6M9 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19 12a7.2 7.2 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L14.5 3h-5L9.2 5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6A7.2 7.2 0 0 0 5 12c0 .34.03.67.08 1l-2 1.6 2 3.4 2.4-1c.52.42 1.09.77 1.7 1l.3 2h5l.3-2c.61-.23 1.18-.58 1.7-1l2.4 1 2-3.4-2-1.6c.06-.33.1-.66.1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4a5 5 0 0 0-5 5v2.8c0 .8-.27 1.57-.76 2.18L5 15.5h14l-1.24-1.52a3.5 3.5 0 0 1-.76-2.18V9a5 5 0 0 0-5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  ),
};

function formatNotifTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function TopbarNotifications() {
  const { history = [], unreadCount = 0, markAllRead, clearHistory } = useToast();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const recent = history.slice(0, 8);

  useEffect(() => {
    if (open) markAllRead();
  }, [open, markAllRead]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, []);

  return (
    <div className="notifyWrap" ref={wrapRef}>
      <button
        type="button"
        className={`notifyBtn ${open ? "open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Open notifications"
      >
        <span className="notifyIcon">{Icons.bell}</span>
        {unreadCount > 0 ? <span className="notifyBadge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>

      <div className={`notifyPanel ${open ? "open" : ""}`}>
        <div className="notifyHeader">
          <div className="notifyTitle">Notifications</div>
          {history.length > 0 ? (
            <button type="button" className="notifyClearBtn" onClick={clearHistory}>
              Clear
            </button>
          ) : null}
        </div>

        {recent.length === 0 ? (
          <div className="notifyEmpty">No notifications yet.</div>
        ) : (
          <div className="notifyList">
            {recent.map((item) => (
              <div key={item.id} className={`notifyItem notify-${item.type}`}>
                <div className="notifyItemTop">
                  <div className="notifyItemTitle">{item.title || "Notice"}</div>
                  <div className="notifyItemTime">{formatNotifTime(item.createdAt)}</div>
                </div>
                <div className="notifyItemMsg">{item.message || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickActionsFab({ role, pathname, navigate }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const [selectedActionIds, setSelectedActionIds] = useState(() => getQuickActionSelection(role));

  const actions = getQuickActions(role)
    .filter((item) => selectedActionIds.includes(item.id))
    .map((item) => ({
      ...item,
      icon: Icons[item.iconKey] || Icons.box,
    }));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    setSelectedActionIds(getQuickActionSelection(role));
  }, [role]);

  useEffect(() => {
    function onQuickActionUpdate() {
      setSelectedActionIds(getQuickActionSelection(role));
    }

    window.addEventListener(quickActionEvents.updated, onQuickActionUpdate);
    return () => window.removeEventListener(quickActionEvents.updated, onQuickActionUpdate);
  }, [role]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, []);

  return (
    <div className="quickFabWrap" ref={wrapRef}>
      <div className={`quickFabPanel ${open ? "open" : ""}`}>
        <div className="quickFabTitle">Quick Actions</div>
        {actions.length === 0 ? (
          <div className="quickFabEmpty">
            <div>No quick actions selected.</div>
            {role === "OWNER" ? (
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/settings")}>
                Manage in Settings
              </button>
            ) : null}
          </div>
        ) : (
          <div className="quickFabList">
            {actions.map((item) => (
              <button
                key={item.to}
                type="button"
                className={`quickFabItem ${pathname === item.to ? "active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  navigate(item.to);
                }}
              >
                <span className="quickFabItemIcon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`quickFabBtn ${open ? "open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Toggle quick actions"
      >
        <span className="quickFabBtnIcon">{Icons.plus}</span>
      </button>
    </div>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = safeUser();
  const role = user?.role || "UNKNOWN";
  const name = user?.full_name || user?.name || user?.fullName || user?.username || "User";

  const [openItems, setOpenItems] = useState(false);
  const [openPurchasingDrop, setOpenPurchasingDrop] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const itemsRef = useRef(null);
  const purchasingRef = useRef(null);

  useEffect(() => {
    function onDoc(event) {
      const insideItems = itemsRef.current && itemsRef.current.contains(event.target);
      const insidePurchasing =
        purchasingRef.current && purchasingRef.current.contains(event.target);

      if (!insideItems && !insidePurchasing) {
        setOpenItems(false);
        setOpenPurchasingDrop(false);
      }
    }

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    applyUiPreferences({
      theme: getThemePreference(),
      fontSize: getFontSizePreference(),
    });
  }, []);

  const onLogout = () => {
    setLogoutConfirmOpen(false);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const requestLogout = () => {
    setLogoutConfirmOpen(true);
  };

  const cancelLogout = () => {
    setLogoutConfirmOpen(false);
  };

  useEffect(() => {
    if (!logoutConfirmOpen) return;
    function onEsc(e) {
      if (e.key === "Escape") setLogoutConfirmOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [logoutConfirmOpen]);

  const isActiveGroup = (prefix) => location.pathname.startsWith(prefix);

  return (
    <ToastProvider>
      <ToastViewport />

      <div className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        {/* Scrim disabled to avoid blocking clicks; sidebar toggled via button */}
        <button
          type="button"
          className="sidebarScrim"
          aria-label="Sidebar scrim disabled"
          tabIndex={-1}
          style={{ pointerEvents: "none" }}
        />

        <aside className="sidebar">
          <div className="brand" onClick={() => navigate(homePathForRole(role))}>
            <div className="brandLogoWrap">
              <img src={boydsLogo} alt="Boyd's Logo" className="brandLogo" />
            </div>
            <div className="brandText">
              <div className="brandTitle">Boyd's Pizza House</div>
              <div className="brandSub">User Management System</div>
            </div>
          </div>

          <nav className="nav">
            {role === "OWNER" && (
              <>
                <NavLink
                  to="/admin"
                  end
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.dashboard}</span>
                  <span>Dashboard</span>
                </NavLink>

                <NavLink
                  to="/admin/staff"
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.users}</span>
                  <span>My Staff</span>
                </NavLink>

                <div ref={itemsRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/items") || isActiveGroup("/admin/ingredients") ? "active" : ""}`}
                    onClick={() => {
                      setOpenItems((value) => !value);
                    }}
                  >
                    <span className="ico">{Icons.box}</span>
                    <span className="navGrow">Items</span>
                    <span className={`chev ${openItems ? "up" : ""}`}>v</span>
                  </button>

                  {openItems && (
                    <div className="dropdown open">
                      <button
                        className="dropdownItem"
                        onClick={() => navigate("/admin/items/manage")}
                      >
                        Manage Ingredients
                      </button>
                      <button
                        className="dropdownItem"
                        onClick={() => navigate("/admin/inventory/summary")}
                      >
                        Inventory Summary
                      </button>
                    </div>
                  )}
                </div>

                <div ref={purchasingRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/purchases") || isActiveGroup("/admin/purchase-requests") || isActiveGroup("/admin/purchase-orders") ? "active" : ""}`}
                    onClick={() => {
                      setOpenPurchasingDrop((value) => !value);
                    }}
                  >
                    <span className="ico">{Icons.purchasing}</span>
                    <span className="navGrow">Purchasing</span>
                    <span className={`chev ${openPurchasingDrop ? "up" : ""}`}>v</span>
                  </button>

                  {openPurchasingDrop && (
                    <div className="dropdown open">
                      <button className="dropdownItem" onClick={() => navigate("/admin/purchase-requests")}>
                        Purchase Requests
                      </button>
                      <button className="dropdownItem" onClick={() => navigate("/admin/purchases")}>
                        Quick Purchases
                      </button>
                      <button
                        className="dropdownItem"
                        onClick={() => navigate("/admin/purchase-orders")}
                      >
                        Purchase Orders
                      </button>
                    </div>
                  )}
                </div>

                <NavLink
                  to="/admin/menu/manage"
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.menu}</span>
                  <span>Menu</span>
                </NavLink>

                <NavLink
                  to="/admin/catering-orders"
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.menu}</span>
                  <span>Catering</span>
                </NavLink>

                <NavLink to="/audit" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons.audit}</span>
                  <span>Audit Logs</span>
                </NavLink>

                <NavLink
                  to="/admin/sales"
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.sales}</span>
                  <span>Sales</span>
                </NavLink>

                <NavLink
                  to="/settings"
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.settings}</span>
                  <span>Settings</span>
                </NavLink>
              </>
            )}

            {role !== "OWNER" &&
              staffNavItemsForRole(role).map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === "/staff"} className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons[item.icon] || Icons.users}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
          </nav>

          <button className="logoutBtn" onClick={requestLogout}>
            <span className="logoutDot" />
            Log Out
          </button>
        </aside>

        <div className="main">
          <header className="topbar">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
            >
              {sidebarCollapsed ? "Show Menu" : "Hide Menu"}
            </button>

            <div className="topbarSpacer" />

            <TopbarNotifications />

            <div className="profile">
              <div className="avatar">{initials(name)}</div>
              <div>
                <div className="profileName">{name}</div>
                <div className="profileRole">{role}</div>
              </div>
            </div>
          </header>

          <main className="content">
            <div className="surface routeSurface" key={location.pathname}>
              <Outlet />
            </div>
          </main>
        </div>

        <QuickActionsFab role={role} pathname={location.pathname} navigate={navigate} />

        {logoutConfirmOpen && (
          <div className="modalBackdrop" onClick={cancelLogout}>
            <div className="modalCard modalCard-sm" onClick={(e) => e.stopPropagation()}>
              <div className="modalHead">
                <h3 style={{ margin: 0 }}>Are you sure?</h3>
              </div>
              <div className="modalMessage">You will be logged out of this account.</div>
              <div className="modalActions">
                <button type="button" className="btn btn-ghost" onClick={cancelLogout}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={onLogout}>Log Out</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
