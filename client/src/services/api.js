// src/services/api.js
import axios from "axios";

// IMPORTANT: your backend routes are /api/...
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // ok even if you don't use cookies
});

// Attach token to every request (if available)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Optional: handle unauthorized globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
    return Promise.reject(err);
  }
);

// ✅ support BOTH import styles:
export default api; // for: import api from "../services/api"
export { api };     // for: import { api } from "../services/api"
