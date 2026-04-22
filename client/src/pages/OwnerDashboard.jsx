import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";
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

function MetricCard({ label, value, hint, tone = "neutral", onClick }) {
  const className = `card dashboardMetricCard dashboardMetricCard-${tone} ${onClick ? "dashboardMetricClickable" : ""}`;
  const content = (
    <>
      <div className="dashboardMetricLabel">{label}</div>
      <div className="dashboardMetricValue">{value}</div>
      {hint ? <div className="dashboardMetricHint">{hint}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
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
    reportSummary: {
      total_inventory_value: 0,
      monthly_sales: 0,
      monthly_gross_sales: 0,
      monthly_discount_amount: 0,
      estimated_food_cost_percent: 0,
      estimated_gross_profit: 0,
      break_even_item_count: 0,
      suggested_price_variance: 0,
      low_stock_count: 0,
      costing_alert_count: 0,
      pending_purchase_count: 0,
      active_promo_count: 0,
    },
    recentActivities: [],
    mostProfitableItems: [],
    costingAlerts: [],
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
        reportsDashboardResponse,
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
        api.get("/reports/dashboard"),
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
        reportSummary: reportsDashboardResponse.data?.summary || {
          total_inventory_value: 0,
          monthly_sales: 0,
          monthly_gross_sales: 0,
          monthly_discount_amount: 0,
          estimated_food_cost_percent: 0,
          estimated_gross_profit: 0,
          break_even_item_count: 0,
          suggested_price_variance: 0,
          low_stock_count: 0,
          costing_alert_count: 0,
          pending_purchase_count: 0,
          active_promo_count: 0,
        },
        recentActivities: reportsDashboardResponse.data?.recentActivities || [],
        mostProfitableItems: reportsDashboardResponse.data?.mostProfitableItems || [],
        costingAlerts: reportsDashboardResponse.data?.costingAlerts || [],
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
  const weeklyBuyRecommendations = useMemo(
    () => (dashboard.weeklyInventoryReview?.recommendations || []).filter((item) => item.needs_attention).slice(0, 6),
    [dashboard.weeklyInventoryReview]
  );

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Dashboard</h2>
          <div className="pageSub">Today&apos;s operating snapshot for stock, costing, purchasing, and sales.</div>
        </div>
        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="dashboardHero">
        <div>
          <div className="dashboardHeroEyebrow">Owner Command Center</div>
          <h3 className="dashboardHeroTitle">Focus on what needs action first.</h3>
          <p className="dashboardHeroText">
            The dashboard highlights urgent stock, purchase, costing, and sales signals. Detailed records stay in their own modules.
          </p>
        </div>
        <div className="dashboardHeroActions">
          <button type="button" className="btn btn-primary" onClick={() => navigate("/admin/purchase-requests")}>Review Requests</button>
          <button type="button" className="btn" onClick={() => navigate("/admin/reports")}>Open Reports</button>
        </div>
      </div>

      <div className="dashboardStatGrid dashboardStatGridOwnerPrimary">
        <MetricCard
          label="Today&apos;s sales"
          value={formatMoney(dashboard.salesSummary.todayRevenue || 0)}
          hint="Open Sales for full gross/net breakdown."
          tone="success"
          onClick={() => navigate("/admin/sales")}
        />
        <MetricCard
          label="Stock alerts"
          value={formatNumber(inventoryAlerts.length, 0)}
          hint={`${formatNumber(outOfStockCount, 0)} out of stock, ${formatNumber(lowStockInventory.length, 0)} low.`}
          tone={inventoryAlerts.length > 0 ? "danger" : "success"}
          onClick={() => navigate("/admin/inventory/summary")}
        />
        <MetricCard
          label="Pending requests"
          value={formatNumber(dashboard.reportSummary.pending_purchase_count, 0)}
          hint="Stockroom requests waiting for owner review."
          tone={dashboard.reportSummary.pending_purchase_count > 0 ? "warning" : "neutral"}
          onClick={() => navigate("/admin/purchase-requests")}
        />
        <MetricCard
          label="Costing alerts"
          value={formatNumber(dashboard.reportSummary.costing_alert_count, 0)}
          hint="Loss or low-profit menu items."
          tone={dashboard.reportSummary.costing_alert_count > 0 ? "warning" : "success"}
          onClick={() => navigate("/admin/reports")}
        />
      </div>

      <div className="dashboardStatGrid dashboardStatGridOwnerSecondary">
        <MetricCard
          label="Inventory value"
          value={formatMoney(dashboard.reportSummary.total_inventory_value)}
          hint="Current value of tracked stock."
          onClick={() => navigate("/admin/reports")}
        />
        <MetricCard
          label="Weekly purchasing"
          value={formatMoney(weeklyPurchasingTotal)}
          hint="Quick purchases plus purchase records."
          onClick={() => navigate("/admin/purchases")}
        />
        <MetricCard
          label="Active promos"
          value={formatNumber(dashboard.reportSummary.active_promo_count, 0)}
          hint="Internal menu promotions currently active."
          onClick={() => navigate("/admin/menu/manage")}
        />
        <MetricCard
          label="Recipe setup"
          value={formatNumber(menuWithoutRecipe.length, 0)}
          hint="Menu items still missing usable recipes."
          tone={menuWithoutRecipe.length > 0 ? "warning" : "success"}
          onClick={() => navigate("/admin/menu/manage")}
        />
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
          title="Most Profitable Items"
          emptyText="Profitability data will appear once recipes and prices are complete."
          actionLabel="Open Reports"
          onAction={() => navigate("/admin/reports")}
          items={dashboard.mostProfitableItems}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.menu_name}</div>
                <div className="dashboardListHint">Healthy margin item</div>
              </div>
              <div className="mono dashboardListValue">{formatMoney(item.profit_per_portion || 0)}</div>
            </div>
          )}
        />

        <DashboardList
          title="Costing Alerts"
          emptyText="No menu items are currently flagged as loss or low profit."
          actionLabel="Open Reports"
          onAction={() => navigate("/admin/reports")}
          items={dashboard.costingAlerts}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.menu_name}</div>
                <div className="dashboardListHint">{item.status}</div>
              </div>
              <div className="mono dashboardListValue">
                {item.suggested_price != null ? formatMoney(item.suggested_price) : "-"}
              </div>
            </div>
          )}
        />

        <DashboardList
          title="Recent Activities"
          emptyText="Recent activity will appear here once actions are logged."
          actionLabel="Open Audit Logs"
          onAction={() => navigate("/audit")}
          items={dashboard.recentActivities}
          renderItem={(item) => (
            <div key={item.id} className="dashboardListRow">
              <div className="dashboardListMeta">
                <div className="dashboardListName">{item.summary || `${item.module_name} ${item.action_name}`}</div>
                <div className="dashboardListHint">
                  {(item.actor_name || "System")} | {formatDateTimeFriendly(item.created_at)}
                </div>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
