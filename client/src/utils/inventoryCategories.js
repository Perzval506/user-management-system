export const INVENTORY_CATEGORY_ORDER = [
  "PULTEA SNACKS",
  "BEVERAGE",
  "CHEESE AND MILK",
  "SHAKE SUPPLIES",
  "OTHER STOCKS",
  "SPICES",
  "LIQUID SEAS",
  "COOKING SEASONING",
  "PASTA AND NOODLES",
  "KITCHEN SUPPLIES",
  "CHILLER / FREEZER",
  "TAKE OUT CONTAINERS",
  "PLASTIC BAGS",
  "CLEANING SUPPLIES",
  "VEGETABLES",
  "UNCATEGORIZED",
];

export function normalizeInventoryCategory(value) {
  return String(value || "UNCATEGORIZED").trim().toUpperCase() || "UNCATEGORIZED";
}

export function compareInventoryCategories(a, b) {
  const left = normalizeInventoryCategory(a);
  const right = normalizeInventoryCategory(b);
  const leftIndex = INVENTORY_CATEGORY_ORDER.indexOf(left);
  const rightIndex = INVENTORY_CATEGORY_ORDER.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }
  return left.localeCompare(right);
}
