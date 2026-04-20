import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing.jsx";
import Info from "./pages/Info.jsx";
import Login from "./pages/Login.jsx";

import OwnerDashboard from "./pages/OwnerDashboard.jsx";
import AdminIngredients from "./pages/AdminIngredients.jsx";
import AdminMenu from "./pages/AdminMenu.jsx";
import Purchases from "./pages/Purchases.jsx";
import PurchaseOrders from "./pages/PurchaseOrders.jsx";
import PurchaseRequests from "./pages/PurchaseRequests.jsx";
import InventorySummary from "./pages/InventorySummary.jsx";
import Sales from "./pages/Sales.jsx";
import CateringOrders from "./pages/CateringOrders.jsx";

import StaffManagement from "./pages/StaffManagement.jsx";
import Staff from "./pages/Staff.jsx";

import AuditLogs from "./pages/AuditLogs.jsx";
import Settings from "./pages/Settings.jsx";

import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import AppShell from "./components/AppShell.jsx";

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/info" element={<Info />} />
      <Route path="/login" element={<Login />} />

      {/* Owner area */}
      <Route element={<ProtectedRoute allowedRoles={["OWNER"]} />}>
        <Route element={<AppShell />}>
          {/* Dashboard (empty) */}
          <Route path="/admin" element={<OwnerDashboard />} />

          {/* ✅ Owner Staff Management (User List + Create User) */}
          <Route path="/admin/staff" element={<StaffManagement />} />

          {/* Items */}
          <Route path="/admin/items/add" element={<Navigate to="/admin/items/manage?create=1" replace />} />
          <Route path="/admin/items/manage" element={<AdminIngredients />} />
          <Route path="/admin/ingredients" element={<AdminIngredients />} />
          <Route path="/admin/purchases" element={<Purchases />} />
          <Route path="/admin/purchase-requests" element={<PurchaseRequests />} />
          <Route path="/admin/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/admin/inventory/summary" element={<InventorySummary />} />
          <Route path="/admin/sales" element={<Sales />} />
          <Route path="/admin/catering-orders" element={<CateringOrders />} />

          {/* Menu */}
          {/* New consolidation: legacy menu add and recipe routes now flow into one management screen. */}
          <Route path="/admin/menu/add" element={<Navigate to="/admin/menu/manage" replace />} />
          <Route path="/admin/menu/manage" element={<AdminMenu />} />
          <Route path="/admin/menu" element={<AdminMenu />} />
          <Route path="/admin/menu/recipes" element={<Navigate to="/admin/menu/manage" replace />} />

          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      {/* Staff area */}
      <Route element={<ProtectedRoute allowedRoles={["CASHIER", "STOCKROOM_STAFF"]} />}>
        <Route element={<AppShell />}>
          <Route path="/staff" element={<Staff />} />

          <Route element={<ProtectedRoute allowedRoles={["CASHIER"]} />}>
            <Route path="/staff/sales" element={<Sales />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={["STOCKROOM_STAFF"]} />}>
            <Route path="/staff/ingredients" element={<AdminIngredients />} />
            <Route path="/staff/purchase-requests" element={<PurchaseRequests />} />
            <Route path="/staff/inventory-summary" element={<InventorySummary />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
