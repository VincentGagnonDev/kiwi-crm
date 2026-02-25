# Project Kiwi – Gavion AI Assistant MVP

Enterprise-grade lead capture and appointment booking system with embedded AI chatbot.

## Features

- **AI Chatbot Widget** – Embeddable, bilingual (EN/FR), real-time via Socket.io
- **Lead Capture** – Forms saved to SQLite + Google Sheets integration (via `gog`)
- **Appointment Booking** – Google Calendar integration + email reminders (stubbed)
- **Admin Dashboard** – Secure HTTP basic auth, stats, leads, appointments
- **Rate Limiting & Security** – Helmet, CORS, input validation
- **Structured Logging** – Winston JSON logs to console and files
- **Railway Ready** – Deploy with `railway.json`
- **OpenRouter AI** – Optional real AI integration; demo fallback included

## Quick Start

```bash
npm install
cp .env.example .env   # then edit .env with your values
npm start
```

Server listens on `http://localhost:3000` (or `$PORT`).

- Health: `/api/health`
- Widget demo: `/`
- Admin panel: `/admin` (credentials from `.env`)
- Widget script: `/widget.js` (include on any site)

## Embedding the Widget

Add to any website:

```html
<script src="https://your-domain.com/widget.js"></script>
<div id="gavion-chat-widget"></div>
<script>
  GavionChat.init({
    container: '#gavion-chat-widget',
    title: 'AI Assistant',
    welcomeMessage: 'Hello! How can I help?',
    language: 'en' // or 'fr'
  });
</script>
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_USER` | Yes | Admin username for `/admin` |
| `ADMIN_PASS` | Yes | Admin password (use strong random) |
| `OPENROUTER_API_KEY` | No | OpenRouter key for real AI (demo mode if absent) |
| `OPENROUTER_MODEL` | No | Model ID (default: `openrouter/stepfun/step-3.5-flash`) |
| `GOG_WRAPPER` | Yes (for Sheets/Calendar) | Absolute path to `gog` wrapper script |
| `GOG_ACCOUNT` | Yes | Google account email used with gog |
| `SITE_URL` | No | OpenRouter referer header (default: `https://gavion.ca`) |
| `PORT` | No | Server port (default: `3000`, Railway sets automatically) |
| `LOG_LEVEL` | No | Winston log level (`info` default) |

## API Reference

### Public

- `GET /api/health` – Health check with DB status and memory usage
- `POST /api/lead` – Submit lead (validated)
  ```json
  { "name": "...", "email": "...", "business": "...", "package": "Starter|Growth|Agency", "message": "..." }
  ```
- `POST /api/appointment` – Create appointment (validated)
  ```json
  { "name": "...", "email": "...", "datetime": "2025-02-25T10:00:00", "timezone": "America/Toronto", "service": "Consultation" }
  ```

### Admin (HTTP Basic Auth)

- `GET /api/admin/stats` – Total counts + recent leads
- `GET /api/admin/leads?page=1&limit=50` – Paginated leads
- `GET /api/admin/appointments` – All appointments

## Deployment (Railway)

1. Push this repository to GitHub.
2. Create new project on railway.app → Deploy from GitHub.
3. Build command: `npm install`
4. Start command: `node src/server.js`
5. Add environment variables in Railway dashboard.
6. Deploy.

## Testing

```bash
npm test
# runs test/healthcheck.js against BASE_URL or localhost:3000
```

## Production Checklist

- [ ] Set strong `ADMIN_USER` / `ADMIN_PASS`
- [ ] Enable `OPENROUTER_API_KEY` for real AI responses
- [ ] Configure `GOG_WRAPPER` path on the server
- [ ] Verify Google Sheets append permissions (sheet ID hardcoded in server.js; change if needed)
- [ ] Implement `scheduleCalendarEvent` with real `gog calendar create` and email reminders (currently stubbed)
- [ ] Set up domain and update `SITE_URL` / CORS
- [ ] Enable HTTPS (Railway provides automatically)
- [ ] Review `helmet` CSP and adjust if needed
- [ ] Set up log rotation (external tool)
- [ ] Add cron for appointment reminders (node-cron already in deps)

## License

UNLICENSED – Proprietary to Gavion.

---

**Support:** ai.gavion@gmail.com
