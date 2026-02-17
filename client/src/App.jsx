import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Admin from "./pages/Admin.jsx";
import Staff from "./pages/Staff.jsx";
import Info from "./pages/Info.jsx";
import AdminIngredients from "./pages/AdminIngredients.jsx";
import AdminMenu from "./pages/AdminMenu.jsx";


function ProtectedRoute({ children, allowedRoles }) {
  const token = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");

  let user = null;
  try {
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    user = null;
  }

  if (!token || !user) return <Navigate to="/login" replace />;

  if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/info" element={<Info />} />

      <Route path="/login" element={<Login />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["OWNER", "ADMINISTRATOR"]}>
            <Admin />
          </ProtectedRoute>
        }
      />

      <Route
        path="/staff"
        element={
          <ProtectedRoute allowedRoles={["CASHIER", "STOCKROOM_STAFF", "OWNER", "ADMINISTRATOR"]}>
            <Staff />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/ingredients"
        element={
          <ProtectedRoute allowedRoles={["OWNER", "ADMINISTRATOR"]}>
            <AdminIngredients />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/menu"
        element={
          <ProtectedRoute allowedRoles={["OWNER", "ADMINISTRATOR"]}>
            <AdminMenu />
          </ProtectedRoute>
        }
      />
      

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
