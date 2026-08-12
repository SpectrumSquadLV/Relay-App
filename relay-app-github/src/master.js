// ============================================================
// Relay Master Template + Organization provisioning
// The Master Template is the default config every new org inherits.
// Editable by the super admin. Provisioning COPIES it into org-scoped
// rows so each org can then customize without affecting others.
// ============================================================
const { db, run, get, all, Repo, id, now } = require('./db');
const { createUser, userByEmail } = require('./auth');
const crypto = require('crypto');

const DEFAULT_TEMPLATE = {
  lead_stages: ['New Inquiry','Contacted','Consultation','Insurance Verification','Assessment','Authorization','Scheduling','Started Services','Lost'],
  client_stages: ['Onboarding','Active','On Hold','Discharged'],
  task_types: ['Call','Email','Text','Document','Assessment','Authorization','Scheduling','General'],
  email_templates: [
    { name: 'Welcome / Inquiry received', subject: 'Thanks for reaching out to {{company_name}}', body: 'Hi {{parent_first_name}},\n\nThanks for contacting {{company_name}} about services for {{client_first_name}}. We received your inquiry and a member of our team will reach out shortly.\n\n— {{company_name}}' },
    { name: 'Assessment complete — next steps', subject: 'Next steps for {{client_first_name}}', body: 'Hi {{parent_first_name}},\n\nGreat news — {{client_first_name}}\'s assessment is complete. Here are the next steps...' },
    { name: 'Authorization approved', subject: 'We\'re ready to schedule', body: 'Hi {{parent_first_name}},\n\nAuthorization is approved and we\'re ready to schedule {{client_first_name}}\'s first day.' },
  ],
  text_templates: [
    { name: 'Inquiry confirmation', body: 'Hi {{parent_first_name}}, this is {{staff_name}} from {{company_name}}. We got your inquiry about {{client_first_name}} and will follow up shortly!' },
    { name: 'No-response follow-up', body: 'Hi {{parent_first_name}}, just checking in from {{company_name}} — is now still a good time to get {{client_first_name}} started?' },
    { name: 'Assessment reminder', body: 'Reminder: {{client_first_name}}\'s assessment with {{company_name}} is tomorrow. Reply YES to confirm.' },
  ],
  automations: [
    { name: 'Welcome new lead', trigger: 'lead.created', steps: [ {action:'send_email', template:'Welcome / Inquiry received'}, {wait_hours:24}, {condition:'no_response'}, {action:'send_sms', template:'No-response follow-up'}, {wait_hours:48}, {action:'create_task', title:'Call parent — no response'} ] },
    { name: 'Assessment complete', trigger: 'assessment.completed', steps: [ {action:'send_email', template:'Assessment complete — next steps'}, {action:'create_task', title:'Treatment plan due'} ] },
    { name: 'Authorization → scheduling', trigger: 'authorization.received', steps: [ {condition:'no_first_day_in_days', days:3}, {action:'alert', title:'Revenue at Risk — schedule first day'} ] },
  ],
  roles: ['owner','admin','manager','staff'],
  default_permissions: { staff:['view_leads','view_clients','send_messages'], manager:['view_leads','view_clients','send_messages','view_reports'], admin:['*'], owner:['*'] },
  dashboard_widgets: ['needs_attention','new_leads','tasks_due','overdue_tasks','awaiting_auth','conversion_rate','avg_days_to_start','revenue_at_risk','recent_activity'],
  notification_defaults: { email: true, sms: false, in_app: true },
  tags: [ {name:'Priority', color:'#B4432F'}, {name:'Warm', color:'#B9791A'}, {name:'Insurance pending', color:'#2C5E8A'}, {name:'VIP', color:'#3E7C5D'} ],
  lead_sources: ['Pediatrician referral','Insurance directory','Google search','Friend / family','Facebook','Website form','Other provider'],
  custom_fields: [ {entity:'lead', name:'Diagnosis', type:'text'}, {entity:'lead', name:'Preferred schedule', type:'text'} ],
  feature_flags: { sms_messaging:true, advanced_automations:true, ai_features:false, analytics:true, custom_branding:true, multiple_pipelines:false, rbt_supervision:true, staff_maps:true },
};

