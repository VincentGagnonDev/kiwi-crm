require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');
const { body, validationResult } = require('express-validator');
const Database = require('better-sqlite3');
const axios = require('axios');

// Load system prompts from JSON config file only
function loadSystemPrompts() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'prompts.json');
    if (fs.existsSync(configPath)) {
      const prompts = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (prompts.en && prompts.fr) {
        return prompts;
      }
    }
  } catch (e) {
    console.warn('Could not load prompts.json:', e.message);
  }

  // Hardcoded fallbacks if config file missing
  return {
    en: 'You are Gavion\'s AI assistant, helpful and professional. You assist customers with questions about services, pricing, and support. Be concise and clear.',
    fr: 'Vous êtes l\'assistant AI de Gavion, utile et professionnel. Vous aidez les clients avec des questions sur les services, les prix, et le support. soyez concis et clair.'
  };
}

const SYSTEM_PROMPTS = loadSystemPrompts();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'kiwi.db');

// Ensure data dir
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Init DB
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    datetime TEXT NOT NULL,
    timezone TEXT DEFAULT 'America/Toronto',
    service TEXT DEFAULT 'Consultation',
    confirmed INTEGER DEFAULT 0,
    google_event_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// Migration: add phone if missing
try {
  const cols = db.prepare("PRAGMA table_info(appointments)").all();
  if (!cols.find(c => c.name === 'phone')) db.exec("ALTER TABLE appointments ADD COLUMN phone TEXT");
} catch (e) { /* ignore */ }

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'kiwi123' },
  challenge: true
});

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Leads table
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    business TEXT,
    package TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create appointment (used by voice & web)
app.post('/api/appointment',
  body('name').trim().notEmpty(),
  body('email').isEmail(),
  body('phone').optional().trim(),
  body('datetime').isISO8601(),
  body('timezone').optional(),
  body('service').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, phone, datetime, timezone = 'America/Toronto', service = 'Consultation' } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO appointments (name, email, phone, datetime, timezone, service) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(name, email, phone || '', datetime, timezone, service);
    // Generate a simple eventId (could be enhanced with Google Calendar integration)
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // Optionally, if GOG_WRAPPER is configured, try to create real event (stubbed for now)
    res.json({ success: true, id: result.lastInsertRowid, eventId });
  } catch (err) {
    console.error('Appointment DB error:', err);
    res.status(500).json({ error: 'db' });
  }
  });

// Admin lookup (by email/phone)
app.get('/api/admin/appointments/lookup', adminAuth, (req, res) => {
  const { email, phone } = req.query;
  if (!email && !phone) return res.status(400).json({ error: 'email or phone required' });
  let query = 'SELECT * FROM appointments WHERE confirmed = 1';
  const params = [];
  if (email) { query += ' AND email = ?'; params.push(email); }
  if (phone) { query += ' AND phone = ?'; params.push(phone); }
  query += ' ORDER BY datetime DESC LIMIT 10';
  res.json(db.prepare(query).all(...params));
});

// Admin delete
app.delete('/api/admin/appointments/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  res.json({ success: true });
});

// Admin patch (reschedule)
app.patch('/api/admin/appointments/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { datetime, service } = req.body;
  if (!datetime) return res.status(400).json({ error: 'datetime required' });
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE appointments SET datetime = ?, service = ? WHERE id = ?').run(datetime, service || appt.service, id);
  res.json({ success: true });
});

// Admin get all
app.get('/api/admin/appointments', adminAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM appointments ORDER BY datetime ASC').all());
});

// Submit lead
app.post('/api/lead', async (req, res) => {
  const { name, email, business, package: pkg, message } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email required' });
  }
  try {
    const stmt = db.prepare('INSERT INTO leads (name, email, business, package, message) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(name, email, business || '', pkg || '', message || '');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Lead DB error:', err);
    res.status(500).json({ error: 'db' });
  }
});

// Admin stats
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  const totalAppointments = db.prepare('SELECT COUNT(*) as count FROM appointments').get().count;
  res.json({ totalLeads, totalAppointments });
});

// Socket.IO chat: AI assistant
io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (data) => {
    socket.language = data.language || 'en';
    console.log('Client joined, language:', socket.language);
  });

  socket.on('message', async (data) => {
    const userMessage = data.text || '';
    const language = data.language || socket.language || 'en';
    if (!userMessage.trim()) return;

    try {
      const openrouterApiKey = process.env.OPENROUTER_API_KEY;
      const openrouterModel = process.env.OPENROUTER_MODEL || 'openrouter/stepfun/step-3.5-flash';

      if (!openrouterApiKey) {
        socket.emit('message', { text: 'OpenRouter API key not configured.' });
        return;
      }

      const systemPrompt = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.en;

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: openrouterModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 512,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${openrouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://kiwi.localhost:3001',
            'X-Title': 'Gavion Kiwi CRM'
          }
        }
      );

      const aiReply = response.data.choices?.[0]?.message?.content || 'No response';
      socket.emit('message', { text: aiReply });
    } catch (err) {
      console.error('OpenRouter error:', err.response?.data || err.message);
      socket.emit('message', { text: 'AI service is currently unavailable. Please try again later.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiwi API listening on ${PORT}`);
});
