import { createContext, useContext, useMemo, useState } from "react";
import { api } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  const isAuthed = !!token;

  const login = async ({ email, password }) => {
    try {
      // Backend expects `/api` in baseURL; send `username` field
      const res = await api.post("/auth/login", { username: email, password });

      // Supports common response shapes:
      // { token, user } OR { accessToken, user } OR { token, data: { user } }
      const newToken =
        res.data?.token || res.data?.accessToken || res.data?.data?.token;
      const newUser =
        res.data?.user || res.data?.data?.user || res.data?.profile;

      if (!newToken || !newUser) {
        throw new Error("Login response missing token/user");
      }

      localStorage.setItem("token", newToken);
      localStorage.setItem("user", JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);

      return newUser;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Login failed";
      throw new Error(msg);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setUser(null);
  };

  const updateUserLocal = (partial) => {
    const updated = { ...(user || {}), ...(partial || {}) };
    setUser(updated);
    localStorage.setItem("user", JSON.stringify(updated));
  };

  const value = useMemo(
    () => ({ token, user, isAuthed, login, logout, updateUserLocal }),
    [token, user, isAuthed]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
