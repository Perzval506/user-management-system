// Dynamic costing and profitability helpers
// Pure functions; safe to use in services/controllers or client-side calculations

const round2 = (n) => Number.parseFloat((Number(n) || 0).toFixed(2));

function packagingCostForOrderType(menuItem = {}) {
  const orderType = String(menuItem.order_type || "DINE_IN").toUpperCase();
  if (orderType === "TAKEOUT") return round2(menuItem.takeout_packaging_cost);
  if (orderType === "DELIVERY") return round2(menuItem.delivery_packaging_cost);
  return round2(menuItem.dine_in_packaging_cost);
}

/**
 * ingredient: { quantity_used, unit, ap_cost_per_unit, yield_percent }
 * Returns { ep_unit_cost, ingredient_cost }
 */
function calculateIngredientCost(ingredient) {
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

/**
 * ingredients: array of ingredient objects
 * Returns { items: [...with ep_unit_cost & ingredient_cost], batch_cost }
 */
function calculateBatchCost(ingredients = []) {
  let batchCost = 0;
  const items = ingredients.map((ing) => {
    const costs = calculateIngredientCost(ing);
    batchCost += costs.ingredient_cost;
    return { ...ing, ...costs };
  });
  return { items, batch_cost: round2(batchCost) };
}

/**
 * Returns { number_of_portions }
 */
function calculatePortions(total_yield_grams, portion_size_grams) {
  const portions =
    (Number(total_yield_grams) || 0) / (Number(portion_size_grams) || 1);
  return { number_of_portions: round2(portions) };
}

/**
 * Returns { cost_per_portion, suggested_price }
 */
function calculatePricing(batch_cost, number_of_portions, target_food_cost_percent, packaging_cost_per_portion = 0) {
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

/**
 * Returns profitability summary
 */
function evaluateProfitability({
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
    food_cost_per_portion: round2(food_cost_per_portion),
    packaging_cost_per_portion: round2(packaging_cost_per_portion),
    cost_per_portion: round2(cost_per_portion),
    suggested_price: round2(suggested_price),
    current_price: round2(currentPrice),
    profit_per_portion: round2(profitPerPortion),
    actual_food_cost_percent: round2(afcp),
    order_type: String(order_type || "DINE_IN").toUpperCase(),
    status,
    comment,
  };
}

/**
 * Convenience wrapper for a whole menu item.
 * menuItem: {
 *   ingredients: [...],
 *   total_yield_grams,
 *   portion_size_grams,
 *   target_food_cost_percent,
 *   current_selling_price
 * }
 */
function computeMenuItemCosting(menuItem = {}) {
  const { items, batch_cost } = calculateBatchCost(menuItem.ingredients || []);
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
  return { ...profitability, items, number_of_portions };
}

module.exports = {
  calculateIngredientCost,
  calculateBatchCost,
  calculatePortions,
  calculatePricing,
  evaluateProfitability,
  computeMenuItemCosting,
};
