// Dynamic costing and profitability helpers (client-side copy)
// Pure functions; safe to use in components/selectors without side effects

const round2 = (n) => Number.parseFloat((Number(n) || 0).toFixed(2));

export function calculateIngredientCost(ingredient) {
  const yieldPct = Number(ingredient?.yield_percent) || 0;
  const apCost = Number(ingredient?.ap_cost_per_unit) || 0;
  const qtyUsed = Number(ingredient?.quantity_used) || 0;

  const epUnitCost = yieldPct > 0 ? apCost / (yieldPct / 100) : 0;
  const ingredientCost = qtyUsed * epUnitCost;

  return {
    ep_unit_cost: round2(epUnitCost),
    ingredient_cost: round2(ingredientCost),
  };
}

export function calculateBatchCost(ingredients = []) {
  let batchCost = 0;
  const items = ingredients.map((ing) => {
    const costs = calculateIngredientCost(ing);
    batchCost += costs.ingredient_cost;
    return { ...ing, ...costs };
  });
  return { items, batch_cost: round2(batchCost) };
}

export function calculatePortions(total_yield_grams, portion_size_grams) {
  const portions =
    (Number(total_yield_grams) || 0) / (Number(portion_size_grams) || 1);
  return { number_of_portions: round2(portions) };
}

export function calculatePricing(batch_cost, number_of_portions, target_food_cost_percent) {
  const costPerPortion =
    number_of_portions > 0 ? batch_cost / number_of_portions : 0;
  const suggestedPrice =
    target_food_cost_percent > 0
      ? costPerPortion / target_food_cost_percent
      : 0;
  return {
    cost_per_portion: round2(costPerPortion),
    suggested_price: round2(suggestedPrice),
  };
}

export function evaluateProfitability({
  batch_cost,
  cost_per_portion,
  suggested_price,
  current_price,
}) {
  const currentPrice = Number(current_price) || 0;
  const profitPerPortion = currentPrice - cost_per_portion;
  const afcp = currentPrice > 0 ? cost_per_portion / currentPrice : 0;

  let status = "BREAKEVEN";
  let comment = "Menu item is breaking even.";
  if (profitPerPortion > 0) {
    status = "PROFIT";
    comment = "Menu item is profitable.";
  } else if (profitPerPortion < 0) {
    status = "LOSS";
    comment = "Menu item is losing money.";
  }

  return {
    batch_cost: round2(batch_cost),
    cost_per_portion: round2(cost_per_portion),
    suggested_price: round2(suggested_price),
    current_price: round2(currentPrice),
    profit_per_portion: round2(profitPerPortion),
    actual_food_cost_percent: round2(afcp),
    status,
    comment,
  };
}

export function computeMenuItemCosting(menuItem = {}) {
  const { items, batch_cost } = calculateBatchCost(menuItem.ingredients || []);
  const { number_of_portions } = calculatePortions(
    menuItem.total_yield_grams,
    menuItem.portion_size_grams
  );
  const { cost_per_portion, suggested_price } = calculatePricing(
    batch_cost,
    number_of_portions,
    menuItem.target_food_cost_percent
  );
  const profitability = evaluateProfitability({
    batch_cost,
    cost_per_portion,
    suggested_price,
    current_price: menuItem.current_selling_price,
  });
  return { ...profitability, items, number_of_portions };
}

export default {
  calculateIngredientCost,
  calculateBatchCost,
  calculatePortions,
  calculatePricing,
  evaluateProfitability,
  computeMenuItemCosting,
};
