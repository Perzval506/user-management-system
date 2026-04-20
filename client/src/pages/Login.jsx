import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api"; // if you have it; otherwise remove and use fetch

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    try {
      // Use API base (`/api` is already included in baseURL)
      const res = await api.post("/auth/login", { username: email, password });
      const token = res.data?.token || res.data?.accessToken;
      const user = res.data?.user;

      if (!token || !user) throw new Error("Login failed: missing token/user");

      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));

      if (user.role === "OWNER") navigate("/admin");
      else navigate("/staff");
    } catch (e2) {
      setErr(e2?.response?.data?.message || e2?.message || "Login failed");
    }
  };

  return (
    <div className="authShell">
      <div className="card card-pad authCard">
        <h1 className="h1 authTitle">Login</h1>
        <p className="muted authSub">
          Sign in to Boyd’s Pizza House UMS
        </p>

        <form onSubmit={onSubmit} className="authForm">
          <div>
            <div className="small muted authFieldLabel">Username</div>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div>
            <div className="small muted authFieldLabel">Password</div>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {err && <div className="small authError">{err}</div>}

          <button className="btn btn-primary" type="submit">Sign in</button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/")}>Back to Home</button>
        </form>
      </div>
    </div>
  );
}
