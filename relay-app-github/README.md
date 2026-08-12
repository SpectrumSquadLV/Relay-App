# Relay — Multi-Tenant CRM SaaS Platform

One master Relay application → many organizations → each gets its own private, isolated workspace.
You control the product centrally; every customer gets a private tenant.

## Run it locally

```bash
npm install
npm start
# open http://localhost:4000
```

**Logins to try**
- **Owner Portal (you / Relay super admin):** `owner@relayitcrm.com` / `relay-admin`
- **A customer workspace (Relay Demo):** `dana@relaydemo.com` / `demo1234`

From the Owner Portal, click any organization → **View Workspace** to impersonate it (audited), or **+ Create Organization** to provision a brand-new tenant from the Master Template.

---

## Architecture (multi-tenancy)

**Model:** shared database, shared schema, **row-level tenancy**. Every tenant-owned table has an
`organization_id` column. This is the "one app, many orgs, one codebase" model you asked for —
improve the master app once, every org gets it; no per-customer copies, repos, or databases.

**Isolation is enforced in the data layer, not just the UI.** `src/db.js` exposes a `Repo` whose
every method *requires* an `organization_id`. Workspace routes derive `req.orgId` from the logged-in
user's membership (`src/auth.js → resolveOrg`) and can only ever read/write within that org. A
customer user hitting the owner API gets a hard `403`. (Verified: org owners cannot reach `/api/owner/*`.)

**Super admin is separate.** The Relay owner is a `users.is_super_admin` account with its own portal
(`/api/owner/*`). It can *impersonate* a workspace for support — every impersonation start/stop is
written to `audit_logs` and shows a persistent banner in the UI.

### Files
```
server.js                 Express entry (sessions, routes, static SPA)
src/db.js                 Schema + Repo (tenant-scoped data access)
src/auth.js               Password hashing (scrypt), roles, tenant-isolation middleware
src/master.js             Master Template + provisionOrg() (new workspace from template)
src/seed.js               Bootstrap (plans, super admin) + Relay Demo data + Reset Demo
src/routes/authRoutes.js  login / logout / me
src/routes/ownerRoutes.js Owner Portal API (orgs, create, impersonate, analytics, flags, template, audit)
src/routes/workspaceRoutes.js  CRM API (dashboard, leads, clients, tasks, messages, automations, search)
public/                   SPA (index.html, app.js, styles.css)
```

### Database tables (all tenant tables carry organization_id)
`plans, organizations, users, organization_users, pipelines, pipeline_stages, leads, clients,
tasks, messages, message_templates, automations, automation_runs, activity_logs, audit_logs,
feature_flags, organization_settings, usage_records, tags, lead_sources, master_template`

---

## What's built (Phase 1 + core of Phase 2/4/5)

- **Multi-tenancy & tenant isolation** — row-level, enforced in the data layer.
- **Auth & roles** — super admin, owner, admin, manager, staff. scrypt password hashing, sessions.
- **Owner Portal** — Organizations table (health/MRR/usage), org detail (subscription, users,
  feature flags, notes, suspend/reactivate, plan change), **Create Organization** (provisions from
  Master Template), **Reset Demo**, **View Workspace** (impersonation + audit), SaaS Analytics,
  Customer Success, Master Template viewer, Audit Log.
- **Master Template system** — the default config new orgs inherit (pipelines, stages, email/text
  templates, automations, tags, sources, feature flags, permissions). Editable; applies to new orgs.
- **Relay Demo org** — 15 leads across stages, 10 clients, 6 staff, tasks (auto + manual),
  email/text history, automation runs — with the exact "nothing falls through the cracks" scenarios.
- **CRM workspace** — Dashboard with **"Needs Your Attention"**, Lead Pipeline (kanban + drag/drop),
  Lead drawer (overview / timeline / messages / tasks), Convert-to-Client, Clients, Tasks (badge
  counts, complete/reopen), Inbox, Automations (on/off + logs), global search.
- **Feature flags per org** and **subscription plans** (Starter/Growth/Pro; prices editable, not hardcoded into logic).
- **Audit log** for logins, admin actions, impersonation, feature changes.

## What's stubbed / next (Phases 3–7)
- **SMS/email delivery** — messages are recorded and shown as conversations, but outbound delivery
  is not yet wired to a provider. Add Twilio (SMS) + Resend/SES (email) in a new `src/services/`
  and call them from `workspaceRoutes /messages` and the automation runner.
- **Automation execution engine** — automations, steps, triggers and a run log exist as data + UI.
  A background runner that actually fires steps on schedule (trigger → wait → condition → action) is
  the next build. Recommended: a queue + worker (e.g. a simple interval worker for MVP, BullMQ later).
- **Billing** — plan fields + Stripe customer ID column exist; wire Stripe Checkout/webhooks.
- **Two-way texting** — inbound webhook to append messages + notify assigned staff.
- **Polish** — more empty/loading/error states, mobile refinements, permission coverage on every route.

---

## Production notes

- **Database:** dev uses Node's built-in SQLite (zero setup). For production, move to **Postgres**
  (Railway has it). The schema is written to port cleanly; swap `src/db.js`'s driver for `pg` and
  keep the same `Repo` interface. Every query is already tenant-scoped, so isolation carries over.
- **Sessions:** set a strong `SESSION_SECRET`. For multi-instance, use a shared session store
  (e.g. `connect-pg-simple`) instead of the default memory store.
- **Secrets:** never in frontend. All integration keys go in environment variables (see `.env.example`).
- **Deploy (Railway):** push this repo to GitHub → Railway deploys via Nixpacks (`npm start`).
  Add a Postgres plugin and set env vars. (Marketing site stays separate on Netlify.)

## Security checklist honored
- Tenant isolation enforced at the data-access layer (org_id required on every tenant query).
- Super-admin access is a separate flag with its own portal and full audit logging.
- Role-based authorization on write routes.
- Passwords hashed (scrypt); no secrets in the frontend; integrations via env vars.
