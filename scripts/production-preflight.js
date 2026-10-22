'use strict';
const fs = require('fs');
const path = require('path');
const { checkJavaScriptSyntax } = require('./check-js-syntax');

const root = path.join(__dirname, '..');
const required = [
  'server.js', 'package.json', '.env.example', 'Dockerfile',
  'docker-compose.production.yml', 'monitoring/prometheus.yml',
  'monitoring/prometheus-alerts.yml',
  'monitoring/grafana/provisioning/dashboards/provider.yml',
  'monitoring/grafana/provisioning/datasources/prometheus.yml',
  'integration_update/config/index.js', 'integration_update/middleware/index.js',
  'scripts/backup-data.js', 'scripts/restore-data.js'
];

(async () => {
  const missing = required.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) {
    console.error('Missing production files:', missing.join(', '));
    process.exitCode = 1;
    return;
  }
  const count = await checkJavaScriptSyntax(root);
  console.log(`Production preflight: ${count} JavaScript files syntax-clean; required deployment assets present.`);
})().catch(err => {
  console.error('Production preflight failed:', err.message);
  process.exitCode = 1;
});
