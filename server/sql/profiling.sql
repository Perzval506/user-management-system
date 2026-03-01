
USE user_management;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL UNIQUE,
  email VARCHAR(120) NULL UNIQUE,
  phone VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMINISTRATOR','OWNER','CASHIER','STOCKROOM_STAFF','CUSTOMER') NOT NULL DEFAULT 'CASHIER',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;



CREATE TABLE IF NOT EXISTS ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NULL,
  base_unit VARCHAR(20) NOT NULL,            -- e.g., kg, g, L, mL, pc
  base_unit_qty DECIMAL(12,3) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ingredients_name (ingredient_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ingredient_ap_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id INT NOT NULL,
  ap_unit_cost DECIMAL(12,2) NOT NULL,       -- ₱ per base_unit
  currency_code CHAR(3) NOT NULL DEFAULT 'PHP',
  effective_date DATE NOT NULL,              -- supports future scheduling
  source ENUM('MANUAL','INVOICE','SUPPLIER_QUOTE','ROLLBACK') NOT NULL DEFAULT 'MANUAL',
  reference_no VARCHAR(80) NULL,             -- invoice no / quote id
  notes VARCHAR(255) NULL,
  created_by INT NULL,                       -- user id (owner/admin)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_iap_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_iap_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_iap_effective (ingredient_id, effective_date)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS supplier_quotes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_name VARCHAR(120) NOT NULL,
  quote_date DATE NOT NULL,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_quotes_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS supplier_quote_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quote_id INT NOT NULL,
  ingredient_id INT NOT NULL,
  quoted_unit_cost DECIMAL(12,2) NOT NULL,
  effective_date DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sqi_quote
    FOREIGN KEY (quote_id) REFERENCES supplier_quotes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sqi_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE CASCADE,
  INDEX idx_sqi (quote_id, ingredient_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(80) NULL UNIQUE,
  invoice_date DATE NOT NULL,
  vendor_name VARCHAR(120) NULL,
  image_url VARCHAR(255) NULL,               -- or store file path
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  ingredient_id INT NOT NULL,
  ap_unit_cost DECIMAL(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_items_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_inv_items_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE CASCADE,
  INDEX idx_invoice_item (invoice_id, ingredient_id)
) ENGINE=InnoDB;


-- Minimal recipe tables (needed because menu pricing assumes recipes/costs exist)
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recipe_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id INT NOT NULL,
  version_no INT NOT NULL,
  yield_amount DECIMAL(12,3) NULL,           -- total yield (e.g., grams)
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_version_id INT NOT NULL,
  ingredient_id INT NOT NULL,
  qty_used DECIMAL(12,3) NOT NULL,
  qty_unit VARCHAR(20) NOT NULL,             -- unit used in recipe line
  yield_percent DECIMAL(5,2) NULL,           -- edible portion %
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ri_version
    FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ri_ingredient
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    ON DELETE RESTRICT,
  INDEX idx_ri (recipe_version_id, ingredient_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_name VARCHAR(140) NOT NULL,
  description TEXT NULL,
  recipe_version_id INT NULL,                -- ties menu item to a recipe version
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_menu_recipe_version
    FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id)
    ON DELETE SET NULL,
  UNIQUE KEY uq_menu_name (menu_name)
) ENGINE=InnoDB;

-- Price history supports manual update, markup-based updates, and logging price changes
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
) ENGINE=InnoDB;

-- Promotional discounts with start/end dates
CREATE TABLE IF NOT EXISTS menu_promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_item_id INT NOT NULL,
  promo_name VARCHAR(120) NOT NULL,
  discount_type ENUM('PERCENT','FIXED') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,     -- % if PERCENT, amount if FIXED
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('SCHEDULED','ACTIVE','ENDED') NOT NULL DEFAULT 'SCHEDULED',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_promo_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_promo_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL,
  INDEX idx_promo_dates (menu_item_id, start_date, end_date)
) ENGINE=InnoDB;

-- ----------------------------
-- 4) CUSTOMER MANAGEMENT (basic customer profiles + sales ties)
-- ----------------------------

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
) ENGINE=InnoDB;

-- POS sales events (ties to customers + staff who recorded the transaction)
CREATE TABLE IF NOT EXISTS sales_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sale_datetime DATETIME NOT NULL,
  customer_id INT NULL,
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  sales_transaction_id BIGINT NOT NULL,
  menu_item_id INT NOT NULL,
  qty DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_items_tx
    FOREIGN KEY (sales_transaction_id) REFERENCES sales_transactions(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sales_items_menu
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    ON DELETE RESTRICT,
  INDEX idx_sales_items_tx (sales_transaction_id)
) ENGINE=InnoDB;


USE user_management;

ALTER TABLE users
  ADD COLUMN email VARCHAR(150) NULL UNIQUE AFTER username,
  ADD COLUMN contact_no VARCHAR(30) NULL AFTER email,
  ADD COLUMN address VARCHAR(255) NULL AFTER contact_no;
USE user_management;

USE user_management;

ALTER TABLE user_profiles
  ADD UNIQUE KEY uniq_user_profiles_user_id (user_id);

ALTER TABLE staff_details
  ADD UNIQUE KEY uniq_staff_details_user_id (user_id);


SELECT * FROM user_management.users;
ALTER TABLE users
MODIFY role ENUM(
  'ADMINISTRATOR',
  'OWNER',
  'CASHIER',
  'STOCKROOM_STAFF',
  'CUSTOMER'
) NOT NULL DEFAULT 'CASHIER';
