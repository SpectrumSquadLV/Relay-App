// ============================================================
// Relay — Database layer (multi-tenant)
// Dev: node:sqlite (built-in). Prod: schema is Postgres-portable.
// EVERY tenant-owned table has organization_id. Data access goes
// through the Repo helpers which REQUIRE an orgId, so a query can
// never accidentally cross tenants.
// ============================================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'relay.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------------- SCHEMA ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, name TEXT, monthly_price INTEGER, setup_fee INTEGER,
  max_users INTEGER, sms_allowance INTEGER, email_allowance INTEGER,
  automation_limit INTEGER, features_json TEXT, sort INTEGER
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE,
  primary_contact TEXT, email TEXT, phone TEXT, website TEXT, address TEXT,
  logo TEXT, brand_color TEXT DEFAULT '#3E7C5D', industry TEXT DEFAULT 'aba',
  plan_id TEXT, subscription_status TEXT DEFAULT 'trialing',
  trial_ends_at TEXT, mrr INTEGER DEFAULT 0, stripe_customer_id TEXT,
  status TEXT DEFAULT 'active', is_demo INTEGER DEFAULT 0,
  notes TEXT, created_at TEXT, last_activity_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  password_hash TEXT, is_super_admin INTEGER DEFAULT 0,
  created_at TEXT, last_login_at TEXT
);

-- membership: which users belong to which org + their role there
CREATE TABLE IF NOT EXISTS organization_users (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT DEFAULT 'staff', -- owner|admin|manager|staff
  credential TEXT DEFAULT 'staff', -- RBT|BCBA|BCaBA|staff  (for supervision + maps)
  title TEXT,
  home_address TEXT, home_zip TEXT, home_lat REAL, home_lng REAL,
  status TEXT DEFAULT 'active', created_at TEXT,
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT, type TEXT DEFAULT 'lead', sort INTEGER
);
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, pipeline_id TEXT,
  name TEXT, sort INTEGER, is_won INTEGER DEFAULT 0, is_lost INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  contact_name TEXT, client_name TEXT, phone TEXT, email TEXT,
  preferred_contact TEXT, referral_source TEXT, insurance TEXT,
  stage_id TEXT, assigned_user_id TEXT, status TEXT DEFAULT 'open',
  notes TEXT, converted_client_id TEXT,
  inquiry_at TEXT, last_contact_at TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, from_lead_id TEXT,
  contact_name TEXT, client_name TEXT, phone TEXT, email TEXT, insurance TEXT,
  assigned_user_id TEXT, stage TEXT DEFAULT 'active',
  address TEXT, zip TEXT, lat REAL, lng REAL,
  auth_start TEXT, auth_end TEXT, assessment_date TEXT, treatment_plan_due TEXT,
  first_day TEXT, weekly_hours REAL, notes TEXT, created_at TEXT
);

-- RBT supervision (BACB 5% requirement)
CREATE TABLE IF NOT EXISTS rbt_timecards (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, rbt_user_id TEXT,
  period TEXT, service_hours REAL, source TEXT DEFAULT 'manual', created_at TEXT
);
CREATE TABLE IF NOT EXISTS supervision_sessions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, rbt_user_id TEXT, supervisor_user_id TEXT,
  date TEXT, period TEXT, duration_hours REAL, type TEXT DEFAULT 'individual', -- individual|group
  method TEXT DEFAULT 'in_person', notes TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  title TEXT, entity_type TEXT, entity_id TEXT, owner_user_id TEXT,
  priority TEXT DEFAULT 'normal', category TEXT, status TEXT DEFAULT 'open',
  due_at TEXT, notes TEXT, auto_generated INTEGER DEFAULT 0, created_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  channel TEXT, -- email|sms|call|note
  direction TEXT, -- in|out
  entity_type TEXT, entity_id TEXT,
  from_addr TEXT, to_addr TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'sent', read_at TEXT, user_id TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  channel TEXT, name TEXT, subject TEXT, body TEXT
);

CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  name TEXT, trigger TEXT, is_on INTEGER DEFAULT 1, steps_json TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  automation_id TEXT, entity_type TEXT, entity_id TEXT,
  status TEXT, detail TEXT, created_at TEXT
);

-- Durable job queue that powers the automation engine (multi-step, with waits)
CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  automation_id TEXT, entity_type TEXT, entity_id TEXT,
  status TEXT DEFAULT 'waiting', -- waiting|done|canceled
  step_index INTEGER DEFAULT 0, next_run_at TEXT,
  started_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON automation_jobs(status, next_run_at);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, kind TEXT, summary TEXT,
  user_id TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, organization_id TEXT, actor_user_id TEXT,
  action TEXT, detail TEXT, ip TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, flag TEXT, enabled INTEGER DEFAULT 1,
  UNIQUE(organization_id, flag)
);

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id TEXT PRIMARY KEY, settings_json TEXT
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, metric TEXT, value INTEGER, period TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT, color TEXT
);

CREATE TABLE IF NOT EXISTS lead_sources (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT
);

-- Single-row store for the editable Master Template (super-admin controlled)
CREATE TABLE IF NOT EXISTS master_template ( id INTEGER PRIMARY KEY CHECK (id=1), config_json TEXT );

CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_org ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_orguser_org ON organization_users(organization_id);
`);

// ---------------- low-level helpers ----------------
function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }

// Tables that are tenant-owned (MUST be scoped by organization_id).
const TENANT_TABLES = new Set([
  'leads','clients','tasks','messages','message_templates','automations',
  'automation_runs','activity_logs','feature_flags','usage_records','tags',
  'lead_sources','pipelines','pipeline_stages','organization_users',
  'rbt_timecards','supervision_sessions','automation_jobs'
]);

// Repo: the ONLY sanctioned way to read/write tenant data.
// Every method takes orgId first and injects organization_id into the WHERE.
const Repo = {
  // generic scoped list
  list(orgId, table, where = '', params = [], order = '') {
    if (!TENANT_TABLES.has(table)) throw new Error('not a tenant table: ' + table);
    if (!orgId) throw new Error('orgId required (tenant isolation)');
    const w = where ? ` AND (${where})` : '';
    return all(`SELECT * FROM ${table} WHERE organization_id = ?${w} ${order}`, [orgId, ...params]);
  },
  one(orgId, table, id) {
    if (!TENANT_TABLES.has(table)) throw new Error('not a tenant table: ' + table);
    return get(`SELECT * FROM ${table} WHERE organization_id = ? AND id = ?`, [orgId, id]);
  },
  insert(orgId, table, obj) {
    if (!TENANT_TABLES.has(table)) throw new Error('not a tenant table: ' + table);
    obj.organization_id = orgId;
    if (!obj.id) obj.id = id();
    const keys = Object.keys(obj);
    run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => obj[k]));
    return obj;
  },
  update(orgId, table, rowId, patch) {
    if (!TENANT_TABLES.has(table)) throw new Error('not a tenant table: ' + table);
    const keys = Object.keys(patch);
    run(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE organization_id = ? AND id = ?`,
      [...keys.map(k => patch[k]), orgId, rowId]);
    return Repo.one(orgId, table, rowId);
  },
  remove(orgId, table, rowId) {
    run(`DELETE FROM ${table} WHERE organization_id = ? AND id = ?`, [orgId, rowId]);
  },
  count(orgId, table, where = '', params = []) {
    const w = where ? ` AND (${where})` : '';
    return get(`SELECT COUNT(*) c FROM ${table} WHERE organization_id = ?${w}`, [orgId, ...params]).c;
  },
};

module.exports = { db, run, get, all, Repo, id, now, TENANT_TABLES };
