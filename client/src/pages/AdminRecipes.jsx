import { useEffect, useState } from "react";
import api from "../services/api";

export default function AdminRecipes() {
  const [menuItems, setMenuItems] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [lines, setLines] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newLine, setNewLine] = useState({ ingredient_id: "", qty_used: "", qty_unit: "" });
  const [err, setErr] = useState("");

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

  function removeLine(id) {
    setLines((l) => l.filter((x) => x.id !== id));
  }

  async function saveRecipe() {
    // TODO: Integrate with backend recipe endpoints if available.
    // If an endpoint exists, POST the recipe version and lines here using `api`.
    console.log('Would save recipe for menu_item_id=', selectedMenu, 'lines=', lines);
    alert('Save logic not implemented: see TODO in code.');
  }

  return (
    <div style={{ maxWidth: 1000, margin: '30px auto', padding: 12 }}>
      <h2>Recipe Management</h2>
      {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}

      <div style={{ marginTop: 12 }}>
        <label>Menu Item</label>
        <select value={selectedMenu || ''} onChange={(e) => setSelectedMenu(e.target.value)} className="input">
          <option value="">-- select menu item --</option>
          {menuItems.map((m) => (
            <option key={m.id} value={m.id}>{m.menu_name}</option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <h3>Recipe Lines</h3>
        <button className="btn" onClick={startAddLine}>Add Line</button>

        {adding && (
          <div style={{ marginTop: 8, padding: 8, border: '1px solid #ddd' }}>
            <label>Ingredient</label>
            <select value={newLine.ingredient_id} onChange={(e) => setNewLine({ ...newLine, ingredient_id: e.target.value })} className="input">
              <option value="">-- select ingredient --</option>
              {ingredients.map((ig) => <option key={ig.id} value={ig.id}>{ig.ingredient_name}</option>)}
            </select>

            <label>Qty</label>
            <input value={newLine.qty_used} onChange={(e) => setNewLine({ ...newLine, qty_used: e.target.value })} className="input" />

            <label>Unit</label>
            <input value={newLine.qty_unit} onChange={(e) => setNewLine({ ...newLine, qty_unit: e.target.value })} className="input" />

            <div style={{ marginTop: 8 }}>
              <button className="btn btn-primary" onClick={saveLine}>Save Line</button>
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <table width="100%" cellPadding={8} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f3f3f3' }}>
                <th>Ingredient</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id} style={{ borderTop: '1px solid #eee' }}>
                  <td>{(ingredients.find((x) => String(x.id) === String(ln.ingredient_id)) || {}).ingredient_name || '-'}</td>
                  <td>{ln.qty_used}</td>
                  <td>{ln.qty_unit}</td>
                  <td><button className="btn btn-ghost" onClick={() => removeLine(ln.id)}>Remove</button></td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={4} style={{ opacity: 0.7 }}>No lines added.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={saveRecipe} disabled={!selectedMenu || lines.length === 0}>Save Recipe</button>
        </div>
      </div>
    </div>
  );
}
