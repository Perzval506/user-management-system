const OWNER_QUICK_ACTION_PREF_KEY = "ums.quickActions.owner.v1";
const QUICK_ACTION_UPDATE_EVENT = "ums:quick-actions-updated";

export const OWNER_QUICK_ACTIONS = [
  { id: "dashboard", to: "/admin", label: "Dashboard", iconKey: "dashboard", description: "Jump to main overview." },
  { id: "staff", to: "/staff", label: "My Staff", iconKey: "users", description: "Manage user accounts and profiles." },
  { id: "ingredientAdd", to: "/admin/items/add", label: "Add Ingredient", iconKey: "box", description: "Create a new ingredient item." },
  { id: "menuAdd", to: "/admin/menu/add", label: "Add Menu Item", iconKey: "menu", description: "Create a new menu entry." },
  { id: "quickPurchase", to: "/admin/purchases", label: "Quick Purchase", iconKey: "box", description: "Record single purchase entries." },
  { id: "purchaseRequest", to: "/admin/purchase-requests", label: "Purchase Requests", iconKey: "box", description: "Review stockroom requests before purchasing." },
  { id: "purchaseOrder", to: "/admin/purchase-orders", label: "Purchase Order", iconKey: "box", description: "Open purchase order records." },
  { id: "inventory", to: "/admin/inventory/summary", label: "Inventory", iconKey: "box", description: "View inventory summary." },
  { id: "cateringOrders", to: "/admin/catering-orders", label: "Catering", iconKey: "menu", description: "Build custom event packages and deposits." },
  { id: "settings", to: "/settings", label: "Settings", iconKey: "settings", description: "Open system preferences." },
];

function ownerDefaultIds() {
  return OWNER_QUICK_ACTIONS.map((x) => x.id);
}

function normalizeOwnerSelection(ids) {
  const incoming = Array.isArray(ids) ? ids : [];
  const set = new Set(incoming.map((v) => String(v)));
  return ownerDefaultIds().filter((id) => set.has(id));
}

export function getQuickActions(role) {
  if (role === "OWNER") return OWNER_QUICK_ACTIONS;
  if (role === "CASHIER") {
    return [
      { id: "staffProfile", to: "/staff", label: "My Profile", iconKey: "users", description: "Open your profile." },
      { id: "staffSales", to: "/staff/sales", label: "Sales", iconKey: "sales", description: "Record and review guest checks." },
    ];
  }
  if (role === "STOCKROOM_STAFF") {
    return [
      { id: "staffProfile", to: "/staff", label: "My Profile", iconKey: "users", description: "Open your profile." },
      { id: "staffIngredients", to: "/staff/ingredients", label: "Ingredients", iconKey: "box", description: "Review and update ingredient records." },
      { id: "staffInventory", to: "/staff/inventory-summary", label: "Stock Summary", iconKey: "box", description: "Check on-hand stock levels." },
      { id: "staffPurchaseRequests", to: "/staff/purchase-requests", label: "Purchase Requests", iconKey: "purchasing", description: "Submit ingredients that need to be bought." },
    ];
  }
  return [{ id: "staffProfile", to: "/staff", label: "My Profile", iconKey: "users", description: "Open your profile." }];
}

export function getDefaultQuickActionIds(role) {
  return getQuickActions(role).map((x) => x.id);
}

export function getQuickActionSelection(role) {
  const defaults = getDefaultQuickActionIds(role);
  if (role !== "OWNER") return defaults;

  try {
    const raw = localStorage.getItem(OWNER_QUICK_ACTION_PREF_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const normalized = normalizeOwnerSelection(parsed);
    if (parsed.length > 0 && normalized.length === 0) return defaults;
    return normalized;
  } catch {
    return defaults;
  }
}

export function setQuickActionSelection(role, ids) {
  const defaults = getDefaultQuickActionIds(role);
  if (role !== "OWNER") return defaults;

  const finalIds = normalizeOwnerSelection(ids);

  try {
    localStorage.setItem(OWNER_QUICK_ACTION_PREF_KEY, JSON.stringify(finalIds));
    window.dispatchEvent(new CustomEvent(QUICK_ACTION_UPDATE_EVENT, { detail: { role, ids: finalIds } }));
  } catch {
    // ignore storage/event errors
  }

  return finalIds;
}

export function resetQuickActionSelection(role) {
  const defaults = getDefaultQuickActionIds(role);
  if (role !== "OWNER") return defaults;

  try {
    localStorage.removeItem(OWNER_QUICK_ACTION_PREF_KEY);
    window.dispatchEvent(new CustomEvent(QUICK_ACTION_UPDATE_EVENT, { detail: { role, ids: defaults } }));
  } catch {
    // ignore storage/event errors
  }

  return defaults;
}

export const quickActionEvents = {
  updated: QUICK_ACTION_UPDATE_EVENT,
};
