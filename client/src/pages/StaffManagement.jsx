import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../services/api";
import { formatDateLong } from "../utils/formatters";

const ROLE_OPTIONS = [
  { value: "OWNER", label: "OWNER" },
  { value: "CASHIER", label: "CASHIER" },
  { value: "STOCKROOM_STAFF", label: "STOCKROOM STAFF" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "INACTIVE", label: "INACTIVE" },
];

function createEmptyProfileData() {
  return {
    full_name: "",
    email: "",
    phone: "",
    address: "",
    gender: "",
    birthdate: "",
    avatar_url: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    employee_no: "",
    position_title: "",
    hire_date: "",
    shift_start: "",
    shift_end: "",
    notes: "",
  };
}

function normalizeProfileData(payload = {}, fallback = {}) {
  const base = { ...createEmptyProfileData(), ...(fallback || {}) };
  return {
    ...base,
    ...payload,
    full_name: payload?.full_name ?? base.full_name ?? "",
    email: payload?.email ?? base.email ?? "",
    phone: payload?.phone ?? base.phone ?? "",
    address: payload?.address ?? base.address ?? "",
    gender: payload?.gender ?? base.gender ?? "",
    birthdate: payload?.birthdate ?? base.birthdate ?? "",
    avatar_url: payload?.avatar_url ?? base.avatar_url ?? "",
    emergency_contact_name: payload?.emergency_contact_name ?? base.emergency_contact_name ?? "",
    emergency_contact_phone: payload?.emergency_contact_phone ?? base.emergency_contact_phone ?? "",
    employee_no: payload?.employee_no ?? base.employee_no ?? "",
    position_title: payload?.position_title ?? base.position_title ?? "",
    hire_date: payload?.hire_date ?? base.hire_date ?? "",
    shift_start: payload?.shift_start ?? base.shift_start ?? "",
    shift_end: payload?.shift_end ?? base.shift_end ?? "",
    notes: payload?.notes ?? base.notes ?? "",
  };
}

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
      className="staffAvatarPreview"
      style={{ width: size, height: size }}
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

function StaffAvatar({ src, name }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "Staff"}
        className="staffAvatarThumb"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    );
  }

  const initials = String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

  return (
    <div className="staffAvatarFallback">
      {initials}
    </div>
  );
}

