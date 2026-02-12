import { useEffect, useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";

export default function Admin() {
  const nav = useNavigate();

  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");

  // adviser: only one function at a time (modal)
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Create form (matches POST /api/users)
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    role: "", // force choose CASHIER or STOCKROOM_STAFF
    status: "ACTIVE",
    email: "",
    phone: "",
    address: "",
    birthdate: "", // YYYY-MM-DD
    gender: "",
    avatar_url: "",
  });

  // Edit form (matches PUT /api/users/:id)
  const [editing, setEditing] = useState(null);
  const [editPassword, setEditPassword] = useState("");

  const CREATE_ROLE_OPTIONS = [
    { value: "CASHIER", label: "Cashier" },
    { value: "STOCKROOM_STAFF", label: "Stockroom Staff" },
  ];

  const ALL_ROLE_OPTIONS = [
    { value: "ADMINISTRATOR", label: "Administrator" },
    { value: "OWNER", label: "Owner" },
    { value: "CASHIER", label: "Cashier" },
    { value: "STOCKROOM_STAFF", label: "Stockroom Staff" },
    { value: "CUSTOMER", label: "Customer (Optional)" },
  ];

  const GENDER_OPTIONS = [
    { value: "MALE", label: "Male" },
    { value: "FEMALE", label: "Female" },
    { value: "OTHER", label: "Other" },
    { value: "PREFER_NOT_TO_SAY", label: "Prefer not to say" },
  ];

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    nav("/login");
  }

  async function loadUsers() {
    setMsg("");
    try {
      // backend returns: id, full_name, username, email, role, status, created_at, updated_at
      const res = await api.get("/users");
      setUsers(res.data);
    } catch (err) {
      setMsg(err.response?.data?.message || "Failed to load users");
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  // ----- Create modal handlers -----
  function openCreate() {
    setMsg("");
    setCreateOpen(true);
    setEditOpen(false);
  }

  function closeCreate() {
    setCreateOpen(false);
    setForm({
      full_name: "",
      username: "",
      password: "",
      role: "",
      status: "ACTIVE",
      email: "",
      phone: "",
      address: "",
      birthdate: "",
      gender: "",
      avatar_url: "",
    });
  }

  // helper: fetch full user detail for edit (GET /api/users/:id)
  async function openEdit(u) {
    try {
      setMsg("");
      setEditPassword("");
      setEditOpen(true);
      setCreateOpen(false);

      const res = await api.get(`/users/${u.id}`);
      // res.data includes profile fields
      setEditing({
        id: res.data.id,
        full_name: res.data.full_name || "",
        username: res.data.username || "",
        role: res.data.role || "",
        status: res.data.status || "ACTIVE",
        email: res.data.email || "",
        phone: res.data.phone || "",
        address: res.data.address || "",
        birthdate: res.data.birthdate ? String(res.data.birthdate).slice(0, 10) : "",
        gender: res.data.gender || "",
        avatar_url: res.data.avatar_url || "",
      });
    } catch (err) {
      setMsg(err.response?.data?.message || "Failed to load user details");
      setEditOpen(false);
    }
  }

  function closeEdit() {
    setEditOpen(false);
    setEditing(null);
    setEditPassword("");
  }

  // convert "" to null so backend will store NULL (cleaner than empty string)
  function emptyToNull(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : null;
  }

  async function createUser(e) {
    e.preventDefault();
    setMsg("");

    try {
      await api.post("/users", {
        full_name: form.full_name,
        username: form.username,
        password: form.password,
        role: form.role,
        status: form.status,
        email: emptyToNull(form.email),
        phone: emptyToNull(form.phone),
        address: emptyToNull(form.address),
        birthdate: emptyToNull(form.birthdate),
        gender: emptyToNull(form.gender),
        avatar_url: emptyToNull(form.avatar_url),
      });

      await loadUsers();
      setMsg("User created!");
      closeCreate();
    } catch (err) {
      setMsg(err.response?.data?.message || "Create failed");
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setMsg("");

    try {
      await api.put(`/users/${editing.id}`, {
        full_name: editing.full_name,
        username: editing.username,
        role: editing.role,
        // backend status is updated via PATCH route, but we can keep status toggle separate
        email: emptyToNull(editing.email),
        phone: emptyToNull(editing.phone),
        address: emptyToNull(editing.address),
        birthdate: emptyToNull(editing.birthdate),
        gender: emptyToNull(editing.gender),
        avatar_url: emptyToNull(editing.avatar_url),
        password: editPassword ? editPassword : undefined,
      });

      await loadUsers();
      setMsg("User updated!");
      closeEdit();
    } catch (err) {
      setMsg(err.response?.data?.message || "Update failed");
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

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", fontFamily: "Arial", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>User Management</h2>
        <button onClick={logout} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {msg && (
        <p style={{ marginTop: 10, color: msg.toLowerCase().includes("fail") ? "salmon" : "green" }}>
          {msg}
        </p>
      )}

      {/* Refresh + Create beside each other (adviser) */}
      <div style={{ display: "flex", gap: 10, marginTop: 20, marginBottom: 10 }}>
        <button onClick={loadUsers} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Refresh
        </button>
        <button onClick={openCreate} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Create User
        </button>
      </div>

      {/* USERS TABLE (no ID column) */}
      <div style={{ overflowX: "auto", border: "1px solid #444", borderRadius: 10 }}>
        <table width="100%" cellPadding="10" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#2b2b2b", color: "white" }}>
              <th align="left">Name</th>
              <th align="left">Username</th>
              <th align="left">Email</th> {/* RECOMMENDED */}
              <th align="left">Phone</th>
              <th align="left">Role</th>
              <th align="left">Status</th>
              <th align="left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid #444" }}>
                <td>{u.full_name}</td>
                <td>{u.username}</td>
                <td>{u.email || "-"}</td> {/* RECOMMENDED */}
                 <td style={{ opacity: u.phone ? 1 : 0.6 }}>{u.phone || "—"}</td>
                <td>{u.role}</td>
                <td>{u.status}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => openEdit(u)} style={{ cursor: "pointer" }}>
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
                <td colSpan="7" style={{ opacity: 0.8 }}>No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE USER MODAL */}
      <Modal open={createOpen} title="Create User" onClose={closeCreate}>
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

          {/* RECOMMENDED (optional profile fields) */}
          <input
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={{ padding: 10 }}
          />

          <input
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            style={{ padding: 10 }}
          />

          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            style={{ padding: 10 }}
            required
          >
            <option value="" disabled>
              Select role
            </option>
            {CREATE_ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            style={{ padding: 10 }}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="submit" style={{ padding: 10, cursor: "pointer" }}>
              Create
            </button>
            <button type="button" onClick={closeCreate} style={{ padding: 10, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {/* EDIT USER MODAL */}
      <Modal open={editOpen} title="Edit User" onClose={closeEdit}>
        {!editing ? (
          <p style={{ opacity: 0.8 }}>No user selected.</p>
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

            {/* RECOMMENDED fields */}
            <input
              placeholder="Email (optional)"
              value={editing.email}
              onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              style={{ padding: 10 }}
            />

            <input
              placeholder="Phone (optional)"
              value={editing.phone}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              style={{ padding: 10 }}
            />

            <input
              placeholder="Address (optional)"
              value={editing.address}
              onChange={(e) => setEditing({ ...editing, address: e.target.value })}
              style={{ padding: 10 }}
            />

            <input
              placeholder="Birthdate (YYYY-MM-DD) optional"
              value={editing.birthdate}
              onChange={(e) => setEditing({ ...editing, birthdate: e.target.value })}
              style={{ padding: 10 }}
            />

            <select
              value={editing.gender}
              onChange={(e) => setEditing({ ...editing, gender: e.target.value })}
              style={{ padding: 10 }}
            >
              <option value="">Gender (optional)</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>

            <input
              placeholder="Avatar URL (optional)"
              value={editing.avatar_url}
              onChange={(e) => setEditing({ ...editing, avatar_url: e.target.value })}
              style={{ padding: 10 }}
            />

            <select
              value={editing.role}
              onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              style={{ padding: 10 }}
            >
              {ALL_ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
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
              <button type="button" onClick={closeEdit} style={{ padding: 10, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
