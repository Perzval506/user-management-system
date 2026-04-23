const express = require("express");
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { tableExists } = require("../utils/dbIntrospection");

const router = express.Router();

router.use(requireAuth, requireRole("OWNER"));

router.get("/", async (req, res) => {
  try {
    if (!(await tableExists("audit_logs"))) {
      return res.json([]);
    }

    const moduleFilter = String(req.query.module || "").trim();
    const search = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);

    const conditions = [];
    const params = [];

    if (moduleFilter) {
      conditions.push("module_name = ?");
      params.push(moduleFilter);
    }
    if (search) {
      conditions.push("(LOWER(COALESCE(summary, '')) LIKE ? OR LOWER(COALESCE(actor_name, '')) LIKE ? OR LOWER(COALESCE(action_name, '')) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT id, actor_user_id, actor_name, actor_role, module_name, action_name, entity_type, entity_id, summary, metadata_json, created_at
         FROM audit_logs
         ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [...params, limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /audit-logs failed:", err.message);
    res.status(500).json({ message: "Failed to fetch audit logs" });
  }
});

module.exports = router;
