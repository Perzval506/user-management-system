CREATE DATABASE IF NOT EXISTS user_management;
USE user_management;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Basic identity
  full_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(120) UNIQUE NULL,
  phone VARCHAR(30) NULL,

  -- Auth
  password_hash VARCHAR(255) NOT NULL,

  -- Roles & status
  role ENUM('ADMINISTRATOR','OWNER','CASHIER','STOCKROOM_STAFF','CUSTOMER') NOT NULL DEFAULT 'CASHIER',
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',

  -- Basic profile (optional)
  address VARCHAR(255) NULL,
  birthdate DATE NULL,
  gender ENUM('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY') NULL,
  avatar_url VARCHAR(255) NULL,

  -- Audit (optional)
  created_by INT NULL,
  updated_by INT NULL,
  last_login_at TIMESTAMP NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_users_role (role),
  INDEX idx_users_status (status),
  INDEX idx_users_created_by (created_by),
  INDEX idx_users_updated_by (updated_by)
);
