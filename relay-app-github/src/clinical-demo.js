// ============================================================
// Demo data for the clinical domain, across all four specialties.
//
// EXTENDS the existing demo seed rather than replacing it. seedDemoContent()
// already builds fifteen ABA leads with a careful narrative -- follow-ups
// missed, authorizations sitting unscheduled -- and none of that is touched.
// This adds the clinical layer on top: active clients across ABA, Behavioural
// Health, OT and Speech, each with insurance, benefits, authorizations,
// documents and a communication history, plus a staff directory with
// credentials at every stage of expiry.
//
// Everything is invented. No real patient or clinician appears here.
//
// Idempotent: it checks for its own marker and does nothing on a second run,
// so a redeploy cannot double-seed the demo.
// ============================================================
const { Repo, get, all, run, id, now } = require('./db');

const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const daysOut = (d) => new Date(Date.now() + d * 864e5).toISOString();
const dateOnly = (iso) => String(iso).slice(0, 10);

// Initials-based avatar, so every demo client and clinician has a face without
// shipping photographs of people who do not exist.
function avatar(name, bg) {
  const initials = String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="${bg}"/><text x="64" y="82" font-family="system-ui,sans-serif" font-size="52" font-weight="600" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const TINTS = { aba: '#3E7C5D', bh: '#6A5ACD', ot: '#C98A1B', st: '#2F7D78' };

// ---- the demo caseload -------------------------------------------------
// Spread deliberately across every phase so a sales call can open on any
// stage and find something real: intake waiting on a card, benefits verified
// but authorization pending, an authorization expiring inside two weeks.
const CLIENTS = [
  { first: 'Mateo', last: 'Alvarez', dob: '2019-04-12', line: 'aba', phase: 'intake',
    guardian: 'Amanda Alvarez', rel: 'Mother', phone: '(702) 555-0231', email: 'amanda.alvarez@example.com',
    dx: 'F84.0 Autism Spectrum Disorder', dxDate: '2025-11-02', ref: 'Pediatrician referral',
    carrier: 'Aetna', member: 'W1928374650', group: 'SS-4417', elig: 'pending', auth: null,
    note: 'Intake form complete, insurance card uploaded, benefits check queued.' },
  { first: 'Ella', last: 'Bennett', dob: '2018-09-30', line: 'aba', phase: 'intake',
    guardian: 'Chris Bennett', rel: 'Father', phone: '(702) 555-0248', email: 'cbennett@example.com',
    dx: 'F84.0 Autism Spectrum Disorder', dxDate: '2025-08-19', ref: 'Google search',
    carrier: 'UnitedHealthcare', member: 'UHC88213340', group: 'NV-2210', elig: 'info_needed', auth: null,
    note: 'Back of insurance card missing — family notified automatically.' },
  { first: 'Zoe', last: 'Carter', dob: '2017-02-08', line: 'aba', phase: 'assessment_auth',
    guardian: 'Dominique Carter', rel: 'Mother', phone: '(702) 555-0263', email: 'dom.carter@example.com',
    dx: 'F84.0 Autism Spectrum Disorder', dxDate: '2025-06-11', ref: 'Facebook',
    carrier: 'Cigna', member: 'CIG5540982', group: 'CG-7781', elig: 'verified',
    auth: { kind: 'assessment', status: 'submitted', cpt: '97151', req: 40, appr: null, start: null, end: null, submitted: daysAgo(6) },
    note: 'Assessment authorization submitted — follow-up task runs every 5 days.' },
  { first: 'Liam', last: 'Nguyen', dob: '2019-12-01', line: 'aba', phase: 'assessment',
    guardian: 'Priscilla Nguyen', rel: 'Mother', phone: '(702) 555-0277', email: 'p.nguyen@example.com',
    dx: 'F84.0 Autism Spectrum Disorder', dxDate: '2025-03-27', ref: 'Insurance directory',
    carrier: 'Aetna', member: 'W2213348890', group: 'SS-4417', elig: 'verified',
    auth: { kind: 'assessment', status: 'approved', cpt: '97151', req: 40, appr: 32, start: daysAgo(20), end: daysOut(40), submitted: daysAgo(30), decided: daysAgo(21) },
    note: 'Assessment completed. Treatment plan due in 6 days.' },
  { first: 'Ava', last: 'Fields', dob: '2016-07-19', line: 'aba', phase: 'active',
    guardian: 'Robert Fields', rel: 'Father', phone: '(702) 555-0284', email: 'rfields@example.com',
    dx: 'F84.0 Autism Spectrum Disorder', dxDate: '2024-10-05', ref: 'Other provider',
    carrier: 'Blue Cross Blue Shield', member: 'BCBS7719023', group: 'BC-1180', elig: 'verified',
    auth: { kind: 'treatment', status: 'approved', cpt: '97153, 97155', req: 640, appr: 640, used: 412, start: daysAgo(120), end: daysOut(11), submitted: daysAgo(130), decided: daysAgo(121) },
    note: 'AUTHORIZATION EXPIRES IN 11 DAYS — renewal task open.' },
  { first: 'Noah', last: 'Brooks', dob: '2015-05-22', line: 'bh', phase: 'active',
    guardian: 'Tanya Brooks', rel: 'Mother', phone: '(702) 555-0299', email: 'tbrooks@example.com',
    dx: 'F90.2 ADHD, combined type', dxDate: '2025-01-14', ref: 'School counselor',
    carrier: 'UnitedHealthcare', member: 'UHC44120087', group: 'NV-2210', elig: 'verified',
    auth: { kind: 'treatment', status: 'approved', cpt: '90837', req: 24, appr: 24, used: 9, start: daysAgo(45), end: daysOut(135), submitted: daysAgo(52), decided: daysAgo(46) },
    note: 'Weekly individual therapy. 15 sessions remaining.' },
  { first: 'Sara', last: 'Ali', dob: '2018-11-03', line: 'ot', phase: 'assessment_auth',
    guardian: 'Hassan Ali', rel: 'Father', phone: '(702) 555-0301', email: 'hali@example.com',
    dx: 'F82 Developmental coordination disorder', dxDate: '2025-09-08', ref: 'Pediatrician referral',
    carrier: 'Cigna', member: 'CIG9982104', group: 'CG-7781', elig: 'verified',
    auth: { kind: 'assessment', status: 'pending', cpt: '97165', req: 4, appr: null, start: null, end: null, submitted: daysAgo(11) },
    note: 'OT evaluation authorization pending 11 days — escalation task open.' },
  { first: 'Ben', last: 'Kim', dob: '2017-08-27', line: 'ot', phase: 'active',
    guardian: 'Grace Kim', rel: 'Mother', phone: '(702) 555-0318', email: 'gkim@example.com',
    dx: 'F82 Developmental coordination disorder', dxDate: '2024-12-02', ref: 'Website form',
    carrier: 'Aetna', member: 'W7781230045', group: 'SS-4417', elig: 'verified',
    auth: { kind: 'treatment', status: 'approved', cpt: '97530', req: 48, appr: 36, used: 22, start: daysAgo(70), end: daysOut(50), submitted: daysAgo(78), decided: daysAgo(71) },
    note: 'Partially approved — 36 of 48 requested units.' },
  { first: 'Lucia', last: 'Ramos', dob: '2019-01-16', line: 'st', phase: 'intake',
    guardian: 'Victor Ramos', rel: 'Father', phone: '(702) 555-0322', email: 'vramos@example.com',
    dx: 'F80.2 Mixed receptive-expressive language disorder', dxDate: '2025-10-21', ref: 'Google search',
    carrier: 'Blue Cross Blue Shield', member: 'BCBS3320114', group: 'BC-1180', elig: 'in_progress',
    auth: null, note: 'Benefits verification in progress with payer.' },
  { first: 'Alex', last: 'Petrov', dob: '2016-03-09', line: 'st', phase: 'active',
    guardian: 'Nadia Petrova', rel: 'Mother', phone: '(702) 555-0335', email: 'npetrova@example.com',
    dx: 'F80.0 Phonological disorder', dxDate: '2024-08-30', ref: 'Insurance directory',
    carrier: 'UnitedHealthcare', member: 'UHC66109921', group: 'NV-2210', elig: 'verified',
    auth: { kind: 'treatment', status: 'approved', cpt: '92507', req: 52, appr: 52, used: 48, start: daysAgo(160), end: daysOut(28), submitted: daysAgo(170), decided: daysAgo(161) },
    note: '48 of 52 units used with 28 days left — reauthorization task open.' },
];

// ---- staff directory ---------------------------------------------------
const STAFF = [
  { name: 'Dana Rivera', pos: 'Clinical Director', spec: 'ABA', cred: 'BCBA-D', npi: '1093847561',
    creds: [['license', 'BCBA-D', 'BACB', 420], ['cpr', 'CPR/BLS', 'AHA', 210]] },
  { name: 'Marcus Webb', pos: 'BCBA', spec: 'ABA', cred: 'BCBA', npi: '1174652093',
    creds: [['license', 'BCBA', 'BACB', 88], ['cpr', 'CPR/BLS', 'AHA', 25]] },
  { name: 'Priya Raman', pos: 'Registered Behavior Technician', spec: 'ABA', cred: 'RBT', npi: '',
    creds: [['rbt', 'RBT Certification', 'BACB', 12], ['background', 'Background Check', 'NV DPS', 300]] },
  { name: 'Jordan Ellis', pos: 'Registered Behavior Technician', spec: 'ABA', cred: 'RBT', npi: '',
    creds: [['rbt', 'RBT Certification', 'BACB', -6], ['cpr', 'CPR/BLS', 'AHA', 140]] },
  { name: 'Sofia Marchetti', pos: 'Occupational Therapist', spec: 'Occupational Therapy', cred: 'OTR/L', npi: '1288390174',
    creds: [['license', 'OT License', 'NV', 55], ['npi', 'NPI Registration', 'CMS', 900]] },
  { name: 'Kwame Boateng', pos: 'Certified OT Assistant', spec: 'Occupational Therapy', cred: 'COTA', npi: '',
    creds: [['license', 'COTA License', 'NV', 240]] },
  { name: 'Hannah Lowe', pos: 'Speech-Language Pathologist', spec: 'Speech Therapy', cred: 'SLP, CCC-SLP', npi: '1399201847',
    creds: [['license', 'SLP License', 'NV', 33], ['credentialing', 'Payer Credentialing', 'UHC', 175]] },
  { name: 'Elena Vasquez', pos: 'Licensed Clinical Social Worker', spec: 'Behavioral Health', cred: 'LCSW', npi: '1440928374',
    creds: [['license', 'LCSW License', 'NV', 610], ['cpr', 'CPR/BLS', 'AHA', 70]] },
];

function alreadySeeded(orgId) {
  return !!get(`SELECT 1 FROM client_insurance WHERE organization_id = ? LIMIT 1`, [orgId]);
}

function seedClinicalDemo(orgId) {
  if (!orgId || alreadySeeded(orgId)) return { skipped: true };
  const created = { clients: 0, insurance: 0, eligibility: 0, authorizations: 0, documents: 0, staff: 0, credentials: 0, messages: 0 };

  // ---- staff directory + credentials ----
  const staffIds = {};
  for (const s of STAFF) {
    const sp = Repo.insert(orgId, 'staff_profiles', {
      full_name: s.name, preferred_name: s.name.split(' ')[0], photo_url: avatar(s.name, '#1b2a6b'),
      position: s.pos, specialty: s.spec, credentials: s.cred, npi: s.npi,
      email: s.name.toLowerCase().replace(/\s+/g, '.') + '@relaydemo.com',
      phone: '(702) 555-0' + (100 + created.staff), employment_status: 'active',
      hire_date: dateOnly(daysAgo(400 + created.staff * 37)), created_at: now(),
    });
    staffIds[s.name] = sp.id || sp;
    created.staff++;
    for (const [kind, label, state, inDays] of s.creds) {
      Repo.insert(orgId, 'staff_credentials', {
        staff_id: staffIds[s.name], kind, label, state,
        number: 'DEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        issued_on: dateOnly(daysAgo(700)), expires_on: dateOnly(daysOut(inDays)),
        status: inDays < 0 ? 'expired' : inDays <= 90 ? 'expiring' : 'active',
        created_at: now(),
      });
      created.credentials++;
    }
  }

  // ---- clients, each with the full clinical chain ----
  for (const c of CLIENTS) {
    const full = `${c.first} ${c.last}`;
    const cl = Repo.insert(orgId, 'clients', {
      client_name: full, contact_name: c.guardian, phone: c.phone, email: c.email,
      legal_first_name: c.first, legal_last_name: c.last, preferred_name: c.first,
      dob: c.dob, service_line: c.line, phase: c.phase, stage: c.phase,
      diagnosis: c.dx, diagnosis_date: c.dxDate, referral_source: c.ref,
      guardian_name: c.guardian, guardian_relationship: c.rel,
      emergency_contact: `${c.guardian} — ${c.phone}`,
      language: 'English', preferred_contact: 'Email',
      city: 'Las Vegas', state: 'NV', insurance: c.carrier,
      photo_url: avatar(full, TINTS[c.line] || '#6b7280'),
      notes: c.note, created_at: daysAgo(60),
    });
    const clientId = cl.id || cl;
    created.clients++;

    const ins = Repo.insert(orgId, 'client_insurance', {
      client_id: clientId, rank: 'primary', carrier: c.carrier, member_id: c.member,
      group_number: c.group, subscriber_name: c.guardian, subscriber_dob: '1989-06-14',
      relationship: c.rel, card_front_path: 'demo/card-front.jpg',
      card_back_path: c.elig === 'info_needed' ? null : 'demo/card-back.jpg',
      effective_date: '2026-01-01', created_at: now(),
    });
    created.insurance++;

    const verified = c.elig === 'verified';
    Repo.insert(orgId, 'eligibility_checks', {
      client_id: clientId, insurance_id: ins.id || ins, status: c.elig,
      requested_at: daysAgo(9), completed_at: verified ? daysAgo(6) : null,
      network_status: verified ? 'in_network' : null,
      deductible: verified ? 3000 : null, deductible_remaining: verified ? 1250 : null,
      copay: verified ? 35 : null, coinsurance: verified ? 20 : null,
      oop_max: verified ? 7500 : null, oop_remaining: verified ? 5100 : null,
      auth_required: 1, referral_required: c.line === 'ot' ? 1 : 0,
      visit_limit: verified ? '60 visits / calendar year' : null,
      effective_date: verified ? '2026-01-01' : null, termination_date: null,
      call_reference: verified ? 'REF-' + Math.random().toString(36).slice(2, 9).toUpperCase() : null,
      payer_rep: verified ? 'B. Chandler' : null,
      notes: c.elig === 'info_needed' ? 'Back of insurance card required before verification can proceed.' : null,
      created_at: now(),
    });
    created.eligibility++;

    if (c.auth) {
      Repo.insert(orgId, 'authorizations', {
        client_id: clientId, kind: c.auth.kind, payer: c.carrier,
        auth_number: c.auth.status === 'approved' ? 'AUTH-' + Math.random().toString(36).slice(2, 8).toUpperCase() : null,
        cpt_codes: c.auth.cpt, status: c.auth.status,
        requested_units: c.auth.req, approved_units: c.auth.appr, used_units: c.auth.used || 0,
        start_date: c.auth.start ? dateOnly(c.auth.start) : null,
        end_date: c.auth.end ? dateOnly(c.auth.end) : null,
        submitted_at: c.auth.submitted || null, decided_at: c.auth.decided || null,
        created_at: now(),
      });
      created.authorizations++;
    }

    // Documents: what a real record accumulates by this point.
    const docs = [
      ['intake', 'Intake Application', 'intake-application.pdf', 1],
      ['insurance', 'Insurance Card — Front', 'card-front.jpg', 1],
      ['referrals', 'Referral / Prescription', 'referral.pdf', 1],
      ['medical', 'Diagnostic Report', 'diagnostic-report.pdf', 0],
      ['consents', 'Consent for Treatment', 'consent-treatment.pdf', 1],
      ['financial', 'Financial Responsibility Agreement', 'financial-agreement.pdf', 1],
    ];
    if (c.elig !== 'info_needed') docs.splice(2, 0, ['insurance', 'Insurance Card — Back', 'card-back.jpg', 1]);
    if (c.phase === 'active' || c.phase === 'assessment') docs.push(['treatment_plans', 'Treatment Plan', 'treatment-plan.pdf', 1]);
    for (const [category, label, filename, req] of docs) {
      Repo.insert(orgId, 'client_documents', {
        client_id: clientId, category, label, filename,
        mime_type: filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        file_path: 'demo/' + filename, is_required: req, created_at: daysAgo(30),
      });
      created.documents++;
    }

    // Outgoing mailbox: the client's permanent communication history.
    const mails = [
      ['Welcome to our practice — next steps', daysAgo(30), 'Intake invitation'],
      ['Your intake form is ready to complete', daysAgo(29), 'Intake form request'],
      ['We received your intake form', daysAgo(20), 'Intake confirmation'],
    ];
    if (c.elig === 'info_needed') mails.push(['We need the back of your insurance card', daysAgo(4), 'Missing document notice']);
    if (verified) mails.push(['Your benefits have been verified', daysAgo(6), 'Benefits summary']);
    if (c.auth && c.auth.status === 'approved') mails.push(['Your authorization has been approved', daysAgo(5), 'Authorization update']);
    if (c.phase === 'active') mails.push(['Welcome to your first day', daysAgo(2), 'First day details']);
    for (const [subject, at, kind] of mails) {
      Repo.insert(orgId, 'messages', {
        channel: 'email', direction: 'out', entity_type: 'client', entity_id: clientId,
        from_addr: 'care@relaydemo.com', to_addr: c.email, subject,
        body: `${kind} sent automatically by Relay for ${full}.`,
        status: 'sent', created_at: at,
      });
      created.messages++;
    }

    Repo.insert(orgId, 'activity_logs', {
      entity_type: 'client', entity_id: clientId, kind: 'automation',
      summary: `Relay advanced ${full} to ${c.phase.replace('_', ' ')}`, created_at: daysAgo(5),
    });
  }

  return created;
}

module.exports = { seedClinicalDemo, avatar };
