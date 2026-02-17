import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";

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

export default function Admin() {
  const nav = useNavigate();
  const me = JSON.parse(localStorage.getItem("user") || "null");

  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");


  const [view, setView] = useState("LIST"); // LIST | CREATE | EDIT

  const [form, setForm] = useState({
    full_name: "",
    username: "",
    password: "",
    role: "CASHIER",
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
  // Profile details modal state
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMode, setProfileMode] = useState("view"); // view | edit
  const [profileUserId, setProfileUserId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

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
      await api.post("/users", form);

      setForm({
        full_name: "",
        username: "",
        password: "",
        role: "CASHIER",
        status: "ACTIVE",
      });

      await loadUsers();
      setMsg("User created!");
      setView("LIST");
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
      setMsg("Status updated.");
    } catch (err) {
      setMsg(err.response?.data?.message || "Status update failed");
    }
  }

  function startEdit(u) {
    setEditing({ ...u }); // copy
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
      // send only known profile fields
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
      setProfileSaving(false);
    } catch (err) {
      setProfileError(err?.response?.data?.message || err.message || "Save failed");
      setProfileSaving(false);
    }
  }

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

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", fontFamily: "Arial", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
        <button onClick={logout} style={{ padding: "8px 12px", cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {msg && (
        <p style={{ marginTop: 10, color: msg.toLowerCase().includes("fail") ? "salmon" : "green" }}>
          {msg}
        </p>
      )}

      {/* Top controls */}
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button
          onClick={openList}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: view === "LIST" ? "#1f2937" : "#111",
            color: "white",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        >
          User List
        </button>

        <button
          onClick={openCreate}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: view === "CREATE" ? "#1f2937" : "#111",
            color: "white",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        >
          Create User
        </button>
        <button
          onClick={() => nav("/admin/ingredients")}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: "#111",
            color: "white",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        >
          Ingredients
        </button>

        <button
          onClick={() => nav("/admin/menu")}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: "#111",
            color: "white",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        >
          Menu
        </button>

        {/* Staff Profile button removed — use Details / Edit Details in the users list */}
        <button
          onClick={loadUsers}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: "#111",
            color: "white",
            border: "1px solid #333",
            borderRadius: 8,
          }}
        >
          Refresh
        </button>
      </div>

      {/* ONE FUNCTION AT A TIME */}
      {view === "LIST" && (
        <>
          <h3 style={{ marginTop: 20 }}>Users List</h3>

          <div style={{ overflowX: "auto", border: "1px solid #444", borderRadius: 10 }}>
            <table width="100%" cellPadding="10" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#2b2b2b", color: "white" }}>
                  {/* Removed ID column */}
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
                    <td>{u.full_name}</td>
                    <td>{u.username}</td>
                    <td>{u.role}</td>
                    <td>{u.status}</td>
                    <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openProfileView(u.id)} style={{ cursor: "pointer" }}>
                        Details
                      </button>

                      <button onClick={() => openProfileEdit(u.id)} style={{ cursor: "pointer" }}>
                        Edit Details
                      </button>

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
                    <td colSpan="5" style={{ opacity: 0.8, padding: 14 }}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Profile Details Modal */}
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
                  {(() => {
                    const pid = String(profileUserId);
                    const userRow = users.find((x) => String(x.id) === pid);
                    const fallbackName = (userRow && (userRow.full_name || userRow.username)) || "";
                    const value = profileData?.full_name || fallbackName;
                    return profileMode === "edit" ? (
                      <input
                        name="full_name"
                        placeholder="Full name"
                        value={value}
                        onChange={(e) => setProfileData((p) => ({ ...(p || {}), full_name: e.target.value }))}
                        style={input}
                      />
                    ) : (
                      <div style={{ padding: 10 }}>{value || "-"}</div>
                    );
                  })()}
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Email</label>
                  <input name="email" placeholder="example@company.com" value={profileData?.email || ""} onChange={(e) => setProfileData((p) => ({ ...p, email: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Phone</label>
                  <input name="phone" placeholder="09xxxxxxxxx" value={profileData?.phone || ""} onChange={(e) => setProfileData((p) => ({ ...p, phone: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={fieldWrap}>
                    <label style={label}>Emergency Contact Name</label>
                    <input name="emergency_contact_name" placeholder="Full name" value={profileData?.emergency_contact_name || ""} onChange={(e) => setProfileData((p) => ({ ...p, emergency_contact_name: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>

                  <div style={fieldWrap}>
                    <label style={label}>Emergency Contact Phone</label>
                    <input name="emergency_contact_phone" placeholder="09xxxxxxxxx" value={profileData?.emergency_contact_phone || ""} onChange={(e) => setProfileData((p) => ({ ...p, emergency_contact_phone: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Address</label>
                  <input name="address" placeholder="City / Barangay / Street" value={profileData?.address || ""} onChange={(e) => setProfileData((p) => ({ ...p, address: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={fieldWrap}>
                    <label style={label}>Gender</label>
                    <input name="gender" placeholder="MALE / FEMALE / OTHER" value={profileData?.gender || ""} onChange={(e) => setProfileData((p) => ({ ...p, gender: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>

                  <div style={fieldWrap}>
                    <label style={label}>Birthdate</label>
                    <input name="birthdate" type="date" value={profileData?.birthdate || ""} onChange={(e) => setProfileData((p) => ({ ...p, birthdate: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={fieldWrap}>
                    <label style={label}>Employee No.</label>
                    <input name="employee_no" placeholder="EMP-0001" value={profileData?.employee_no || ""} onChange={(e) => setProfileData((p) => ({ ...p, employee_no: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>

                  <div style={fieldWrap}>
                    <label style={label}>Position Title</label>
                    <input name="position_title" placeholder="Cashier / Stockroom Staff" value={profileData?.position_title || ""} onChange={(e) => setProfileData((p) => ({ ...p, position_title: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={fieldWrap}>
                    <label style={label}>Hire Date</label>
                    <input name="hire_date" type="date" value={profileData?.hire_date || ""} onChange={(e) => setProfileData((p) => ({ ...p, hire_date: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>

                  <div style={fieldWrap}>
                    <label style={label}>Shift Start</label>
                    <input name="shift_start" type="time" value={profileData?.shift_start || ""} onChange={(e) => setProfileData((p) => ({ ...p, shift_start: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>
 
                  <div style={fieldWrap}>
                    <label style={label}>Shift End</label>
                    <input name="shift_end" type="time" value={profileData?.shift_end || ""} onChange={(e) => setProfileData((p) => ({ ...p, shift_end: e.target.value }))} style={input} disabled={profileMode !== "edit"} />
                  </div>
                </div>

                <div style={fieldWrap}>
                  <label style={label}>Notes</label>
                  <textarea name="notes" placeholder="Optional notes..." value={profileData?.notes || ""} onChange={(e) => setProfileData((p) => ({ ...p, notes: e.target.value }))} style={{ ...input, minHeight: 80 }} disabled={profileMode !== "edit"} />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                  <button type="button" onClick={closeProfile} style={btnSecondary}>Close</button>
                  {profileMode === "edit" ? (
                    <button type="submit" style={btnPrimary} disabled={profileSaving}>{profileSaving ? "Saving..." : "Save"}</button>
                  ) : (
                    <button type="button" onClick={() => setProfileMode("edit")} style={btnSecondary}>Edit</button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {view === "CREATE" && (
        <div style={{ marginTop: 20, padding: 15, border: "1px solid #444", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Create User</h3>

          <form onSubmit={createUser} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
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
              {ROLE_OPTIONS.map((r) => (
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
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10 }}>

              <button style={{ padding: 10, cursor: "pointer" }}>Create</button>

              <button type="button" onClick={openList} style={{ padding: 10, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {view === "EDIT" && (
        <div style={{ marginTop: 20, padding: 15, border: "1px solid #444", borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Edit User</h3>

          {!editing ? (
            <p style={{ opacity: 0.8 }}>Select a user from the list.</p>
          ) : (
            <form onSubmit={saveEdit} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
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
                {ROLE_OPTIONS.map((r) => (
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
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setEditPassword("");
                    setView("LIST");
                  }}
                  style={{ padding: 10, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* Modal / UI styles used by profile modal */
const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
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
const label = { 
  fontSize: 13, 
  color: '#111827', 
  fontWeight: 600, 
  marginBottom: 6, 
  display: 'block', 
  opacity: 0.95 
};
const input = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", outline: "none" };

const btnPrimary = { padding: "10px 14px", borderRadius: 10, border: "none", background: "black", color: "white", cursor: "pointer" };
const btnSecondary = { padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.35)", background: "white", cursor: "pointer", fontWeight: 700 };
const btnGhost = { padding: "8px 12px", borderRadius: 10, border: "1px solid #999", background: "transparent", cursor: "pointer" };

const alertErr = { marginTop: 12, padding: 12, borderRadius: 10, background: "#ffe5e5" };
