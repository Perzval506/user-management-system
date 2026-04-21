#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
require("dotenv").config();

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;

function logStep(message) {
  console.log(`\n[setup] ${message}`);
}

function logInfo(message) {
  console.log(`[setup] ${message}`);
}

function escapeIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, "``")}\``;
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function splitSqlStatements(sqlText) {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name = ?
      LIMIT 1
    `,
    [DB_NAME, tableName]
  );
  return rows.length > 0;
}

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [DB_NAME, tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(conn, tableName, indexName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = ?
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [DB_NAME, tableName, indexName]
  );
  return rows.length > 0;
}

async function foreignKeyExists(conn, tableName, constraintName) {
  const [rows] = await conn.query(
    `
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = ?
        AND table_name = ?
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = ?
      LIMIT 1
    `,
    [DB_NAME, tableName, constraintName]
  );
  return rows.length > 0;
}

async function ensureTable(conn, tableName, createTableSql) {
  const exists = await tableExists(conn, tableName);
  if (exists) {
    logInfo(`Table ${tableName} already exists`);
    return;
  }
  await conn.query(createTableSql);
  logInfo(`Created table ${tableName}`);
}

async function ensureColumn(conn, tableName, columnName, definitionSql) {
  const exists = await columnExists(conn, tableName, columnName);
  if (exists) {
    logInfo(`Column ${tableName}.${columnName} already exists`);
    return;
  }
  await conn.query(
    `ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${escapeIdentifier(columnName)} ${definitionSql}`
  );
  logInfo(`Added column ${tableName}.${columnName}`);
}

async function ensureIndex(conn, tableName, indexName, addIndexSqlFragment) {
  const exists = await indexExists(conn, tableName, indexName);
  if (exists) {
    logInfo(`Index ${tableName}.${indexName} already exists`);
    return;
  }
  await conn.query(`ALTER TABLE ${escapeIdentifier(tableName)} ADD ${addIndexSqlFragment}`);
  logInfo(`Added index ${tableName}.${indexName}`);
}

async function ensureForeignKey(conn, tableName, constraintName, foreignKeySqlFragment) {
  const exists = await foreignKeyExists(conn, tableName, constraintName);
  if (exists) {
    logInfo(`Foreign key ${tableName}.${constraintName} already exists`);
    return;
  }
  await conn.query(`ALTER TABLE ${escapeIdentifier(tableName)} ADD CONSTRAINT ${escapeIdentifier(constraintName)} ${foreignKeySqlFragment}`);
  logInfo(`Added foreign key ${tableName}.${constraintName}`);
}

async function applySchemaFromFile(conn) {
  logStep("Creating tables from sql/schema.sql...");

  const schemaPath = path.join(__dirname, "..", "sql", "schema.sql");
  const schemaText = fs.readFileSync(schemaPath, "utf8");

  const statements = splitSqlStatements(schemaText).filter((statement) => {
    return !/^CREATE DATABASE\s+/i.test(statement) && !/^USE\s+/i.test(statement);
  });

  for (const statement of statements) {
    await conn.query(statement);
  }

  logInfo(`Schema statements applied: ${statements.length}`);
}

async function applyBaseUnitPatches(conn) {
  logStep("Applying unit patches (add_base_unit_qty)...");

  await ensureColumn(conn, "ingredients", "base_unit_qty", "DECIMAL(12,3) NULL");
  await ensureColumn(conn, "ingredients", "quantity", "DECIMAL(12,3) NOT NULL DEFAULT 0");
  await ensureColumn(conn, "ingredients", "last_updated", "TIMESTAMP NULL");
}

async function applyRecipePricePatch(conn) {
  logStep("Applying recipe line price patch (add_recipe_line_price)...");
  await ensureColumn(conn, "recipe_ingredients", "price", "DECIMAL(12,2) NULL");
}

async function applyPurchasingAndSalesPatches(conn) {
  logStep("Applying purchasing/sales relational patches...");

  await ensureTable(
    conn,
    "purchases",
    `
      CREATE TABLE IF NOT EXISTS purchases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ingredient_name VARCHAR(140) NOT NULL,
        quantity DECIMAL(12,3) NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_purchases_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureTable(
    conn,
    "purchase_requests",
    `
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_date DATE NOT NULL,
        needed_by_date DATE NULL,
        status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
        notes VARCHAR(255) NULL,
        review_notes VARCHAR(255) NULL,
        catering_order_id BIGINT NULL,
        requested_by_user_id INT NULL,
        reviewed_by_user_id INT NULL,
        reviewed_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_purchase_request_requester
          FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_purchase_request_reviewer
          FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
          ON DELETE SET NULL,
        UNIQUE KEY uq_purchase_request_catering_order (catering_order_id),
        INDEX idx_purchase_request_status (status),
        INDEX idx_purchase_request_requested_by (requested_by_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureTable(
    conn,
    "purchase_request_items",
    `
      CREATE TABLE IF NOT EXISTS purchase_request_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_request_id INT NOT NULL,
        ingredient_id INT NOT NULL,
        ingredient_name VARCHAR(140) NULL,
        quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        unit VARCHAR(40) NOT NULL,
        reason VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_purchase_request_item_request
          FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_purchase_request_item_ingredient
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
          ON DELETE RESTRICT,
        INDEX idx_purchase_request_item_request (purchase_request_id),
        INDEX idx_purchase_request_item_ingredient (ingredient_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureTable(
    conn,
    "purchase_orders",
    `
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_name VARCHAR(150) NOT NULL,
        purchase_date DATE NOT NULL,
        purchase_request_id INT NULL,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_purchase_order_request (purchase_request_id),
        INDEX idx_po_date (purchase_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureTable(
    conn,
    "purchase_order_details",
    `
      CREATE TABLE IF NOT EXISTS purchase_order_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_order_id INT NOT NULL,
        ingredient_id INT NULL,
        ingredient_name VARCHAR(140) NULL,
        brand VARCHAR(120) NULL,
        unit VARCHAR(40) NULL,
        quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_pod_order
          FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_pod_ingredient
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
          ON DELETE SET NULL,
        INDEX idx_pod_order (purchase_order_id),
        INDEX idx_pod_ingredient (ingredient_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureTable(
    conn,
    "sales_item_inventory_usage",
    `
      CREATE TABLE IF NOT EXISTS sales_item_inventory_usage (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        sales_item_id BIGINT NOT NULL,
        ingredient_id INT NOT NULL,
        qty_used_base_unit DECIMAL(12,3) NOT NULL DEFAULT 0.000,
        base_unit VARCHAR(20) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sales_usage_item
          FOREIGN KEY (sales_item_id) REFERENCES sales_items(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_sales_usage_ingredient
          FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
          ON DELETE RESTRICT,
        INDEX idx_sales_usage_item (sales_item_id),
        INDEX idx_sales_usage_ingredient (ingredient_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureColumn(conn, "purchase_orders", "purchase_request_id", "INT NULL");
  await ensureColumn(conn, "purchase_requests", "catering_order_id", "BIGINT NULL");

  await ensureIndex(
    conn,
    "purchase_orders",
    "uq_purchase_order_request",
    `UNIQUE KEY ${escapeIdentifier("uq_purchase_order_request")} (${escapeIdentifier("purchase_request_id")})`
  );
  await ensureIndex(
    conn,
    "purchase_requests",
    "uq_purchase_request_catering_order",
    `UNIQUE KEY ${escapeIdentifier("uq_purchase_request_catering_order")} (${escapeIdentifier("catering_order_id")})`
  );

  await ensureForeignKey(
    conn,
    "purchase_requests",
    "fk_purchase_request_requester",
    `FOREIGN KEY (${escapeIdentifier("requested_by_user_id")}) REFERENCES ${escapeIdentifier("users")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
  await ensureForeignKey(
    conn,
    "purchase_requests",
    "fk_purchase_request_reviewer",
    `FOREIGN KEY (${escapeIdentifier("reviewed_by_user_id")}) REFERENCES ${escapeIdentifier("users")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
  await ensureForeignKey(
    conn,
    "purchase_request_items",
    "fk_purchase_request_item_request",
    `FOREIGN KEY (${escapeIdentifier("purchase_request_id")}) REFERENCES ${escapeIdentifier("purchase_requests")}(${escapeIdentifier("id")}) ON DELETE CASCADE`
  );
  await ensureForeignKey(
    conn,
    "purchase_request_items",
    "fk_purchase_request_item_ingredient",
    `FOREIGN KEY (${escapeIdentifier("ingredient_id")}) REFERENCES ${escapeIdentifier("ingredients")}(${escapeIdentifier("id")}) ON DELETE RESTRICT`
  );
  await ensureForeignKey(
    conn,
    "purchase_order_details",
    "fk_pod_order",
    `FOREIGN KEY (${escapeIdentifier("purchase_order_id")}) REFERENCES ${escapeIdentifier("purchase_orders")}(${escapeIdentifier("id")}) ON DELETE CASCADE`
  );
  await ensureForeignKey(
    conn,
    "purchase_order_details",
    "fk_pod_ingredient",
    `FOREIGN KEY (${escapeIdentifier("ingredient_id")}) REFERENCES ${escapeIdentifier("ingredients")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
  await ensureForeignKey(
    conn,
    "sales_item_inventory_usage",
    "fk_sales_usage_item",
    `FOREIGN KEY (${escapeIdentifier("sales_item_id")}) REFERENCES ${escapeIdentifier("sales_items")}(${escapeIdentifier("id")}) ON DELETE CASCADE`
  );
  await ensureForeignKey(
    conn,
    "sales_item_inventory_usage",
    "fk_sales_usage_ingredient",
    `FOREIGN KEY (${escapeIdentifier("ingredient_id")}) REFERENCES ${escapeIdentifier("ingredients")}(${escapeIdentifier("id")}) ON DELETE RESTRICT`
  );

  await ensureForeignKey(
    conn,
    "purchase_orders",
    "fk_purchase_order_request",
    `FOREIGN KEY (${escapeIdentifier("purchase_request_id")}) REFERENCES ${escapeIdentifier("purchase_requests")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
  await ensureForeignKey(
    conn,
    "purchase_requests",
    "fk_purchase_request_catering_order",
    `FOREIGN KEY (${escapeIdentifier("catering_order_id")}) REFERENCES ${escapeIdentifier("catering_orders")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
}

async function applyAuditPatches(conn) {
  logStep("Applying audit patches (migrate_audit_features)...");

  await ensureTable(
    conn,
    "audit_logs",
    `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT NULL,
        actor_name VARCHAR(120) NULL,
        actor_role VARCHAR(60) NULL,
        module_name VARCHAR(80) NOT NULL,
        action_name VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80) NULL,
        entity_id BIGINT NULL,
        summary VARCHAR(255) NULL,
        metadata_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_audit_actor
          FOREIGN KEY (actor_user_id) REFERENCES users(id)
          ON DELETE SET NULL,
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_module (module_name, created_at),
        INDEX idx_audit_entity (entity_type, entity_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `
  );

  await ensureForeignKey(
    conn,
    "audit_logs",
    "fk_audit_actor",
    `FOREIGN KEY (${escapeIdentifier("actor_user_id")}) REFERENCES ${escapeIdentifier("users")}(${escapeIdentifier("id")}) ON DELETE SET NULL`
  );
}

async function seedAdmin(conn) {
  logStep("Seeding admin account (seedAdmin)...");

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const fullName = process.env.ADMIN_FULLNAME || "System Owner";
  const email = process.env.ADMIN_EMAIL || null;

  const [existing] = await conn.execute(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );

  if (existing.length > 0) {
    logInfo(`Admin already exists: ${username}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const firstName = fullName.split(" ")[0] || null;
  const lastName = fullName.split(" ").slice(1).join(" ") || null;

  await conn.execute(
    `
      INSERT INTO users (
        full_name, first_name, last_name, username, email, password_hash, role, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'OWNER', 'ACTIVE')
    `,
    [fullName, firstName, lastName, username, email, passwordHash]
  );

  logInfo(`Seeded admin account: ${username}`);
}

async function main() {
  requireEnv("DB_HOST", DB_HOST);
  requireEnv("DB_USER", DB_USER);
  requireEnv("DB_NAME", DB_NAME);
  requireEnv("DB_PASS or DB_PASSWORD", DB_PASS);

  let conn;
  try {
    logStep("Connecting to MySQL...");
    conn = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASS,
      multipleStatements: true,
    });

    logStep(`Ensuring database ${DB_NAME} exists...`);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeIdentifier(DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE ${escapeIdentifier(DB_NAME)}`);
    logInfo(`Using database: ${DB_NAME}`);

    await applySchemaFromFile(conn);
    await applyBaseUnitPatches(conn);
    await applyRecipePricePatch(conn);
    await applyPurchasingAndSalesPatches(conn);
    await applyAuditPatches(conn);
    await seedAdmin(conn);

    logStep("Master database setup completed successfully.");
  } catch (error) {
    console.error("\n[setup] Setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

main();

