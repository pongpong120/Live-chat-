const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', '.gradle'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const jsFiles = files.filter(f => /\.(js|cjs|mjs)$/.test(f));
for (const file of jsFiles) {
  // Syntax validation without loading application dependencies.
  const cp = require('child_process').spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (cp.status !== 0) errors.push(`JS syntax: ${path.relative(root, file)}\n${cp.stderr || cp.stdout}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!pkg.scripts?.test) warnings.push('package.json has no test script');
if (!fs.existsSync(path.join(root, 'android', 'gradlew'))) errors.push('Android Gradle wrapper is missing');
else if (!(fs.statSync(path.join(root, 'android', 'gradlew')).mode & 0o111)) errors.push('android/gradlew is not executable');

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
if (!server.includes('assertProductionVoiceReadiness')) warnings.push('Production voice readiness guard not detected');
if (!server.includes('uncaughtException')) warnings.push('Process-level exception guard not detected');

console.log(JSON.stringify({
  ok: errors.length === 0,
  filesScanned: files.length,
  jsFilesChecked: jsFiles.length,
  errors,
  warnings,
  note: 'This audit intentionally does not delete modules automatically. A module is removed only when its runtime/test/build references are proven absent.'
}, null, 2));
process.exitCode = errors.length ? 1 : 0;
