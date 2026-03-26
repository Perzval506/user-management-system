import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import ConfirmModal from "./ConfirmModal";
import MultiSelectDropdown from "./MultiSelectDropdown";
import { useToast } from "./Toast";
import { formatMoney, formatNumber } from "../utils/formatters";

const makeLocalLineId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `recipe-line-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeLine = (line = {}) => ({
  id: line.id || null,
  local_id: line.local_id || (line.id ? `db-${line.id}` : makeLocalLineId()),
  ingredient_id: line.ingredient_id || null,
  qty_used: line.qty_used ?? "",
  qty_unit: line.qty_unit ?? "",
  price: line.price ?? "",
  yield_percent: line.yield_percent ?? "",
});

const buildDefaultLine = (ingredientId, ingredientsOpt, units) => {
  const selectedIngredient = ingredientsOpt.find((ingredient) => ingredient.id === ingredientId);
  return normalizeLine({
    ingredient_id: ingredientId || null,
    qty_unit: selectedIngredient?.base_unit || units[0] || "",
    price:
      selectedIngredient?.suggested_unit_cost != null &&
      Number.isFinite(Number(selectedIngredient.suggested_unit_cost))
        ? String(selectedIngredient.suggested_unit_cost)
        : "",
    qty_used: "",
    yield_percent: "",
  });
};

const RecipeLineRow = React.memo(function RecipeLineRow({
  line,
  idx,
  ingredientsOpt,
  units,
  onChange,
  onRemove,
}) {
  const selectedIngredient = ingredientsOpt.find((ingredient) => ingredient.id === line.ingredient_id) || null;
  const suggestedUnitCost =
    selectedIngredient?.suggested_unit_cost != null && Number.isFinite(Number(selectedIngredient.suggested_unit_cost))
      ? Number(selectedIngredient.suggested_unit_cost)
      : null;

  return (
    <tr>
      <td>
        <select
          className="input"
          value={line.ingredient_id || ""}
          onChange={(event) => {
            const newId = Number(event.target.value) || null;
            const selectedIngredient = ingredientsOpt.find((ingredient) => ingredient.id === newId);
            onChange(idx, {
              ingredient_id: newId,
              qty_unit: selectedIngredient ? selectedIngredient.base_unit : "",
              price:
                (line.price === "" || line.price === null) &&
                selectedIngredient?.suggested_unit_cost != null &&
                Number.isFinite(Number(selectedIngredient.suggested_unit_cost))
                  ? String(selectedIngredient.suggested_unit_cost)
                  : line.price,
            });
          }}
        >
          <option value="">Select ingredient</option>
          {ingredientsOpt.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.ingredient_name} ({ingredient.base_unit})
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="input"
          placeholder="e.g., 2.50"
          type="number"
          step="0.01"
          min="0.01"
          value={line.qty_used ?? ""}
          onChange={(event) => onChange(idx, { qty_used: event.target.value })}
        />
      </td>
      <td>
        <select
          className="input"
          value={line.qty_unit ?? ""}
          onChange={(event) => onChange(idx, { qty_unit: event.target.value })}
        >
          <option value="">Select unit</option>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className="input"
          placeholder={
            suggestedUnitCost != null
              ? `${suggestedUnitCost.toFixed(2)} suggested`
              : "0.00 per unit"
          }
          type="number"
          step="0.01"
          min="0"
          value={line.price ?? ""}
          onChange={(event) => onChange(idx, { price: event.target.value })}
        />
        {suggestedUnitCost != null && (
          <div style={{ color: "#6B7280", marginTop: 4, fontSize: 12 }}>
            Recent cost suggestion: {formatMoney(suggestedUnitCost)}
          </div>
        )}
      </td>
      <td>
        <input
          className="input"
          placeholder="100"
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={line.yield_percent ?? ""}
          onChange={(event) => onChange(idx, { yield_percent: event.target.value })}
        />
      </td>
      <td>
        <button className="btn btn-ghost" type="button" onClick={() => onRemove(idx)}>
          Remove
        </button>
      </td>
    </tr>
  );
});

export default function RecipeBuilder({ menuId, onClose }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recipeVersion, setRecipeVersion] = useState(null);
  const [lines, setLines] = useState([]);
  const [ingredientsOpt, setIngredientsOpt] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const units = useUnits();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const draftKey = `recipe_draft:${menuId}`;

  const ingredientOptions = useMemo(
    () =>
      ingredientsOpt.map((ingredient) => ({
        value: ingredient.id,
        label: `${ingredient.ingredient_name} (${ingredient.base_unit})`,
      })),
    [ingredientsOpt]
  );

  const totalCost = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const quantity = Number(line.qty_used);
        const price = Number(line.price);
        if (!isFinite(quantity) || !isFinite(price)) return sum;
        return sum + quantity * price;
      }, 0),
    [lines]
  );

  const estimatedPortions = useMemo(() => {
    const yieldAmount = Number(recipeVersion?.yield_amount);
    const portionSize = Number(recipeVersion?.portion_size);
    if (!isFinite(yieldAmount) || !isFinite(portionSize) || yieldAmount <= 0 || portionSize <= 0) {
      return null;
    }
    return yieldAmount / portionSize;
  }, [recipeVersion]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [ingredientsResponse, recipeResponse] = await Promise.all([
        api.get("/ingredients"),
        api.get(`/menu/${menuId}/recipe`),
      ]);

      setIngredientsOpt(ingredientsResponse.data || []);
      const payload = recipeResponse.data || {};
      setRecipeVersion(payload.recipe_version || null);
      const serverLines = (payload.ingredients || []).map(normalizeLine);

      let restoredDraft = false;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lines)) {
            setLines(parsed.lines.map(normalizeLine));
            setRecipeVersion(parsed.recipeVersion || payload.recipe_version || null);
            restoredDraft = true;
          } else {
            setLines(serverLines);
          }
        } else {
          setLines(serverLines);
        }
      } catch {
        setLines(serverLines);
      }

      // New draft handling: restored local drafts stay marked as dirty until the user saves or discards them.
      setDirty(restoredDraft);
      setSelectedToAdd([]);
    } catch (loadError) {
      setError(loadError?.response?.data?.error || loadError.message || "Failed to load recipe data");
    } finally {
      setLoading(false);
    }
  }, [draftKey, menuId]);

  useEffect(() => {
    load();
  }, [load]);

  const writeDraft = useCallback(
    (nextLines) => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            recipeVersion,
            lines: nextLines,
            updated_at: Date.now(),
          })
        );
      } catch {
        /* ignore */
      }
    },
    [draftKey, recipeVersion]
  );

  const updateRecipeVersion = (patch) => {
    setRecipeVersion((previous) => {
      const next = { ...(previous || {}), ...patch };
      setDirty(true);
      writeDraft(lines);
      return next;
    });
  };

  const addSelected = useCallback(
    (ids) => {
      if (!Array.isArray(ids) || !ids.length) return;
      setLines((previous) => {
        const existing = new Set(previous.map((line) => line.ingredient_id));
        const additions = ids
          .map((id) => Number(id))
          .filter((id) => !Number.isNaN(id))
          .filter((id) => !existing.has(id))
          .map((id) => buildDefaultLine(id, ingredientsOpt, units));

        if (!additions.length) return previous;
        const next = [...previous, ...additions];
        setDirty(true);
        writeDraft(next);
        return next;
      });
      setSelectedToAdd([]);
    },
    [ingredientsOpt, units, writeDraft]
  );

  const addLine = useCallback(() => {
    setLines((previous) => {
      const next = [...previous, buildDefaultLine(null, ingredientsOpt, units)];
      setDirty(true);
      writeDraft(next);
      return next;
    });
  }, [ingredientsOpt, units, writeDraft]);

  const updateLine = useCallback(
    (idx, change) => {
      setLines((previous) => {
        const next = previous.map((row, rowIndex) =>
          rowIndex === idx ? { ...row, ...change } : row
        );
        setDirty(true);
        writeDraft(next);
        return next;
      });
    },
    [writeDraft]
  );

  const removeLine = useCallback(
    (idx) => {
      setLines((previous) => {
        const next = previous.filter((_, rowIndex) => rowIndex !== idx);
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
      for (const line of lines) {
        if (!line.ingredient_id) throw new Error("Each line requires an ingredient.");
        if (
          line.qty_used === null ||
          line.qty_used === "" ||
          !isFinite(Number(line.qty_used)) ||
          Number(line.qty_used) <= 0
        ) {
          throw new Error("Each line needs a quantity greater than 0.");
        }
        if (!line.qty_unit || !units.includes(String(line.qty_unit).trim())) {
          throw new Error("Each line needs a valid unit.");
        }
        if (
          line.price !== "" &&
          line.price !== null &&
          (!isFinite(Number(line.price)) || Number(line.price) < 0)
        ) {
          throw new Error("Each line price must be 0 or greater.");
        }
        if (line.yield_percent !== "" && line.yield_percent !== null) {
          const yieldPercent = Number(line.yield_percent);
          if (!isFinite(yieldPercent) || yieldPercent < 0 || yieldPercent > 100) {
            throw new Error("Yield percent must be between 0 and 100.");
          }
        }
      }

      await api.put(`/menu/${menuId}/recipe`, {
        recipe_version: recipeVersion,
        ingredients: lines.map((line) => ({
          ingredient_id: Number(line.ingredient_id),
          qty_used: Number(line.qty_used),
          qty_unit: line.qty_unit,
          price: line.price === "" || line.price === null ? null : Number(line.price),
          yield_percent:
            line.yield_percent === "" || line.yield_percent === null
              ? null
              : Number(line.yield_percent),
        })),
      });

      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }

      setDirty(false);
      toast.push({
        type: "success",
        title: "Recipe saved",
        message: "Recipe settings and ingredient lines were updated.",
      });
      if (onClose) onClose();
    } catch (saveError) {
      setError(saveError?.response?.data?.error || saveError.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function discardDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setDirty(false);
    setShowDiscardConfirm(false);
    load();
  }

  useEffect(() => {
    function handler(event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
      return "";
    }

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loading) return <div>Loading recipe...</div>;

  return (
    <div>
      {error && <div style={{ marginBottom: 8, color: "crimson" }}>{error}</div>}

      <div
        style={{
          marginBottom: 12,
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>Recipe version:</strong>{" "}
          {recipeVersion?.version_no ? `v${recipeVersion.version_no}` : "Draft"}
        </div>
        {dirty && (
          <span style={{ marginLeft: 4, color: "#b44", fontWeight: 700 }}>
            Unsaved changes
          </span>
        )}
          <div style={{ marginLeft: "auto", fontWeight: 800 }}>
            Total ingredient cost: {formatMoney(Number.isFinite(totalCost) ? totalCost : 0)}
          </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          {/* UX cleanup: recipe setup is now presented as a first step so the workflow is easier to follow. */}
          <div style={{ marginBottom: 6, fontWeight: 700 }}>Step 1: Define the recipe output</div>
          <div style={{ color: "#6B7280", marginBottom: 12, lineHeight: 1.5 }}>
            Set how much this recipe makes, then define a serving size so portions and costing are easier to understand.
          </div>
          <div className="formRow2">
            <div>
              <label>Yield amount</label>
              <input
                className="input"
                type="number"
                  step="0.01"
                min="0"
                value={recipeVersion?.yield_amount ?? ""}
                onChange={(event) =>
                  updateRecipeVersion({ yield_amount: event.target.value || null })
                }
                placeholder="e.g., 1000"
              />
            </div>
            <div>
              <label>Yield unit</label>
              <select
                className="input"
                value={recipeVersion?.yield_unit ?? ""}
                onChange={(event) =>
                  updateRecipeVersion({ yield_unit: event.target.value || null })
                }
              >
                <option value="">Select unit</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="formRow2" style={{ marginTop: 10 }}>
            <div>
              <label>Portion size</label>
              <input
                className="input"
                type="number"
                  step="0.01"
                min="0"
                value={recipeVersion?.portion_size ?? ""}
                onChange={(event) =>
                  updateRecipeVersion({ portion_size: event.target.value || null })
                }
                placeholder="e.g., 125"
              />
            </div>
            <div>
              <label>Portion unit</label>
              <select
                className="input"
                value={recipeVersion?.portion_unit ?? ""}
                onChange={(event) =>
                  updateRecipeVersion({ portion_unit: event.target.value || null })
                }
              >
                <option value="">Select unit</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              marginTop: 12,
            }}
          >
            <div className="card" style={{ background: "#f8fafc" }}>
              <div style={{ color: "#6B7280", marginBottom: 4 }}>Ingredient lines</div>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{lines.length}</div>
            </div>
            <div className="card" style={{ background: "#f8fafc" }}>
              <div style={{ color: "#6B7280", marginBottom: 4 }}>Estimated portions</div>
                <div style={{ fontWeight: 800, fontSize: 22 }}>{estimatedPortions == null ? "-" : formatNumber(estimatedPortions)}</div>
            </div>
            <div className="card" style={{ background: "#f8fafc" }}>
                <div style={{ color: "#6B7280", marginBottom: 4 }}>Estimated ingredient cost</div>
                <div style={{ fontWeight: 800, fontSize: 22 }}>{formatMoney(totalCost)}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ marginBottom: 6, fontWeight: 700 }}>Step 2: Add the ingredient lines</div>
          <div style={{ color: "#6B7280", marginBottom: 12 }}>
            Add ingredients from the list, then enter the amount used, the unit, the unit cost, and the optional usable yield percentage.
            Recent buying history is used to suggest a unit cost when available.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <MultiSelectDropdown
                label="Add ingredients"
                options={ingredientOptions}
                selected={selectedToAdd}
                onChange={setSelectedToAdd}
                onDone={addSelected}
                placeholder="Choose one or more ingredients"
                doneLabel="Add selected"
              />
            </div>
            <button type="button" onClick={addLine} className="btn">
              Add blank row
            </button>
          </div>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Amount used</th>
                  <th>Unit</th>
                  <th>Unit cost</th>
                  <th>Yield %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <MemoRecipeLineRow
                    key={line.local_id || line.id || idx}
                    line={line}
                    idx={idx}
                    ingredientsOpt={ingredientsOpt}
                    units={units}
                    onChange={updateLine}
                    onRemove={removeLine}
                  />
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>
                      No ingredients added yet. Start with "Add ingredients" for stock items, or use "Add blank row" when you want to fill in one line manually.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={!dirty}
            className="btn btn-ghost"
          >
            Discard
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ color: "#6B7280", display: "flex", alignItems: "center" }}>
            Step 3: Save the recipe once the quantities and costs look correct.
          </div>
          <button type="button" onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save recipe"}
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
