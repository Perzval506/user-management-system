import { useEffect, useState } from "react";
import { api } from "../services/api";

const ROLE_OPTIONS = [
  { value: "ADMINISTRATOR", label: "ADMINISTRATOR" },
  { value: "OWNER", label: "OWNER" },
  { value: "CASHIER", label: "CASHIER" },
  { value: "STOCKROOM_STAFF", label: "STOCKROOM STAFF" },
  { value: "CUSTOMER", label: "CUSTOMER" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "INACTIVE", label: "INACTIVE" },
];

export default function StaffManagement() {
  const me = JSON.parse(localStorage.getItem("user") || "null");

  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");

  const [view, setView] = useState("LIST"); // LIST | CREATE | EDIT

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    username: "",
    password: "",
    role: "",
    status: "ACTIVE",
  });

  const [editing, setEditing] = useState(null);
  const [editPassword, setEditPassword] = useState("");

  // Profile details modal state
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMode, setProfileMode] = useState("view"); // view | edit
  const [profileUserId, setProfileUserId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

  async function loadUsers() {
    setMsg("");
    try {
      const res = await api.get("/users");
      const list = Array.isArray(res.data) ? res.data : [];
      const filtered = me?.id ? list.filter((u) => u.id !== me.id) : list;
      setUsers(filtered);
      if (view === "LIST") setMsg("User list updated.");
    } catch (err) {
      setMsg(err.response?.data?.message || "Failed to load users");
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setMsg("");
    setEditing(null);
    setEditPassword("");
    setView("CREATE");
  }

  function openList() {
    setMsg("");
    setEditing(null);
    setEditPassword("");
    setView("LIST");
  }

  async function createUser(e) {
    e.preventDefault();
    setMsg("");

    try {
      const full = `${(form.first_name || "").trim()} ${(form.last_name || "").trim()}`.trim();
      const payload = { ...form, full_name: full };
      delete payload.first_name;
      delete payload.last_name;

      await api.post("/users", payload);

      setForm({
        first_name: "",
        last_name: "",
        username: "",
        password: "",
        role: "",
        status: "ACTIVE",
      });

      await loadUsers();
      setMsg("User created!");
      setView("LIST");
    } catch (err) {
      setMsg(err.response?.data?.message || "Create failed");
    }
  }

  async function toggleStatus(u) {
    try {
      const next = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/users/${u.id}/status`, { status: next });
      await loadUsers();
      setMsg("Status updated.");
    } catch (err) {
      setMsg(err.response?.data?.message || "Status update failed");
    }
  }

  function startEdit(u) {
    setEditing({ ...u });
    setEditPassword("");
    setMsg("");
    setView("EDIT");
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
      setView("LIST");
    } catch (err) {
      setMsg(err.response?.data?.message || "Update failed");
    }
  }

  async function loadProfile(userId) {
    setProfileLoading(true);
    setProfileError("");
    try {
      const res = await api.get(`/profile/staff/${userId}`);
      setProfileData(res.data || null);
    } catch (err) {
      setProfileError(err?.response?.data?.message || err.message || "Failed to load profile");
      setProfileData(null);
    } finally {
      setProfileLoading(false);
    }
  }

  function openProfileView(userId) {
    setProfileMode("view");
    setProfileUserId(userId);
    setProfileOpen(true);
    loadProfile(userId);
  }

  function openProfileEdit(userId) {
    setProfileMode("edit");
    setProfileUserId(userId);
    setProfileOpen(true);
    loadProfile(userId);
  }

  function closeProfile() {
    setProfileOpen(false);
    setProfileUserId(null);
    setProfileData(null);
    setProfileError("");
  }

  async function saveProfile(e) {
    e && e.preventDefault();
    if (!profileUserId) return;
    setProfileSaving(true);
    setProfileError("");

    try {
      await api.put(`/profile/staff/${profileUserId}`, {
        full_name: profileData?.full_name || null,
        email: profileData?.email || null,
        phone: profileData?.phone || null,
        address: profileData?.address || null,
        gender: profileData?.gender || null,
        birthdate: profileData?.birthdate || null,
        avatar_url: profileData?.avatar_url || null,
        emergency_contact_name: profileData?.emergency_contact_name || null,
        emergency_contact_phone: profileData?.emergency_contact_phone || null,
        employee_no: profileData?.employee_no || null,
        position_title: profileData?.position_title || null,
        hire_date: profileData?.hire_date || null,
        shift_start: profileData?.shift_start || null,
        shift_end: profileData?.shift_end || null,
        notes: profileData?.notes || null,
      });

      await loadUsers();
      setProfileMode("view");
    } catch (err) {
      setProfileError(err?.response?.data?.message || err.message || "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  const msgIsError = /\b(fail|error|invalid|missing|denied|forbidden|not found)\b/i.test(msg);

  return (
    <div className="page" style={{ maxWidth: 1140 }}>
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">My Staff</h2>
          <div className="pageSub">Create and manage team accounts.</div>
          {msg && (
            <div className={`inlineStatus ${msgIsError ? "error" : "success"}`}>
              {msg}
            </div>
          )}
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" type="button" onClick={loadUsers}>Refresh</button>
          {view !== "CREATE" ? (
            <button className="btn btn-primary" type="button" onClick={openCreate}>Add User</button>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={openList}>Back to List</button>
          )}
        </div>
      </div>

      {/* LIST */}
      {view === "LIST" && (
        <>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>User List</h3>

          <div className="tableWrap">
            <div className="tableTopBar">Users</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.status}</td>
                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openProfileView(u.id)}>Details</button>
                        <button className="btn" onClick={() => openProfileEdit(u.id)}>Edit Details</button>
                        <button className="btn" onClick={() => startEdit(u)}>Edit</button>
                        <button className="btn" onClick={() => toggleStatus(u)}>
                          {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {users.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ opacity: 0.8, padding: 14 }}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* CREATE */}
      {view === "CREATE" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Create User</h3>

          <form onSubmit={createUser} className="formGrid" style={{ maxWidth: 620 }}>
            <div className="formRow2">
              <input
                className="input"
                placeholder="First name"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
              <input
                className="input"
                placeholder="Last name"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </div>

            <input
              className="input"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />

            <input
              className="input"
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />

            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              required
            >
              <option value="" disabled>Select role</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit">Create</button>
              <button className="btn btn-ghost" type="button" onClick={openList}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT */}
      {view === "EDIT" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Edit User</h3>

          {!editing ? (
            <p style={{ opacity: 0.8 }}>Select a user from the list.</p>
          ) : (
            <form onSubmit={saveEdit} className="formGrid" style={{ maxWidth: 620 }}>
              <input
                className="input"
                value={editing.full_name}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                required
              />

              <input
                className="input"
                value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                required
              />

              <select
                className="input"
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              <input
                className="input"
                placeholder="New password (optional)"
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" type="submit">Save</button>
                <button className="btn btn-ghost" type="button" onClick={openList}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Profile Modal */}
      {profileOpen && (
        <div style={modalBackdrop} onClick={closeProfile}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>{profileMode === "edit" ? "Edit Staff Profile" : "Staff Profile"}</h3>
              <button onClick={closeProfile} style={btnGhost}>✕</button>
            </div>

            {profileLoading ? (
              <div style={{ padding: 14 }}>Loading...</div>
            ) : (
              <form onSubmit={saveProfile} style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {profileError && <div style={alertErr}>{profileError}</div>}

                <div style={fieldWrap}>
                  <label style={label}>Full name</label>
                  <input
                    className="input"
                    name="full_name"
                    value={profileData?.full_name || ""}
                    onChange={(e) => setProfileData((p) => ({ ...(p || {}), full_name: e.target.value }))}
                    disabled={profileMode !== "edit"}
                  />
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Email</label>
                  <input
                    className="input"
                    name="email"
                    value={profileData?.email || ""}
                    onChange={(e) => setProfileData((p) => ({ ...p, email: e.target.value }))}
                    disabled={profileMode !== "edit"}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                  <button type="button" onClick={closeProfile} className="btn btn-ghost">Close</button>
                  {profileMode === "edit" ? (
                    <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                      {profileSaving ? "Saving..." : "Save"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setProfileMode("edit")} className="btn">
                      Edit
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.24)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  overflowY: "auto",
  zIndex: 9999,
};

const modalCard = {
  width: "min(900px, 100%)",
  background: "white",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
  maxHeight: "90vh",
  overflowY: "auto",
};

const fieldWrap = { display: "grid", gap: 6 };
const label = { fontSize: 13, color: "#111827", fontWeight: 600, marginBottom: 6, display: "block", opacity: 0.95 };
const btnGhost = { padding: "8px 12px", borderRadius: 10, border: "1px solid #999", background: "transparent", cursor: "pointer" };
const alertErr = { marginTop: 12, padding: 12, borderRadius: 10, background: "#ffe5e5" };
