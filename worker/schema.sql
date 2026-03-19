-- Vibelink Production SaaS Schema (D1)

DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS plans;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  company_name TEXT,
  admin_email TEXT,
  status TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT,
  plan_id TEXT,
  plan_name TEXT,
  monthly_rate REAL,
  balance REAL,
  billing_cycle_day INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT,
  monthly_price REAL,
  speed_mbps INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  customer_id TEXT,
  invoice_number TEXT,
  customer_name TEXT,
  customer_email TEXT,
  billing_period_start TEXT,
  billing_period_end TEXT,
  due_date TEXT,
  subtotal REAL,
  tax_rate REAL,
  tax_amount REAL,
  total_amount REAL,
  status TEXT,
  items TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  customer_id TEXT,
  invoice_id TEXT,
  amount REAL,
  method TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  customer_id TEXT,
  subject TEXT,
  description TEXT,
  status TEXT,
  priority TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS mikrotiks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  router_name TEXT,
  ip_address TEXT,
  status TEXT,
  last_sync TEXT
);

CREATE TABLE IF NOT EXISTS vpn_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  type TEXT,
  name TEXT,
  public_key TEXT,
  private_key TEXT,
  allowed_ips TEXT,
  public_endpoint TEXT,
  port INTEGER,
  inner_ip TEXT,
  listen_port INTEGER,
  status TEXT
);
