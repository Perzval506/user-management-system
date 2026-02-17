import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ allowedRoles }) {
  const { isAuthed, user } = useAuth();

  if (!isAuthed) return <Navigate to="/login" replace />;

  const role = user?.role; 
  if (allowedRoles?.length && !allowedRoles.includes(role)) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
