import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../styles/shell.css";
import boydsLogo from "../assets/boyds-logo.png";
import { ToastProvider, ToastViewport } from "./Toast";

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
  box: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 8l8-4 8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M4 8v8l8 4 8-4V8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 7h12M6 12h12M6 17h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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
  const location = useLocation();
  const user = safeUser();
  const role = user?.role || "UNKNOWN";
  const name = user?.full_name || user?.name || user?.fullName || user?.username || "User";

  const [openItems, setOpenItems] = useState(false);
  const [openMenuDrop, setOpenMenuDrop] = useState(false);
  const [openPurchasingDrop, setOpenPurchasingDrop] = useState(false);
  const [openInventoryDrop, setOpenInventoryDrop] = useState(false);
  const itemsRef = useRef(null);
  const menuRef = useRef(null);
  const purchasingRef = useRef(null);
  const inventoryRef = useRef(null);

  useEffect(() => {
    setOpenItems(false);
    setOpenMenuDrop(false);
    setOpenPurchasingDrop(false);
    setOpenInventoryDrop(false);
  }, [location.pathname]);

  useEffect(() => {
    function onDoc(e) {
      const insideItems = itemsRef.current && itemsRef.current.contains(e.target);
      const insideMenu = menuRef.current && menuRef.current.contains(e.target);
      const insidePurchasing = purchasingRef.current && purchasingRef.current.contains(e.target);
      const insideInventory = inventoryRef.current && inventoryRef.current.contains(e.target);

      // Only close when click is outside all dropdown regions
      if (!insideItems && !insideMenu && !insidePurchasing && !insideInventory) {
        setOpenItems(false);
        setOpenMenuDrop(false);
        setOpenPurchasingDrop(false);
        setOpenInventoryDrop(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const isActiveGroup = (prefix) => location.pathname.startsWith(prefix);

  return (
    <ToastProvider>
      <ToastViewport />

      <div className="shell">
        <aside className="sidebar">
          <div className="brand" onClick={() => navigate("/")}>
            <div className="brandLogoWrap">
              <img src={boydsLogo} alt="Boyd’s Logo" className="brandLogo" />
            </div>
            <div className="brandText">
              <div className="brandTitle">Boyd’s Pizza House</div>
              <div className="brandSub">User Management System</div>
            </div>
          </div>

          <nav className="nav">
            {role === "OWNER" && (
              <>
                {/* ✅ FIX: end makes /admin active ONLY on exact /admin */}
                <NavLink
                  to="/admin"
                  end
                  className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{Icons.dashboard}</span>
                  <span>Dashboard</span>
                </NavLink>

                <NavLink to="/staff" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons.users}</span>
                  <span>My Staff</span>
                </NavLink>

                <div ref={itemsRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/items") || isActiveGroup("/admin/ingredients") ? "active" : ""}`}
                    onClick={() => { setOpenItems(v => !v); }}
                  >
                    <span className="ico">{Icons.box}</span>
                    <span className="navGrow">Items</span>
                    <span className={`chev ${openItems ? "up" : ""}`}>▾</span>
                  </button>

                  {openItems && (
                    <div className="dropdown">
                      <button className="dropdownItem" onClick={() => navigate("/admin/items/add")}>Add Ingredient</button>
                      <button className="dropdownItem" onClick={() => navigate("/admin/items/manage")}>Manage Ingredients</button>
                    </div>
                  )}
                </div>

                <div ref={purchasingRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/purchases") || isActiveGroup("/admin/purchase-orders") ? "active" : ""}`}
                    onClick={() => { setOpenPurchasingDrop(v => !v); }}
                  >
                    <span className="ico">{Icons.box}</span>
                    <span className="navGrow">Purchasing</span>
                    <span className={`chev ${openPurchasingDrop ? "up" : ""}`}>▾</span>
                  </button>

                  {openPurchasingDrop && (
                    <div className="dropdown">
                      <button className="dropdownItem" onClick={() => navigate("/admin/purchases")}>Quick Purchases</button>
                      <button className="dropdownItem" onClick={() => navigate("/admin/purchase-orders")}>Purchase Orders</button>
                    </div>
                  )}
                </div>

                <div ref={inventoryRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/inventory") ? "active" : ""}`}
                    onClick={() => { setOpenInventoryDrop(v => !v); }}
                  >
                    <span className="ico">{Icons.box}</span>
                    <span className="navGrow">Inventory</span>
                    <span className={`chev ${openInventoryDrop ? "up" : ""}`}>▾</span>
                  </button>

                  {openInventoryDrop && (
                    <div className="dropdown">
                      <button className="dropdownItem" onClick={() => navigate("/admin/inventory/summary")}>Inventory Summary</button>
                    </div>
                  )}
                </div>

                <div ref={menuRef} className="navGroup">
                  <button
                    type="button"
                    className={`navLink navBtn ${isActiveGroup("/admin/menu") ? "active" : ""}`}
                    onClick={() => { setOpenMenuDrop(v => !v); }}
                  >
                    <span className="ico">{Icons.menu}</span>
                    <span className="navGrow">Menu</span>
                    <span className={`chev ${openMenuDrop ? "up" : ""}`}>▾</span>
                  </button>

                  {openMenuDrop && (
                    <div className="dropdown">
                      <button className="dropdownItem" onClick={() => navigate("/admin/menu/add")}>Add Menu Item</button>
                      <button className="dropdownItem" onClick={() => navigate("/admin/menu/manage")}>Manage Menu Items</button>
                      <button className="dropdownItem" onClick={() => navigate("/admin/menu/recipes")}>Recipe</button>
                    </div>
                  )}
                </div>

                <NavLink to="/audit" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons.audit}</span>
                  <span>Audit Logs</span>
                </NavLink>

                <NavLink to="/admin/sales" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons.menu}</span>
                  <span>Sales</span>
                </NavLink>

                <NavLink to="/settings" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                  <span className="ico">{Icons.settings}</span>
                  <span>Settings</span>
                </NavLink>
              </>
            )}

            {role !== "OWNER" && (
              <NavLink to="/staff" className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}>
                <span className="ico">{Icons.users}</span>
                <span>My Profile</span>
              </NavLink>
            )}
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

            <div className="topbarSpacer" />

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
    </ToastProvider>
  );
}
