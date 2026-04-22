import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";
import { normalizeInventoryCategory } from "../utils/inventoryCategories";

const LOW_STOCK_THRESHOLD = 5;
const DASHBOARD_LIST_LIMIT = 5;

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
  const toneLabel = tone === "danger" ? "Urgent" : tone === "warning" ? "Review" : tone === "success" ? "Good" : "Info";
  const content = (
    <>
      <div className="dashboardMetricHead">
        <div className="dashboardMetricLabel">{label}</div>
        <span className={`dashboardMetricTone dashboardMetricTone-${tone}`}>{toneLabel}</span>
      </div>
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

function ActionTile({ label, detail, count, tone = "neutral", onClick }) {
  return (
    <button type="button" className={`actionTile actionTile-${tone}`} onClick={onClick}>
      <span className="actionTileCount">{count}</span>
      <span className="actionTileBody">
        <span className="actionTileLabel">{label}</span>
        <span className="actionTileDetail">{detail}</span>
      </span>
    </button>
  );
}

function OverviewStat({ label, value, hint }) {
  return (
    <div className="overviewStat">
      <div className="overviewStatLabel">{label}</div>
      <div className="overviewStatValue">{value}</div>
      {hint ? <div className="overviewStatHint">{hint}</div> : null}
    </div>
  );
}

function OverviewBar({ label, value, displayValue, max, tone = "neutral" }) {
  const width = max > 0 ? Math.max((Number(value || 0) / max) * 100, Number(value || 0) > 0 ? 4 : 0) : 0;
  return (
    <div className="overviewBarRow">
      <div className="overviewBarMeta">
        <span>{label}</span>
        <span className="mono">{displayValue}</span>
      </div>
      <div className="overviewBarTrack">
        <div className={`overviewBarFill overviewBarFill-${tone}`} style={{ width: `${width}%` }} />
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
        .filter((item) => item.status !== "INACTIVE" && Number(item.total_stock || 0) > 0 && Number(item.total_stock || 0) <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => Number(a.total_stock || 0) - Number(b.total_stock || 0)),
    [dashboard.inventory]
  );
  const inventoryAlerts = useMemo(
    () =>
      dashboard.inventory
        .filter((item) => item.status !== "INACTIVE" && Number(item.total_stock || 0) <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => Number(a.total_stock || 0) - Number(b.total_stock || 0))
        .slice(0, DASHBOARD_LIST_LIMIT),
    [dashboard.inventory]
  );
  const outOfStockCount = useMemo(
    () => dashboard.inventory.filter((item) => item.status !== "INACTIVE" && Number(item.total_stock || 0) <= 0).length,
    [dashboard.inventory]
  );
  const menuWithoutRecipe = useMemo(
    () => dashboard.menu.filter((item) => !item.recipe_version_id || !item.has_recipe_lines).slice(0, DASHBOARD_LIST_LIMIT),
    [dashboard.menu]
  );
  const weeklyPurchasingTotal = useMemo(
    () => Number(dashboard.purchaseWeeklyTotal || 0) + Number(dashboard.purchaseOrderWeeklyTotal || 0),
    [dashboard.purchaseOrderWeeklyTotal, dashboard.purchaseWeeklyTotal]
  );
  const weeklyBuyRecommendations = useMemo(
    () => (dashboard.weeklyInventoryReview?.recommendations || []).filter((item) => item.needs_attention).slice(0, DASHBOARD_LIST_LIMIT),
    [dashboard.weeklyInventoryReview]
  );
  const actionItems = useMemo(
    () => [
      {
        label: "Restock urgent items",
        detail: `${formatNumber(outOfStockCount, 0)} out, ${formatNumber(lowStockInventory.length, 0)} low`,
        count: formatNumber(inventoryAlerts.length, 0),
        tone: inventoryAlerts.length > 0 ? "danger" : "success",
        onClick: () => navigate("/admin/inventory/summary"),
      },
      {
        label: "Approve purchase requests",
        detail: "Requests waiting for owner review",
        count: formatNumber(dashboard.reportSummary.pending_purchase_count, 0),
        tone: dashboard.reportSummary.pending_purchase_count > 0 ? "warning" : "success",
        onClick: () => navigate("/admin/purchase-requests"),
      },
      {
        label: "Fix menu costing",
        detail: "Loss or low-profit items",
        count: formatNumber(dashboard.reportSummary.costing_alert_count, 0),
        tone: dashboard.reportSummary.costing_alert_count > 0 ? "warning" : "success",
        onClick: () => navigate("/admin/reports"),
      },
      {
        label: "Finish recipe setup",
        detail: "Menu items missing usable recipes",
        count: formatNumber(menuWithoutRecipe.length, 0),
        tone: menuWithoutRecipe.length > 0 ? "warning" : "success",
        onClick: () => navigate("/admin/menu/manage"),
      },
    ],
    [
      dashboard.reportSummary.costing_alert_count,
      dashboard.reportSummary.pending_purchase_count,
      inventoryAlerts.length,
      lowStockInventory.length,
      menuWithoutRecipe.length,
      navigate,
      outOfStockCount,
    ]
  );
  const overviewMetrics = useMemo(
    () => [
      {
        label: "Monthly net sales",
        value: Number(dashboard.reportSummary.monthly_sales || 0),
        displayValue: formatMoney(dashboard.reportSummary.monthly_sales || 0),
        tone: "sales",
      },
      {
        label: "Inventory value",
        value: Number(dashboard.reportSummary.total_inventory_value || 0),
        displayValue: formatMoney(dashboard.reportSummary.total_inventory_value || 0),
        tone: "stock",
      },
      {
        label: "Weekly purchasing",
        value: Number(weeklyPurchasingTotal || 0),
        displayValue: formatMoney(weeklyPurchasingTotal),
        tone: "purchase",
      },
      {
        label: "Estimated gross profit",
        value: Number(dashboard.reportSummary.estimated_gross_profit || 0),
        displayValue: formatMoney(dashboard.reportSummary.estimated_gross_profit || 0),
        tone: "profit",
      },
    ],
    [
      dashboard.reportSummary.estimated_gross_profit,
      dashboard.reportSummary.monthly_sales,
      dashboard.reportSummary.total_inventory_value,
      weeklyPurchasingTotal,
    ]
  );
  const overviewMetricMax = useMemo(
    () => Math.max(...overviewMetrics.map((metric) => Math.abs(Number(metric.value || 0))), 1),
    [overviewMetrics]
  );
  const attentionCount =
    inventoryAlerts.length +
    Number(dashboard.reportSummary.pending_purchase_count || 0) +
    Number(dashboard.reportSummary.costing_alert_count || 0) +
    menuWithoutRecipe.length;
  const leftColumnCards = [
    {
      key: "weekly-buying",
      title: "Weekly Buying Plan",
      emptyText: "No urgent weekly buys suggested.",
      actionLabel: "Open Stock Summary",
      onAction: () => navigate("/admin/inventory/summary"),
      items: weeklyBuyRecommendations,
      renderItem: (item) => (
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
      ),
    },
    {
      key: "inventory-alerts",
      title: "Inventory Alerts",
      emptyText: "Stock levels look healthy right now.",
      actionLabel: "Open Stock",
      onAction: () => navigate("/admin/inventory/summary"),
      items: inventoryAlerts,
      renderItem: (item) => (
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
      ),
    },
    {
      key: "recipe-watchlist",
      title: "Recipe Setup Watchlist",
      emptyText: "Every menu item already has a recipe linked.",
      actionLabel: "Open Menu",
      onAction: () => navigate("/admin/menu/manage"),
      items: menuWithoutRecipe,
      renderItem: (item) => (
        <div key={item.id} className="dashboardListRow">
          <div className="dashboardListMeta">
            <div className="dashboardListName">{item.menu_name}</div>
            <div className="dashboardListHint">
              {!item.recipe_version_id ? "No recipe linked yet" : "Recipe linked but still missing ingredient lines"}
            </div>
          </div>
          <span className="badge badge-inactive">Needs setup</span>
        </div>
      ),
    },
  ];
  const rightColumnCards = [
    {
      key: "profitable-items",
      title: "Most Profitable Items",
      emptyText: "No profitability data yet.",
      actionLabel: "Open Reports",
      onAction: () => navigate("/admin/reports"),
      items: (dashboard.mostProfitableItems || []).slice(0, DASHBOARD_LIST_LIMIT),
      renderItem: (item) => (
        <div key={item.id} className="dashboardListRow">
          <div className="dashboardListMeta">
            <div className="dashboardListName">{item.menu_name}</div>
            <div className="dashboardListHint">Healthy margin item</div>
          </div>
          <div className="mono dashboardListValue">{formatMoney(item.profit_per_portion || 0)}</div>
        </div>
      ),
    },
    {
      key: "costing-alerts",
      title: "Costing Alerts",
      emptyText: "No menu items are currently flagged as loss or low profit.",
      actionLabel: "Open Reports",
      onAction: () => navigate("/admin/reports"),
      items: (dashboard.costingAlerts || []).slice(0, DASHBOARD_LIST_LIMIT),
      renderItem: (item) => (
        <div key={item.id} className="dashboardListRow">
          <div className="dashboardListMeta">
            <div className="dashboardListName">{item.menu_name}</div>
            <div className="dashboardListHint">{item.status}</div>
          </div>
          <div className="mono dashboardListValue">
            {item.suggested_price != null ? formatMoney(item.suggested_price) : "-"}
          </div>
        </div>
      ),
    },
    {
      key: "recent-activity",
      title: "Recent Activity",
      emptyText: "No recent activity yet.",
      actionLabel: "Open Activity Log",
      onAction: () => navigate("/audit"),
      items: (dashboard.recentActivities || []).slice(0, DASHBOARD_LIST_LIMIT),
      renderItem: (item) => (
        <div key={item.id} className="dashboardListRow dashboardListRowCompact">
          <div className="dashboardListMeta">
            <div className="dashboardListName">{item.summary || `${item.module_name} ${item.action_name}`}</div>
            <div className="dashboardListHint">
              {(item.actor_name || "System")} | {formatDateTimeFriendly(item.created_at)}
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h2 className="pageTitle">Dashboard</h2>
          <div className="pageSub">A clean operating view for sales, stock, purchasing, and menu health.</div>
        </div>
        <div className="pageActions">
          <button className="btn btn-ghost" onClick={load}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="overviewBoard">
        <section className="overviewMainCard">
          <div className="overviewMainHead">
            <div>
              <div className="sectionEyebrow">Restaurant overview</div>
              <h3 className="overviewMainTitle">Today&apos;s operating picture</h3>
            </div>
            <div className={`overviewHealthPill ${attentionCount > 0 ? "needsAttention" : "healthy"}`}>
              {attentionCount > 0 ? `${formatNumber(attentionCount, 0)} needs attention` : "All clear"}
            </div>
          </div>

          <div className="overviewStatGrid">
            <OverviewStat
              label="Today&apos;s sales"
              value={formatMoney(dashboard.salesSummary.todayRevenue || 0)}
              hint={`${formatNumber(dashboard.salesSummary.totalTransactions || 0, 0)} completed sale(s) overall`}
            />
            <OverviewStat
              label="Monthly net sales"
              value={formatMoney(dashboard.reportSummary.monthly_sales || 0)}
              hint={`${formatNumber(dashboard.reportSummary.estimated_food_cost_percent || 0)}% estimated ingredient cost`}
            />
            <OverviewStat
              label="Inventory value"
              value={formatMoney(dashboard.reportSummary.total_inventory_value || 0)}
              hint={`${formatNumber(outOfStockCount, 0)} out, ${formatNumber(lowStockInventory.length, 0)} low`}
            />
          </div>

          <div className="overviewBars">
            {overviewMetrics.map((metric) => (
              <OverviewBar key={metric.label} max={overviewMetricMax} {...metric} />
            ))}
          </div>
        </section>

        <aside className="overviewActionCard">
          <div className="overviewActionHead">
            <div>
              <div className="sectionEyebrow">Next actions</div>
              <div className="overviewActionTitle">Start here</div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin/reports")}>Reports</button>
          </div>
          <div className="overviewActionList">
            {actionItems.map((item) => (
              <ActionTile key={item.label} {...item} />
            ))}
          </div>
        </aside>
      </div>

      <div className="dashboardQuickStats">
        <MetricCard
          label="Weekly purchasing"
          value={formatMoney(weeklyPurchasingTotal)}
          hint="Quick purchases plus purchase receipts."
          onClick={() => navigate("/admin/purchases")}
        />
        <MetricCard
          label="Pending requests"
          value={formatNumber(dashboard.reportSummary.pending_purchase_count, 0)}
          hint="Waiting for owner review."
          tone={dashboard.reportSummary.pending_purchase_count > 0 ? "warning" : "success"}
          onClick={() => navigate("/admin/purchase-requests")}
        />
        <MetricCard
          label="Active promos"
          value={formatNumber(dashboard.reportSummary.active_promo_count, 0)}
          hint="Currently active menu promos."
          onClick={() => navigate("/admin/menu/manage")}
        />
        <MetricCard
          label="Recipe setup"
          value={formatNumber(menuWithoutRecipe.length, 0)}
          hint="Menu items missing usable recipes."
          tone={menuWithoutRecipe.length > 0 ? "warning" : "success"}
          onClick={() => navigate("/admin/menu/manage")}
        />
      </div>

      <div className="dashboardColumns">
        <div className="dashboardColumn">
          {leftColumnCards.map((card) => (
            <DashboardList key={card.key} {...card} />
          ))}
        </div>
        <div className="dashboardColumn">
          {rightColumnCards.map((card) => (
            <DashboardList key={card.key} {...card} />
          ))}
        </div>
      </div>
    </div>
  );
}
