import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useToast } from "../components/Toast";
import { formatDateLong, formatDateTimeFriendly, formatMoney, formatNumber } from "../utils/formatters";

const LOW_STOCK_THRESHOLD = 5;

function DashboardList({ title, emptyText, items, renderItem, actionLabel, onAction }) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        {actionLabel && (
          <button type="button" className="btn btn-ghost" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {items.length > 0 ? (
          items.map(renderItem)
        ) : (
          <div style={{ color: "#6B7280", padding: 4 }}>{emptyText}</div>
        )}
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState({
    users: [],
    ingredients: [],
    inventory: [],
    menu: [],
    purchases: [],
    purchaseOrders: [],
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
      ] = await Promise.all([
        api.get("/users"),
        api.get("/ingredients"),
        api.get("/inventory/summary"),
        api.get("/menu"),
        api.get("/purchases"),
        api.get("/purchase-orders"),
      ]);

      setDashboard({
        users: usersResponse.data || [],
        ingredients: ingredientsResponse.data || [],
        inventory: inventoryResponse.data || [],
        menu: menuResponse.data || [],
        purchases: purchasesResponse.data?.items || [],
        purchaseOrders: purchaseOrdersResponse.data || [],
      });
    } catch (error) {
      toast.push({
        type: "error",
        title: "Dashboard load failed",
        message: error?.response?.data?.message || error.message || "Unable to load dashboard data.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

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
    () => dashboard.menu.filter((item) => !item.recipe_version_id).slice(0, 5),
    [dashboard.menu]
  );
  const totalQuickPurchases = useMemo(
    () => dashboard.purchases.reduce((sum, item) => sum + Number(item.price || 0), 0),
    [dashboard.purchases]
  );
  const totalPurchaseOrders = useMemo(
    () => dashboard.purchaseOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    [dashboard.purchaseOrders]
  );
  const recentPurchases = useMemo(() => dashboard.purchases.slice(0, 5), [dashboard.purchases]);
  const recentPurchaseOrders = useMemo(() => dashboard.purchaseOrders.slice(0, 5), [dashboard.purchaseOrders]);

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

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          marginBottom: 14,
        }}
      >
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Active staff</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{activeStaffCount}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Inactive staff</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{inactiveStaffCount}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Low stock items</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{lowStockInventory.length}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Out of stock</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{outOfStockCount}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Menu items without recipe</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{menuWithoutRecipe.length}</div>
        </div>
        <div className="card">
          <div style={{ color: "#6B7280", marginBottom: 4 }}>Recent purchasing total</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{formatMoney(totalQuickPurchases + totalPurchaseOrders)}</div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        }}
      >
        <DashboardList
          title="Inventory Alerts"
          emptyText="Stock levels look healthy right now."
          actionLabel="Open Inventory"
          onAction={() => navigate("/admin/inventory/summary")}
          items={inventoryAlerts}
          renderItem={(item) => (
            <div key={item.id} style={listRow}>
              <div>
                <div style={{ fontWeight: 800 }}>{item.ingredient_name}</div>
                <div style={{ color: "#6B7280", fontSize: 13 }}>
                  {item.base_unit || "-"} | {Number(item.total_stock || 0) <= 0 ? "Restock now" : `Low stock (${LOW_STOCK_THRESHOLD} or below)`}
                </div>
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <span className={Number(item.total_stock || 0) <= 0 ? "badge badge-inactive" : "badge badge-pending"}>
                  {Number(item.total_stock || 0) <= 0 ? "Out" : "Low"}
                </span>
                <div className="mono" style={{ fontWeight: 800 }}>
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
            <div key={item.id} style={listRow}>
              <div>
                <div style={{ fontWeight: 800 }}>{item.menu_name}</div>
                <div style={{ color: "#6B7280", fontSize: 13 }}>No recipe linked yet</div>
              </div>
              <span className="badge badge-inactive">Needs setup</span>
            </div>
          )}
        />

        <DashboardList
          title="Recent Purchases"
          emptyText="No quick purchases recorded yet."
          actionLabel="Open Purchases"
          onAction={() => navigate("/admin/purchases")}
          items={recentPurchases}
          renderItem={(item) => (
            <div key={item.id} style={listRow}>
              <div>
                <div style={{ fontWeight: 800 }}>{item.ingredient_name}</div>
                <div style={{ color: "#6B7280", fontSize: 13 }}>{formatDateTimeFriendly(item.createdAt)}</div>
              </div>
              <div className="mono" style={{ fontWeight: 800 }}>
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
            <div key={order.id} style={listRow}>
              <div>
                <div style={{ fontWeight: 800 }}>{order.store_name}</div>
                <div style={{ color: "#6B7280", fontSize: 13 }}>
                  {formatDateLong(order.purchase_date)} | {order.item_count || 0} items
                </div>
              </div>
              <div className="mono" style={{ fontWeight: 800 }}>
                {formatMoney(order.total_amount)}
              </div>
            </div>
          )}
        />
      </div>
    </div>
  );
}

const listRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: 12,
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
};
