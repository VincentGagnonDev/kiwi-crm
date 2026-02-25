const http = require('http');
const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request(url, { method: opts.method || 'GET', ...opts }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function run() {
  console.log('Running healthchecks...');
  // 1. Health endpoint
  const health = await request('/api/health');
  assert.strictEqual(health.status, 200, 'Health should be 200');
  const body = JSON.parse(health.body);
  assert.strictEqual(body.status, 'ok');
  console.log('✓ Health OK');

  // 2. Widget JS served
  const widget = await request('/widget.js');
  assert.strictEqual(widget.status, 200);
  assert(widget.body.includes('window.GavionChat'), 'Widget should contain GavionChat');
  console.log('✓ Widget JS served');

  // 3. Index page
  const index = await request('/');
  assert.strictEqual(index.status, 200);
  assert(index.body.includes('gavion-chat-widget'), 'Index should have widget container');
  console.log('✓ Index page OK');

  // 4. Submit lead
  const leadRes = await request('/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.com',
      business: 'TestCo',
      package: 'Starter',
      message: 'Hello from test'
    })
  });
  assert.strictEqual(leadRes.status, 200);
  const leadBody = JSON.parse(leadRes.body);
  assert(leadBody.success, 'Lead should succeed');
  console.log('✓ Lead creation OK');

  // 5. Appointment (requires auth, skip in basic test)
  console.log('✓ All basic checks passed');
}

run().catch(err => {
  console.error('Healthcheck failed:', err);
  process.exit(1);
});
