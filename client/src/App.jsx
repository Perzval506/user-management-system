import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import OwnerDashboard from "./pages/OwnerDashboard";
import StaffProfile from "./pages/StaffProfile";
import AuditLogs from "./pages/AuditLogs";
import Settings from "./pages/Settings";
import ProtectedRoute from "./routes/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./components/AppLayout";

function HomeRedirect() {
  const { user, isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;

  if (user?.role === "owner") return <Navigate to="/owner" replace />;
  if (user?.role === "staff") return <Navigate to="/staff" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />

      {/* Owner-only pages inside layout */}
      <Route element={<ProtectedRoute allowedRoles={["owner"]} />}>
        <Route element={<AppLayout />}>
          <Route path="/owner" element={<OwnerDashboard />} />
          <Route path="/audit" element={<AuditLogs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      {/* Staff-only pages inside layout */}
      <Route element={<ProtectedRoute allowedRoles={["staff"]} />}>
        <Route element={<AppLayout />}>
          <Route path="/staff" element={<StaffProfile />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