export default function StaffManagement() {
  const me = safeCurrentUser();
  const createAvatarInputRef = useRef(null);
  const profileAvatarInputRef = useRef(null);
  const profileNameInputRef = useRef(null);
  const latestProfileRequestRef = useRef(0);

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

  async function loadProfile(userId, requestId) {
    setProfileLoading(true);
    setProfileError("");

    try {
      const res = await api.get(`/profile/staff/${userId}`);
      if (requestId === latestProfileRequestRef.current) {
        setProfileData((current) => normalizeProfileData(res.data || {}, current || {}));
      }
    } catch (err) {
      if (requestId === latestProfileRequestRef.current) {
        setProfileError(err?.response?.data?.message || err.message || "Failed to load profile");
      }
    } finally {
      if (requestId === latestProfileRequestRef.current) {
        setProfileLoading(false);
      }
    }
  }

  function openManage(user) {
    // Prevent accidental click-through re-open/reset while modal is already open.
    if (profileOpen) {
      return;
    }
    // Unified staff workflow: one entry point for profile and account management.
    setEditing({ ...user });
    setEditPassword("");
    setManageTab("profile");
    setProfileMode("view");
    setProfileUserId(user.id);
    setProfileData(
      normalizeProfileData(
        { full_name: user.full_name || "", avatar_url: user.avatar_url || "" },
        createEmptyProfileData()
      )
    );
    setProfileLoading(true);
    setProfileOpen(true);
    const requestId = Date.now() + Math.random();
    latestProfileRequestRef.current = requestId;
    loadProfile(user.id, requestId);
  }

  function closeProfile() {
    latestProfileRequestRef.current += 1;
    setProfileOpen(false);
    setManageTab("profile");
    setProfileUserId(null);
    setProfileData(createEmptyProfileData());
    setProfileError("");
    setProfileLoading(false);
    setProfileMode("view");
    resetAccountForm();
  }

  function enableProfileEditing(event) {
    event?.preventDefault();
    event?.stopPropagation();
    setProfileMode("edit");
    setProfileData((current) => normalizeProfileData(current || {}, createEmptyProfileData()));
    requestAnimationFrame(() => profileNameInputRef.current?.focus());
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
            <div className={`inlineStatus ${flash.type === "error" ? "error" : "success"}`}>
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
              Add Staff
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
          <div className="dashboardStatGrid staffSummaryGrid">
            <div className="card dashboardMetricCard">
              <div className="dashboardMetricLabel">Active staff</div>
              <div className="dashboardMetricValue">{activeCount}</div>
            </div>
            <div className="card dashboardMetricCard">
              <div className="dashboardMetricLabel">Inactive staff</div>
              <div className="dashboardMetricValue">{inactiveCount}</div>
            </div>
            <div className="card dashboardMetricCard">
              <div className="dashboardMetricLabel">How this works</div>
              <div className="dashboardMetricHint">
                Active staff stay visible by default. Turn on inactive users only when you need to review or reactivate them.
              </div>
            </div>
          </div>

          <div className="staffFilterRow">
            <label className="toggleRow">
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              <span className="toggleText">Show INACTIVE</span>
            </label>
          </div>

          <div className="tableWrap">
            <div className="tableTopBar">Staff List</div>
            <div className="tableScroller">
            <table className="table table-wide">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Date Added</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="staffTableUser">
                        <StaffAvatar src={user.avatar_url} name={user.full_name} />
                        <div className="tableStrong">{user.full_name}</div>
                      </div>
                    </td>
                    <td>{user.username}</td>
                    <td>{user.role}</td>
                    <td>
                      <span className={`badge ${user.status === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
                        {user.status}
                      </span>
                    </td>
                    <td>{user.created_at ? formatDateLong(user.created_at) : "-"}</td>
                    <td>
                      <div className="rowActions">
                        <button type="button" className="btn" onClick={() => openManage(user)}>
                          Manage Staff
                        </button>
                        <button type="button" className="btn" onClick={() => toggleStatus(user)}>
                          {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan="6" className="tableEmpty">
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
        <div className="card staffCreateCard">
          <h3 className="modalTitle">Create User</h3>

          <form onSubmit={createUser} className="formGrid staffCreateForm">
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

            <div className="staffAvatarUpload">
              <label>Profile photo (optional)</label>
              <div className="staffAvatarCard">
                <AvatarPreview src={form.avatar_url} alt="New user avatar preview" size={84} />
                {!form.avatar_url && (
                  <div className="staffHintText">
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
                <div className="staffHintText">
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

            <div className="pageActions">
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

      {profileOpen &&
        createPortal(
          <div className="modalBackdrop">
            <div
              className="modalCard modalCard-lg staffManageModal"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modalHead">
                <div>
                  <h3 className="modalTitle">Manage Staff</h3>
                  <div className="mutedHint">
                    Review profile details or update account access in one place.
                  </div>
                </div>
              </div>

              {profileLoading ? (
                <div className="tableLoading">Loading...</div>
              ) : (
                <>
                  <div className="segmentTabs">
                    <button
                      type="button"
                      className={`segmentTab ${manageTab === "profile" ? "active" : ""}`}
                      onClick={() => setManageTab("profile")}
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      className={`segmentTab ${manageTab === "account" ? "active" : ""}`}
                      onClick={() => setManageTab("account")}
                    >
                      Account
                    </button>
                  </div>

                  {manageTab === "profile" ? (
                    <form onSubmit={saveProfile} className="formGrid modalSection">
                      {profileError && <div className="staffManageError">{profileError}</div>}

                      <div>
                        <label>Full name</label>
                        <input
                          ref={profileNameInputRef}
                          className="input"
                          name="full_name"
                          value={profileData?.full_name || ""}
                          onChange={(event) =>
                            setProfileData((current) => ({ ...(current || {}), full_name: event.target.value }))
                          }
                          disabled={profileMode !== "edit"}
                        />
                      </div>

                      <div>
                        <label>Email</label>
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

                      <div>
                        <label>Phone</label>
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

                      <div>
                        <label>Profile photo</label>
                        <div className="staffAvatarCard">
                          <AvatarPreview src={profileData?.avatar_url} size={84} alt="Staff avatar preview" />
                          {!profileData?.avatar_url && (
                            <div className="staffHintText">
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
                              <div className="staffHintText">
                                {profileAvatarUploading ? "Uploading avatar..." : "Optional. Upload a photo now or leave it unchanged."}
                              </div>
                              {profileData?.avatar_url && (
                                <button type="button" className="btn btn-ghost" onClick={clearProfileAvatar}>
                                  Remove Photo
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="staffHintText">Stored profile image</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <label>Address</label>
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

                      <div className="formActions">
                        <button type="button" onClick={closeProfile} className="btn btn-ghost">
                          Close
                        </button>
                        {profileMode === "edit" ? (
                          <button type="submit" className="btn btn-primary" disabled={profileSaving || profileAvatarUploading}>
                            {profileSaving ? "Saving..." : "Save Profile"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={enableProfileEditing}
                            className="btn"
                          >
                            Edit Profile and Photo
                          </button>
                        )}
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={saveEdit} className="formGrid modalSection">
                      <div>
                        <label>Full name</label>
                        <input
                          className="input"
                          value={editing?.full_name || ""}
                          onChange={(event) => setEditing((current) => ({ ...(current || {}), full_name: event.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label>Username</label>
                        <input
                          className="input"
                          value={editing?.username || ""}
                          onChange={(event) => setEditing((current) => ({ ...(current || {}), username: event.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label>Role</label>
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

                      <div>
                        <label>New password</label>
                        <input
                          className="input"
                          placeholder="Leave blank to keep the current password"
                          type="password"
                          value={editPassword}
                          onChange={(event) => setEditPassword(event.target.value)}
                        />
                      </div>

                      <div className="formActions">
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
          </div>,
          document.body
        )}
    </div>
  );
}
