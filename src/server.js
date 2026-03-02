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
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

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
    en: 'You are Gala, the friendly and professional AI assistant for Gavion. Your job is to help businesses understand how Gavion\'s AI solutions can automate their operations, qualify leads, book appointments, and improve customer engagement. Only answer questions about Gavion\'s services, pricing, implementation, and support. If a user asks about booking an appointment, scheduling a call, requesting a demo, or any meeting-related question, respond with a polite message that includes the direct link to the contact section: "#contact". Example: "You can book an appointment by visiting our contact section. Just click here: #contact". Use natural variations. Be conversational and human-sounding. Use a friendly tone. Avoid emojis and weird symbols. Keep responses concise.',
    fr: 'Vous êtes Gala, l\'assistante IA amicale et professionnelle de Gavion. Votre rôle est d\'aider les entreprises à comprendre comment les solutions IA de Gavion peuvent automatiser leurs opérations, qualifier des prospects, prendre des rendez-vous et améliorer l\'engagement client. Ne répondez qu\'aux questions concernant les services de Gavion, les tarifs, la mise en œuvre et le support. Si un utilisateur pose des questions sur la prise de rendez-vous, la planification d\'un appel, la demande de démo ou toute question liée à une réunion, répondez avec un message poli qui inclut le lien direct vers la section contact : "#contact". Exemple : "Vous pouvez prendre rendez-vous en visitant notre section contact. Cliquez ici : #contact". Utilisez des variations naturelles. Soyez conversationnel et naturel. Utilisez un ton amical. Pas d\'émojis ni de symboles bizarres. Gardez les réponses concises.'
  };
}

const SYSTEM_PROMPTS = loadSystemPrompts();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
app.use(cors({ origin: '*' })); // Allow all origins for API; restrict in production if needed

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

// Email helper
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Singleton transporter for connection reuse
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendContactEmail(data) {
  const { name, email, business, package: pkg, message } = data;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ff6b00;">New Contact Form Submission</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 8px 0; font-weight: bold; width: 150px;">Name:</td><td>${escapeHtml(name)}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Email:</td><td>${escapeHtml(email)}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Business:</td><td>${escapeHtml(business || '-')}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Package:</td><td>${escapeHtml(pkg || '-')}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold; vertical-align: top;">Message:</td><td>${escapeHtml(message).replace(/\n/g, '<br>')}</td></tr>
        <tr><td style="padding: 8px 0; font-weight: bold;">Submitted:</td><td>${new Date().toLocaleString()}</td></tr>
      </table>
    </div>
  `;

  await getTransporter().sendMail({
    from: `"Gavion Contact" <${process.env.SMTP_USER}>`,
    to: 'info@gavion.ai',
    replyTo: email,
    subject: `[Gavion Contact] ${name} - ${pkg || 'General'}`,
    html: html,
  });
}

async function sendConfirmationEmail(data) {
  const { name, email, package: pkg, language = 'en' } = data;

  const templates = {
    en: {
      subject: 'We Received Your Message! – Gavion',
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ff6b00; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .footer { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
    .button { display: inline-block; padding: 12px 24px; background: #ff6b00; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
    .package { background: #e0e0e0; padding: 10px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;font-size:24px;">Gavion</h1>
    <p style="margin:5px 0 0;">We've received your message</p>
  </div>
  <div class="content">
    <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p>Thank you for reaching out to Gavion! We've received your contact form submission and will get back to you within <strong>4 business hours</strong>.</p>
    
    ${pkg ? `<div class="package"><strong>Package of interest:</strong> ${escapeHtml(pkg)}</div>` : ''}
    
    <p>If you'd like to speak with us sooner, feel free to book a call or visit our contact page:</p>
    <p><a href="http://localhost:3000#contact" class="button">Go to Contact Page</a></p>
    
    <p>Best regards,<br>The Gavion Sales Team</p>
  </div>
  <div class="footer">
    <p>Gavion AI Integration Agency | Montreal, Quebec</p>
    <p><a href="mailto:info@gavion.ai">info@gavion.ai</a></p>
  </div>
</body>
</html>`
    },
    fr: {
      subject: 'Nous avons reçu votre message ! – Gavion',
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ff6b00; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .footer { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
    .button { display: inline-block; padding: 12px 24px; background: #ff6b00; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
    .package { background: #e0e0e0; padding: 10px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;font-size:24px;">Gavion</h1>
    <p style="margin:5px 0 0;">Nous avons reçu votre message</p>
  </div>
  <div class="content">
    <p>Bonjour <strong>${escapeHtml(name)}</strong>,</p>
    <p>Merci de nous avoir contactés ! Nous avons reçu votre soumission et vous répondrons dans un délai de <strong>4 heures ouvrables</strong>.</p>
    
    ${pkg ? `<div class="package"><strong>Forfait d'intérêt :</strong> ${escapeHtml(pkg)}</div>` : ''}
    
    <p>Cordialement,<br>L'équipe des Ventes de Gavion</p>
  </div>
  <div class="footer">
    <p>Agence d'Intégration IA Gavion | Montréal, Québec</p>
    <p><a href="mailto:info@gavion.ai">info@gavion.ai</a></p>
  </div>
</body>
</html>`
    }
  };

  const tmpl = templates[language] || templates.en;

  await getTransporter().sendMail({
    from: `"Gavion" <${process.env.SMTP_USER}>`,
    to: email,
    replyTo: 'info@gavion.ai',
    subject: tmpl.subject,
    html: tmpl.html,
  });
}

// Rate limiter for contact endpoint: generous limit for testing (effectively unlimited)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10000,               // Very high limit
  message: { success: false, message: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

// Contact form endpoint — sends email to info@gavion.ai and confirmation to client
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, business, package: pkg, message, language } = req.body;
    
    // Validation
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    // Respond immediately to user
    res.json({ success: true, message: 'Message sent successfully' });

    // Send notification to Gavion team (background)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      sendContactEmail(req.body).catch(err => {
        console.error('Background notification email failed:', err);
      });
      // Also send confirmation to client (background)
      sendConfirmationEmail({ ...req.body, language: language || 'en' }).catch(err => {
        console.error('Confirmation email failed:', err);
      });
    } else {
      console.warn('SMTP credentials not set, emails not sent');
    }
  } catch (err) {
    console.error('Contact endpoint error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
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
