import { useNavigate } from "react-router-dom";

export default function Staff() {
  const nav = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "null");

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    nav("/login");
  }

  return (
    <div style={{ maxWidth: 700, margin: "60px auto", fontFamily: "Arial" }}>
      <h2>Staff Page</h2>
      <p>Logged in as: <b>{user?.username}</b> ({user?.role})</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
