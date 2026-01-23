import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const u = await login({ email, password });
      if (u?.role === "owner") navigate("/owner");
      else if (u?.role === "staff") navigate("/staff");
      else navigate("/");
    } catch (err) {
      setError(err?.message || "Login failed");
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "64px auto", padding: 16 }}>
      <h2>Login</h2>
      <form onSubmit={onSubmit}>
        <label>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: "100%", marginBottom: 12 }}
        />

        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="••••••••"
          style={{ width: "100%", marginBottom: 12 }}
        />

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button type="submit" style={{ width: "100%" }}>
          Sign in
        </button>
      </form>

      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        Note: endpoint currently expects POST /api/auth/login.
      </p>
    </div>
  );
}
