import { useMemo, useState } from "react";
import { getQuickActions, getQuickActionSelection, resetQuickActionSelection, setQuickActionSelection } from "../utils/quickActions";

function safeRole() {
  try {
    const raw = localStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    return user?.role || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export default function Settings() {
  const role = safeRole();
  const allActions = useMemo(() => getQuickActions(role), [role]);
  const [selectedIds, setSelectedIds] = useState(() => getQuickActionSelection(role));

  const selectedCount = selectedIds.length;

  function toggleAction(id) {
    const has = selectedIds.includes(id);
    const next = has ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    const saved = setQuickActionSelection(role, next);
    setSelectedIds(saved);
  }

  function resetDefaults() {
    const defaults = resetQuickActionSelection(role);
    setSelectedIds(defaults);
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Settings</h2>
          <div className="pageSub">Manage system preferences and account-level configuration.</div>
        </div>
      </div>

      <div className="card">
        <div className="settingsSectionHead">
          <div>
            <h3 className="settingsSectionTitle">Quick Actions</h3>
            <div className="pageSub settingsSectionSub">
              Choose which predefined actions appear in the floating quick actions button.
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={resetDefaults}>
            Reset Defaults
          </button>
        </div>

        <div className="settingsHint">
          Selected: <strong>{selectedCount}</strong> of <strong>{allActions.length}</strong>
        </div>

        <div className="settingsQuickActionList">
          {allActions.map((action) => {
            const checked = selectedIds.includes(action.id);
            return (
              <label key={action.id} className="settingsQuickActionItem">
                <span className="settingsQuickActionInfo">
                  <span className="settingsQuickActionLabel">{action.label}</span>
                  <span className="settingsQuickActionDesc">{action.description}</span>
                </span>

                <span className="toggleControl">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAction(action.id)}
                    aria-label={`Toggle ${action.label}`}
                  />
                  <span className="toggleSlider" />
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
