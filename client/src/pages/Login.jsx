import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");

    try {
      const res = await api.post("/auth/login", { username, password });

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));

      if (res.data.user.role === "OWNER") nav("/admin");
      else nav("/staff");
    } catch (err) {
      setMsg(err.response?.data?.message || "Login failed");
    }
  }

return (
  <div
    style={{
      minHeight: "100vh",
      width: "100vw",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "Arial",
      padding: 20,
      background: "#1f1f1f",
      color: "#fff",
    }}
  >
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        padding: 20,
        borderRadius: 10,
        background: "#2b2b2b",
        border: "1px solid #3a3a3a",
      }}
    >
      <h2 style={{ marginTop: 0 }}>User Management System</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>Login</p>

      <form onSubmit={onSubmit}>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: "100%",
            padding: 10,
            marginBottom: 10,
            borderRadius: 6,
            border: "1px solid #555",
            background: "#1f1f1f",
            color: "#fff",
          }}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: 10,
            marginBottom: 10,
            borderRadius: 6,
            border: "1px solid #555",
            background: "#1f1f1f",
            color: "#fff",
          }}
        />
        <button
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
          }}
        >
          Login
        </button>
      </form>

      {msg && <p style={{ color: "salmon" }}>{msg}</p>}

      <p style={{ marginTop: 15, fontSize: 12, opacity: 0.8 }}>
        Default admin: <b>admin</b> / <b>admin123</b>
      </p>
    </div>
  </div>
);


}
