import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Staff() {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadMyProfile() {
    setLoading(true);
    setMsg("");
    try {
      // If your backend has a "my profile" endpoint, replace this.
      // Based on your Admin.jsx, you used /profile/staff/:id, so we reuse it.
      const res = await api.get(`/profile/staff/${user?.id}`);
      setProfile(res.data || null);
    } catch (err) {
      setMsg(err?.response?.data?.message || "Failed to load profile");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMyProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">My Profile</h2>
          <div className="pageSub" style={{ marginTop: 6 }}>
            Logged in as <b>{user?.username}</b> ({user?.role})
          </div>
          {msg && <div className="inlineStatus error">{msg}</div>}
        </div>

        <button className="btn btn-ghost" type="button" onClick={loadMyProfile}>
          Refresh
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div>Loading...</div>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>Staff Details</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Full Name" value={profile?.full_name || "-"} />
              <Field label="Username" value={user?.username || "-"} />

              <Field label="Role" value={user?.role || "-"} />
              <Field label="Email" value={profile?.email || "-"} />

              <Field label="Phone" value={profile?.phone || "-"} />
              <Field label="Address" value={profile?.address || "-"} />
            </div>

            <div style={{ marginTop: 12, color: "#6B7280", fontSize: 12 }}>
              If you need changes to your account, please request the owner/administrator.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ padding: 14, borderRadius: 14, background: "#FBFBFE", border: "1px solid #E7EAF3" }}>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{value}</div>
    </div>
  );
}