function getMasterTemplate() {
  const row = get(`SELECT config_json FROM master_template WHERE id=1`);
  if (!row) { run(`INSERT INTO master_template (id, config_json) VALUES (1, ?)`, [JSON.stringify(DEFAULT_TEMPLATE)]); return { ...DEFAULT_TEMPLATE }; }
  return JSON.parse(row.config_json);
}
function setMasterTemplate(cfg) {
  run(`INSERT INTO master_template (id, config_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json`, [JSON.stringify(cfg)]);
  return cfg;
}

function slugify(s){ return (s||'org').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,40) || 'org'; }
function uniqueSlug(base){ let s=slugify(base), n=1; while(get(`SELECT 1 FROM organizations WHERE slug=?`,[s])){ s=slugify(base)+'-'+(++n); } return s; }

// Provision a NEW organization from the master template.
function provisionOrg(input) {
  const tpl = getMasterTemplate();
  const orgId = id();
  const slug = uniqueSlug(input.name);
  const trialDays = 14;
  const trialEnds = input.trial ? new Date(Date.now() + trialDays*864e5).toISOString() : null;
  const plan = input.plan_id ? get(`SELECT * FROM plans WHERE id=?`, [input.plan_id]) : get(`SELECT * FROM plans ORDER BY sort LIMIT 1`);

  run(`INSERT INTO organizations (id,name,slug,primary_contact,email,phone,website,address,logo,brand_color,industry,plan_id,subscription_status,trial_ends_at,mrr,status,is_demo,notes,created_at,last_activity_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orgId, input.name, slug, input.owner_name||'', input.owner_email||'', input.phone||'', input.website||'', input.address||'',
     input.logo||'', input.brand_color||'#3E7C5D', input.industry||'aba', plan?.id||null,
     input.trial ? 'trialing' : 'active', trialEnds, input.trial ? 0 : (plan?.monthly_price||0), 'active',
     input.is_demo?1:0, input.notes||'', now(), now()]);

  // settings
  run(`INSERT INTO organization_settings (organization_id, settings_json) VALUES (?,?)`,
    [orgId, JSON.stringify({ notifications: tpl.notification_defaults, email_signature:`— The ${input.name} team`, text_signature:`- ${input.name}`, custom_fields: tpl.custom_fields, default_permissions: tpl.default_permissions })]);

  // lead pipeline + stages
  const leadPipe = Repo.insert(orgId, 'pipelines', { name:'Lead Pipeline', type:'lead', sort:0 });
  tpl.lead_stages.forEach((n,i) => Repo.insert(orgId, 'pipeline_stages', { pipeline_id: leadPipe.id, name:n, sort:i, is_won: n==='Started Services'?1:0, is_lost: n==='Lost'?1:0 }));

  // templates
  tpl.email_templates.forEach(t => Repo.insert(orgId,'message_templates',{ channel:'email', name:t.name, subject:t.subject, body:t.body }));
  tpl.text_templates.forEach(t => Repo.insert(orgId,'message_templates',{ channel:'sms', name:t.name, subject:'', body:t.body }));

  // automations
  tpl.automations.forEach(a => Repo.insert(orgId,'automations',{ name:a.name, trigger:a.trigger, is_on:1, steps_json:JSON.stringify(a.steps), created_at:now() }));

  // tags + sources
  tpl.tags.forEach(t => Repo.insert(orgId,'tags',{ name:t.name, color:t.color }));
  tpl.lead_sources.forEach(n => Repo.insert(orgId,'lead_sources',{ name:n }));

  // feature flags (template defaults, overlaid by plan features)
  const planFeatures = plan?.features_json ? JSON.parse(plan.features_json) : {};
  const flags = { ...tpl.feature_flags, ...planFeatures };
  Object.entries(flags).forEach(([flag, enabled]) => Repo.insert(orgId,'feature_flags',{ flag, enabled: enabled?1:0 }));

  // owner user + membership
  let ownerUser = input.owner_email ? userByEmail(input.owner_email) : null;
  let tempPassword = null;
  if (!ownerUser && input.owner_email) {
    tempPassword = crypto.randomBytes(5).toString('hex');
    ownerUser = createUser({ email: input.owner_email, name: input.owner_name || input.owner_email, password: tempPassword });
  }
  if (ownerUser) Repo.insert(orgId,'organization_users',{ user_id: ownerUser.id, role:'owner', status:'active', created_at:now() });

  return { org: get(`SELECT * FROM organizations WHERE id=?`,[orgId]), ownerUser, tempPassword };
}

module.exports = { DEFAULT_TEMPLATE, getMasterTemplate, setMasterTemplate, provisionOrg, slugify };
