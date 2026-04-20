// Dynamic costing and profitability helpers (client-side copy)
// Pure functions; safe to use in components/selectors without side effects
import { convertQuantity } from "./unitConversion";

const round2 = (n) => Number.parseFloat((Number(n) || 0).toFixed(2));

function packagingCostForOrderType(menuItem = {}) {
  const orderType = String(menuItem.order_type || "DINE_IN").toUpperCase();
  if (orderType === "TAKEOUT") return round2(menuItem.takeout_packaging_cost);
  if (orderType === "DELIVERY") return round2(menuItem.delivery_packaging_cost);
  return round2(menuItem.dine_in_packaging_cost);
}

export function calculateIngredientCost(ingredient) {
  const yieldPct = Number(ingredient?.yield_percent) || 0;
  const apCost = Number(ingredient?.ap_cost_per_unit) || 0;
  const qtyUsedRaw = Number(ingredient?.quantity_used) || 0;
  const qtyUsed =
    ingredient?.uses_manual_unit_cost
      ? qtyUsedRaw
      : convertQuantity(qtyUsedRaw, ingredient?.quantity_unit, ingredient?.base_unit) ?? null;

  if (!ingredient?.uses_manual_unit_cost && qtyUsed === null) {
    return {
      ep_unit_cost: 0,
      ingredient_cost: 0,
      has_unit_mismatch: true,
    };
  }

  const epUnitCost = yieldPct > 0 ? apCost / (yieldPct / 100) : 0;
  const ingredientCost = qtyUsed * epUnitCost;

  return {
    ep_unit_cost: round2(epUnitCost),
    ingredient_cost: round2(ingredientCost),
    has_unit_mismatch: false,
  };
}

export function calculateBatchCost(ingredients = []) {
  let batchCost = 0;
  let hasUnitMismatch = false;
  const items = ingredients.map((ing) => {
    const costs = calculateIngredientCost(ing);
    if (costs.has_unit_mismatch) hasUnitMismatch = true;
    batchCost += costs.ingredient_cost;
    return { ...ing, ...costs };
  });
  return { items, batch_cost: round2(batchCost), has_unit_mismatch: hasUnitMismatch };
}

export function calculatePortions(total_yield_grams, portion_size_grams) {
  const portions =
    (Number(total_yield_grams) || 0) / (Number(portion_size_grams) || 1);
  return { number_of_portions: round2(portions) };
}

export function calculatePricing(batch_cost, number_of_portions, target_food_cost_percent, packaging_cost_per_portion = 0) {
  const costPerPortion =
    number_of_portions > 0 ? batch_cost / number_of_portions : 0;
  const totalCostPerPortion = costPerPortion + (Number(packaging_cost_per_portion) || 0);
  const suggestedPrice =
    target_food_cost_percent > 0
      ? totalCostPerPortion / target_food_cost_percent
      : 0;
  return {
    food_cost_per_portion: round2(costPerPortion),
    packaging_cost_per_portion: round2(packaging_cost_per_portion),
    cost_per_portion: round2(totalCostPerPortion),
    suggested_price: round2(suggestedPrice),
  };
}

export function evaluateProfitability({
  batch_cost,
  food_cost_per_portion,
  packaging_cost_per_portion,
  cost_per_portion,
  suggested_price,
  current_price,
  order_type,
}) {
  const currentPrice = Number(current_price) || 0;
  const profitPerPortion = currentPrice - cost_per_portion;
  const profitMargin = currentPrice > 0 ? profitPerPortion / currentPrice : 0;
  const afcp = currentPrice > 0 ? cost_per_portion / currentPrice : 0;

  let status = "Break-even";
  let comment = "This menu item is breaking even at the current selling price.";
  if (profitPerPortion < 0) {
    status = "Loss";
    comment = "This menu item is losing money at the current selling price.";
  } else if (Math.abs(profitPerPortion) < 0.01 || Math.abs(profitMargin) < 0.01) {
    status = "Break-even";
    comment = "This menu item is effectively breaking even.";
  } else if (profitMargin < 0.15) {
    status = "Low Profit";
    comment = "This menu item is profitable, but the margin is still low.";
  } else if (profitMargin < 0.3) {
    status = "Moderate Profit";
    comment = "This menu item has a healthy moderate profit margin.";
  } else {
    status = "High Profit";
    comment = "This menu item has a strong profit margin.";
  }

  return {
    batch_cost: round2(batch_cost),
    food_cost_per_portion: round2(food_cost_per_portion),
    packaging_cost_per_portion: round2(packaging_cost_per_portion),
    cost_per_portion: round2(cost_per_portion),
    suggested_price: round2(suggested_price),
    current_price: round2(currentPrice),
    profit_per_portion: round2(profitPerPortion),
    actual_food_cost_percent: round2(afcp),
    profit_margin: round2(profitMargin),
    order_type: String(order_type || "DINE_IN").toUpperCase(),
    status,
    comment,
  };
}

export function computeMenuItemCosting(menuItem = {}) {
  const { items, batch_cost } = calculateBatchCost(menuItem.ingredients || []);
  const hasUnitMismatch = items.some((item) => item.has_unit_mismatch);
  const packagingCostPerPortion = packagingCostForOrderType(menuItem);
  const { number_of_portions } = calculatePortions(
    menuItem.total_yield_grams,
    menuItem.portion_size_grams
  );
  const { food_cost_per_portion, packaging_cost_per_portion, cost_per_portion, suggested_price } = calculatePricing(
    batch_cost,
    number_of_portions,
    menuItem.target_food_cost_percent,
    packagingCostPerPortion
  );
  const profitability = evaluateProfitability({
    batch_cost,
    food_cost_per_portion,
    packaging_cost_per_portion,
    cost_per_portion,
    suggested_price,
    current_price: menuItem.current_selling_price,
    order_type: menuItem.order_type,
  });
  return { ...profitability, items, number_of_portions, has_unit_mismatch: hasUnitMismatch };
}

export default {
  calculateIngredientCost,
  calculateBatchCost,
  calculatePortions,
  calculatePricing,
  evaluateProfitability,
  computeMenuItemCosting,
};
