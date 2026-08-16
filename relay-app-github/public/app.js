// ============================================================
// Relay SPA (vanilla). Owner Portal + CRM Workspace.
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const LOGO = `<svg viewBox="0 0 24 24" fill="none"><path d="M2 12h5M7 7l5 5-5 5M12 7l5 5-5 5M17 7l5 5-5 5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
const initials = (n) => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
const money = (c) => '$' + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0 });
const ago = (iso) => { if (!iso) return '—'; const d = (Date.now() - Date.parse(iso)) / 864e5; if (d < 1) return 'today'; if (d < 2) return 'yesterday'; return Math.round(d) + 'd ago'; };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
const MSG_LABEL = (s) => ({ sent: 'Delivered', delivered: 'Delivered', simulated: 'Simulated', failed: 'Failed', queued: 'Sending…', received: 'Received' }[s] || s);

let STATE = { user: null, memberships: [], impersonating: null };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401) { STATE.user = null; renderLogin(); throw new Error('unauth'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || 'error'), { data, status: res.status });
  return data;
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

// ---------------- boot ----------------
async function boot() {
  try {
    const me = await api('/auth/me');
    STATE.user = me.user; STATE.memberships = me.memberships || []; STATE.impersonating = me.impersonating;
    if (!STATE.user) return renderLogin();
    if (STATE.user.is_super_admin && !STATE.impersonating) return renderOwner('organizations');
    return renderWorkspace('dashboard');
  } catch (e) { renderLogin(); }
}

// ---------------- login ----------------
function renderLogin() {
  app.innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="brand"><span class="logo-mark">${LOGO}</span> Relay</div>
    <h1>Sign in</h1><p class="sub">Welcome back. Log in to your workspace.</p>
    <label>Email</label><input id="email" type="email" autocomplete="username" />
    <label>Password</label><input id="pw" type="password" autocomplete="current-password" />
    <div class="err" id="loginErr">Invalid email or password.</div>
    <button class="btn btn-primary" id="loginBtn">Sign in</button>
    <div class="login-hint"><b>Demo logins</b><br>Owner portal: <b>owner@relayitcrm.com</b> / relay-admin<br>Demo workspace: <b>dana@relaydemo.com</b> / demo1234</div>
  </div></div>`;
  const submit = async () => {
    $('#loginErr').style.display = 'none';
    try { await api('/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#pw').value } }); boot(); }
    catch { $('#loginErr').style.display = 'block'; }
  };
  $('#loginBtn').onclick = submit;
  $('#pw').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ================= OWNER PORTAL =================
