import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const ROLE_OPTIONS = [
  { value: "OWNER", label: "OWNER" },
  { value: "CASHIER", label: "CASHIER" },
  { value: "STOCKROOM_STAFF", label: "STOCKROOM STAFF" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "INACTIVE", label: "INACTIVE" },
];

function safeCurrentUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function uploadAvatarFile(file) {
  const res = await api.post("/profile/avatar-upload", file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
  });
  return res.data?.avatar_url || "";
}

function AvatarPreview({ src, size = 72, alt }) {
  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      style={{ width: size, height: size, borderRadius: 16, objectFit: "cover", border: "1px solid #E7EAF3" }}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

export default function StaffManagement() {
  const me = safeCurrentUser();
  const createAvatarInputRef = useRef(null);
  const profileAvatarInputRef = useRef(null);

  const [users, setUsers] = useState([]);
  const [flash, setFlash] = useState(null);
  const [view, setView] = useState("LIST");
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    username: "",
    password: "",
    avatar_url: "",
    role: "",
    status: "ACTIVE",
  });
  const [createAvatarUploading, setCreateAvatarUploading] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editPassword, setEditPassword] = useState("");

  const [profileOpen, setProfileOpen] = useState(false);
  const [manageTab, setManageTab] = useState("profile");
  const [profileMode, setProfileMode] = useState("view");
  const [profileUserId, setProfileUserId] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileAvatarUploading, setProfileAvatarUploading] = useState(false);

  const visibleUsers = showInactive ? users : users.filter((user) => user.status !== "INACTIVE");
  const activeCount = users.filter((user) => user.status !== "INACTIVE").length;
  const inactiveCount = users.filter((user) => user.status === "INACTIVE").length;

  async function loadUsers() {
    setFlash(null);
    try {
      const res = await api.get("/users");
      const list = Array.isArray(res.data) ? res.data : [];
      const filtered = me?.id ? list.filter((user) => user.id !== me.id) : list;
      setUsers(filtered);
      if (view === "LIST") {
        setFlash({ type: "success", text: "User list updated." });
      }
    } catch (err) {
      setFlash({
        type: "error",
        text: err.response?.data?.message || "Failed to load users",
      });
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetAccountForm() {
    setEditing(null);
    setEditPassword("");
  }

  function openCreate() {
    setFlash(null);
    resetAccountForm();
    setForm({
      first_name: "",
      last_name: "",
      username: "",
      password: "",
      avatar_url: "",
      role: "",
      status: "ACTIVE",
    });
    setView("CREATE");
  }

  function openList() {
    setFlash(null);
    resetAccountForm();
    setView("LIST");
  }

  function clearCreateAvatar() {
    setForm((current) => ({ ...current, avatar_url: "" }));
    if (createAvatarInputRef.current) {
      createAvatarInputRef.current.value = "";
    }
  }

  async function handleCreateAvatarChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setCreateAvatarUploading(true);
    setFlash(null);
    try {
      const avatarUrl = await uploadAvatarFile(file);
      setForm((current) => ({ ...current, avatar_url: avatarUrl }));
      setFlash({ type: "success", text: "Avatar uploaded. It will be saved with the new user." });
    } catch (err) {
      setFlash({ type: "error", text: err?.response?.data?.message || err.message || "Avatar upload failed" });
    } finally {
      setCreateAvatarUploading(false);
      event.target.value = "";
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setFlash(null);

    try {
      const fullName = `${(form.first_name || "").trim()} ${(form.last_name || "").trim()}`.trim();
      const payload = { ...form, full_name: fullName };
      delete payload.first_name;
      delete payload.last_name;

      await api.post("/users", payload);

      setForm({
        first_name: "",
        last_name: "",
        username: "",
        password: "",
        avatar_url: "",
        role: "",
        status: "ACTIVE",
      });

      await loadUsers();
      setFlash({ type: "success", text: "User created." });
      setView("LIST");
    } catch (err) {
      setFlash({
        type: "error",
        text: err.response?.data?.message || "Create failed",
      });
    }
  }

  async function toggleStatus(user) {
    try {
      const nextStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/users/${user.id}/status`, { status: nextStatus });
      await loadUsers();
      setFlash({
        type: "success",
        text: `User ${nextStatus === "ACTIVE" ? "activated" : "deactivated"}.`,
      });
    } catch (err) {
      setFlash({
        type: "error",
        text: err.response?.data?.message || "Status update failed",
      });
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setFlash(null);

    try {
      await api.put(`/users/${editing.id}`, {
        full_name: editing.full_name,
        username: editing.username,
        role: editing.role,
        password: editPassword || undefined,
      });

      const accountUpdated = {
        ...editing,
        full_name: editing.full_name,
        username: editing.username,
        role: editing.role,
      };
      resetAccountForm();
      await loadUsers();
      setEditing(accountUpdated);
      setFlash({ type: "success", text: "Account details updated." });
      if (profileOpen) {
        setManageTab("account");
      } else {
        setView("LIST");
      }
    } catch (err) {
      setFlash({
        type: "error",
        text: err.response?.data?.message || "Update failed",
      });
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

  function openManage(user) {
    // Unified staff workflow: one entry point for profile and account management.
    setEditing({ ...user });
    setEditPassword("");
    setManageTab("profile");
    setProfileMode("view");
    setProfileUserId(user.id);
    setProfileOpen(true);
    loadProfile(user.id);
  }

  function closeProfile() {
    setProfileOpen(false);
    setManageTab("profile");
    setProfileUserId(null);
    setProfileData(null);
    setProfileError("");
    resetAccountForm();
  }

  async function handleProfileAvatarChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setProfileAvatarUploading(true);
    setProfileError("");
    try {
      const avatarUrl = await uploadAvatarFile(file);
      setProfileData((current) => ({ ...(current || {}), avatar_url: avatarUrl }));
    } catch (err) {
      setProfileError(err?.response?.data?.message || err.message || "Avatar upload failed");
    } finally {
      setProfileAvatarUploading(false);
      event.target.value = "";
    }
  }

  function clearProfileAvatar() {
    setProfileData((current) => ({ ...(current || {}), avatar_url: "" }));
    if (profileAvatarInputRef.current) {
      profileAvatarInputRef.current.value = "";
    }
  }

  async function saveProfile(event) {
    event?.preventDefault();
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
      setFlash({ type: "success", text: "Profile updated." });
      setProfileMode("view");
    } catch (err) {
      setProfileError(err?.response?.data?.message || err.message || "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">My Staff</h2>
          <div className="pageSub">Create staff accounts, manage access, and keep employee profiles up to date.</div>
          {flash?.text && (
            <div style={{ color: flash.type === "error" ? "#d94a4a" : "#2e9f68", marginTop: 6 }}>
              {flash.text}
            </div>
          )}
        </div>

        <div className="pageActions">
          <button className="btn btn-ghost" type="button" onClick={loadUsers}>
            Refresh
          </button>
          {view !== "CREATE" ? (
            <button className="btn btn-primary" type="button" onClick={openCreate}>
              Add User
            </button>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={openList}>
              Back to List
            </button>
          )}
        </div>
      </div>

      {view === "LIST" && (
        <>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              marginTop: 18,
              marginBottom: 14,
            }}
          >
            <div className="card">
              <div style={{ color: "#6B7280", marginBottom: 4 }}>Active staff</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{activeCount}</div>
            </div>
            <div className="card">
              <div style={{ color: "#6B7280", marginBottom: 4 }}>Inactive staff</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{inactiveCount}</div>
            </div>
            <div className="card">
              <div style={{ color: "#6B7280", marginBottom: 4 }}>How this works</div>
              <div style={{ lineHeight: 1.5 }}>
                Active staff stay visible by default. Turn on inactive users only when you need to review or reactivate them.
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              Show INACTIVE
            </label>
          </div>

          <div className="tableWrap">
            <div className="tableTopBar">Staff List</div>
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
                {visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td style={{ fontWeight: 800 }}>{user.full_name}</td>
                    <td>{user.username}</td>
                    <td>{user.role}</td>
                    <td>
                      <span className={`badge ${user.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {user.status}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        <button className="btn" onClick={() => openManage(user)}>
                          Manage Staff
                        </button>
                        <button className="btn" onClick={() => toggleStatus(user)}>
                          {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ opacity: 0.8, padding: 14 }}>
                      No staff found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {view === "CREATE" && (
        <div className="card" style={{ marginTop: 18 }}>
          <h3 style={{ marginTop: 0 }}>Create User</h3>

          <form onSubmit={createUser} className="formGrid" style={{ maxWidth: 620 }}>
            <div className="formRow2">
              <input
                className="input"
                placeholder="First name"
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
                required
              />
              <input
                className="input"
                placeholder="Last name"
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
                required
              />
            </div>

            <input
              className="input"
              placeholder="Username"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              required
            />

            <input
              className="input"
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />

            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontWeight: 600 }}>Profile photo (optional)</label>
              <div style={avatarCard}>
                <AvatarPreview src={form.avatar_url} alt="New user avatar preview" size={84} />
                {!form.avatar_url && (
                  <div style={{ color: "#6B7280", fontSize: 13 }}>
                    No photo selected yet.
                  </div>
                )}
                <input
                  ref={createAvatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCreateAvatarChange}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => createAvatarInputRef.current?.click()}
                  disabled={createAvatarUploading}
                >
                  {createAvatarUploading ? "Uploading..." : form.avatar_url ? "Replace Photo" : "Choose Photo"}
                </button>
                <div style={{ color: "#6B7280", fontSize: 13 }}>
                  {createAvatarUploading ? "Uploading avatar..." : "You can skip this now and add a picture later."}
                </div>
                {form.avatar_url && (
                  <button type="button" className="btn btn-ghost" onClick={clearCreateAvatar}>
                    Remove Photo
                  </button>
                )}
              </div>
            </div>

            <select
              className="input"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
              required
            >
              <option value="" disabled>
                Select role
              </option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>

            <select
              className="input"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" disabled={createAvatarUploading}>
                Create
              </button>
              <button className="btn btn-ghost" type="button" onClick={openList}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {profileOpen && (
        <div style={modalBackdrop} onClick={closeProfile}>
          <div style={modalCard} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>Manage Staff</h3>
                <div style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>
                  Review profile details or update account access in one place.
                </div>
              </div>
              <button onClick={closeProfile} style={btnGhost} aria-label="Close profile modal">
                X
              </button>
            </div>

            {profileLoading ? (
              <div style={{ padding: 14 }}>Loading...</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, marginTop: 14, marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={tabButton(manageTab === "profile")}
                    onClick={() => setManageTab("profile")}
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    style={tabButton(manageTab === "account")}
                    onClick={() => setManageTab("account")}
                  >
                    Account
                  </button>
                </div>

                {manageTab === "profile" ? (
                  <form onSubmit={saveProfile} style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {profileError && <div style={alertErr}>{profileError}</div>}

                    <div style={fieldWrap}>
                      <label style={label}>Full name</label>
                      <input
                        className="input"
                        name="full_name"
                        value={profileData?.full_name || ""}
                        onChange={(event) =>
                          setProfileData((current) => ({ ...(current || {}), full_name: event.target.value }))
                        }
                        disabled={profileMode !== "edit"}
                      />
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Email</label>
                      <input
                        className="input"
                        name="email"
                        value={profileData?.email || ""}
                        onChange={(event) =>
                          setProfileData((current) => ({ ...(current || {}), email: event.target.value }))
                        }
                        disabled={profileMode !== "edit"}
                      />
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Phone</label>
                      <input
                        className="input"
                        name="phone"
                        value={profileData?.phone || ""}
                        onChange={(event) =>
                          setProfileData((current) => ({ ...(current || {}), phone: event.target.value }))
                        }
                        disabled={profileMode !== "edit"}
                      />
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Profile photo</label>
                      <div style={avatarCard}>
                        <AvatarPreview src={profileData?.avatar_url} size={84} alt="Staff avatar preview" />
                        {!profileData?.avatar_url && (
                          <div style={{ color: "#6B7280", fontSize: 13 }}>
                            No profile photo saved yet.
                          </div>
                        )}
                        {profileMode === "edit" ? (
                          <>
                            <input
                              ref={profileAvatarInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleProfileAvatarChange}
                              style={{ display: "none" }}
                            />
                            <button
                              type="button"
                              className="btn"
                              onClick={() => profileAvatarInputRef.current?.click()}
                              disabled={profileAvatarUploading}
                            >
                              {profileAvatarUploading ? "Uploading..." : profileData?.avatar_url ? "Replace Photo" : "Choose Photo"}
                            </button>
                            <div style={{ color: "#6B7280", fontSize: 13 }}>
                              {profileAvatarUploading ? "Uploading avatar..." : "Optional. Upload a photo now or leave it unchanged."}
                            </div>
                            {profileData?.avatar_url && (
                              <button type="button" className="btn btn-ghost" onClick={clearProfileAvatar}>
                                Remove Photo
                              </button>
                            )}
                          </>
                        ) : (
                          <div style={{ color: "#6B7280", fontSize: 13 }}>Stored profile image</div>
                        )}
                      </div>
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Address</label>
                      <input
                        className="input"
                        name="address"
                        value={profileData?.address || ""}
                        onChange={(event) =>
                          setProfileData((current) => ({ ...(current || {}), address: event.target.value }))
                        }
                        disabled={profileMode !== "edit"}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                      <button type="button" onClick={closeProfile} className="btn btn-ghost">
                        Close
                      </button>
                      {profileMode === "edit" ? (
                        <button type="submit" className="btn btn-primary" disabled={profileSaving || profileAvatarUploading}>
                          {profileSaving ? "Saving..." : "Save Profile"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setProfileMode("edit")} className="btn">
                          Edit Profile and Photo
                        </button>
                      )}
                    </div>
                  </form>
                ) : (
                  <form onSubmit={saveEdit} style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    <div style={fieldWrap}>
                      <label style={label}>Full name</label>
                      <input
                        className="input"
                        value={editing?.full_name || ""}
                        onChange={(event) => setEditing((current) => ({ ...(current || {}), full_name: event.target.value }))}
                        required
                      />
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Username</label>
                      <input
                        className="input"
                        value={editing?.username || ""}
                        onChange={(event) => setEditing((current) => ({ ...(current || {}), username: event.target.value }))}
                        required
                      />
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>Role</label>
                      <select
                        className="input"
                        value={editing?.role || ""}
                        onChange={(event) => setEditing((current) => ({ ...(current || {}), role: event.target.value }))}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={fieldWrap}>
                      <label style={label}>New password</label>
                      <input
                        className="input"
                        placeholder="Leave blank to keep the current password"
                        type="password"
                        value={editPassword}
                        onChange={(event) => setEditPassword(event.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                      <button type="button" onClick={closeProfile} className="btn btn-ghost">
                        Close
                      </button>
                      <button type="submit" className="btn btn-primary">
                        Save Account
                      </button>
                    </div>
                  </form>
                )}
              </>
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
const label = {
  fontSize: 13,
  color: "#111827",
  fontWeight: 600,
  marginBottom: 6,
  display: "block",
  opacity: 0.95,
};
const btnGhost = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #999",
  background: "transparent",
  cursor: "pointer",
};
const alertErr = { marginTop: 12, padding: 12, borderRadius: 10, background: "#ffe5e5" };
const avatarCard = {
  display: "grid",
  gap: 8,
  padding: 12,
  borderRadius: 14,
  border: "1px solid #E7EAF3",
  background: "#FBFBFE",
  justifyItems: "start",
};
const tabButton = (active) => ({
  padding: "10px 14px",
  borderRadius: 999,
  border: active ? "1px solid rgba(209, 122, 45, 0.35)" : "1px solid #E7EAF3",
  background: active ? "rgba(209, 122, 45, 0.14)" : "#FFFFFF",
  color: "#111827",
  fontWeight: 700,
  cursor: "pointer",
});
