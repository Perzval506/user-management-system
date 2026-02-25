import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing.jsx";
import Info from "./pages/Info.jsx";
import Login from "./pages/Login.jsx";

import Admin from "./pages/Admin.jsx";
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
          <Route path="/admin" element={<Admin />} />
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