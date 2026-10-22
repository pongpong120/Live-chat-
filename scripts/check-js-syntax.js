'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.gradle', 'build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

function checkOne(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => resolve({ file, status: 1, stderr: err.message }));
    child.on('close', status => resolve({ file, status: status ?? 1, stderr }));
  });
}

async function checkJavaScriptSyntax(root, concurrency = 8) {
  const files = collect(root);
  let cursor = 0, checked = 0;
  const failures = [];
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      const file = files[index];
      const result = await checkOne(file);
      checked++;
      if (result.status !== 0) {
        failures.push(result);
        console.error(`Syntax failure: ${path.relative(root, file)}\n${result.stderr}`);
      }
      if (checked % 25 === 0 || checked === files.length) {
        console.log(`Syntax check progress: ${checked}/${files.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  if (failures.length) throw new Error(`${failures.length} JavaScript syntax failure(s)`);
  return files.length;
}
module.exports = { checkJavaScriptSyntax };
