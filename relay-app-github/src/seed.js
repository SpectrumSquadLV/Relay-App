// ============================================================
// Bootstrap (plans, super admin, master template) + Relay Demo seed + reset
// ============================================================
const { db, run, get, all, Repo, id, now } = require('./db');
const { createUser, userByEmail } = require('./auth');
const { getMasterTemplate, provisionOrg } = require('./master');

const daysAgo = (d) => new Date(Date.now() - d*864e5).toISOString();
const daysFromNow = (d) => new Date(Date.now() + d*864e5).toISOString();

function bootstrap() {
  // Plans are sized by STAFF COUNT, not by capability.
  //
  // Every practice gets the whole product. A three-person clinic verifying
  // benefits needs the same automations, the same intake, the same
  // authorization tracking as a fifty-person group -- withholding those from
  // the smallest customers sells them a CRM that lets things fall through the
  // cracks, which is the opposite of the pitch. What scales with size is the
  // number of people using it, so that is what scales with price.
  //
  // Prices and band edges are the owner's to set; these carry over the
  // existing price points.
  const ALL_FEATURES = {
    sms_messaging: true, advanced_automations: true, ai_features: true,
    analytics: true, custom_branding: true, multiple_pipelines: true,
  };
  const PLANS = [
    // id, name, monthly, setup, max staff, sms, email, automations, sort, blurb
    ['solo',     'Solo',      19900,  75000,   5,  1000,  5000, 999, 0, 'Up to 5 staff'],
    ['practice', 'Practice',  39900, 150000,  20,  4000, 20000, 999, 1, '6 to 20 staff'],
    ['group',    'Group',     79900, 250000,  50, 12000, 60000, 999, 2, '21 to 50 staff'],
    ['network',  'Network',  129900, 350000, 999, 40000, 200000, 999, 3, '50+ staff'],
  ];
  const upsertPlan = (p) => {
    const row = [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], JSON.stringify(ALL_FEATURES), p[8], p[9]];
    if (get(`SELECT 1 FROM plans WHERE id=?`, [p[0]])) {
      run(`UPDATE plans SET name=?, monthly_price=?, setup_fee=?, max_users=?, sms_allowance=?,
             email_allowance=?, automation_limit=?, features_json=?, sort=? WHERE id=?`,
        [p[1], p[2], p[3], p[4], p[5], p[6], p[7], JSON.stringify(ALL_FEATURES), p[8], p[0]]);
    } else {
      run(`INSERT INTO plans (id,name,monthly_price,setup_fee,max_users,sms_allowance,email_allowance,automation_limit,features_json,sort)
           VALUES (?,?,?,?,?,?,?,?,?,?)`, row.slice(0, 10));
    }
  };
  PLANS.forEach(upsertPlan);

  // Retire the capability-tiered plans, without stranding anyone on them: an
  // organization still pointing at an old plan is moved to the size band that
  // matches what it was already paying for.
  const RETIRED = { starter: 'solo', growth: 'practice', pro: 'group' };
  for (const [oldId, newId] of Object.entries(RETIRED)) {
    if (!get(`SELECT 1 FROM plans WHERE id=?`, [oldId])) continue;
    const target = get(`SELECT monthly_price FROM plans WHERE id=?`, [newId]);
    run(`UPDATE organizations SET plan_id=?, mrr=? WHERE plan_id=?`, [newId, target.monthly_price, oldId]);
    run(`DELETE FROM plans WHERE id=?`, [oldId]);
  }
  getMasterTemplate(); // ensure row exists

  // super admin (Relay owner)
  const superEmail = process.env.SUPER_ADMIN_EMAIL || 'owner@relayitcrm.com';
  if (!userByEmail(superEmail)) {
    createUser({ email: superEmail, name: 'Relay Owner', password: process.env.SUPER_ADMIN_PASSWORD || 'relay-admin', isSuper: 1 });
  }

  // demo org
  if (!get(`SELECT 1 FROM organizations WHERE is_demo=1 LIMIT 1`)) {
    const { org } = provisionOrg({ name:'Relay Demo', owner_name:'Dana Rivera', owner_email:'dana@relaydemo.com', phone:'(702) 555-0142', website:'relaydemo.com', industry:'aba', plan_id:'practice', trial:false, is_demo:true });
    run(`UPDATE organizations SET mrr=39900 WHERE id=?`, [org.id]);
    seedDemoContent(org.id);
  }

  // Clinical layer for the demo practice: active clients across ABA,
  // Behavioural Health, OT and Speech with insurance, benefits verification,
  // authorizations, documents and communication history, plus a staff
  // directory with credentials at every stage of expiry.
  //
  // Outside the is_demo guard above and idempotent in its own right, so a
  // database seeded before this existed picks the clinical data up on its next
  // boot instead of staying half-populated forever.
  const demoOrg = get(`SELECT id FROM organizations WHERE is_demo=1 LIMIT 1`);
  if (demoOrg) {
    try { require('./clinical-demo').seedClinicalDemo(demoOrg.id); }
    catch (e) { console.error('clinical demo seed failed:', e.message); }
  }

  // a couple of extra sample customer orgs so the owner portal isn't empty
  if (get(`SELECT COUNT(*) c FROM organizations`).c < 3) {
    const a = provisionOrg({ name:'Bright Steps ABA', owner_name:'Maria Lopez', owner_email:'maria@brightsteps.example', phone:'(480) 555-0110', plan_id:'practice', trial:false });
    run(`UPDATE organizations SET mrr=39900, created_at=? WHERE id=?`, [daysAgo(52), a.org.id]);
    const b = provisionOrg({ name:'Cornerstone Home Health', owner_name:'James Okafor', owner_email:'james@cornerstone.example', phone:'(702) 555-0188', plan_id:'solo', trial:true });
    run(`UPDATE organizations SET created_at=?, last_activity_at=? WHERE id=?`, [daysAgo(9), daysAgo(6), b.org.id]);
  }
}

