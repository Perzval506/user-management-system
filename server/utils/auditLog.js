const pool = require("../db");
const { tableExists } = require("./dbIntrospection");

let auditTableReady = null;

async function canWriteAuditLogs() {
  if (auditTableReady !== null) return auditTableReady;
  auditTableReady = await tableExists("audit_logs");
  return auditTableReady;
}

async function writeAuditLog(entry = {}, conn = null) {
  if (!(await canWriteAuditLogs())) return;

  const target = conn || pool;
  const actorUserId = entry.actor_user_id || null;
  const actorName = entry.actor_name || null;
  const actorRole = entry.actor_role || null;
  const moduleName = entry.module_name || "SYSTEM";
  const actionName = entry.action_name || "UNKNOWN";
  const entityType = entry.entity_type || null;
  const entityId = entry.entity_id || null;
  const summary = entry.summary || null;
  const metadata = entry.metadata ? JSON.stringify(entry.metadata) : null;

  await target.query(
    `INSERT INTO audit_logs
      (actor_user_id, actor_name, actor_role, module_name, action_name, entity_type, entity_id, summary, metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [actorUserId, actorName, actorRole, moduleName, actionName, entityType, entityId, summary, metadata]
  );
}

function buildActor(req) {
  return {
    actor_user_id: req?.user?.id || null,
    actor_name: req?.user?.username || req?.user?.full_name || null,
    actor_role: req?.user?.role || null,
  };
}

module.exports = {
  writeAuditLog,
  buildActor,
};
