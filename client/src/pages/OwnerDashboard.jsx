import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";
import { normalizeInventoryCategory } from "../utils/inventoryCategories";

const LOW_STOCK_THRESHOLD = 5;

function DashboardList({ title, emptyText, items, renderItem, actionLabel, onAction }) {
  return (
    <div className="card dashboardListCard">
      <div className="dashboardListHead">
        <div className="dashboardListTitle">{title}</div>
        {actionLabel && (
          <button type="button" className="btn btn-ghost" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>

      <div className="dashboardListGrid">
        {items.length > 0 ? (
          items.map(renderItem)
        ) : (
          <div className="dashboardListEmpty">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState({
    users: [],
    ingredients: [],
    inventory: [],
    menu: [],
    purchases: [],
    purchaseOrders: [],
    weeklyInventoryReview: { recommendations: [], categories: [] },
    salesSummary: { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0 },
    purchaseWeeklyTotal: 0,
    purchaseOrderWeeklyTotal: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        usersResponse,
        ingredientsResponse,
        inventoryResponse,
        menuResponse,
        purchasesResponse,
        purchaseOrdersResponse,
        salesResponse,
        purchaseOrderWeeklyResponse,
        weeklyInventoryResponse,
      ] = await Promise.all([
        api.get("/users"),
        api.get("/ingredients"),
        api.get("/inventory/summary"),
        api.get("/menu"),
        api.get("/purchases"),
        api.get("/purchase-orders"),
        api.get("/sales"),
        api.get("/purchase-orders/summary/weekly"),
        api.get("/inventory/weekly-review"),
      ]);

      const menuItems = menuResponse.data || [];
      const recipeChecks = await Promise.all(
        menuItems.map(async (item) => {
          if (!item.recipe_version_id) {
            return { menuId: item.id, hasRecipeLines: false };
          }
          try {
            const recipeRes = await api.get(`/menu/${item.id}/recipe`);
            const hasRecipeLines = Array.isArray(recipeRes.data?.ingredients) && recipeRes.data.ingredients.length > 0;
            return { menuId: item.id, hasRecipeLines };
          } catch {
            return { menuId: item.id, hasRecipeLines: false };
          }
        })
      );
      const recipeCheckMap = recipeChecks.reduce((acc, row) => {
        acc[row.menuId] = row.hasRecipeLines;
        return acc;
      }, {});

      setDashboard({
        users: usersResponse.data || [],
        ingredients: ingredientsResponse.data || [],
        inventory: inventoryResponse.data || [],
        menu: menuItems.map((item) => ({
          ...item,
          has_recipe_lines: Boolean(recipeCheckMap[item.id]),
        })),
        purchases: purchasesResponse.data?.items || [],
        purchaseOrders: purchaseOrdersResponse.data || [],
        weeklyInventoryReview: weeklyInventoryResponse.data || { recommendations: [], categories: [] },
        salesSummary: salesResponse.data?.summary || { totalRevenue: 0, totalTransactions: 0, todayRevenue: 0 },
        purchaseWeeklyTotal: Number(purchasesResponse.data?.weeklyTotal || 0),
        purchaseOrderWeeklyTotal: Number(purchaseOrderWeeklyResponse.data?.weeklyTotal || 0),
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "Dashboard load failed",
        message: error?.response?.data?.message || error.message || "Unable to load dashboard data.",
      });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  const activeStaffCount = useMemo(
    () => dashboard.users.filter((user) => user.role !== "OWNER" && user.status !== "INACTIVE").length,
    [dashboard.users]
  );
  const inactiveStaffCount = useMemo(
    () => dashboard.users.filter((user) => user.role !== "OWNER" && user.status === "INACTIVE").length,
    [dashboard.users]
  );
  const lowStockInventory = useMemo(
    () =>
      dashboard.inventory
        .filter((item) => Number(item.total_stock || 0) > 0 && Number(item.total_stock || 0) <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => Number(a.total_stock || 0) - Number(b.total_stock || 0)),
    [dashboard.inventory]
  );
  const inventoryAlerts = useMemo(
    () =>
      dashboard.inventory
        .filter((item) => Number(item.total_stock || 0) <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => Number(a.total_stock || 0) - Number(b.total_stock || 0))
        .slice(0, 8),
    [dashboard.inventory]
  );
  const outOfStockCount = useMemo(
    () => dashboard.inventory.filter((item) => Number(item.total_stock || 0) <= 0).length,
    [dashboard.inventory]
  );
  const menuWithoutRecipe = useMemo(
    () => dashboard.menu.filter((item) => !item.recipe_version_id || !item.has_recipe_lines).slice(0, 5),
    [dashboard.menu]
  );
  const weeklyPurchasingTotal = useMemo(
    () => Number(dashboard.purchaseWeeklyTotal || 0) + Number(dashboard.purchaseOrderWeeklyTotal || 0),
    [dashboard.purchaseOrderWeeklyTotal, dashboard.purchaseWeeklyTotal]
  );
  const recentPurchases = useMemo(() => dashboard.purchases.slice(0, 5), [dashboard.purchases]);
  const recentPurchaseOrders = useMemo(() => dashboard.purchaseOrders.slice(0, 5), [dashboard.purchaseOrders]);
  const weeklyBuyRecommendations = useMemo(
    () => (dashboard.weeklyInventoryReview?.recommendations || []).filter((item) => item.needs_attention).slice(0, 6),
    [dashboard.weeklyInventoryReview]
  );

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Dashboard</h2>
          <div className="pageSub">See stock risks, staff status, and recent purchasing activity at a glance.</div>
        </div>
        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="dashboardStatGrid dashboardStatGridOwnerPrimary">
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Active staff</div>
          <div className="dashboardMetricValue">{activeStaffCount}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Inactive staff</div>
          <div className="dashboardMetricValue">{inactiveStaffCount}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Low stock items</div>
          <div className="dashboardMetricValue">{lowStockInventory.length}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Out of stock</div>
          <div className="dashboardMetricValue">{outOfStockCount}</div>
        </div>
      </div>

      <div className="dashboardStatGrid dashboardStatGridOwnerSecondary">
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Menu items without recipe</div>
          <div className="dashboardMetricValue">{menuWithoutRecipe.length}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Weekly purchasing total</div>
          <div className="dashboardMetricValue">{formatMoney(weeklyPurchasingTotal)}</div>
        </div>
        <div className="card dashboardMetricCard">
          <div className="dashboardMetricLabel">Total revenue</div>
          <div className="dashboardMetricValue">{formatMoney(dashboard.salesSummary.totalRevenue)}</div>
        </div>
      </div>

      <div className="dashboardInsightsGrid dashboardInsightsTop">
        <DashboardList
          title="Weekly Buying Plan"
          emptyText="No urgent weekly buys suggested."
          actionLabel="Open Stock Summary"
          onAction={() => navigate("/admin/inventory/summary")}
          items={weeklyBuyRecommendations}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.ingredient_name}</div>
                <div className="dashboardListHint">
                  {normalizeInventoryCategory(item.category)} | Used {formatNumber(item.weekly_used)} {item.base_unit}
                </div>
              </div>
              <div className="dashboardListAside">
                <span className="badge badge-pending">Buy next</span>
                <div className="mono dashboardListValue">
                  {formatNumber(item.recommended_buy_qty)} {item.base_unit}
                </div>
              </div>
            </div>
          )}
        />

        <DashboardList
          title="Inventory Alerts"
          emptyText="Stock levels look healthy right now."
          actionLabel="Open Inventory"
          onAction={() => navigate("/admin/inventory/summary")}
          items={inventoryAlerts}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.ingredient_name}</div>
                <div className="dashboardListHint">
                  {item.base_unit || "-"} | {Number(item.total_stock || 0) <= 0 ? "Restock now" : `Low stock (${LOW_STOCK_THRESHOLD} or below)`}
                </div>
              </div>
              <div className="dashboardListAside">
                <span className={Number(item.total_stock || 0) <= 0 ? "badge badge-inactive" : "badge badge-pending"}>
                  {Number(item.total_stock || 0) <= 0 ? "Out" : "Low"}
                </span>
                <div className="mono dashboardListValue">
                  {formatNumber(item.total_stock)}
                </div>
              </div>
            </div>
          )}
        />

        <DashboardList
          title="Recipe Setup Watchlist"
          emptyText="Every menu item already has a recipe linked."
          actionLabel="Open Menu"
          onAction={() => navigate("/admin/menu/manage")}
          items={menuWithoutRecipe}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.menu_name}</div>
                <div className="dashboardListHint">
                  {!item.recipe_version_id ? "No recipe linked yet" : "Recipe linked but still missing ingredient lines"}
                </div>
              </div>
              <span className="badge badge-inactive">Needs setup</span>
            </div>
          )}
        />
      </div>

      <div className="dashboardInsightsGrid dashboardInsightsBottom">
        <DashboardList
          title="Recent Purchases"
          emptyText="No quick purchases recorded yet."
          actionLabel="Open Purchases"
          onAction={() => navigate("/admin/purchases")}
          items={recentPurchases}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.ingredient_name}</div>
                <div className="dashboardListHint">{formatDateTimeFriendly(item.createdAt)}</div>
              </div>
              <div className="mono dashboardListValue">
                {formatMoney(item.price)}
              </div>
            </div>
          )}
        />

        <DashboardList
          title="Recent Purchase Orders"
          emptyText="No purchase orders recorded yet."
          actionLabel="Open PO Module"
          onAction={() => navigate("/admin/purchase-orders")}
          items={recentPurchaseOrders}
          renderItem={(order) => (
            <div key={order.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{order.store_name}</div>
                <div className="dashboardListHint">
                  {formatDateLong(order.purchase_date)} | {order.item_count || 0} items
                </div>
              </div>
              <div className="mono dashboardListValue">
                {formatMoney(order.total_amount)}
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