// name, email, role, credential, home_lat, home_lng, home_zip  (coords around Las Vegas)
const DEMO_STAFF = [
  ['Dana Rivera','dana@relaydemo.com','owner','BCBA',36.150,-115.300,'89135'],
  ['Jordan Lee','jordan@relaydemo.com','manager','BCBA',36.100,-115.120,'89104'],
  ['Priya Shah','priya@relaydemo.com','staff','RBT',36.050,-115.250,'89147'],
  ['Marcus Cole','marcus@relaydemo.com','staff','RBT',36.240,-115.260,'89149'],
  ['Elena Duran','elena@relaydemo.com','staff','RBT',36.020,-115.100,'89052'],
  ['Sam Park','sam@relaydemo.com','staff','RBT',36.190,-115.070,'89110'],
];

function ensureDemoStaff(orgId) {
  const { hashPassword } = require('./auth');
  const ids = [];
  for (const [name, email, role, credential, lat, lng, zip] of DEMO_STAFF) {
    let u = userByEmail(email);
    if (!u) u = createUser({ email, name, password: 'demo1234' });
    else run(`UPDATE users SET password_hash=? WHERE id=?`, [hashPassword('demo1234'), u.id]); // demo accounts: known password
    if (!get(`SELECT 1 FROM organization_users WHERE organization_id=? AND user_id=?`, [orgId, u.id]))
      Repo.insert(orgId,'organization_users',{ user_id:u.id, role, credential, title:credential, home_lat:lat, home_lng:lng, home_zip:zip, status:'active', created_at:daysAgo(120) });
    else run(`UPDATE organization_users SET credential=?, title=?, home_lat=?, home_lng=?, home_zip=? WHERE organization_id=? AND user_id=?`, [credential, credential, lat, lng, zip, orgId, u.id]);
    ids.push(u.id);
  }
  return ids; // [dana, jordan, priya, marcus, elena, sam]
}

