// ============================================================
// Relay clinical domain: insurance, eligibility & benefits,
// authorizations, documents, client photos, staff credentials.
//
// Relay already had the CRM spine -- organizations, pipelines, leads,
// clients, tasks, messages, a real automation engine. What it did not have
// was anything that makes it a BEHAVIOURAL HEALTH product: no insurance,
// no benefits verification, no authorization tracking, no document store,
// no credentials. That is what lives here.
//
// Additive by construction. Nothing in this file alters an existing table
// beyond adding nullable columns, and no existing behaviour changes until
// something reads these tables.
//
// Multi-tenant like the rest of Relay: every table carries organization_id
// and is registered with the Repo so a query cannot accidentally cross a
// practice boundary.
// ============================================================
const { db, run, get, all, id, now } = require('./db');

// ---------- schema ----------
function ensureClinicalSchema() {
  db.exec(`
-- One row per insurance policy. A client may carry primary, secondary and
-- tertiary cover, which is why this is a table rather than columns.
CREATE TABLE IF NOT EXISTS client_insurance (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
  rank TEXT DEFAULT 'primary',            -- primary | secondary | tertiary
  carrier TEXT, member_id TEXT, group_number TEXT,
  subscriber_name TEXT, subscriber_dob TEXT, relationship TEXT,
  card_front_path TEXT, card_back_path TEXT,
  effective_date TEXT, termination_date TEXT,
  created_at TEXT
);

-- Eligibility & benefits verification. Every field the eligibility team
-- reads back off a payer call is captured, because the call is the
-- expensive part and nobody should have to make it twice.
CREATE TABLE IF NOT EXISTS eligibility_checks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
  insurance_id TEXT,
  status TEXT DEFAULT 'not_started',      -- not_started|pending|in_progress|info_needed|verified|unable|not_eligible
  assigned_user_id TEXT, requested_at TEXT, completed_at TEXT,
  network_status TEXT,                    -- in_network | out_of_network
  deductible REAL, deductible_remaining REAL,
  copay REAL, coinsurance REAL,
  oop_max REAL, oop_remaining REAL,
  auth_required INTEGER DEFAULT 0, referral_required INTEGER DEFAULT 0,
  visit_limit TEXT, service_limitations TEXT,
  effective_date TEXT, termination_date TEXT,
  call_reference TEXT, payer_rep TEXT, notes TEXT,
  created_at TEXT
);

-- Authorizations, for both the assessment and the treatment phase.
CREATE TABLE IF NOT EXISTS authorizations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
  kind TEXT DEFAULT 'treatment',          -- assessment | treatment
  payer TEXT, auth_number TEXT, cpt_codes TEXT,
  status TEXT DEFAULT 'required',         -- required|preparing|submitted|pending|info_requested|approved|partial|denied|appeal
  requested_units REAL, approved_units REAL, used_units REAL DEFAULT 0,
  start_date TEXT, end_date TEXT,
  submitted_at TEXT, decided_at TEXT, denial_reason TEXT,
  notes TEXT, created_at TEXT
);

-- Client document store, categorised, with expiry so required paperwork
-- can be chased before it lapses rather than after.
CREATE TABLE IF NOT EXISTS client_documents (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
  category TEXT DEFAULT 'other',          -- intake|insurance|authorizations|assessments|treatment_plans|medical|consents|financial|referrals|clinical|other
  label TEXT, filename TEXT, mime_type TEXT, file_path TEXT, external_url TEXT,
  is_required INTEGER DEFAULT 0, expires_on TEXT, archived INTEGER DEFAULT 0,
  uploaded_by TEXT, created_at TEXT
);

-- Staff profile detail beyond the login record in users.
CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT,
  full_name TEXT, preferred_name TEXT, photo_url TEXT,
  position TEXT, specialty TEXT, credentials TEXT,
  npi TEXT, taxonomy TEXT, medicaid_id TEXT,
  email TEXT, phone TEXT,
  employment_status TEXT DEFAULT 'active', hire_date TEXT,
  supervisor_id TEXT, location TEXT, created_at TEXT
);

-- Licences, certifications and anything else with an expiry date that can
-- quietly stop a clinician being billable.
CREATE TABLE IF NOT EXISTS staff_credentials (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  kind TEXT,                              -- license|rbt|cpr|bls|background|fingerprint|npi|medicaid|credentialing|drivers|custom
  label TEXT, number TEXT, state TEXT,
  issued_on TEXT, expires_on TEXT,
  status TEXT DEFAULT 'active',           -- active | expiring | expired
  file_path TEXT, notes TEXT, created_at TEXT
);
  `);

  // Additive columns on the existing clients table. Nullable, so every row
  // already in a practice's database stays valid and unchanged.
  for (const [col, type] of [
    ['photo_url', 'TEXT'],
    ['legal_first_name', 'TEXT'], ['middle_name', 'TEXT'], ['legal_last_name', 'TEXT'],
    ['preferred_name', 'TEXT'], ['dob', 'TEXT'], ['sex', 'TEXT'],
    ['city', 'TEXT'], ['state', 'TEXT'],
    ['language', 'TEXT'], ['preferred_contact', 'TEXT'],
    ['service_line', 'TEXT'],               // aba | bh | ot | st
    ['diagnosis', 'TEXT'], ['diagnosis_date', 'TEXT'],
    ['referral_source', 'TEXT'], ['referring_provider', 'TEXT'],
    ['guardian_name', 'TEXT'], ['guardian_relationship', 'TEXT'],
    ['emergency_contact', 'TEXT'],
    ['phase', 'TEXT'],                      // intake | assessment_auth | assessment | active
  ]) {
    try { run(`ALTER TABLE clients ADD COLUMN ${col} ${type}`); } catch (e) { /* already there */ }
  }
}

// Registered with the Repo so tenant scoping applies to these exactly as it
// does to leads and clients.
const CLINICAL_TABLES = [
  'client_insurance', 'eligibility_checks', 'authorizations',
  'client_documents', 'staff_profiles', 'staff_credentials',
];

// ---------- derived status helpers ----------
const daysUntil = (iso) => (iso ? Math.round((new Date(iso) - new Date()) / 864e5) : null);

// Credential status derived from its expiry rather than stored, so it can
// never drift out of date with the date it describes.
function credentialStatus(expiresOn) {
  const d = daysUntil(expiresOn);
  if (d === null) return 'active';
  if (d < 0) return 'expired';
  if (d <= 90) return 'expiring';
  return 'active';
}

// The alert ladder the spec asks for: 90 / 60 / 30 / 14 days, then expired.
const CREDENTIAL_MILESTONES = [90, 60, 30, 14, 0];
function credentialMilestone(expiresOn) {
  const d = daysUntil(expiresOn);
  if (d === null) return null;
  if (d < 0) return 0;
  // The TIGHTEST tier crossed, not the loosest. Searching the list as written
  // returns 90 for a credential 20 days out, which would fire the gentle
  // three-month notice for something about to lapse.
  return [...CREDENTIAL_MILESTONES].reverse().find((m) => d <= m) ?? null;
}

// Authorization expiry ladder, same shape.
function authUrgency(endDate) {
  const d = daysUntil(endDate);
  if (d === null) return null;
  if (d < 0) return 'expired';
  if (d <= 14) return 'critical';
  if (d <= 30) return 'urgent';
  if (d <= 60) return 'attention';
  return 'ok';
}

module.exports = {
  ensureClinicalSchema, CLINICAL_TABLES,
  credentialStatus, credentialMilestone, authUrgency, daysUntil,
};
