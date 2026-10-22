#!/usr/bin/env node
'use strict';

// Low-risk HTTP smoke/load check using only Node built-ins. Run against a
// local or staging deployment you own; it does not create accounts or mutate data.
const { performance } = require('node:perf_hooks');

const baseUrl = (process.env.LOAD_TEST_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const requests = Math.max(1, Math.min(10000, Number.parseInt(process.env.LOAD_TEST_REQUESTS || '300', 10) || 300));
const concurrency = Math.max(1, Math.min(250, Number.parseInt(process.env.LOAD_TEST_CONCURRENCY || '25', 10) || 25));
const route = process.env.LOAD_TEST_PATH || '/api/health';
if (!route.startsWith('/') || route.startsWith('//')) {
  console.error('LOAD_TEST_PATH must be a local path beginning with one slash.');
  process.exit(2);
}

async function main() {
  const durations = [];
  let next = 0;
  let failures = 0;
  let non2xx = 0;
  const started = performance.now();

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= requests) return;
      const start = performance.now();
      try {
        const response = await fetch(`${baseUrl}${route}`, { headers: { accept: 'application/json' } });
        await response.arrayBuffer();
        durations.push(performance.now() - start);
        if (!response.ok) non2xx++;
      } catch (error) {
        failures++;
        if (failures === 1) console.error(`First request failure: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  const elapsedSeconds = (performance.now() - started) / 1000;
  durations.sort((a, b) => a - b);
  const percentile = p => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)] : NaN;
  const avg = durations.length ? durations.reduce((sum, n) => sum + n, 0) / durations.length : NaN;
  const report = {
    target: `${baseUrl}${route}`,
    requested: requests,
    completed: durations.length,
    failures,
    non2xx,
    concurrency: Math.min(concurrency, requests),
    elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    requestsPerSecond: Number((durations.length / elapsedSeconds).toFixed(2)),
    latencyMs: {
      average: Number(avg.toFixed(2)),
      p50: Number(percentile(0.50).toFixed(2)),
      p95: Number(percentile(0.95).toFixed(2)),
      p99: Number(percentile(0.99).toFixed(2)),
    },
    note: 'HTTP smoke test only; not a million-user capacity test and does not measure WebSocket, database writes, payments, or voice media.'
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures || non2xx || durations.length !== requests) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