// Populate the demo org with realistic fake CRM data.
function seedDemoContent(orgId) {
  const staff = ensureDemoStaff(orgId);
  const stages = Repo.list(orgId,'pipeline_stages','',[], 'ORDER BY sort');
  const S = Object.fromEntries(stages.map(s => [s.name, s.id]));
  const log = (entity_type,entity_id,kind,summary,user_id,at) => Repo.insert(orgId,'activity_logs',{ entity_type, entity_id, kind, summary, user_id, created_at:at||now() });
  const msg = (entity_id,channel,direction,body,at,extra={}) => Repo.insert(orgId,'messages',{ channel, direction, entity_type:'lead', entity_id, from_addr:extra.from||'', to_addr:extra.to||'', subject:extra.subject||'', body, status:extra.status||'sent', read_at:extra.read_at||null, user_id:extra.user_id||null, created_at:at });

  // ---- 15 leads across stages, with narrative flags ----
  const leads = [
    // #1 submitted yesterday, NOT contacted -> Follow-Up Needed
    { contact_name:'Amanda Reyes', client_name:'Mateo Reyes', phone:'(702) 555-0231', email:'amanda.reyes@example.com', referral_source:'Pediatrician referral', insurance:'Aetna', stage:'New Inquiry', assigned:null, inquiry:daysAgo(1), last:null, notes:'Submitted website inquiry. Not yet contacted.' },
    { contact_name:'Chris Bennett', client_name:'Ella Bennett', phone:'(702) 555-0248', email:'cbennett@example.com', referral_source:'Google search', insurance:'UnitedHealthcare', stage:'New Inquiry', assigned:null, inquiry:daysAgo(2), last:null, notes:'No outreach yet — 2 days old.' },
    { contact_name:'Dominique Carter', client_name:'Zoe Carter', phone:'(702) 555-0263', email:'dom.carter@example.com', referral_source:'Facebook', insurance:'Cigna', stage:'Contacted', assigned:2, inquiry:daysAgo(4), last:daysAgo(3), notes:'Left voicemail.' },
    // #4 3 outreach attempts, no response
    { contact_name:'Priscilla Nguyen', client_name:'Liam Nguyen', phone:'(702) 555-0277', email:'p.nguyen@example.com', referral_source:'Insurance directory', insurance:'Aetna', stage:'Contacted', assigned:3, inquiry:daysAgo(8), last:daysAgo(2), notes:'3 outreach attempts, no response.' },
    { contact_name:'Robert Fields', client_name:'Ava Fields', phone:'(702) 555-0284', email:'rfields@example.com', referral_source:'Other provider', insurance:'BCBS', stage:'Consultation', assigned:2, inquiry:daysAgo(6), last:daysAgo(1), notes:'Consultation booked for Thursday.' },
    { contact_name:'Tanya Brooks', client_name:'Noah Brooks', phone:'(702) 555-0299', email:'tbrooks@example.com', referral_source:'Friend / family', insurance:'UnitedHealthcare', stage:'Insurance Verification', assigned:4, inquiry:daysAgo(10), last:daysAgo(2), notes:'Verifying benefits.' },
    { contact_name:'Hassan Ali', client_name:'Sara Ali', phone:'(702) 555-0301', email:'hali@example.com', referral_source:'Pediatrician referral', insurance:'Cigna', stage:'Insurance Verification', assigned:4, inquiry:daysAgo(12), last:daysAgo(5), notes:'Waiting on insurance card.' },
    // #assessment completed -> treatment plan task
    { contact_name:'Grace Kim', client_name:'Ben Kim', phone:'(702) 555-0318', email:'gkim@example.com', referral_source:'Website form', insurance:'Aetna', stage:'Assessment', assigned:3, inquiry:daysAgo(16), last:daysAgo(2), notes:'Assessment completed 2 days ago — treatment plan due.' },
    { contact_name:'Victor Ramos', client_name:'Lucia Ramos', phone:'(702) 555-0322', email:'vramos@example.com', referral_source:'Google search', insurance:'BCBS', stage:'Assessment', assigned:2, inquiry:daysAgo(18), last:daysAgo(4), notes:'Assessment scheduled.' },
    // #authorization received, no first day -> revenue at risk
    { contact_name:'Nadia Petrova', client_name:'Alex Petrov', phone:'(702) 555-0335', email:'npetrova@example.com', referral_source:'Insurance directory', insurance:'UnitedHealthcare', stage:'Authorization', assigned:3, inquiry:daysAgo(24), last:daysAgo(4), notes:'Authorization received — no first day scheduled.' },
    { contact_name:'Owen Wallace', client_name:'Mila Wallace', phone:'(702) 555-0347', email:'owallace@example.com', referral_source:'Pediatrician referral', insurance:'Aetna', stage:'Authorization', assigned:2, inquiry:daysAgo(26), last:daysAgo(6), notes:'Auth submitted, pending payer.' },
    { contact_name:'Bianca Flores', client_name:'Theo Flores', phone:'(702) 555-0359', email:'bflores@example.com', referral_source:'Facebook', insurance:'Cigna', stage:'Scheduling', assigned:4, inquiry:daysAgo(28), last:daysAgo(1), notes:'Coordinating first session.' },
    { contact_name:'Derek Shaw', client_name:'Ivy Shaw', phone:'(702) 555-0361', email:'dshaw@example.com', referral_source:'Website form', insurance:'BCBS', stage:'Started Services', assigned:2, inquiry:daysAgo(35), last:daysAgo(3), notes:'Started last week.' },
    { contact_name:'Lauren Cho', client_name:'Max Cho', phone:'(702) 555-0372', email:'lcho@example.com', referral_source:'Friend / family', insurance:'Aetna', stage:'Lost', assigned:3, inquiry:daysAgo(40), last:daysAgo(20), notes:'Went with another provider.' },
    { contact_name:'Felix Turner', client_name:'Rosa Turner', phone:'(702) 555-0388', email:'fturner@example.com', referral_source:'Google search', insurance:'UnitedHealthcare', stage:'New Inquiry', assigned:null, inquiry:daysAgo(1), last:null, notes:'Fresh inquiry this morning.' },
  ];
  const leadIds = [];
  leads.forEach(l => {
    const row = Repo.insert(orgId,'leads',{ contact_name:l.contact_name, client_name:l.client_name, phone:l.phone, email:l.email,
      preferred_contact:'text', referral_source:l.referral_source, insurance:l.insurance, stage_id:S[l.stage],
      assigned_user_id: l.assigned!=null?staff[l.assigned]:null, status: l.stage==='Lost'?'lost':'open', notes:l.notes,
      inquiry_at:l.inquiry, last_contact_at:l.last, created_at:l.inquiry });
    leadIds.push(row.id);
    log('lead',row.id,'created','Inquiry received',null,l.inquiry);
    if (l.last) log('lead',row.id,'status','Stage: '+l.stage,l.assigned!=null?staff[l.assigned]:null,l.last);
  });

  // conversation history on a few leads
  msg(leadIds[0],'email','out','Hi Amanda, thanks for reaching out to Relay Demo about Mateo...',daysAgo(1),{subject:'Thanks for reaching out',status:'sent',user_id:null});
  msg(leadIds[3],'sms','out','Hi Priscilla, checking in from Relay Demo — is now a good time to get Liam started?',daysAgo(2),{status:'delivered'});
  msg(leadIds[3],'sms','out','Following up again — happy to answer any questions!',daysAgo(5),{status:'delivered'});
  msg(leadIds[7],'email','out','Ben\'s assessment is complete — here are the next steps.',daysAgo(2),{subject:'Next steps',status:'sent'});
  msg(leadIds[11],'sms','in','Yes! Friday works great for us. Thank you!',daysAgo(1),{status:'received'});

  // automation runs (activity to show the engine "working")
  Repo.insert(orgId,'automation_runs',{ automation_id:null, entity_type:'lead', entity_id:leadIds[0], status:'success', detail:'Sent welcome email', created_at:daysAgo(1) });
  Repo.insert(orgId,'automation_runs',{ automation_id:null, entity_type:'lead', entity_id:leadIds[3], status:'success', detail:'Sent no-response follow-up text', created_at:daysAgo(2) });
  Repo.insert(orgId,'automation_runs',{ automation_id:null, entity_type:'lead', entity_id:leadIds[9], status:'success', detail:'Created "Revenue at Risk" alert', created_at:daysAgo(3) });

  // tasks (some auto-generated, some overdue)
  const T = (title, leadIdx, owner, cat, due, status, auto) => Repo.insert(orgId,'tasks',{ title, entity_type:'lead', entity_id:leadIds[leadIdx], owner_user_id:staff[owner], priority: status==='open'&&due<now()?'high':'normal', category:cat, status, due_at:due, auto_generated:auto?1:0, created_at:daysAgo(3) });
  T('Call new inquiry — Amanda Reyes',0,2,'Call',daysAgo(0),'open',1);
  T('Contact Chris Bennett (2 days, no outreach)',1,2,'Call',daysAgo(1),'open',1);
  T('3rd follow-up — Priscilla Nguyen',3,3,'Text',daysAgo(1),'open',1);
  T('Treatment plan due — Ben Kim',7,3,'Document',daysFromNow(2),'open',1);
  T('Schedule first day — Alex Petrov (Revenue at Risk)',9,3,'Scheduling',daysAgo(1),'open',1);
  T('Verify benefits — Sara Ali',6,4,'Authorization',daysFromNow(1),'in_progress',0);
  T('Send consultation reminder — Ava Fields',4,2,'Email',daysFromNow(1),'open',0);

  // ---- 10 clients (converted) ----
  const clientNames = [
    ['Whitney Adams','Cara Adams','Aetna',0],['George Bell','Sam Bell','Cigna',3],['Helen Ortiz','Nia Ortiz','BCBS',2],
    ['Ivan Cruz','Leo Cruz','UnitedHealthcare',4],['Julia Park','Emma Park','Aetna',2],['Kevin Ross','Dylan Ross','Cigna',3],
    ['Lena Voss','Ari Voss','BCBS',4],['Mona Diaz','Kai Diaz','Aetna',2],['Nate Fox','Remy Fox','UnitedHealthcare',3],['Olive Grant','Sky Grant','Cigna',2],
  ];
  // client home locations spread across the Las Vegas valley (for the MAPS feature)
  const CLIENT_LOC = [
    [36.170,-115.140,'89101','1420 E Charleston Blvd'],[36.060,-115.240,'89147','7200 W Flamingo Rd'],
    [36.230,-115.250,'89149','6100 N Durango Dr'],[36.030,-115.090,'89052','2400 Green Valley Pkwy'],
    [36.140,-115.320,'89135','10800 W Charleston Blvd'],[36.190,-115.080,'89110','4300 E Bonanza Rd'],
    [36.010,-115.180,'89123','8900 S Eastern Ave'],[36.270,-115.200,'89131','7600 N Tenaya Way'],
    [36.100,-115.170,'89109','3200 Las Vegas Blvd'],[36.080,-115.290,'89148','9500 W Tropicana Ave'],
  ];
  clientNames.forEach((c,i) => { const L = CLIENT_LOC[i] || CLIENT_LOC[0]; Repo.insert(orgId,'clients',{ contact_name:c[0], client_name:c[1], phone:'(702) 555-0'+(400+i), email:c[0].toLowerCase().replace(/\W/g,'.')+'@example.com',
    insurance:c[2], assigned_user_id:staff[c[3]], stage: i<8?'active':'onboarding', address:L[3], zip:L[2], lat:L[0], lng:L[1], weekly_hours:[10,15,20,25][i%4],
    auth_start:daysAgo(30+i), auth_end:daysFromNow(150-i*5), assessment_date:daysAgo(45+i), treatment_plan_due:daysFromNow(i%3), first_day:daysAgo(20+i),
    notes:'Converted from lead. Active in services.', created_at:daysAgo(40+i) }); });

  // usage records for the owner portal
  const period = new Date().toISOString().slice(0,7);
  [['emails_sent',412],['sms_sent',188],['automations_triggered',96]].forEach(([m,v]) => Repo.insert(orgId,'usage_records',{ metric:m, value:v, period }));

  // ---- RBT supervision demo (staff: 0=Dana BCBA,1=Jordan BCBA,2=Priya,3=Marcus,4=Elena,5=Sam RBTs) ----
  const d = (n) => period + '-' + String(n).padStart(2,'0');
  const tc = (idx, hours) => Repo.insert(orgId,'rbt_timecards',{ rbt_user_id:staff[idx], period, service_hours:hours, source:'upload', created_at:now() });
  tc(2,120); tc(3,90); tc(4,60); tc(5,140);
  const ses = (rbt, sup, day, hrs, type) => Repo.insert(orgId,'supervision_sessions',{ rbt_user_id:staff[rbt], supervisor_user_id:staff[sup], date:d(day), period, duration_hours:hrs, type, method:'in_person', notes:'', created_at:now() });
  // Priya 120h → needs 6h: 7h across 2 contacts incl individual → MET
  ses(2,0,3,4,'individual'); ses(2,0,11,3,'group');
  // Marcus 90h → needs 4.5h: 5h, 2 contacts, 1 individual → MET
  ses(3,1,4,3,'individual'); ses(3,1,12,2,'group');
  // Elena 60h → needs 3h: only 1h, 1 contact → BEHIND (red alert)
  ses(4,0,6,1,'individual');
  // Sam 140h → needs 7h: 4.5h, 2 contacts → AT RISK
  ses(5,1,5,2.5,'individual'); ses(5,1,10,2,'group');
}

// Clear demo tenant DATA (keep structure/users) and re-seed. Powers "Reset Demo".
function resetDemo() {
  const org = get(`SELECT * FROM organizations WHERE is_demo=1 LIMIT 1`);
  if (!org) return { error: 'no_demo' };
  for (const t of ['leads','clients','tasks','messages','automation_runs','activity_logs','usage_records','rbt_timecards','supervision_sessions'])
    run(`DELETE FROM ${t} WHERE organization_id=?`, [org.id]);
  seedDemoContent(org.id);
  return { ok:true, org_id: org.id };
}

module.exports = { bootstrap, seedDemoContent, resetDemo, DEMO_STAFF };
