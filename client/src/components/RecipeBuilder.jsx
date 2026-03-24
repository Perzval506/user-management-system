import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import ConfirmModal from "./ConfirmModal";
import MultiSelectDropdown from "./MultiSelectDropdown";

const buildDefaultLine = (ingredientId, ingredientsOpt, units) => {
  const sel = ingredientsOpt.find((i) => i.id === ingredientId);
  return {
    ingredient_id: ingredientId || null,
    qty_used: "",
    qty_unit: sel?.base_unit || units[0] || "",
    yield_percent: "",
    price: "",
  };
};

const RecipeLineRow = React.memo(function RecipeLineRow({ line, idx, ingredientsOpt, units, onChange, onRemove }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <select
        value={line.ingredient_id || ""}
        onChange={(e) => {
          const newId = Number(e.target.value) || null;
          const sel = ingredientsOpt.find((x) => x.id === newId);
          onChange(idx, { ingredient_id: newId, qty_unit: sel ? sel.base_unit : "" });
        }}
        style={{ minWidth: 220 }}
      >
        <option value="">-- select ingredient --</option>
        {ingredientsOpt.map((i) => (
          <option key={i.id} value={i.id}>
            {i.ingredient_name} ({i.base_unit})
          </option>
        ))}
      </select>

      <input
        placeholder="qty"
        type="number"
        step="0.001"
        min="0.001"
        value={line.qty_used ?? ""}
        onChange={(e) => onChange(idx, { qty_used: e.target.value })}
        style={{ width: 100, padding: 6 }}
      />

      <select
        value={line.qty_unit ?? ""}
        onChange={(e) => onChange(idx, { qty_unit: e.target.value })}
        style={{ width: 120, padding: 6 }}
      >
        <option value="">-- unit --</option>
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>

      <input
        placeholder="price"
        type="number"
        step="0.01"
        min="0"
        value={line.price ?? ""}
        onChange={(e) => onChange(idx, { price: e.target.value })}
        style={{ width: 100, padding: 6 }}
      />

      <input
        placeholder="yield %"
        type="number"
        step="0.01"
        min="0"
        max="100"
        value={line.yield_percent ?? ""}
        onChange={(e) => onChange(idx, { yield_percent: e.target.value })}
        style={{ width: 100, padding: 6 }}
      />

      <button onClick={() => onRemove(idx)} style={{ padding: "6px 10px" }}>
        Remove
      </button>
    </div>
  );
});