const OWNER_NAV = [
  ['organizations', 'Organizations', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ['analytics', 'Analytics', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['success', 'Customer Success', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'],
  ['template', 'Master Template', '<path d="M4 6h16M4 12h16M4 18h10"/>'],
  ['audit', 'Audit Log', '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h11"/>'],
];
function shell(nav, active, title, contentHtml, opts = {}) {
  const navHtml = nav.map(([k, label, icon, badge]) => `<button class="nav-item ${k === active ? 'active' : ''}" data-nav="${k}">
    <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`).join('');
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><span class="logo-mark">${LOGO}</span> Relay${opts.owner ? ' <span style="font-size:11px;color:var(--muted);font-weight:600">Owner</span>' : ''}</div>
      ${opts.orgchip ? `<div class="orgchip">${esc(opts.orgchip)}</div>` : ''}
      ${navHtml}
      <div class="foot">${esc(STATE.user.name || STATE.user.email)}<br><a href="#" id="logout" style="color:var(--brand);font-weight:600">Sign out</a></div>
    </aside>
    <div class="main">
      ${opts.banner || ''}
      <div class="topbar">${opts.topbar || `<div style="font-weight:700;color:var(--ink)">${esc(title)}</div>`}
        <div class="user"><span class="avatar">${initials(STATE.user.name || STATE.user.email)}</span></div>
      </div>
      <div class="content" id="content">${contentHtml}</div>
    </div></div>`;
  $('#logout').onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); STATE.user = null; renderLogin(); };
  app.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => opts.onNav(b.dataset.nav));
}

async function renderOwner(view) {
  const onNav = (v) => renderOwner(v);
  const wrap = (html) => shell(OWNER_NAV, view, 'Relay Owner', html, { owner: true, onNav });
  wrap('<div class="empty">Loading…</div>');
  try {
    if (view === 'organizations') return ownerOrgs(wrap);
    if (view === 'analytics') return ownerAnalytics(wrap);
    if (view === 'success') return ownerSuccess(wrap);
    if (view === 'template') return ownerTemplate(wrap);
    if (view === 'audit') return ownerAudit(wrap);
  } catch (e) { wrap(`<div class="empty">Error: ${esc(e.message)}</div>`); }
}

async function ownerOrgs(wrap) {
  const { organizations } = await api('/owner/organizations');
  const rows = organizations.map(o => `<tr class="clickable" data-org="${o.id}">
    <td><b>${esc(o.name)}</b>${o.is_demo ? ' <span class="pill green">Demo</span>' : ''}<div style="font-size:12px;color:var(--muted)">${esc(o.primary_contact || '')}</div></td>
    <td>${esc(o.plan_name)}</td>
    <td><span class="pill ${o.subscription_status === 'active' ? 'green' : o.subscription_status === 'trialing' ? 'blue' : 'amber'}">${esc(o.subscription_status)}</span></td>
    <td>${o.users}</td><td>${o.leads}</td><td>${o.clients}</td>
    <td>${money(o.mrr)}</td>
    <td><span class="health-dot ${o.health === 'green' ? 'hg' : o.health === 'yellow' ? 'hy' : 'hr'}"></span> ${o.health_flags.join(', ') || 'Healthy'}</td>
    <td>${o.last_activity_days > 900 ? '—' : o.last_activity_days + 'd'}</td></tr>`).join('');
  wrap(`<div class="page-head" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1>Relay Organizations</h1><p>Every company using Relay — ${organizations.length} total.</p></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" id="resetDemo">↺ Reset Demo</button>
        <button class="btn btn-primary" id="createOrg">+ Create Organization</button></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table>
      <thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Users</th><th>Leads</th><th>Clients</th><th>MRR</th><th>Health</th><th>Last active</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
  $('#content').querySelectorAll('[data-org]').forEach(tr => tr.onclick = () => ownerOrgDetail(tr.dataset.org));
  $('#createOrg').onclick = createOrgModal;
  $('#resetDemo').onclick = async () => { if (confirm('Reset Relay Demo to original fake data? This wipes any changes made during demos.')) { await api('/owner/reset-demo', { method: 'POST' }); toast('Demo reset to original data'); renderOwner('organizations'); } };
}

async function ownerOrgDetail(id) {
  const d = await api('/owner/organizations/' + id);
  const o = d.organization;
  const flagsHtml = d.feature_flags.map(f => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13.5px">
    <input type="checkbox" style="width:auto" data-flag="${f.flag}" ${f.enabled ? 'checked' : ''}> ${f.flag.replace(/_/g, ' ')}</label>`).join('');
  const usersHtml = d.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td><span class="pill gray">${esc(u.role)}</span></td><td>${ago(u.last_login_at)}</td></tr>`).join('');
  const planOpts = d.plans.map(p => `<option value="${p.id}" ${p.id === o.plan_id ? 'selected' : ''}>${esc(p.name)} — ${money(p.monthly_price)}/mo</option>`).join('');
  const backBtn = `<button class="btn btn-ghost btn-sm" id="back">← Back</button>`;
  shell(OWNER_NAV, 'organizations', o.name, `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>${backBtn}<h1 style="margin-top:10px">${esc(o.name)} ${o.is_demo ? '<span class="pill green">Demo</span>' : ''}</h1>
        <p>${esc(o.primary_contact || '')} · ${esc(o.email || '')} · ${esc(o.phone || '')}</p></div>
      <button class="btn btn-primary" id="viewWs">View Workspace →</button></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card stat"><div class="k">${o.users}</div><div class="l">Users</div></div>
      <div class="card stat"><div class="k">${o.leads}</div><div class="l">Leads</div></div>
      <div class="card stat"><div class="k">${o.clients}</div><div class="l">Active clients</div></div>
      <div class="card stat"><div class="k">${money(o.mrr)}</div><div class="l">MRR</div></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="section-title" style="margin-top:0">Subscription</div>
        <div class="field-row"><span class="l">Status</span><span class="v">${esc(o.subscription_status)}</span></div>
        <div class="field-row"><span class="l">Plan</span><span class="v"><select id="plan" style="width:auto;padding:5px 8px">${planOpts}</select></span></div>
        <div class="field-row"><span class="l">Created</span><span class="v">${fmtDate(o.created_at)}</span></div>
        <div class="field-row"><span class="l">Health</span><span class="v"><span class="health-dot ${o.health === 'green' ? 'hg' : o.health === 'yellow' ? 'hy' : 'hr'}"></span> ${o.health_flags.join(', ') || 'Healthy'}</span></div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" id="suspend">${o.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button></div>
      </div>
      <div class="card"><div class="section-title" style="margin-top:0">Feature Flags</div>${flagsHtml}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-title" style="margin-top:0">Users</div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th></tr></thead><tbody>${usersHtml}</tbody></table></div>
    <div class="card" style="margin-top:16px"><div class="section-title" style="margin-top:0">Messaging / sender</div>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:12px">Global delivery — Email: ${d.providers?.email ? '<b style="color:var(--brand)">✓ Resend connected</b>' : '— not connected'} · SMS: ${d.providers?.sms ? '<b style="color:var(--brand)">✓ Twilio connected</b>' : '— not connected'}. Leave blank to use the Relay-managed sender.</p>
      <div class="form-grid">
        <div class="fld"><label>From email (this org)</label><input id="msg_email" value="${esc(d.messaging?.from_email || '')}" placeholder="intake@practice.com"></div>
        <div class="fld"><label>From number (this org)</label><input id="msg_num" value="${esc(d.messaging?.from_number || '')}" placeholder="+1702..."></div>
      </div>
      <button class="btn btn-ghost btn-sm" id="saveMsg" style="margin-top:4px">Save messaging</button></div>
    <div class="card" style="margin-top:16px"><div class="section-title" style="margin-top:0">Internal notes</div>
      <textarea id="notes" rows="3" placeholder="Private notes about this customer…">${esc(o.notes || '')}</textarea>
      <button class="btn btn-ghost btn-sm" id="saveNotes" style="margin-top:8px">Save notes</button></div>
  `, { owner: true, onNav: (v) => renderOwner(v) });
  $('#back').onclick = () => renderOwner('organizations');
  $('#viewWs').onclick = async () => { await api('/owner/impersonate/' + id, { method: 'POST' }); STATE.impersonating = { id: o.id, name: o.name }; renderWorkspace('dashboard'); };
  $('#plan').onchange = async (e) => { await api('/owner/organizations/' + id + '/plan', { method: 'POST', body: { plan_id: e.target.value } }); toast('Plan updated'); };
  $('#suspend').onclick = async () => { const ns = o.status === 'suspended' ? 'active' : 'suspended'; await api('/owner/organizations/' + id + '/status', { method: 'POST', body: { status: ns } }); toast('Account ' + ns); ownerOrgDetail(id); };
  $('#saveNotes').onclick = async () => { await api('/owner/organizations/' + id + '/notes', { method: 'POST', body: { notes: $('#notes').value } }); toast('Notes saved'); };
  $('#saveMsg').onclick = async () => { await api('/owner/organizations/' + id + '/messaging', { method: 'POST', body: { from_email: $('#msg_email').value, from_number: $('#msg_num').value } }); toast('Messaging settings saved'); };
  $('#content').querySelectorAll('[data-flag]').forEach(cb => cb.onchange = async () => { await api('/owner/organizations/' + id + '/flags', { method: 'POST', body: { flag: cb.dataset.flag, enabled: cb.checked } }); toast('Feature ' + (cb.checked ? 'enabled' : 'disabled')); });
}

function createOrgModal() {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal"><div class="modal-h">Create Organization</div>
    <div class="modal-b"><div class="form-grid">
      <div class="fld full"><label>Company name *</label><input id="c_name"></div>
      <div class="fld"><label>Owner name</label><input id="c_owner"></div>
      <div class="fld"><label>Owner email</label><input id="c_email" type="email"></div>
      <div class="fld"><label>Phone</label><input id="c_phone"></div>
      <div class="fld"><label>Industry / template</label><select id="c_ind"><option value="aba">ABA Therapy</option><option value="behavioral">Behavioral Health</option><option value="home_health">Home Health</option></select></div>
      <div class="fld"><label>Plan</label><select id="c_plan"><option value="starter">Starter</option><option value="growth" selected>Growth</option><option value="pro">Pro</option></select></div>
      <div class="fld"><label>Account type</label><select id="c_trial"><option value="1">Trial (14 days)</option><option value="0">Paid</option></select></div>
    </div><p style="font-size:12.5px;color:var(--muted);margin-top:6px">A fresh workspace is provisioned from the Relay Master Template — pipelines, templates, automations, tags and default settings included.</p></div>
    <div class="modal-f"><button class="btn btn-ghost" id="c_cancel">Cancel</button><button class="btn btn-primary" id="c_create">Create workspace</button></div></div>`;
  document.body.appendChild(m);
  $('#c_cancel', m).onclick = () => m.remove();
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  $('#c_create', m).onclick = async () => {
    const name = $('#c_name', m).value.trim(); if (!name) return toast('Company name required');
    const r = await api('/owner/organizations', { method: 'POST', body: {
      name, owner_name: $('#c_owner', m).value, owner_email: $('#c_email', m).value, phone: $('#c_phone', m).value,
      industry: $('#c_ind', m).value, plan_id: $('#c_plan', m).value, trial: $('#c_trial', m).value === '1' } });
    m.remove();
    toast('Workspace created' + (r.owner_temp_password ? ' · temp pw: ' + r.owner_temp_password : ''));
    renderOwner('organizations');
  };
}

async function ownerAnalytics(wrap) {
  const a = await api('/owner/analytics');
  const tile = (k, l) => `<div class="card stat"><div class="k">${k}</div><div class="l">${l}</div></div>`;
  wrap(`<div class="page-head"><h1>SaaS Analytics</h1><p>The health and growth of Relay.</p></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${tile(a.total_orgs, 'Total organizations')}${tile(a.active, 'Active / paid')}${tile(a.trials, 'On trial')}${tile(a.new_this_month, 'New this month')}</div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${tile(money(a.mrr), 'MRR')}${tile(money(a.arr), 'ARR')}${tile(a.total_users, 'Total users')}${tile(a.total_leads, 'Leads processed')}</div>
    <div class="grid cols-3">
      ${tile(a.total_emails, 'Emails sent')}${tile(a.total_texts, 'Texts sent')}${tile(a.automation_runs, 'Automation executions')}</div>`);
}

async function ownerSuccess(wrap) {
  const b = await api('/owner/customer-success');
  const list = (arr, empty) => arr.length ? arr.map(o => `<div class="attn-item"><span class="ic yellow">•</span><span class="tx">${esc(o.name)}<div style="font-size:12px;color:var(--muted);font-weight:400">${esc(o.primary_contact || '')} · ${o.leads} leads · last active ${o.last_activity_days > 900 ? 'never' : o.last_activity_days + 'd ago'}</div></span></div>`).join('') : `<div class="attn-item"><span class="tx" style="color:var(--muted)">${empty}</span></div>`;
  wrap(`<div class="page-head"><h1>Customer Success</h1><p>Accounts that may need a nudge.</p></div>
    <div class="grid cols-2">
      <div class="attn"><div class="attn-h">🕒 Inactive (no login 14d+)</div>${list(b.inactive, 'All active recently')}</div>
      <div class="attn"><div class="attn-h">⏳ Trials in progress</div>${list(b.trial_ending, 'No active trials')}</div>
      <div class="attn"><div class="attn-h">💳 Failed payments</div>${list(b.failed_payment, 'No failed payments')}</div>
      <div class="attn"><div class="attn-h">📉 Low usage (&lt;3 leads)</div>${list(b.low_usage, 'Healthy usage')}</div>
    </div>`);
}

async function ownerTemplate(wrap) {
  const { template } = await api('/owner/master-template');
  wrap(`<div class="page-head"><h1>Relay Master Template</h1><p>The default configuration every new organization inherits. Edit here; changes apply to <b>new</b> organizations and never overwrite a customer's own customizations.</p></div>
    <div class="grid cols-2">
      <div class="card"><div class="section-title" style="margin-top:0">Lead pipeline stages</div>${template.lead_stages.map(s => `<div class="field-row"><span class="v">${esc(s)}</span></div>`).join('')}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Default automations</div>${template.automations.map(a => `<div class="field-row"><span class="l">${esc(a.trigger)}</span><span class="v">${esc(a.name)}</span></div>`).join('')}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Email templates</div>${template.email_templates.map(t => `<div class="field-row"><span class="v">${esc(t.name)}</span></div>`).join('')}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Text templates</div>${template.text_templates.map(t => `<div class="field-row"><span class="v">${esc(t.name)}</span></div>`).join('')}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Lead sources</div>${template.lead_sources.map(s => `<span class="pill gray" style="margin:3px">${esc(s)}</span>`).join('')}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Default feature flags</div>${Object.entries(template.feature_flags).map(([k, v]) => `<div class="field-row"><span class="l">${k.replace(/_/g, ' ')}</span><span class="v">${v ? 'On' : 'Off'}</span></div>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:16px;background:var(--tint2)"><b>Publishing a change globally</b><p style="font-size:13.5px;color:var(--body);margin-top:6px">When you push a template change, Relay will show you: what will change, which organizations are affected, and whether any customer customization would be overwritten — and require confirmation. (Global apply is scaffolded; new orgs already inherit edits.)</p></div>`);
}

async function ownerAudit(wrap) {
  const { audit } = await api('/owner/audit');
  const rows = audit.map(a => `<tr><td>${fmtDate(a.created_at)} ${new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.actor || '—')}</td><td style="color:var(--muted)">${esc(a.detail || '')}</td></tr>`).join('');
  wrap(`<div class="page-head"><h1>Audit Log</h1><p>Every sensitive action, including admin impersonation.</p></div>
    <div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

// ================= WORKSPACE =================
let WS = { me: null, view: 'dashboard' };
const WS_NAV = (badges, flags = {}) => {
  const nav = [
    ['dashboard', 'Dashboard', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
    ['leads', 'Leads', '<path d="M4 6h16M4 12h10M4 18h6"/>'],
    ['clients', 'Clients', '<circle cx="12" cy="8" r="4"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'],
    ['tasks', 'Tasks', '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>', badges.tasks],
    ['inbox', 'Inbox', '<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 5h14v14H5z"/>', badges.inbox],
    ['automations', 'Automations', '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 4v4h4"/>'],
  ];
  if (flags.rbt_supervision) nav.push(['supervision', 'Supervision', '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>', badges.supervision]);
  if (flags.staff_maps) nav.push(['maps', 'Maps', '<path d="M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>']);
  return nav;
};

async function renderWorkspace(view) {
  WS.view = view;
  if (!WS.me) WS.me = await api('/workspace/me');
  const dash = await api('/workspace/dashboard').catch(() => ({ metrics: {} }));
  const badges = { tasks: dash.metrics.overdue_tasks || '', inbox: '' };
  const flags = WS.me.feature_flags || {};
  const banner = STATE.impersonating ? `<div class="imp-banner">👁 You are viewing <b>${esc(WS.me.org.name)}</b> as Relay Administrator.<button class="btn" id="stopImp">Exit workspace</button></div>` : '';
  const topbar = `<div class="search"><span class="si">🔍</span><input id="gsearch" placeholder="Search leads, clients, tasks, phone, email…" autocomplete="off"><div class="search-results hidden" id="sresults"></div></div>`;
  const onNav = (v) => renderWorkspace(v);
  const wrap = (html) => {
    shell(WS_NAV(badges, flags), view, WS.me.org.name, html, { orgchip: WS.me.org.name, banner, topbar, onNav });
    if (STATE.impersonating) $('#stopImp').onclick = async () => { await api('/owner/impersonate-stop', { method: 'POST' }); STATE.impersonating = null; WS.me = null; renderOwner('organizations'); };
    setupSearch();
  };
  wrap('<div class="empty">Loading…</div>');
  if (view === 'dashboard') return wsDashboard(wrap, dash);
  if (view === 'leads') return wsLeads(wrap);
  if (view === 'clients') return wsClients(wrap);
  if (view === 'tasks') return wsTasks(wrap);
  if (view === 'inbox') return wsInbox(wrap);
  if (view === 'automations') return wsAutomations(wrap);
  if (view === 'supervision') return wsSupervision(wrap);
  if (view === 'maps') return wsMaps(wrap);
}

function wsDashboard(wrap, d) {
  const m = d.metrics;
  const attn = (d.attention || []).map(a => `<div class="attn-item"><span class="ic ${a.level}">${a.icon}</span><span class="tx">${esc(a.text)}</span><a class="go" data-goto="${a.view}">Review →</a></div>`).join('') || `<div class="attn-item"><span class="ic green">✓</span><span class="tx">You're all caught up. Nothing needs attention.</span></div>`;
  const recent = (d.recent || []).map(r => `<div class="field-row"><span class="l">${esc(r.summary)}</span><span class="v" style="font-weight:400;color:var(--muted)">${ago(r.created_at)}</span></div>`).join('');
  wrap(`<div class="page-head"><h1>Good morning${WS.me.staff[0] ? ', ' + esc(WS.me.staff.find(s => s.role === 'owner')?.name?.split(' ')[0] || '') : ''}</h1><p>Here's what needs you today.</p></div>
    <div class="attn" style="margin-bottom:20px"><div class="attn-h">⚡ Needs Your Attention</div>${attn}</div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card stat"><div class="k">${m.new_leads || 0}</div><div class="l">New leads (7d)</div></div>
      <div class="card stat danger"><div class="k">${m.needs_followup || 0}</div><div class="l">Need follow-up</div></div>
      <div class="card stat alert"><div class="k">${m.overdue_tasks || 0}</div><div class="l">Overdue tasks</div></div>
      <div class="card stat"><div class="k">${m.active_clients || 0}</div><div class="l">Active clients</div></div></div>
    <div class="grid cols-4" style="margin-bottom:20px">
      <div class="card stat"><div class="k">${m.awaiting_auth || 0}</div><div class="l">Awaiting authorization</div></div>
      <div class="card stat danger"><div class="k">${m.revenue_at_risk || 0}</div><div class="l">Revenue at risk</div></div>
      <div class="card stat"><div class="k">${m.conversion_rate || 0}%</div><div class="l">Referral → started</div></div>
      <div class="card stat"><div class="k">${m.tasks_due_today || 0}</div><div class="l">Due today</div></div></div>
    <div class="card"><div class="section-title" style="margin-top:0">Recent activity</div>${recent || '<div class="empty">No recent activity</div>'}</div>`);
  $('#content').querySelectorAll('[data-goto]').forEach(a => a.onclick = () => renderWorkspace(a.dataset.goto));
}

let LEADS_CACHE = [];
async function wsLeads(wrap) {
  const { stages, leads } = await api('/workspace/leads');
  LEADS_CACHE = leads;
  const HOURS = (iso) => iso ? (Date.now() - Date.parse(iso)) / 36e5 : 1e9;
  const flagFor = (l, sname) => {
    const f = [];
    if (['New Inquiry', 'Contacted'].includes(sname) && HOURS(l.last_contact_at) > 48) f.push('<span class="chip red">Follow-up needed</span>');
    if (sname === 'Authorization' && HOURS(l.last_contact_at) > 72) f.push('<span class="chip red">Revenue at risk</span>');
    if (sname === 'Assessment') f.push('<span class="chip amber">Assessment</span>');
    return f.join('');
  };
  const cols = stages.map(s => {
    const items = leads.filter(l => l.stage_id === s.id);
    return `<div class="kcol" data-stage="${s.id}">
      <div class="kcol-h">${esc(s.name)}<span class="ct">${items.length}</span></div>
      <div class="kbody" data-stage="${s.id}">${items.map(l => `<div class="kcard" draggable="true" data-lead="${l.id}">
        <div class="nm">${esc(l.contact_name)}</div><div class="mt">${esc(l.client_name)} · ${esc(l.referral_source || '')}</div>
        <div class="row">${flagFor(l, s.name)}${l.assigned_name ? `<span class="who" title="${esc(l.assigned_name)}">${initials(l.assigned_name)}</span>` : ''}</div>
      </div>`).join('')}</div></div>`;
  }).join('');
  wrap(`<div class="page-head" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1>Lead Pipeline</h1><p>${leads.length} prospective clients. Drag cards between stages.</p></div>
      <button class="btn btn-primary" id="newLead">+ New Lead</button></div>
    <div class="kanban">${cols}</div>`);
  $('#newLead').onclick = () => newLeadModal(stages);
  $('#content').querySelectorAll('[data-lead]').forEach(c => {
    c.onclick = () => leadDrawer(c.dataset.lead);
    c.ondragstart = (e) => { e.dataTransfer.setData('lead', c.dataset.lead); c.classList.add('drag'); };
    c.ondragend = () => c.classList.remove('drag');
  });
  $('#content').querySelectorAll('.kbody').forEach(col => {
    col.ondragover = (e) => e.preventDefault();
    col.ondrop = async (e) => { e.preventDefault(); const lid = e.dataTransfer.getData('lead'); await api('/workspace/leads/' + lid, { method: 'PATCH', body: { stage_id: col.dataset.stage } }); toast('Lead moved'); wsLeads(wrap); };
  });
}

async function leadDrawer(id) {
  const d = await api('/workspace/leads/' + id);
  const l = d.lead;
  const bg = document.createElement('div'); bg.className = 'drawer-bg';
  const timeline = d.timeline.map(t => `<div class="tl"><div class="d">${fmtDate(t.created_at)} · ${new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div class="e">${esc(t.summary)}</div></div>`).join('') || '<div class="empty">No activity yet</div>';
  const tasks = d.tasks.map(t => `<div class="field-row"><span class="l">${esc(t.title)}</span><span class="v"><span class="pill ${t.status === 'completed' ? 'green' : 'amber'}">${esc(t.status)}</span></span></div>`).join('') || '<div class="empty">No tasks</div>';
  const msgs = d.messages.map(msg => `<div class="msg ${msg.direction === 'out' ? 'out' : 'in'}"><div>${esc(msg.body)}</div><div class="meta">${(msg.channel || '').toUpperCase()} · ${fmtDate(msg.created_at)} · ${esc(MSG_LABEL(msg.status))}</div></div>`).join('') || '<div class="empty">No messages</div>';
  bg.innerHTML = `<div class="drawer"><div class="drawer-h"><span class="x" id="dx">×</span>
      <h2 style="font-size:20px">${esc(l.contact_name)}</h2>
      <p style="color:var(--muted);margin-top:3px">Client: ${esc(l.client_name)} · ${esc(l.phone || '')}</p>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="convert">Convert to Client</button><button class="btn btn-ghost btn-sm" id="addTask">+ Task</button></div></div>
    <div class="drawer-b">
      <div class="tabs"><button class="active" data-tab="overview">Overview</button><button data-tab="timeline">Timeline</button><button data-tab="messages">Messages</button><button data-tab="tasks">Tasks</button></div>
      <div data-panel="overview">
        <div class="field-row"><span class="l">Stage</span><span class="v">${esc(d.stages.find(s => s.id === l.stage_id)?.name || '')}</span></div>
        <div class="field-row"><span class="l">Assigned</span><span class="v">${esc(l.assigned_name || 'Unassigned')}</span></div>
        <div class="field-row"><span class="l">Email</span><span class="v">${esc(l.email || '—')}</span></div>
        <div class="field-row"><span class="l">Phone</span><span class="v">${esc(l.phone || '—')}</span></div>
        <div class="field-row"><span class="l">Referral source</span><span class="v">${esc(l.referral_source || '—')}</span></div>
        <div class="field-row"><span class="l">Insurance</span><span class="v">${esc(l.insurance || '—')}</span></div>
        <div class="field-row"><span class="l">Inquiry received</span><span class="v">${fmtDate(l.inquiry_at)}</span></div>
        <div class="field-row"><span class="l">Last contact</span><span class="v">${l.last_contact_at ? ago(l.last_contact_at) : 'never'}</span></div>
        <div class="section-title">Notes</div><div style="font-size:13.5px;color:var(--body)">${esc(l.notes || '—')}</div>
      </div>
      <div data-panel="timeline" class="hidden"><div class="timeline">${timeline}</div></div>
      <div data-panel="messages" class="hidden">${msgs}<div style="display:flex;gap:8px;margin-top:12px"><input id="msgbody" placeholder="Send a text…"><button class="btn btn-primary btn-sm" id="sendmsg">Send</button></div></div>
      <div data-panel="tasks" class="hidden">${tasks}</div>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  $('#dx', bg).onclick = close; bg.onclick = (e) => { if (e.target === bg) close(); };
  bg.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    bg.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
    bg.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  });
  $('#convert', bg).onclick = async () => { await api('/workspace/leads/' + id + '/convert', { method: 'POST' }); toast('Converted to client'); close(); renderWorkspace('leads'); };
  $('#addTask', bg).onclick = async () => { const title = prompt('Task title:'); if (title) { await api('/workspace/tasks', { method: 'POST', body: { title, entity_id: id } }); toast('Task added'); } };
  const send = $('#sendmsg', bg); if (send) send.onclick = async () => { const body = $('#msgbody', bg).value; if (!body) return; await api('/workspace/messages', { method: 'POST', body: { channel: 'sms', entity_id: id, body } }); toast('Message sent'); leadDrawer(id) && close(); };
}

function newLeadModal(stages) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal"><div class="modal-h">New Lead</div><div class="modal-b"><div class="form-grid">
    <div class="fld"><label>Parent/contact name *</label><input id="n_contact"></div>
    <div class="fld"><label>Client name</label><input id="n_client"></div>
    <div class="fld"><label>Phone</label><input id="n_phone"></div>
    <div class="fld"><label>Email</label><input id="n_email"></div>
    <div class="fld"><label>Referral source</label><input id="n_ref"></div>
    <div class="fld"><label>Insurance</label><input id="n_ins"></div>
  </div></div><div class="modal-f"><button class="btn btn-ghost" id="n_cancel">Cancel</button><button class="btn btn-primary" id="n_create">Create lead</button></div></div>`;
  document.body.appendChild(m);
  $('#n_cancel', m).onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
  $('#n_create', m).onclick = async () => { const contact = $('#n_contact', m).value.trim(); if (!contact) return toast('Name required');
    await api('/workspace/leads', { method: 'POST', body: { contact_name: contact, client_name: $('#n_client', m).value, phone: $('#n_phone', m).value, email: $('#n_email', m).value, referral_source: $('#n_ref', m).value, insurance: $('#n_ins', m).value } });
    m.remove(); toast('Lead created'); renderWorkspace('leads'); };
}

async function wsClients(wrap) {
  const { clients } = await api('/workspace/clients');
  const rows = clients.map(c => `<tr class="clickable" data-client="${c.id}"><td><b>${esc(c.client_name)}</b><div style="font-size:12px;color:var(--muted)">${esc(c.contact_name)}</div></td>
    <td>${c.address ? esc(c.address) : '<span style="color:var(--muted)">— add —</span>'} ${c.lat != null ? '<span class="pill green" style="margin-left:4px">📍 located</span>' : (c.address ? '<span class="pill amber" style="margin-left:4px">not located</span>' : '')}</td>
    <td>${esc(c.insurance || '—')}</td><td>${esc(c.assigned_name || '—')}</td><td><span class="pill ${c.stage === 'active' ? 'green' : 'blue'}">${esc(c.stage)}</span></td></tr>`).join('');
  wrap(`<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><h1>Clients</h1><p>${clients.length} active clients. Click a client to open their full record.</p></div>
      <button class="btn btn-primary" id="send_intake">✉ Send intake form</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table><thead><tr><th>Client</th><th>Home address</th><th>Insurance</th><th>Assigned</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  // Clicking a client opens the full chart. Setting the home address is still
  // there, as a button inside the record rather than the only thing a click
  // could do.
  $('#content').querySelectorAll('[data-client]').forEach(tr => tr.onclick = () => clientRecord(tr.dataset.client, wrap));
  const si = $('#send_intake'); if (si) si.onclick = () => sendIntakeModal();
}

// Share the practice's intake link, or email it to a family. The link is
// public on purpose -- a parent opens it on a phone with no account -- so the
// useful thing here is getting it to them, and recording that we did.
async function sendIntakeModal(lead) {
  let info;
  try { info = await api('/workspace/intake-link'); }
  catch (e) { toast('Could not build the intake link'); return; }

  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal" style="width:560px;max-width:94vw">
    <div class="modal-h">Send the intake form</div>
    <div class="modal-b">
      <p style="margin-top:0;color:var(--muted);font-size:13.5px">
        Families open this on a phone — no login. They can photograph both sides of their
        insurance card inside the form, and Relay opens the benefits check the moment it arrives.</p>
      <div class="fld"><label>Your intake link</label>
        <input id="il_url" readonly value="${esc(info.url)}" style="font-size:13px"></div>
      <button class="btn btn-ghost" id="il_copy" style="width:100%;margin-bottom:6px">Copy link</button>
      <div class="fld"><label>Or email it</label>
        <input id="il_email" type="email" placeholder="parent@example.com" value="${esc((lead && lead.email) || '')}"></div>
      <div class="fld"><label>Their name (optional)</label>
        <input id="il_name" value="${esc((lead && lead.contact_name) || '')}"></div>
    </div>
    <div class="modal-f">
      <button class="btn btn-ghost" id="il_close">Close</button>
      <button class="btn btn-primary" id="il_send">Send intake form</button>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $('#il_close', m).onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
  $('#il_copy', m).onclick = () => {
    const f = $('#il_url', m); f.select(); f.setSelectionRange(0, 99999);
    (navigator.clipboard ? navigator.clipboard.writeText(f.value) : Promise.reject())
      .then(() => toast('Link copied')).catch(() => { document.execCommand('copy'); toast('Link copied'); });
  };
  $('#il_send', m).onclick = async () => {
    const email = $('#il_email', m).value.trim();
    if (!email) { toast('Enter an email address'); return; }
    const btn = $('#il_send', m); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/workspace/intake-link/send', { method: 'POST',
        body: { email, name: $('#il_name', m).value.trim(), lead_id: lead ? lead.id : null } });
      close(); toast('Intake form sent to ' + email);
    } catch (e) { toast(e.message || 'Could not send'); btn.disabled = false; btn.textContent = 'Send intake form'; }
  };
}

// ---- Client record -----------------------------------------------------
// One chart: photo, intake detail, insurance, benefits, authorization with
// units and expiry, documents by category, and every message Relay has sent.
// All of it from a single /record call, so nothing on screen can disagree
// with anything else on screen.
const DOC_CATEGORIES = {
  intake: 'Intake', insurance: 'Insurance', authorizations: 'Authorizations',
  assessments: 'Assessments', treatment_plans: 'Treatment Plans', medical: 'Medical Records',
  consents: 'Consents', financial: 'Financial', referrals: 'Referrals',
  clinical: 'Clinical', other: 'Other',
};
const SERVICE_LINES = { aba: 'ABA', bh: 'Behavioral Health', ot: 'Occupational Therapy', st: 'Speech Therapy' };
const PHASES = { intake: 'Intake', assessment_auth: 'Assessment Authorization', assessment: 'Assessment', active: 'Active Client' };
const URGENCY_PILL = { critical: 'red', urgent: 'amber', attention: 'amber', ok: 'green', expired: 'red' };

async function clientRecord(clientId, wrap) {
  let d;
  try { d = await api('/workspace/clients/' + clientId + '/record'); }
  catch (e) { toast('Could not open that record'); return; }
  const c = d.client;
  const ins = d.insurance[0] || null;
  const el = d.eligibility;
  const auth = d.current_authorization || d.authorizations[0] || null;
  const fmt = (v) => (v == null || v === '' ? '—' : esc(String(v)));
  const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString());
  const when = (t) => (t ? new Date(t).toLocaleDateString() : '—');

  const field = (label, val) => `<div style="min-width:150px"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">${label}</div><div style="font-weight:600">${val}</div></div>`;

  // Benefits: the numbers somebody phoned a payer to get. Worth showing in
  // full, because the alternative is phoning again.
  const benefits = el && el.status === 'verified' ? `
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px">
      ${field('Network', fmt(el.network_status === 'in_network' ? 'In network' : el.network_status))}
      ${field('Deductible', money(el.deductible) + ' <span style="font-weight:400;color:var(--muted)">(' + money(el.deductible_remaining) + ' left)</span>')}
      ${field('Copay', money(el.copay))}
      ${field('Coinsurance', el.coinsurance == null ? '—' : el.coinsurance + '%')}
      ${field('Out of pocket', money(el.oop_max) + ' <span style="font-weight:400;color:var(--muted)">(' + money(el.oop_remaining) + ' left)</span>')}
      ${field('Auth required', el.auth_required ? 'Yes' : 'No')}
      ${field('Visit limit', fmt(el.visit_limit))}
      ${field('Call reference', fmt(el.call_reference))}
    </div>` : `<div style="margin-top:8px;color:var(--muted);font-size:13px">${el && el.notes ? esc(el.notes) : 'Benefits not verified yet.'}</div>`;

  const docSections = Object.keys(d.documents).map(cat => `
    <div style="margin-bottom:10px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);margin-bottom:4px">${esc(DOC_CATEGORIES[cat] || cat)}</div>
      ${d.documents[cat].map(x => `<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid var(--line,#eee)">
        <span>${esc(x.label || x.filename)}${x.is_required ? ' <span class="pill blue" style="font-size:10px">required</span>' : ''}</span>
        <span style="color:var(--muted);font-size:12px">${when(x.created_at)}</span></div>`).join('')}
    </div>`).join('') || '<div style="color:var(--muted)">No documents yet.</div>';

  const mailRows = d.mailbox.map(m => `<div style="padding:7px 0;border-bottom:1px solid var(--line,#eee)">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <b>${esc(m.subject || '(no subject)')}</b>
        <span style="color:var(--muted);font-size:12px">${new Date(m.created_at).toLocaleString()}</span></div>
      <div style="font-size:12.5px;color:var(--muted)">to ${esc(m.to_addr || '—')} · ${esc(m.channel)} · <span class="pill ${m.status === 'sent' ? 'green' : 'amber'}" style="font-size:10px">${esc(m.status)}</span></div>
      <div style="font-size:12.5px;margin-top:2px">${esc(m.body || '')}</div>
    </div>`).join('') || '<div style="color:var(--muted)">Nothing sent yet.</div>';

  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal" style="width:900px;max-width:96vw">
    <div class="modal-h" style="display:flex;align-items:center;gap:12px">
      <img src="${esc(c.photo_url || '')}" alt="" style="width:48px;height:48px;border-radius:50%;background:#e5e7eb;object-fit:cover">
      <div style="flex:1">
        <div>${esc(c.client_name)}</div>
        <div style="font-size:12px;font-weight:400;color:var(--muted)">
          ${esc(SERVICE_LINES[c.service_line] || c.service_line || '')} · ${esc(PHASES[c.phase] || c.phase || '')}
          ${c.dob ? ' · DOB ' + esc(c.dob) : ''}
        </div>
      </div>
      ${auth && auth.urgency && auth.urgency !== 'ok' ? `<span class="pill ${URGENCY_PILL[auth.urgency] || 'amber'}">Auth ${auth.days_left < 0 ? 'expired' : auth.days_left + 'd left'}</span>` : ''}
    </div>
    <div class="modal-b" style="max-height:66vh;overflow:auto">
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px">
        ${field('Guardian', fmt(c.guardian_name) + (c.guardian_relationship ? ' <span style="font-weight:400;color:var(--muted)">(' + esc(c.guardian_relationship) + ')</span>' : ''))}
        ${field('Phone', fmt(c.phone))}
        ${field('Email', fmt(c.email))}
        ${field('Diagnosis', fmt(c.diagnosis))}
        ${field('Referral', fmt(c.referral_source))}
      </div>

      <div class="card" style="margin-bottom:12px">
        <b>Insurance &amp; Benefits</b>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:8px">
          ${field('Carrier', fmt(ins && ins.carrier))}
          ${field('Member ID', fmt(ins && ins.member_id))}
          ${field('Group', fmt(ins && ins.group_number))}
          ${field('Subscriber', fmt(ins && ins.subscriber_name))}
          ${field('Card on file', ins ? ((ins.card_front_path ? 'Front' : '') + (ins.card_back_path ? ' + Back' : ins.card_front_path ? ' <span class="pill amber" style="font-size:10px">back missing</span>' : '')) || '—' : '—')}
          ${field('Verification', `<span class="pill ${el && el.status === 'verified' ? 'green' : 'amber'}">${fmt(el && el.status)}</span>`)}
        </div>
        ${benefits}
      </div>

      ${auth ? `<div class="card" style="margin-bottom:12px">
        <b>Authorization</b>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:8px">
          ${field('Type', fmt(auth.kind))}
          ${field('Status', `<span class="pill ${auth.status === 'approved' ? 'green' : 'amber'}">${fmt(auth.status)}</span>`)}
          ${field('Auth #', fmt(auth.auth_number))}
          ${field('CPT', fmt(auth.cpt_codes))}
          ${field('Units', auth.approved_units == null ? '—' : `${auth.units_remaining} left <span style="font-weight:400;color:var(--muted)">of ${auth.approved_units}</span>`)}
          ${field('Dates', `${when(auth.start_date)} – ${when(auth.end_date)}`)}
          ${field('Expires in', auth.days_left == null ? '—' : `<span class="pill ${URGENCY_PILL[auth.urgency] || 'green'}">${auth.days_left} days</span>`)}
        </div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="card"><b>Documents</b> <span style="color:var(--muted);font-size:12px">(${d.document_count})</span>
          <div style="margin-top:8px">${docSections}</div></div>
        <div class="card"><b>Outgoing mail</b> <span style="color:var(--muted);font-size:12px">(${d.mailbox.length})</span>
          <div style="margin-top:8px;max-height:340px;overflow:auto">${mailRows}</div></div>
      </div>
    </div>
    <div class="modal-f">
      <button class="btn btn-ghost" id="cr_addr">Home address</button>
      <button class="btn btn-primary" id="cr_close">Close</button>
    </div></div>`;
  document.body.appendChild(m);
  $('#cr_close', m).onclick = () => m.remove();
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  // The address editor this click used to open, preserved.
  $('#cr_addr', m).onclick = () => { m.remove(); clientAddress(c, wrap); };
}

function clientAddress(c, wrap) {
  {
    const m = document.createElement('div'); m.className = 'modal-bg';
    m.innerHTML = `<div class="modal"><div class="modal-h">${esc(c.client_name)} — home address</div><div class="modal-b">
      <div class="fld"><label>Street address</label><input id="cl_addr" value="${esc(c.address || '')}" placeholder="1420 E Charleston Blvd, Las Vegas NV"></div>
      <div class="fld"><label>ZIP</label><input id="cl_zip" value="${esc(c.zip || '')}" placeholder="89101"></div>
      <p style="font-size:12.5px;color:var(--muted)">On save, Relay converts the address to map coordinates automatically.</p>
      </div><div class="modal-f"><button class="btn btn-ghost" id="cl_cancel">Cancel</button><button class="btn btn-primary" id="cl_save">Save &amp; locate</button></div></div>`;
    document.body.appendChild(m);
    $('#cl_cancel', m).onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
    $('#cl_save', m).onclick = async () => {
      $('#cl_save', m).textContent = 'Locating…';
      const r = await api('/workspace/clients/' + c.id, { method: 'PATCH', body: { address: $('#cl_addr', m).value, zip: $('#cl_zip', m).value } });
      m.remove(); toast(r.geocoded ? '📍 Located on map' : 'Saved — could not locate right now (try again in a moment)'); wsClients(wrap);
    };
  }
}

async function wsTasks(wrap) {
  const { tasks } = await api('/workspace/tasks');
  const now = Date.now();
  const row = (t) => `<div class="attn-item"><input type="checkbox" style="width:auto" data-task="${t.id}" ${t.status === 'completed' ? 'checked' : ''}>
    <span class="tx" style="${t.status === 'completed' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}<div style="font-size:12px;color:var(--muted);font-weight:400">${esc(t.category || '')} · ${esc(t.owner_name || '')}${t.auto_generated ? ' · <span style="color:var(--brand)">auto</span>' : ''}</div></span>
    <span class="go" style="color:${t.due_at && Date.parse(t.due_at) < now && t.status !== 'completed' ? 'var(--red)' : 'var(--muted)'}">${t.due_at && Date.parse(t.due_at) < now && t.status !== 'completed' ? 'Overdue' : fmtDate(t.due_at)}</span></div>`;
  wrap(`<div class="page-head"><h1>Tasks &amp; Alerts</h1><p>${tasks.filter(t => t.status !== 'completed').length} open.</p></div>
    <div class="attn">${tasks.map(row).join('') || '<div class="empty">No tasks</div>'}</div>`);
  $('#content').querySelectorAll('[data-task]').forEach(cb => cb.onchange = async () => { await api('/workspace/tasks/' + cb.dataset.task, { method: 'PATCH', body: { status: cb.checked ? 'completed' : 'open' } }); toast('Task updated'); wsTasks(wrap); });
}

async function wsInbox(wrap) {
  const { messages } = await api('/workspace/inbox');
  const rows = messages.map(m => `<div class="attn-item"><span class="ic ${m.channel === 'sms' ? 'green' : 'blue'}">${m.channel === 'sms' ? '💬' : '✉'}</span>
    <span class="tx">${esc(m.body).slice(0, 90)}<div style="font-size:12px;color:var(--muted);font-weight:400">${(m.channel || '').toUpperCase()} · ${m.direction === 'in' ? 'Received' : 'Sent'} · ${ago(m.created_at)}</div></span>
    <span class="pill ${m.direction === 'in' ? 'amber' : m.status === 'failed' ? 'red' : 'gray'}">${m.direction === 'in' ? 'Incoming' : MSG_LABEL(m.status)}</span></div>`).join('') || '<div class="empty">No messages yet</div>';
  wrap(`<div class="page-head"><h1>Relay Inbox</h1><p>All email &amp; text across your practice.</p></div><div class="attn">${rows}</div>`);
}

const STEP_LABEL = (s) => s.action === 'send_email' ? '✉ email' : s.action === 'send_sms' ? '💬 text' : s.action === 'create_task' ? '✓ task' : s.action === 'alert' ? '⚠ alert' : s.wait_hours != null ? '⏱ wait ' + s.wait_hours + 'h' : s.condition ? '? if ' + s.condition.replace(/_/g, ' ') : (s.action || '');
const RUN_ICON = { triggered: '▶', success: '✓', wait: '⏱', condition_pass: '✓', condition_stop: '⛔', error: '⚠' };
async function wsAutomations(wrap) {
  const { automations, runs } = await api('/workspace/automations');
  const autos = automations.map(a => `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
    <div><b>${esc(a.name)}</b><div style="font-size:12.5px;color:var(--muted)">When: ${esc(a.trigger)} · ${a.steps.length} steps</div></div>
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn btn-ghost btn-sm" data-sim="${a.id}" ${a.is_on ? '' : 'disabled title="Turn on to run"'}>▶ Simulate</button>
      <label style="display:flex;align-items:center;gap:7px;font-size:13px"><input type="checkbox" style="width:auto" data-auto="${a.id}" ${a.is_on ? 'checked' : ''}> ${a.is_on ? 'On' : 'Off'}</label></div></div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">${a.steps.map(s => `<span class="pill ${s.action ? 'tint' : s.wait_hours != null ? 'blue' : 'amber'}">${esc(STEP_LABEL(s))}</span>`).join('<span style="color:var(--muted)">→</span>')}</div></div>`).join('');
  const log = runs.map(r => `<div class="field-row"><span class="l"><span style="color:var(--brand)">${RUN_ICON[r.status] || '•'}</span> ${esc(r.detail)}</span><span class="v" style="font-weight:400;color:var(--muted)">${ago(r.created_at)}</span></div>`).join('') || '<div class="empty">No runs yet — hit “Simulate” on an automation.</div>';
  wrap(`<div class="page-head"><h1>Automations</h1><p>Trigger → wait → condition → action. The engine runs in the background so your team doesn't have to remember.</p></div>
    <div class="grid cols-2"><div>${autos}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Automation log <span class="pill green" style="margin-left:6px">● engine live</span></div>${log}</div></div>`);
  $('#content').querySelectorAll('[data-auto]').forEach(cb => cb.onchange = async () => { await api('/workspace/automations/' + cb.dataset.auto, { method: 'PATCH', body: { is_on: cb.checked } }); toast('Automation ' + (cb.checked ? 'on' : 'off')); wsAutomations(wrap); });
  $('#content').querySelectorAll('[data-sim]').forEach(b => b.onclick = async () => {
    b.textContent = 'Running…'; b.disabled = true;
    const r = await api('/workspace/automations/' + b.dataset.sim + '/simulate', { method: 'POST' });
    toast(r.ok ? `Ran “${r.automation}” on a lead` : 'Add a lead first'); wsAutomations(wrap);
  });
}

// ---- RBT Supervision (BACB 5% tracking) ----
const STATUS_META = { met: ['green', 'On track'], at_risk: ['amber', 'At risk'], behind: ['red', 'Behind'], no_hours: ['gray', 'No hours'] };
async function wsSupervision(wrap, period) {
  period = period || new Date().toISOString().slice(0, 7);
  const d = await api('/workspace/supervision?period=' + period);
  const rows = d.rbts.map(r => {
    const [cls, label] = STATUS_META[r.status] || ['gray', r.status];
    const pctReq = r.required_hours ? Math.min(100, Math.round(r.supervised_hours / r.required_hours * 100)) : 0;
    return `<tr class="clickable" data-rbt="${r.rbt_user_id}">
      <td><b>${esc(r.name)}</b> <span class="pill gray">RBT</span></td>
      <td>${r.service_hours} h</td>
      <td>${r.required_hours} h <span style="color:var(--muted);font-size:12px">(5%)</span></td>
      <td>${r.supervised_hours} h
        <div style="height:6px;background:var(--soft);border-radius:4px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${pctReq}%;background:${cls === 'red' ? 'var(--red)' : cls === 'amber' ? 'var(--amber)' : 'var(--brand)'}"></div></div></td>
      <td>${r.contacts} <span style="color:var(--muted);font-size:12px">(${r.individual_contacts} ind.)</span></td>
      <td><span class="pill ${cls}">${label}</span></td></tr>`;
  }).join('') || '<tr><td colspan="6"><div class="empty">No RBTs yet. Set staff credential to "RBT" and upload timecards.</div></td></tr>';
  const behind = d.rbts.filter(r => r.status === 'behind').length;
  wrap(`<div class="page-head" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1>RBT Supervision</h1><p>BACB requires ≥5% of each RBT's monthly service hours be supervised (≥2 contacts, ≥1 individual).</p></div>
      <div style="display:flex;gap:10px;align-items:center">
        <input type="month" id="supPeriod" value="${period}" style="width:auto">
        <button class="btn btn-ghost" id="upTimecards">⬆ Upload timecards</button>
        <button class="btn btn-primary" id="logSup">+ Log supervision</button></div></div>
    ${behind ? `<div class="attn" style="margin-bottom:16px"><div class="attn-item"><span class="ic red">🎓</span><span class="tx"><b>${behind} RBT${behind > 1 ? 's are' : ' is'}</b> below the 5% supervision requirement for ${period}. Log sessions before month-end to stay compliant.</span></div></div>` : ''}
    <div class="card" style="padding:0;overflow-x:auto"><table>
      <thead><tr><th>RBT</th><th>Service hours</th><th>Required</th><th>Supervised</th><th>Contacts</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:12px">Click an RBT to see their supervision sessions this month.</p>`);
  $('#supPeriod').onchange = (e) => wsSupervision(wrap, e.target.value);
  $('#upTimecards').onclick = () => timecardModal(period, wrap);
  $('#logSup').onclick = () => logSupervisionModal(d, period, wrap);
  $('#content').querySelectorAll('[data-rbt]').forEach(tr => tr.onclick = () => {
    const r = d.rbts.find(x => x.rbt_user_id === tr.dataset.rbt);
    const list = r.sessions.map(s => `<div class="field-row"><span class="l">${fmtDate(s.date)} · ${esc(s.supervisor_name || '')} · ${esc(s.type)}</span><span class="v">${s.duration_hours} h</span></div>`).join('') || '<div class="empty">No sessions logged yet</div>';
    const bg = document.createElement('div'); bg.className = 'drawer-bg';
    bg.innerHTML = `<div class="drawer"><div class="drawer-h"><span class="x">×</span><h2 style="font-size:20px">${esc(r.name)}</h2><p style="color:var(--muted)">${r.supervised_hours}h supervised of ${r.required_hours}h required · ${r.service_hours}h service</p></div><div class="drawer-b"><div class="section-title" style="margin-top:0">Supervision sessions — ${period}</div>${list}</div></div>`;
    document.body.appendChild(bg); bg.querySelector('.x').onclick = () => bg.remove(); bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  });
}
function timecardModal(period, wrap) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal"><div class="modal-h">Upload timecards — ${period}</div><div class="modal-b">
    <p style="font-size:13.5px;color:var(--muted);margin-bottom:12px">Upload a CSV or paste rows as <b>email,hours</b> (one RBT per line). This sets each RBT's total service hours for the month.</p>
    <div class="fld"><label>CSV file</label><input type="file" id="tc_file" accept=".csv,text/csv"></div>
    <div class="fld"><label>Or paste</label><textarea id="tc_csv" rows="6" placeholder="priya@relaydemo.com,120&#10;marcus@relaydemo.com,90"></textarea></div>
    </div><div class="modal-f"><button class="btn btn-ghost" id="tc_cancel">Cancel</button><button class="btn btn-primary" id="tc_import">Import</button></div></div>`;
  document.body.appendChild(m);
  $('#tc_cancel', m).onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
  $('#tc_file', m).onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $('#tc_csv', m).value = rd.result; }; rd.readAsText(f); };
  $('#tc_import', m).onclick = async () => { const csv = $('#tc_csv', m).value.trim(); if (!csv) return toast('Add some rows');
    const r = await api('/workspace/supervision/timecards', { method: 'POST', body: { csv, period } });
    m.remove(); toast(`Imported ${r.imported} timecard(s)` + (r.skipped.length ? ` · ${r.skipped.length} unmatched` : '')); wsSupervision(wrap, period); };
}
function logSupervisionModal(d, period, wrap) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  const rbtOpts = d.rbts.map(r => `<option value="${r.rbt_user_id}">${esc(r.name)}</option>`).join('');
  const supOpts = d.supervisors.map(s => `<option value="${s.id}">${esc(s.name)} (${s.credential})</option>`).join('') || '<option value="">— add a BCBA —</option>';
  m.innerHTML = `<div class="modal"><div class="modal-h">Log supervision session</div><div class="modal-b"><div class="form-grid">
    <div class="fld"><label>RBT</label><select id="s_rbt">${rbtOpts}</select></div>
    <div class="fld"><label>Supervisor (BCBA)</label><select id="s_sup">${supOpts}</select></div>
    <div class="fld"><label>Date</label><input type="date" id="s_date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="fld"><label>Duration (hours)</label><input type="number" id="s_dur" step="0.25" value="1"></div>
    <div class="fld"><label>Type</label><select id="s_type"><option value="individual">Individual</option><option value="group">Group</option></select></div>
    <div class="fld"><label>Method</label><select id="s_method"><option value="in_person">In person</option><option value="remote">Remote</option></select></div>
    <div class="fld full"><label>Notes</label><textarea id="s_notes" rows="2"></textarea></div>
    </div></div><div class="modal-f"><button class="btn btn-ghost" id="s_cancel">Cancel</button><button class="btn btn-primary" id="s_save">Log session</button></div></div>`;
  document.body.appendChild(m);
  $('#s_cancel', m).onclick = () => m.remove(); m.onclick = (e) => { if (e.target === m) m.remove(); };
  $('#s_save', m).onclick = async () => { await api('/workspace/supervision/sessions', { method: 'POST', body: {
    rbt_user_id: $('#s_rbt', m).value, supervisor_user_id: $('#s_sup', m).value, date: $('#s_date', m).value,
    duration_hours: $('#s_dur', m).value, type: $('#s_type', m).value, method: $('#s_method', m).value, notes: $('#s_notes', m).value } });
    m.remove(); toast('Supervision logged'); wsSupervision(wrap, period); };
}

// ---- Staff Maps (proximity) ----
async function wsMaps(wrap) {
  const { staff, clients, pending } = await api('/workspace/maps');
  const clientOpts = clients.map(c => `<option value="${c.id}">${esc(c.name)} — ${esc(c.zip || '')}</option>`).join('');
  const pendCount = (pending?.clients || 0) + (pending?.staff || 0);
  wrap(`<div class="page-head" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1>Staff Maps</h1><p>See which staff live closest to a client's home — for assigning in-home RBTs.</p></div>
      ${pendCount ? `<button class="btn btn-ghost" id="geocodeBtn">⌖ Geocode ${pendCount} pending address${pendCount > 1 ? 'es' : ''}</button>` : ''}</div>
    <div class="grid" style="grid-template-columns:340px 1fr;gap:16px">
      <div class="card">
        <label style="font-size:12.5px;font-weight:600;color:var(--ink)">Client</label>
        <select id="mapClient" style="margin:6px 0 14px">${clientOpts}</select>
        <div class="section-title" style="margin-top:0">Closest staff</div>
        <div id="nearList"></div>
      </div>
      <div class="card" style="padding:0;overflow:hidden"><div id="map" style="height:520px;width:100%;background:var(--soft)"></div></div>
    </div>`);
  const miles = (a, b, c, d) => { const R = 3958.8, r = x => x * Math.PI / 180; const dLat = r(c - a), dLng = r(d - b); const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  let map, markers = [];
  function initMap() {
    if (typeof L === 'undefined') { $('#map').innerHTML = '<div class="empty">Map library loading… the proximity list on the left works regardless.</div>'; return; }
    map = L.map('map').setView([36.12, -115.17], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
  }
  function render(clientId) {
    const c = clients.find(x => x.id === clientId); if (!c) return;
    const ranked = staff.map(s => ({ ...s, mi: miles(c.lat, c.lng, s.lat, s.lng) })).sort((a, b) => a.mi - b.mi);
    $('#nearList').innerHTML = ranked.map((s, i) => `<div class="attn-item" style="padding:10px 0">
      <span class="avatar" style="background:${i === 0 ? 'var(--brand)' : 'var(--tint)'};color:${i === 0 ? '#fff' : 'var(--strong)'}">${initials(s.name)}</span>
      <span class="tx">${esc(s.name)} <span class="pill gray">${esc(s.credential)}</span><div style="font-size:12px;color:var(--muted);font-weight:400">${esc(s.zip || '')}</div></span>
      <span class="go" style="color:${i === 0 ? 'var(--brand)' : 'var(--muted)'}">${s.mi.toFixed(1)} mi</span></div>`).join('');
    if (!map) return;
    markers.forEach(m => map.removeLayer(m)); markers = [];
    const cm = L.marker([c.lat, c.lng]).addTo(map).bindPopup('<b>' + c.name + '</b><br>Client home'); markers.push(cm);
    ranked.forEach((s, i) => { const mk = L.circleMarker([s.lat, s.lng], { radius: 9, color: '#fff', weight: 2, fillColor: i === 0 ? '#3E7C5D' : '#9FC5AC', fillOpacity: 1 }).addTo(map).bindPopup(`<b>${s.name}</b> (${s.credential})<br>${s.mi.toFixed(1)} mi away`); markers.push(mk); });
    map.setView([c.lat, c.lng], 11);
  }
  setTimeout(() => { initMap(); if (clients[0]) render(clients[0].id); }, 300);
  $('#mapClient').onchange = (e) => render(e.target.value);
  const gb = $('#geocodeBtn');
  if (gb) gb.onclick = async () => {
    gb.textContent = 'Locating addresses…'; gb.disabled = true;
    const r = await api('/workspace/maps/geocode', { method: 'POST' });
    toast(`Located ${r.clients_located + r.staff_located} address${r.clients_located + r.staff_located === 1 ? '' : 'es'}` + (r.failed ? ` · ${r.failed} not found` : ''));
    wsMaps(wrap);
  };
}

function setupSearch() {
  const inp = $('#gsearch'); if (!inp) return;
  const box = $('#sresults'); let t;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const q = inp.value.trim(); if (!q) { box.classList.add('hidden'); return; }
    const { results } = await api('/workspace/search?q=' + encodeURIComponent(q));
    if (!results.length) { box.innerHTML = '<a>No results</a>'; box.classList.remove('hidden'); return; }
    box.innerHTML = results.map(r => `<a data-type="${r.type}" data-id="${r.id}"><span class="t">${r.type}</span> ${esc(r.contact_name || r.client_name || r.title)} <span style="color:var(--muted)">${esc(r.phone || r.email || '')}</span></a>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('a[data-type]').forEach(a => a.onclick = () => { box.classList.add('hidden'); inp.value = ''; if (a.dataset.type === 'lead') leadDrawer(a.dataset.id); else renderWorkspace(a.dataset.type === 'client' ? 'clients' : 'tasks'); });
  }, 200); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) box.classList.add('hidden'); });
}

boot();
