import { useEffect, useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";

export default function Admin() {
  const nav = useNavigate();
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    role: "STAFF",
    status: "ACTIVE",
  });

  const [editing, setEditing] = useState(null);
  const [editPassword, setEditPassword] = useState("");

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    nav("/login");
  }

  async function loadUsers() {
    setMsg("");
    try {
      const res = await api.get("/users");
      setUsers(res.data);
    } catch (err) {
      setMsg(err.response?.data?.message || "Failed to load users");
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e) {
    e.preventDefault();
    setMsg("");
    try {
      await api.post("/users", form);
      setForm({
        full_name: "",
        username: "",
        password: "",
        role: "STAFF",
        status: "ACTIVE",
      });
      await loadUsers();
      setMsg("User created!");
    } catch (err) {
      setMsg(err.response?.data?.message || "Create failed");
    }
  }

  async function toggleStatus(u) {
    try {
      const next = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/users/${u.id}/status`, { status: next });
      await loadUsers();
    } catch (err) {
      setMsg(err.response?.data?.message || "Status update failed");
    }
  }

  function startEdit(u) {
    setEditing({ ...u }); // copy
    setEditPassword("");
    setMsg("");
  }

  async function saveEdit(e) {
    e.preventDefault();
    setMsg("");

    try {
      await api.put(`/users/${editing.id}`, {
        full_name: editing.full_name,
        username: editing.username,
        role: editing.role,
        password: editPassword ? editPassword : undefined,
      });

      setEditing(null);
      setEditPassword("");
      await loadUsers();
      setMsg("User updated!");
    } catch (err) {
      setMsg(err.response?.data?.message || "Update failed");
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", fontFamily: "Arial", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Admin Dashboard (OWNER)</h2>
        <button onClick={logout} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {msg && (
        <p style={{ marginTop: 10, color: msg.toLowerCase().includes("fail") ? "salmon" : "lightgreen" }}>
          {msg}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
        {/* ADD USER */}
        <div style={{ padding: 15, border: "1px solid #444", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Add User</h3>

          <form onSubmit={createUser} style={{ display: "grid", gap: 10 }}>
            <input
              placeholder="Full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              style={{ padding: 10 }}
              required
            />

            <input
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              style={{ padding: 10 }}
              required
            />

            <input
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={{ padding: 10 }}
              required
            />

            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              style={{ padding: 10 }}
            >
              <option value="STAFF">STAFF</option>
              <option value="OWNER">OWNER</option>
            </select>

            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              style={{ padding: 10 }}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>

            <button style={{ padding: 10, cursor: "pointer" }}>Create</button>
          </form>
        </div>

        {/* EDIT USER */}
        <div style={{ padding: 15, border: "1px solid #444", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Edit User</h3>

          {!editing ? (
            <p style={{ opacity: 0.8 }}>Click "Edit" on a user from the table.</p>
          ) : (
            <form onSubmit={saveEdit} style={{ display: "grid", gap: 10 }}>
              <input
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                style={{ padding: 10 }}
                required
              />

              <input
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                style={{ padding: 10 }}
                required
              />

              <select
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                style={{ padding: 10 }}
              >
                <option value="STAFF">STAFF</option>
                <option value="OWNER">OWNER</option>
              </select>

              <input
                placeholder="New password (optional)"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                style={{ padding: 10 }}
              />

              <div style={{ display: "flex", gap: 10 }}>
                <button type="submit" style={{ padding: 10, cursor: "pointer" }}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  style={{ padding: 10, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* USERS TABLE */}
      <h3 style={{ marginTop: 30 }}>Users List</h3>

      <button onClick={loadUsers} style={{ padding: "8px 12px", cursor: "pointer", marginBottom: 10 }}>
        Refresh
      </button>

      <div style={{ overflowX: "auto", border: "1px solid #444", borderRadius: 10 }}>
        <table width="100%" cellPadding="10" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#2b2b2b" }}>
              <th align="left">ID</th>
              <th align="left">Name</th>
              <th align="left">Username</th>
              <th align="left">Role</th>
              <th align="left">Status</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid #444" }}>
                <td>{u.id}</td>
                <td>{u.full_name}</td>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>{u.status}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => startEdit(u)} style={{ cursor: "pointer" }}>
                    Edit
                  </button>
                  <button onClick={() => toggleStatus(u)} style={{ cursor: "pointer" }}>
                    {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan="6" style={{ opacity: 0.8 }}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
