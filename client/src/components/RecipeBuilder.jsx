import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import useUnits from "../hooks/useUnits";
import ConfirmModal from "./ConfirmModal";
import MultiSelectDropdown from "./MultiSelectDropdown";
import { useToast } from "./Toast";
import { formatDateLong, formatMoney, formatNumber } from "../utils/formatters";
import { computeMenuItemCosting } from "../utils/costing";

const makeLocalLineId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `recipe-line-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeLine = (line = {}) => ({
  id: line.id || null,
  local_id: line.local_id || (line.id ? `db-${line.id}` : makeLocalLineId()),
  ingredient_id: line.ingredient_id || null,
  qty_used: line.qty_used ?? "",
  qty_unit: line.qty_unit ?? "",
  price:
    line.price === null ||
    typeof line.price === "undefined" ||
    line.price === "" ||
    Number(line.price) === 0
      ? ""
      : line.price,
  yield_percent: line.yield_percent ?? "",
});

function preferredUnitCost(ingredient) {
  const currentApCost = Number(ingredient?.current_ap_cost);
  if (Number.isFinite(currentApCost) && currentApCost > 0) return currentApCost;

  const suggestedUnitCost = Number(ingredient?.suggested_unit_cost);
  if (Number.isFinite(suggestedUnitCost) && suggestedUnitCost > 0) return suggestedUnitCost;

  return null;
}

function isBlankOrZero(value) {
  return value === "" || value === null || typeof value === "undefined" || Number(value) === 0;
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

const buildDefaultLine = (ingredientId, ingredientsOpt, units) => {
  const selectedIngredient = ingredientsOpt.find((ingredient) => ingredient.id === ingredientId);
  return normalizeLine({
    ingredient_id: ingredientId || null,
    qty_unit: selectedIngredient?.base_unit || units[0] || "",
    price: "",
    qty_used: "",
    yield_percent: "",
  });
};

function getCostingStatusTone(status) {
  if (status === "High Profit" || status === "Moderate Profit") return "good";
  if (status === "Low Profit") return "warn";
  if (status === "Loss") return "bad";
  return "neutral";
}

function getCostingActionText(costingSummary, estimatedPortions) {
  if (estimatedPortions != null && estimatedPortions < 1) {
    return "Check the recipe output. The system thinks this batch makes less than one serving.";
  }
  if (estimatedPortions == null) {
    return "Set the recipe output and serving size so per-serving pricing is accurate.";
  }
  if (costingSummary?.has_unit_mismatch) {
    return "Review the ingredient units. Some lines may not match their base unit.";
  }
  if (costingSummary?.status === "Loss") {
    return "Raise the selling price or lower recipe cost before selling this item.";
  }
  if (costingSummary?.status === "Low Profit") {
    return "Review this item before discounting or promoting it.";
  }
  return "Recipe costing is ready for pricing review.";
}

const RecipeLineRow = React.memo(function RecipeLineRow({
  line,
  idx,
  ingredientsOpt,
  units,
  onChange,
  onRemove,
}) {
  const selectedIngredient = ingredientsOpt.find((ingredient) => ingredient.id === line.ingredient_id) || null;
  const suggestedUnitCost = preferredUnitCost(selectedIngredient);
  const displayedUnitCost = isBlankOrZero(line.price) && suggestedUnitCost != null ? String(suggestedUnitCost) : line.price ?? "";

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
              price: isBlankOrZero(line.price) ? "" : line.price,
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
          value={displayedUnitCost}
          onChange={(event) => onChange(idx, { price: event.target.value })}
        />
        {suggestedUnitCost != null && (
          <div className="formNote">
            Latest purchase cost: {formatMoney(suggestedUnitCost)} / {selectedIngredient?.base_unit || "unit"}
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

export default function RecipeBuilder({
  menuId,
  onClose,
  currentSellingPrice = 0,
  targetFoodCostPercent = 0.3,
  dineInPackagingCost = 0,
  takeoutPackagingCost = 0,
  deliveryPackagingCost = 0,
  onTargetChange,
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recipeVersion, setRecipeVersion] = useState(null);
  const [recipeVersions, setRecipeVersions] = useState([]);
  const [lines, setLines] = useState([]);
  const [ingredientsOpt, setIngredientsOpt] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const units = useUnits();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [costingOrderType, setCostingOrderType] = useState("DINE_IN");
  const [versionBusy, setVersionBusy] = useState(false);
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

  const costingSummary = useMemo(() => {
    const yieldAmount = Number(recipeVersion?.yield_amount);
    const portionSize = Number(recipeVersion?.portion_size);
    const hasDefinedPortions = isFinite(yieldAmount) && isFinite(portionSize) && yieldAmount > 0 && portionSize > 0;

    const ingredientsForCost = lines.map((line) => {
      const ingredient = ingredientsOpt.find((i) => i.id === line.ingredient_id);
      const qtyUsed = Number(line.qty_used) || 0;
      const fallbackCost = preferredUnitCost(ingredient) ?? 0;
      const linePrice = Number(line.price);
      const hasManualLinePrice =
        !isBlankOrZero(line.price) &&
        Number.isFinite(linePrice) &&
        (fallbackCost <= 0 || !nearlyEqual(linePrice, fallbackCost));
      const baseCost = hasManualLinePrice ? linePrice : fallbackCost;
      const yieldPercentRaw =
        line.yield_percent === "" || line.yield_percent === null
          ? 100
          : Number(line.yield_percent);

      return {
        quantity_used: qtyUsed,
        quantity_unit: line.qty_unit,
        base_unit: ingredient?.base_unit || line.qty_unit,
        ap_cost_per_unit: isFinite(baseCost) ? baseCost : 0,
        uses_manual_unit_cost: hasManualLinePrice,
        yield_percent: isFinite(yieldPercentRaw) ? yieldPercentRaw : 100,
      };
    });

    return computeMenuItemCosting({
      ingredients: ingredientsForCost,
      total_yield_grams: hasDefinedPortions ? yieldAmount : 1,
      portion_size_grams: hasDefinedPortions ? portionSize : 1,
      target_food_cost_percent: Number(targetFoodCostPercent) || 0,
      current_selling_price: Number(currentSellingPrice) || 0,
      order_type: costingOrderType,
      dine_in_packaging_cost: Number(dineInPackagingCost) || 0,
      takeout_packaging_cost: Number(takeoutPackagingCost) || 0,
      delivery_packaging_cost: Number(deliveryPackagingCost) || 0,
    });
  }, [lines, ingredientsOpt, recipeVersion, targetFoodCostPercent, currentSellingPrice, costingOrderType, dineInPackagingCost, takeoutPackagingCost, deliveryPackagingCost]);
  const costingTone = getCostingStatusTone(costingSummary?.status);
  const costingActionText = getCostingActionText(costingSummary, estimatedPortions);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [ingredientsResponse, recipeResponse] = await Promise.all([
        api.get("/ingredients"),
        api.get(`/menu/${menuId}/recipe`),
      ]);
      const versionResponse = await api.get(`/menu/${menuId}/recipe-versions`);

      setIngredientsOpt(ingredientsResponse.data || []);
      const payload = recipeResponse.data || {};
      setRecipeVersion(payload.recipe_version || null);
      setRecipeVersions(versionResponse.data || []);
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

  async function createNewVersion() {
    setVersionBusy(true);
    try {
      await api.post(`/menu/${menuId}/recipe-versions`);
      toast.push({
        type: "success",
        title: "Version created",
        message: "A new editable recipe version is now active.",
      });
      await load();
    } catch (error) {
      setError(error?.response?.data?.error || error.message || "Failed to create a new recipe version");
    } finally {
      setVersionBusy(false);
    }
  }

  async function lockCurrentVersion() {
    if (!recipeVersion?.id) return;
    setVersionBusy(true);
    try {
      await api.post(`/menu/${menuId}/recipe-versions/${recipeVersion.id}/lock`);
      toast.push({
        type: "success",
        title: "Version locked",
        message: `Recipe version v${recipeVersion.version_no || ""} is now locked.`,
      });
      await load();
    } catch (error) {
      setError(error?.response?.data?.error || error.message || "Failed to lock recipe version");
    } finally {
      setVersionBusy(false);
    }
  }

  async function activateVersion(versionId) {
    if (!versionId) return;
    setVersionBusy(true);
    try {
      await api.post(`/menu/${menuId}/recipe-versions/${versionId}/activate`);
      toast.push({
        type: "success",
        title: "Version activated",
        message: "The selected recipe version is now active.",
      });
      await load();
    } catch (error) {
      setError(error?.response?.data?.error || error.message || "Failed to activate recipe version");
    } finally {
      setVersionBusy(false);
    }
  }

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
          price: isBlankOrZero(line.price) ? null : Number(line.price),
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
    <div className="recipeBuilder">
      {error && <div style={{ marginBottom: 8, color: "crimson" }}>{error}</div>}

      <div className="recipeHeaderCard">
        <div className="recipeHeaderMeta">
          <div className="recipeHeaderBlock">
            <div className="recipeHeaderLabel">Version</div>
            <div className="recipeHeaderValue">{recipeVersion?.version_no ? `v${recipeVersion.version_no}` : "Draft"}</div>
          </div>
          <div className="recipeHeaderBlock recipeHeaderControl">
            <label className="recipeHeaderLabel">Order type</label>
            <div className="recipeHeaderSelectWrap">
          <select className="input" value={costingOrderType} onChange={(event) => setCostingOrderType(event.target.value)}>
            <option value="DINE_IN">DINE IN</option>
            <option value="TAKEOUT">TAKEOUT</option>
            <option value="DELIVERY">DELIVERY</option>
          </select>
            </div>
          </div>
          {dirty && (
            <div className="recipeDirtyPill">Unsaved changes</div>
          )}
        </div>
      </div>

      <div className="card recipeVersionsCard">
        <div className="recipeSectionHead">
          <div>
            <div className="recipeSectionTitle">Versions</div>
            <div className="recipeSectionSub">Switch or lock a version.</div>
          </div>
          <button type="button" className="btn btn-primary" onClick={createNewVersion} disabled={versionBusy}>
            Create New Version
          </button>
        </div>

        <div className="recipeTableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th className="text-right">Cost / Portion</th>
                <th className="text-right">Diff vs Current</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipeVersions.map((version) => {
                const isCurrent = Number(version.id) === Number(recipeVersion?.id);
                return (
                  <tr key={version.id}>
                    <td>
                      <div className="recipeVersionName">
                        v{version.version_no}{isCurrent ? " (Current)" : ""}
                      </div>
                      <div className="recipeVersionMeta">
                        {version.ingredient_count || 0} ingredients • {version.is_locked ? "Locked" : "Editable"}
                      </div>
                    </td>
                    <td className="text-right mono">
                      {version.cost_per_portion == null ? "-" : formatMoney(version.cost_per_portion)}
                    </td>
                    <td className="text-right mono">
                      {version.diff_vs_current == null ? "-" : `${version.diff_vs_current > 0 ? "+" : ""}${formatMoney(version.diff_vs_current)}`}
                    </td>
                    <td>
                      <span className={`badge ${isCurrent ? "badge-active" : "badge-pending"}`}>
                        {isCurrent ? "Current" : version.is_locked ? "Locked" : "Available"}
                      </span>
                    </td>
                    <td>{formatDateLong(version.created_at)}</td>
                    <td>
                      <div className="rowActions">
                        {isCurrent ? (
                          <button type="button" className="btn btn-ghost" onClick={lockCurrentVersion} disabled={versionBusy || version.is_locked}>
                            {version.is_locked ? "Locked" : "Lock"}
                          </button>
                        ) : (
                          <button type="button" className="btn" onClick={() => activateVersion(version.id)} disabled={versionBusy}>
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {recipeVersions.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ padding: 12, opacity: 0.7 }}>
                    No recipe versions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="recipeContent">
        <div className="card recipeSectionCard">
          {/* UX cleanup: recipe setup is now presented as a first step so the workflow is easier to follow. */}
          <div className="recipeSectionHead recipeSectionHead-compact">
            <div>
              <div className="recipeSectionTitle">Output</div>
              <div className="recipeSectionSub">Batch and serving size.</div>
            </div>
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

          <div className="recipeMetricGrid">
            <div className="metricMiniCard">
              <div className="metricMiniLabel">Ingredient lines</div>
              <div className="metricMiniValue">{lines.length}</div>
            </div>
            <div className="metricMiniCard">
              <div className="metricMiniLabel">Servings made</div>
                <div className="metricMiniValue">{estimatedPortions == null ? "-" : formatNumber(estimatedPortions)}</div>
                {estimatedPortions == null ? (
                  <div className="metricMiniHelper">
                    Uses one batch until output is set.
                  </div>
                ) : null}
            </div>
            <div className="metricMiniCard">
              <div className="metricMiniLabel">Cost per serving</div>
              <div className="metricMiniValue">
                {formatMoney(costingSummary?.cost_per_portion || 0)}
              </div>
            </div>
            <div className="metricMiniCard">
              <div className="metricMiniLabel">Packaging</div>
              <div className="metricMiniValue">
                {formatMoney(costingSummary?.packaging_cost_per_portion || 0)}
              </div>
            </div>
            <div className="metricMiniCard">
              <div className="metricMiniLabel">Suggested price</div>
              <div className="metricMiniValue">
                {formatMoney(costingSummary?.suggested_price || 0)}
              </div>
            </div>
          </div>
        </div>

        <div className="card recipeSectionCard">
          <div className="recipeSectionHead recipeSectionHead-compact">
            <div>
              <div className="recipeSectionTitle">Ingredients</div>
              <div className="recipeSectionSub">Amounts and yield.</div>
            </div>
          </div>
          <div className="recipeAddBar">
            <div className="recipeAddControl">
              <MultiSelectDropdown
                label="Add ingredients"
                options={ingredientOptions}
                selected={selectedToAdd}
                onChange={setSelectedToAdd}
                onDone={addSelected}
                placeholder="Choose ingredients"
                doneLabel="Add selected"
              />
            </div>
            <button type="button" onClick={addLine} className="btn">
              Add blank row
            </button>
          </div>

          <div className="recipeTableWrap recipeIngredientTable">
            <table className="table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Amount used</th>
                  <th>Unit</th>
                  <th>Latest cost / unit</th>
                  <th>Usable yield %</th>
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
                      No ingredients added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="recipeSaveBar">
          <button
            type="button"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={!dirty}
            className="btn btn-ghost"
          >
            Discard
          </button>
          <div className="recipeSaveSpacer" />
          <div className="recipeSaveHint">
            Save when the recipe looks right.
          </div>
          <button type="button" onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save recipe"}
          </button>
        </div>
      </div>

      <div className="card costingPanel">
        <div className="costingPanelHead">
          <div className="costingResult">
            <div className="sectionEyebrow">Pricing review</div>
            <div className="costingResultLine">
              <span className={`statusPill statusPill-${costingTone}`}>{costingSummary?.status || "N/A"}</span>
              <span className="costingResultText">{costingSummary?.comment}</span>
            </div>
            <div className="costingActionText">{costingActionText}</div>
            {costingSummary?.has_unit_mismatch ? (
              <div className="warningText">Unit mismatch. Review costing.</div>
            ) : null}
            {estimatedPortions == null ? (
              <div className="mutedHint">Output not set. Costing uses one batch.</div>
            ) : null}
          </div>
          <div className="costingTargetBox">
            <label style={{ display: "block" }}>
              Target food cost %
              <span style={{ color: "#6B7280" }}> — 0.30 = 30%</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              className="input"
              value={targetFoodCostPercent ?? ""}
              onChange={(e) => onTargetChange && onTargetChange(e.target.value)}
            />
            <div className="formNote">Set in Pricing.</div>
          </div>
        </div>

        <div className="recipeCostGrid">
          <CostCell
            label="Recipe cost"
            value={formatMoney(costingSummary?.batch_cost || 0)}
            helper="Full batch."
          />
          <CostCell
            label="Food cost"
            value={formatMoney(costingSummary?.food_cost_per_portion || 0)}
            helper="Per serving."
          />
          <CostCell
            label="Total cost"
            value={formatMoney(costingSummary?.cost_per_portion || 0)}
            helper="Per serving."
          />
          <CostCell
            label="Packaging"
            value={formatMoney(costingSummary?.packaging_cost_per_portion || 0)}
            helper={`Applied for ${String(costingSummary?.order_type || costingOrderType).replace("_", " ")}`}
          />
          <CostCell
            label="Suggested price"
            value={formatMoney(costingSummary?.suggested_price || 0)}
            helper="From target food cost."
          />
          <CostCell
            label="Current price"
            value={formatMoney(currentSellingPrice || 0)}
            helper="Latest history."
          />
          <CostCell
            label="Profit"
            value={formatMoney(costingSummary?.profit_per_portion || 0)}
            helper={`Margin: ${formatNumber(costingSummary?.profit_margin * 100 || 0)}% | Ingredient cost: ${formatNumber(costingSummary?.actual_food_cost_percent * 100 || 0)}%`}
          />
          <CostCell
            label="Servings"
            value={
              costingSummary?.number_of_portions != null
                ? formatNumber(costingSummary.number_of_portions)
                : "-"
            }
            helper="Yield divided by portion."
          />
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

function CostCell({ label, value, helper }) {
  return (
    <div className="metricMiniCard">
      <div className="metricMiniLabel">{label}</div>
      <div className="metricMiniValue">{value}</div>
      {helper && <div className="metricMiniHelper">{helper}</div>}
    </div>
  );
}

const MemoRecipeLineRow = RecipeLineRow;
