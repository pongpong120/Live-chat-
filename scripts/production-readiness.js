'use strict';
const fs = require('fs');
const path = require('path');
const { checkJavaScriptSyntax } = require('./check-js-syntax');
const root = path.join(__dirname, '..');

(async () => {
  const required = ['server.js', 'package.json', 'Dockerfile', 'docker-compose.production.yml',
    'monitoring/prometheus.yml', 'monitoring/prometheus-alerts.yml',
    'scripts/backup-data.js', 'scripts/restore-data.js'];
  const missing = required.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) throw new Error(`Missing production assets: ${missing.join(', ')}`);
  const pkg = require(path.join(root, 'package.json'));
  for (const key of ['start:production', 'test', 'preflight']) {
    if (!pkg.scripts?.[key]) throw new Error(`Missing npm script: ${key}`);
  }
  const count = await checkJavaScriptSyntax(root);
  console.log(`Production readiness: ${count} JavaScript files parse cleanly; ${required.length} core assets present; dependency install mode: npm install.`);
})().catch(err => {
  console.error('Production readiness failed:', err.message);
  process.exitCode = 1;
});
