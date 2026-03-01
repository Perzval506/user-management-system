import React, { useEffect, useState } from "react";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import ConfirmModal from "./ConfirmModal";

export default function RecipeBuilder({ menuId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recipeVersion, setRecipeVersion] = useState(null);
  const [lines, setLines] = useState([]);
  const [ingredientsOpt, setIngredientsOpt] = useState([]);
  const units = useUnits();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = `recipe_draft:${menuId}`;

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [ingsRes, rvRes] = await Promise.all([
        api.get("/ingredients"),
        api.get(`/menu/${menuId}/recipe`),
      ]);
      setIngredientsOpt(ingsRes.data || []);
      const payload = rvRes.data || {};
      // load server version
      setRecipeVersion(payload.recipe_version || null);
      const serverLines = (payload.ingredients || []).map(i => ({ id: i.id || null, ingredient_id: i.ingredient_id, qty_used: i.qty_used, qty_unit: i.qty_unit, yield_percent: i.yield_percent }));

      // if a draft exists in localStorage for this menuId, prefer it (load draft into UI)
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lines)) {
            setLines(parsed.lines);
            setRecipeVersion(parsed.recipeVersion || payload.recipe_version || null);
            setDirty(true);
          } else {
            setLines(serverLines);
          }
        } else {
          setLines(serverLines);
        }
      } catch (e) {
        setLines(serverLines);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Failed to load recipe data");
    } finally {
      setLoading(false);
    }
  }

  function writeDraft(nextLines) {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ recipeVersion, lines: nextLines, updated_at: Date.now() }));
    } catch (e) {
      // ignore
    }
  }

  function addLine() {
    const next = [...lines, { ingredient_id: ingredientsOpt[0]?.id || null, qty_used: '', qty_unit: ingredientsOpt[0]?.base_unit || units[0] || '', yield_percent: '' }];
    setLines(next);
    setDirty(true);
    writeDraft(next);
  }

  function updateLine(idx, change) {
    const next = lines.map((r, i) => i===idx ? { ...r, ...change } : r);
    setLines(next);
    setDirty(true);
    writeDraft(next);
  }

  function removeLine(idx) {
    const next = lines.filter((_, i) => i !== idx);
    setLines(next);
    setDirty(true);
    writeDraft(next);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      // basic validation
      for (const l of lines) {
        if (!l.ingredient_id) throw new Error('Each line requires an ingredient');
        if (l.qty_used === null || l.qty_used === '' || !isFinite(Number(l.qty_used)) || Number(l.qty_used) <= 0) throw new Error('qty_used must be a number greater than 0');
        if (!l.qty_unit || !units.includes(String(l.qty_unit).trim())) throw new Error('qty_unit is required and must be a valid unit');
        if (l.yield_percent !== '' && l.yield_percent !== null) {
          const yp = Number(l.yield_percent);
          if (!isFinite(yp) || yp < 0 || yp > 100) throw new Error('yield_percent must be between 0 and 100');
        }
      }

      await api.put(`/menu/${menuId}/recipe`, { recipe_version: recipeVersion, ingredients: lines });
      // clear draft on success
      try { localStorage.removeItem(draftKey); } catch (e) {}
      setDirty(false);
      if (onClose) onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  function discardDraft() {
    try { localStorage.removeItem(draftKey); } catch (e) {}
    setDirty(false);
    setShowDiscardConfirm(false);
    // reload server data
    load();
  }

  // warn on page unload if dirty
  useEffect(() => {
    function handler(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (loading) return <div>Loading recipe...</div>;

  return (
    <div>
      {error && <div style={{ marginBottom: 8, color: 'crimson' }}>{error}</div>}

      <div style={{ marginBottom: 8 }}>
        <strong>Recipe Version:</strong> {recipeVersion ? recipeVersion.version_no : 'N/A'}
        {dirty && <span style={{ marginLeft: 12, color: '#b44', fontWeight: 700 }}>Unsaved changes</span>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={line.ingredient_id || ''} onChange={(e) => {
              const newId = Number(e.target.value) || null;
              const sel = ingredientsOpt.find(x => x.id === newId);
              updateLine(idx, { ingredient_id: newId, qty_unit: sel ? sel.base_unit : '' });
            }} style={{ minWidth: 220 }}>
              <option value="">-- select ingredient --</option>
              {ingredientsOpt.map(i => (
                <option key={i.id} value={i.id}>{i.ingredient_name} ({i.base_unit})</option>
              ))}
            </select>
            <input placeholder="qty" type="number" step="0.001" min="0.001" value={line.qty_used ?? ''} onChange={(e) => updateLine(idx, { qty_used: e.target.value })} style={{ width: 100, padding: 6 }} />
                <select value={line.qty_unit ?? ''} onChange={(e) => updateLine(idx, { qty_unit: e.target.value })} style={{ width: 120, padding: 6 }}>
                  <option value="">-- unit --</option>
                  {units.map(u => (<option key={u} value={u}>{u}</option>))}
                </select>
            <input placeholder="yield %" type="number" step="0.01" min="0" max="100" value={line.yield_percent ?? ''} onChange={(e) => updateLine(idx, { yield_percent: e.target.value })} style={{ width: 100, padding: 6 }} />
            <button onClick={() => removeLine(idx)} style={{ padding: '6px 10px' }}>Remove</button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addLine} style={{ padding: '8px 12px' }}>Add ingredient line</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowDiscardConfirm(true)} disabled={!dirty} style={{ padding: '8px 12px' }}>Discard</button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 12px' }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <ConfirmModal open={showDiscardConfirm} title="Discard changes?" message="Discard unsaved recipe changes for this menu item?" onConfirm={discardDraft} onCancel={() => setShowDiscardConfirm(false)} />
    </div>
  );
}
