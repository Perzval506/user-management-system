import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

function safeUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function staffActionsForRole(role) {
  if (role === "CASHIER") {
    return [
      {
        title: "Sales",
        description: "Record guest checks, group ordered items per customer, and review daily earnings.",
        to: "/staff/sales",
        cta: "Open Sales",
      },
    ];
  }

  if (role === "STOCKROOM_STAFF") {
    return [
      {
        title: "Ingredients",
        description: "Create and update ingredient records, quantities, and current buying cost.",
        to: "/staff/ingredients",
        cta: "Open Ingredients",
      },
      {
        title: "Purchase Requests",
        description: "Submit weekly or urgent buy requests for owner approval before actual purchasing.",
        to: "/staff/purchase-requests",
        cta: "Open Requests",
      },
      {
        title: "Stock Summary",
        description: "Review current stock totals before buying or issuing ingredients.",
        to: "/staff/inventory-summary",
        cta: "View Stock Summary",
      },
    ];
  }

  return [];
}

function roleSummary(role) {
  if (role === "CASHIER") {
    return "Cashier access is focused on sales recording and guest checks.";
  }
  if (role === "STOCKROOM_STAFF") {
    return "Stockroom access is focused on ingredients, purchasing, and inventory monitoring.";
  }
  return "Your access depends on the role assigned by the owner.";
}

export default function Staff() {
  const navigate = useNavigate();
  const user = safeUser();
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const actions = useMemo(() => staffActionsForRole(user?.role), [user?.role]);

  async function loadMyProfile() {
    setLoading(true);
    setMsg("");
    try {
      const res = await api.get("/profile/me");
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
  }, []);

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Staff Workspace</h2>
          <div className="pageSub" style={{ marginTop: 6 }}>
            Logged in as <b>{user?.username}</b> ({user?.role})
          </div>
          <div className="pageSub" style={{ marginTop: 8 }}>
            {roleSummary(user?.role)}
          </div>
          {msg ? <div className="inlineStatus error">{msg}</div> : null}
        </div>

        <button className="btn btn-ghost" type="button" onClick={loadMyProfile}>
          Refresh
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div className="card">
          {loading ? (
            <div>Loading...</div>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Profile</h3>

              {profile?.avatar_url ? (
                <div style={{ marginBottom: 16 }}>
                  <img
                    src={profile.avatar_url}
                    alt={`${profile.full_name || "Staff"} avatar`}
                    style={{
                      width: 88,
                      height: 88,
                      borderRadius: 20,
                      objectFit: "cover",
                      border: "1px solid #E7EAF3",
                    }}
                  />
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                <Field label="Full Name" value={profile?.full_name || "-"} />
                <Field label="Username" value={user?.username || "-"} />
                <Field label="Role" value={user?.role || "-"} />
                <Field label="Email" value={profile?.email || "-"} />
                <Field label="Phone" value={profile?.phone || "-"} />
                <Field label="Address" value={profile?.address || "-"} />
              </div>

              <div style={{ marginTop: 12, color: "#6B7280", fontSize: 12 }}>
                Profile details are read-only here. Request owner approval for account changes.
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Assigned Functions</h3>
          <div className="pageSub" style={{ marginBottom: 16 }}>
            Only pages backed by your current role permissions are shown here.
          </div>

          {actions.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {actions.map((action) => (
                <div
                  key={action.to}
                  style={{
                    border: "1px solid #E7EAF3",
                    borderRadius: 18,
                    padding: 18,
                    background: "#FBFBFE",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937" }}>{action.title}</div>
                  <div style={{ color: "#6B7280", lineHeight: 1.5 }}>{action.description}</div>
                  <button type="button" className="btn btn-primary" onClick={() => navigate(action.to)}>
                    {action.cta}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="emptyState">No staff actions are configured for this role yet.</div>
          )}
        </div>
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
