CREATE DATABASE IF NOT EXISTS user_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE user_management;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  first_name VARCHAR(50) NULL,
  last_name VARCHAR(50) NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(120) NULL UNIQUE,
  phone VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('OWNER','CASHIER','STOCKROOM_STAFF') NOT NULL DEFAULT 'CASHIER',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INT PRIMARY KEY,
  address VARCHAR(255) NULL,
  gender ENUM('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY') NULL,
  birthdate DATE NULL,
  avatar_url VARCHAR(255) NULL,
  emergency_contact_name VARCHAR(120) NULL,
  emergency_contact_phone VARCHAR(30) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_details (
  user_id INT PRIMARY KEY,
  employee_no VARCHAR(40) NULL UNIQUE,
  position_title VARCHAR(80) NULL,
  hire_date DATE NULL,
  shift_start TIME NULL,
  shift_end TIME NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_details_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NULL,
  base_unit VARCHAR(20) NOT NULL,
  base_unit_qty DECIMAL(12,3) NULL,
  quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_updated TIMESTAMP NULL,
  UNIQUE KEY uq_ingredients_name (ingredient_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingredient_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(80) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ingredient_category_name (category_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT NOT NULL,
  movement_type VARCHAR(40) NOT NULL,
  quantity_change DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  resulting_quantity DECIMAL(12,3) NULL,
  unit VARCHAR(20) NULL,
  source_module VARCHAR(60) NULL,
  reference_type VARCHAR(80) NULL,
  reference_id BIGINT NULL,
  notes VARCHAR(255) NULL,
  created_by_user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_movement_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_inventory_movement_user
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_inventory_movement_ingredient_date (ingredient_id, created_at),
  INDEX idx_inventory_movement_module_date (source_module, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_name VARCHAR(140) NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_purchases_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store_name VARCHAR(150) NOT NULL,
  purchase_date DATE NOT NULL,
  -- Optional one-to-one link when a purchase order is generated from an approved request.
  purchase_request_id INT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_order_request (purchase_request_id),
  INDEX idx_po_date (purchase_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_date DATE NOT NULL,
  needed_by_date DATE NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  notes VARCHAR(255) NULL,
  review_notes VARCHAR(255) NULL,
  -- Optional one-to-one link when a purchase request is generated from a catering shortage review.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_name VARCHAR(140) NOT NULL,
  description TEXT NULL,
  created_by INT NULL,
  status ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recipes_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipe_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id INT NOT NULL,
  version_no INT NOT NULL,
  yield_amount DECIMAL(12,3) NULL,
  yield_unit VARCHAR(20) NULL,
  portion_size DECIMAL(12,3) NULL,
  portion_unit VARCHAR(20) NULL,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recipe_versions_recipe
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_recipe_versions_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_recipe_version (recipe_id, version_no),
  INDEX idx_recipe_active (recipe_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_version_id INT NOT NULL,
  ingredient_id INT NOT NULL,
  qty_used DECIMAL(12,3) NOT NULL,
  qty_unit VARCHAR(20) NOT NULL,
  -- Optional costing fields used by recipe profitability calculations.
  price DECIMAL(12,2) NULL,
  yield_percent DECIMAL(5,2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ri_version
    FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ri_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE RESTRICT,
  INDEX idx_ri (recipe_version_id, ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_name VARCHAR(140) NOT NULL,
  description TEXT NULL,
  recipe_version_id INT NULL,
  -- Helps separate food, drinks, and add-ons while keeping one sales flow.
  menu_type ENUM('FOOD','DRINK','ADD_ON') NOT NULL DEFAULT 'FOOD',
  -- Stored as a decimal ratio, e.g. 0.3000 = 30% target food cost.
  target_food_cost_percent DECIMAL(6,4) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_recipe_version
    FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_menu_name (menu_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_price_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT NOT NULL,
  selling_price DECIMAL(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  change_reason ENUM('MANUAL','MARKUP_RULE','PROMO_START','PROMO_END','AUTO_SUGGEST') NOT NULL DEFAULT 'MANUAL',
  notes VARCHAR(255) NULL,
  synced_to_pos TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mph_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_mph_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_mph_effective (menu_item_id, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingredient_ap_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT NOT NULL,
  supplier_name VARCHAR(150) NULL,
  unit VARCHAR(40) NULL,
  ap_cost_per_unit DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
  effective_date DATE NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_iap_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE CASCADE,
  INDEX idx_iap_ingredient_date (ingredient_id, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT NOT NULL,
  promo_name VARCHAR(140) NOT NULL,
  promo_type ENUM('FIXED','PERCENT') NOT NULL DEFAULT 'FIXED',
  promo_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('DRAFT','ACTIVE','INACTIVE','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_promo_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE CASCADE,
  INDEX idx_menu_promo_dates (menu_item_id, start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(140) NOT NULL,
  email VARCHAR(120) NULL,
  phone VARCHAR(30) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  loyalty_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_name (customer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NULL,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  invoice_date DATETIME NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('DRAFT','ISSUED','PAID','CANCELLED') NOT NULL DEFAULT 'ISSUED',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE SET NULL,
  INDEX idx_invoice_date (invoice_date),
  INDEX idx_invoice_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT NOT NULL,
  menu_item_id INT NULL,
  item_name VARCHAR(140) NOT NULL,
  qty DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_item_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_invoice_item_menu
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE SET NULL,
  INDEX idx_invoice_items_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sale_datetime DATETIME NOT NULL,
  customer_id INT NULL,
  -- Optional cashier-entered label for the guest check, table, or customer name.
  guest_name VARCHAR(120) NULL,
  -- Records whether the sale was dine in, takeout, or delivery for costing and reporting.
  order_type ENUM('DINE_IN','TAKEOUT','DELIVERY') NOT NULL DEFAULT 'DINE_IN',
  cashier_user_id INT NULL,
  gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('CASH','CARD','E_WALLET','OTHER') NULL,
  status ENUM('COMPLETED','VOIDED','REFUNDED') NOT NULL DEFAULT 'COMPLETED',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_sales_cashier
    FOREIGN KEY (cashier_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_sales_date (sale_datetime),
  INDEX idx_sales_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_day_closures (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  -- One row means that date's sales were already closed and should no longer be edited.
  sale_date DATE NOT NULL,
  total_revenue DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_transactions INT NOT NULL DEFAULT 0,
  closed_by_user_id INT NULL,
  closed_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_day_closure_user
    FOREIGN KEY (closed_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_sales_day_closure_date (sale_date),
  INDEX idx_sales_day_closure_user (closed_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sales_transaction_id BIGINT NOT NULL,
  menu_item_id INT NOT NULL,
  qty DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- Optional takeout container chosen during the sale, not baked into menu costing.
  takeout_container_ingredient_id INT NULL,
  takeout_container_qty DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  takeout_container_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  takeout_container_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_items_tx
    FOREIGN KEY (sales_transaction_id) REFERENCES sales_transactions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sales_items_menu
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_sales_items_takeout_container
    FOREIGN KEY (takeout_container_ingredient_id) REFERENCES ingredients(id)
    ON DELETE SET NULL,
  INDEX idx_sales_items_tx (sales_transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catering_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(150) NOT NULL,
  contact_number VARCHAR(60) NULL,
  event_date DATE NOT NULL,
  event_time VARCHAR(40) NULL,
  venue VARCHAR(180) NULL,
  pax_count INT NOT NULL DEFAULT 1,
  status ENUM('DRAFT','QUOTED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  notes VARCHAR(255) NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by_user_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_catering_order_creator
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_catering_event_date (event_date),
  INDEX idx_catering_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catering_order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  catering_order_id BIGINT NOT NULL,
  menu_item_id INT NULL,
  item_name_snapshot VARCHAR(160) NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_catering_item_order
    FOREIGN KEY (catering_order_id) REFERENCES catering_orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_catering_item_menu
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE SET NULL,
  INDEX idx_catering_item_order (catering_order_id),
  INDEX idx_catering_item_menu (menu_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_name VARCHAR(150) NOT NULL,
  quote_date DATE NOT NULL,
  valid_until DATE NULL,
  status ENUM('DRAFT','RECEIVED','APPROVED','REJECTED','EXPIRED') NOT NULL DEFAULT 'RECEIVED',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_supplier_quote_date (quote_date),
  INDEX idx_supplier_quote_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_quote_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier_quote_id BIGINT NOT NULL,
  ingredient_id INT NULL,
  ingredient_name VARCHAR(140) NULL,
  brand VARCHAR(120) NULL,
  unit VARCHAR(40) NULL,
  quantity DECIMAL(12,3) NULL,
  quoted_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_supplier_quote_item_quote
    FOREIGN KEY (supplier_quote_id) REFERENCES supplier_quotes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_supplier_quote_item_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE SET NULL,
  INDEX idx_supplier_quote_item_quote (supplier_quote_id),
  INDEX idx_supplier_quote_item_ingredient (ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