export default function RecipeBuilder({ menuId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recipeVersion, setRecipeVersion] = useState(null);
  const [lines, setLines] = useState([]);
  const [ingredientsOpt, setIngredientsOpt] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const units = useUnits();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = `recipe_draft:${menuId}`;

  const ingredientOptions = useMemo(
    () => ingredientsOpt.map((i) => ({ value: i.id, label: `${i.ingredient_name} (${i.base_unit})` })),
    [ingredientsOpt]
  );

  const totalCost = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.qty_used);
        const p = Number(line.price);
        if (!isFinite(qty) || !isFinite(p)) return sum;
        return sum + qty * p;
      }, 0),
    [lines]
  );

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
      setRecipeVersion(payload.recipe_version || null);
      const serverLines = (payload.ingredients || []).map((i) => ({
        id: i.id || null,
        ingredient_id: i.ingredient_id,
        qty_used: i.qty_used,
        qty_unit: i.qty_unit,
        yield_percent: i.yield_percent,
        price: i.price || "",
      }));

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
      setDirty(false);
      setSelectedToAdd([]);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Failed to load recipe data");
    } finally {
      setLoading(false);
    }
  }

  const writeDraft = useCallback(
    (nextLines) => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ recipeVersion, lines: nextLines, updated_at: Date.now() }));
      } catch (e) {
        /* ignore */
      }
    },
    [draftKey, recipeVersion]
  );

  const addLine = useCallback(() => {
    setLines((prev) => {
      const next = [...prev, buildDefaultLine(ingredientsOpt[0]?.id || null, ingredientsOpt, units)];
      setDirty(true);
      writeDraft(next);
      return next;
    });
  }, [ingredientsOpt, units, writeDraft]);

  const addSelected = useCallback(
    (ids) => {
      if (!Array.isArray(ids) || !ids.length) return;
      setLines((prev) => {
        const existing = new Set(prev.map((l) => l.ingredient_id));
        const additions = ids
          .map((id) => Number(id))
          .filter((id) => !Number.isNaN(id))
          .filter((id) => !existing.has(id))
          .map((id) => buildDefaultLine(id, ingredientsOpt, units));
        if (!additions.length) return prev;
        const next = [...prev, ...additions];
        setDirty(true);
        writeDraft(next);
        return next;
      });
    },
    [ingredientsOpt, units, writeDraft]
  );

  const updateLine = useCallback(
    (idx, change) => {
      setLines((prev) => {
        const next = prev.map((r, i) => (i === idx ? { ...r, ...change } : r));
        setDirty(true);
        writeDraft(next);
        return next;
      });
    },
    [writeDraft]
  );

  const removeLine = useCallback(
    (idx) => {
      setLines((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        setDirty(true);
        writeDraft(next);
        return next;
      });
    },
    [writeDraft]
  );

  async function save() {
    setSaving(true);
    setError("");
    try {
      for (const l of lines) {
        if (!l.ingredient_id) throw new Error("Each line requires an ingredient");
        if (l.qty_used === null || l.qty_used === "" || !isFinite(Number(l.qty_used)) || Number(l.qty_used) <= 0)
          throw new Error("qty_used must be a number greater than 0");
        if (!l.qty_unit || !units.includes(String(l.qty_unit).trim()))
          throw new Error("qty_unit is required and must be a valid unit");
        if (l.yield_percent !== "" && l.yield_percent !== null) {
          const yp = Number(l.yield_percent);
          if (!isFinite(yp) || yp < 0 || yp > 100) throw new Error("yield_percent must be between 0 and 100");
        }
      }

      await api.put(`/menu/${menuId}/recipe`, { recipe_version: recipeVersion, ingredients: lines });
      try {
        localStorage.removeItem(draftKey);
      } catch (e) {
        /* ignore */
      }
      setDirty(false);
      if (onClose) onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  function discardDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch (e) {
      /* ignore */
    }
    setDirty(false);
    setShowDiscardConfirm(false);
    load();
  }

  useEffect(() => {
    function handler(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loading) return <div>Loading recipe...</div>;

  return (
    <div>
      {error && <div style={{ marginBottom: 8, color: "crimson" }}>{error}</div>}

      <div style={{ marginBottom: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <strong>Recipe Version:</strong> {recipeVersion ? recipeVersion.version_no : "N/A"}
        </div>
        {dirty && <span style={{ marginLeft: 4, color: "#b44", fontWeight: 700 }}>Unsaved changes</span>}
        <div style={{ marginLeft: "auto", fontWeight: 800 }}>
          Total cost: PHP {Number.isFinite(totalCost) ? totalCost.toFixed(2) : "0.00"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <MultiSelectDropdown
                label="Add ingredients"
                options={ingredientOptions}
                selected={selectedToAdd}
                onChange={setSelectedToAdd}
                onDone={(vals) => addSelected(vals)}
                placeholder="Pick one or more ingredients"
              />
            </div>
            <button onClick={addLine} className="btn">
              Add empty line
            </button>
          </div>
        </div>

        {lines.map((line, idx) => (
          <MemoRecipeLineRow
            key={idx}
            line={line}
            idx={idx}
            ingredientsOpt={ingredientsOpt}
            units={units}
            onChange={updateLine}
            onRemove={removeLine}
          />
        ))}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowDiscardConfirm(true)} disabled={!dirty} style={{ padding: "8px 12px" }}>
            Discard
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={save} disabled={saving} style={{ padding: "8px 12px" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <ConfirmModal
        open={showDiscardConfirm}
        title="Discard changes?"
        message="Discard unsaved recipe changes for this menu item?"
        onConfirm={discardDraft}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}

const MemoRecipeLineRow = RecipeLineRow;
