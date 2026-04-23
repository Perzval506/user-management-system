import { useMemo, useState } from "react";
import {
  getQuickActions,
  getQuickActionSelection,
  resetQuickActionSelection,
  setQuickActionSelection,
} from "../utils/quickActions";
import {
  applyUiPreferences,
  fontSizeOptions,
  getFontSizePreference,
  getThemePreference,
  setFontSizePreference,
  setThemePreference,
} from "../utils/preferences";

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
  const [theme, setTheme] = useState(() => getThemePreference());
  const [fontSize, setFontSize] = useState(() => getFontSizePreference());

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

  function updateTheme(nextTheme) {
    const saved = setThemePreference(nextTheme);
    setTheme(saved);
    applyUiPreferences({ theme: saved, fontSize });
  }

  function updateFontSize(nextSize) {
    const saved = setFontSizePreference(nextSize);
    setFontSize(saved);
    applyUiPreferences({ theme, fontSize: saved });
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Settings</h2>
          <div className="pageSub">Manage appearance and system preferences.</div>
        </div>
      </div>

      <div className="card settingsCard">
        <div className="settingsSectionHead">
          <div>
            <h3 className="settingsSectionTitle">Appearance</h3>
            <div className="pageSub settingsSectionSub">
              Adjust the overall theme and reading size for the app.
            </div>
          </div>
        </div>

        <div className="formRow2">
          <div>
            <label>Theme</label>
            <select className="input" value={theme} onChange={(event) => updateTheme(event.target.value)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div>
            <label>Font size</label>
            <select className="input" value={fontSize} onChange={(event) => updateFontSize(event.target.value)}>
              {fontSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card settingsCard">
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
          Selected: <strong>{selectedIds.length}</strong> of <strong>{allActions.length}</strong>
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
