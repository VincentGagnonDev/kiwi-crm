require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');
const { body, validationResult } = require('express-validator');
const Database = require('better-sqlite3');

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
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) {
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiwi API listening on ${PORT}`);
});
