import { useEffect, useState } from "react";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import { useToast } from "../components/Toast";

export default function AdminRecipes() {
  const toast = useToast();
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [lines, setLines] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newLine, setNewLine] = useState({ ingredient_id: "", qty_used: "", qty_unit: "" });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const units = useUnits();

  useEffect(() => {
    loadLists();
  }, []);

  async function loadLists() {
    try {
      const m = await api.get('/menu');
      const ing = await api.get('/ingredients');
      setMenuItems(Array.isArray(m.data) ? m.data : []);
      setIngredients(Array.isArray(ing.data) ? ing.data : []);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || 'Failed to load lists');
    }
  }

  function startAddLine() {
    setAdding(true);
    setNewLine({ ingredient_id: '', qty_used: '', qty_unit: '' });
  }

  function saveLine() {
    if (!newLine.ingredient_id) return setErr('Ingredient required');
    if (!newLine.qty_used) return setErr('Quantity required');
    setErr('');
    setLines((l) => [...l, { ...newLine, id: Date.now() }]);
    setAdding(false);
  }

  function updateLine(id, patch) {
    setLines((ls) => ls.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeLine(id) {
    setLines((l) => l.filter((x) => x.id !== id));
  }

  async function saveRecipe() {
    if (!selectedMenu) return setErr('Select a menu item first');
    if (!Array.isArray(lines) || lines.length === 0) return setErr('No lines to save');
    // client-side validation
    if (!units || units.length === 0) {
      // allow saving but warn
      console.warn('Units list empty, server will validate');
    }
    for (const ln of lines) {
      if (!ln.ingredient_id) return setErr('Each line must have an ingredient');
      const q = Number(ln.qty_used);
      if (!isFinite(q) || q <= 0) return setErr('Each line must have qty > 0');
      if (units && units.length && !units.includes(ln.qty_unit)) return setErr('Invalid unit on one or more lines');
    }

    setErr('');
    setSaving(true);
    try {
      const payload = { ingredients: lines.map((ln) => ({
        ingredient_id: Number(ln.ingredient_id),
        qty_used: Number(ln.qty_used),
        qty_unit: ln.qty_unit,
        yield_percent: ln.yield_percent || null
      })) };
      await api.put(`/menu/${selectedMenu}/recipe`, payload);
      toast.push({ type: "success", title: "Saved", message: "Recipe saved successfully." });
      // reload saved recipe lines
      const res = await api.get(`/menu/${selectedMenu}/recipe`);
      if (res && res.data) {
        setLines(Array.isArray(res.data.ingredients) ? res.data.ingredients.map((r) => ({
          id: r.id || Date.now() + Math.random(),
          ingredient_id: r.ingredient_id,
          qty_used: r.qty_used,
          qty_unit: r.qty_unit,
          yield_percent: r.yield_percent
        })) : []);
      }
    } catch (e) {
      const message = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Save failed';
      setErr(message);
      toast.push({ type: "error", title: "Save failed", message });
    } finally {
      setSaving(false);
    }
  }

  // load recipe when a menu is selected
  useEffect(() => {
    let mounted = true;
    async function loadRecipe() {
      if (!selectedMenu) return setLines([]);
      try {
        const res = await api.get(`/menu/${selectedMenu}/recipe`);
        if (!mounted) return;
        if (res && res.data && Array.isArray(res.data.ingredients)) {
          setLines(res.data.ingredients.map((r) => ({
            id: r.id || Date.now() + Math.random(),
            ingredient_id: r.ingredient_id,
            qty_used: r.qty_used,
            qty_unit: r.qty_unit,
            yield_percent: r.yield_percent
          })));
        } else {
          setLines([]);
        }
      } catch (err) {
        if (!mounted) return;
        setErr(err?.response?.data?.message || err?.message || 'Failed to load recipe');
      }
    }
    loadRecipe();
    return () => { mounted = false; };
  }, [selectedMenu]);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Recipe Management</h2>
          <div className="pageSub">Build and update recipe lines for each menu item.</div>
        </div>
      </div>
      {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}

      <div className="card">
        <label>Menu Item</label>
        <select value={selectedMenu || ''} onChange={(e) => setSelectedMenu(e.target.value)} className="input">
          <option value="">-- select menu item --</option>
          {menuItems.map((m) => (
            <option key={m.id} value={m.id}>{m.menu_name}</option>
          ))}
        </select>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Recipe Lines</h3>
        <button className="btn" onClick={startAddLine}>Add Line</button>

        {adding && (
          <div className="card" style={{ marginTop: 10, padding: 12 }}>
            <label>Ingredient</label>
            <select value={newLine.ingredient_id} onChange={(e) => setNewLine({ ...newLine, ingredient_id: e.target.value })} className="input">
              <option value="">-- select ingredient --</option>
              {ingredients.map((ig) => <option key={ig.id} value={ig.id}>{ig.ingredient_name}</option>)}
            </select>

            <label>Qty</label>
            <input value={newLine.qty_used} onChange={(e) => setNewLine({ ...newLine, qty_used: e.target.value })} className="input" />

            <label>Unit</label>
            <select value={newLine.qty_unit} onChange={(e) => setNewLine({ ...newLine, qty_unit: e.target.value })} className="input">
              <option value="">-- select unit --</option>
              {(units || []).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>

            <div style={{ marginTop: 8 }}>
              <button className="btn btn-primary" onClick={saveLine}>Save Line</button>
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div className="tableWrap">
            <table className="table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id}>
                  <td>
                    <select value={ln.ingredient_id} onChange={(e) => updateLine(ln.id, { ingredient_id: e.target.value })} className="input">
                      <option value="">-- select ingredient --</option>
                      {ingredients.map((ig) => <option key={ig.id} value={ig.id}>{ig.ingredient_name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={ln.qty_used} onChange={(e) => updateLine(ln.id, { qty_used: e.target.value })} className="input" />
                  </td>
                  <td>
                    <select value={ln.qty_unit} onChange={(e) => updateLine(ln.id, { qty_unit: e.target.value })} className="input">
                      <option value="">-- select unit --</option>
                      {(units || []).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><button className="btn btn-ghost" onClick={() => removeLine(ln.id)}>Remove</button></td>
                </tr>
              ))}
                {lines.length === 0 && (
                  <tr><td colSpan={4} style={{ opacity: 0.7 }}>No lines added.</td></tr>
                )}
            </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={saveRecipe} disabled={!selectedMenu || lines.length === 0 || saving}>{saving ? 'Saving...' : 'Save Recipe'}</button>
        </div>
      </div>
    </div>
  );
}
