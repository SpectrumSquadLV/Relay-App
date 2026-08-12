// ============================================================
// Relay SaaS — server entry
// ============================================================
const express = require('express');
const session = require('express-session');
const path = require('path');
const { bootstrap } = require('./src/seed');
const engine = require('./src/services/engine');
const authRoutes = require('./src/routes/authRoutes');
const ownerRoutes = require('./src/routes/ownerRoutes');
const workspaceRoutes = require('./src/routes/workspaceRoutes');

bootstrap();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-relay-secret-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7*864e5 },
}));

app.use('/api/auth', authRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/workspace', workspaceRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
// SPA fallback (Express 5: use a regex/middleware, not '*')
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Automation scheduler — resumes waiting jobs whose delay has elapsed.
// (For a multi-instance deployment, run this as a single worker process instead.)
const TICK_MS = parseInt(process.env.ENGINE_TICK_MS || '15000', 10);
setInterval(() => engine.tick(), TICK_MS);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Relay running on http://localhost:${PORT} (automation engine tick=${TICK_MS}ms)`));
