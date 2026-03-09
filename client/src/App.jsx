import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing.jsx";
import Info from "./pages/Info.jsx";
import Login from "./pages/Login.jsx";

import OwnerDashboard from "./pages/OwnerDashboard.jsx";
import AdminIngredients from "./pages/AdminIngredients.jsx";
import AdminMenu from "./pages/AdminMenu.jsx";
import AdminIngredientAdd from "./pages/AdminIngredientAdd.jsx";
import AdminMenuAdd from "./pages/AdminMenuAdd.jsx";
import AdminRecipes from "./pages/AdminRecipes.jsx";

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
          <Route path="/staff" element={<StaffManagement />} />

          {/* Items */}
          <Route path="/admin/items/add" element={<AdminIngredientAdd />} />
          <Route path="/admin/items/manage" element={<AdminIngredients />} />
          <Route path="/admin/ingredients" element={<AdminIngredients />} />

          {/* Menu */}
          <Route path="/admin/menu/add" element={<AdminMenuAdd />} />
          <Route path="/admin/menu/manage" element={<AdminMenu />} />
          <Route path="/admin/menu" element={<AdminMenu />} />
          <Route path="/admin/menu/recipes" element={<AdminRecipes />} />

          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      {/* Staff area */}
      <Route element={<ProtectedRoute allowedRoles={["CASHIER", "STOCKROOM_STAFF"]} />}>
        <Route element={<AppShell />}>
          <Route path="/staff" element={<Staff />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}