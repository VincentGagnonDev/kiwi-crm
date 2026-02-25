#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const SERVER_CMD = process.env.NODE || 'node';
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

async function waitForServer(timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`${BASE}/api/health`, res => resolve(res))
          .on('error', reject);
      });
      if (res.statusCode === 200) return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('Server did not start within timeout');
}

async function request(path, opts = {}) {
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

async function runTests() {
  console.log('=== Project Kiwi Full Test Suite ===\n');

  // 1. Health
  console.log('1. Health check');
  const health = await request('/api/health');
  if (health.status !== 200) throw new Error(`Health returned ${health.status}`);
  const healthJson = JSON.parse(health.body);
  if (healthJson.status !== 'ok') throw new Error('Health status not ok');
  console.log('   ✓ Health OK, DB connected\n');

  // 2. Widget JS
  console.log('2. Widget JS');
  const widget = await request('/widget.js');
  if (widget.status !== 200) throw new Error(`Widget JS returned ${widget.status}`);
  if (!widget.body.includes('window.GavionChat')) throw new Error('Widget missing GavionChat');
  console.log('   ✓ Widget JS served, contains GavionChat\n');

  // 3. Index page
  console.log('3. Demo page (/)');
  const index = await request('/');
  if (index.status !== 200) throw new Error(`Index returned ${index.status}`);
  if (!index.body.includes('gavion-chat-widget')) throw new Error('Index missing widget container');
  console.log('   ✓ Index page OK, widget container present\n');

  // 4. Submit lead
  console.log('4. Lead submission');
  const leadRes = await request('/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test User',
      email: 'test@example.com',
      business: 'TestCo',
      package: 'Starter',
      message: 'Hello from automated test'
    })
  });
  if (leadRes.status !== 200) throw new Error(`Lead returned ${leadRes.status}`);
  const leadBody = JSON.parse(leadRes.body);
  if (!leadBody.success) throw new Error('Lead not successful');
  console.log(`   ✓ Lead created, id=${leadBody.id}\n`);

  // 5. Appointment (with basic auth)
  console.log('5. Appointment creation (admin auth)');
  const apptRes = await request('/api/appointment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from('admin:kiwi123').toString('base64')
    },
    body: JSON.stringify({
      name: 'Bob Smith',
      email: 'bob@example.com',
      datetime: '2025-02-26T14:00:00',
      timezone: 'America/Toronto',
      service: 'Consultation'
    })
  });
  if (apptRes.status !== 200) throw new Error(`Appointment returned ${apptRes.status}`);
  const apptBody = JSON.parse(apptRes.body);
  if (!apptBody.success) throw new Error('Appointment not successful');
  console.log(`   ✓ Appointment created, id=${apptBody.id}, eventId=${apptBody.eventId}\n`);

  // 6. Admin stats (auth)
  console.log('6. Admin stats (auth)');
  const statsRes = await request('/api/admin/stats', {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + Buffer.from('admin:kiwi123').toString('base64')
    }
  });
  if (statsRes.status !== 200) throw new Error(`Stats returned ${statsRes.status}`);
  const stats = JSON.parse(statsRes.body);
  console.log(`   ✓ Stats: leads=${stats.totalLeads}, appointments=${stats.totalAppointments}\n`);

  console.log('✅ All tests passed!');
}

async function main() {
  console.log('Starting Project Kiwi server...');
  const server = spawn(SERVER_CMD, [SERVER_PATH], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: process.env.PORT || '3000' },
    detached: true,
    stdio: 'pipe'
  });

  server.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  server.stderr.on('data', data => process.stderr.write(`[server-err] ${data}`));

  try {
    await waitForServer();
    console.log('Server ready, running tests...\n');
    await runTests();
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('\nStopping server...');
    process.kill(-server.pid, 'SIGTERM');
    server.on('exit', () => console.log('Server stopped.'));
  }
}

main();
