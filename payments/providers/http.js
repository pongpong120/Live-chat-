'use strict';
// Minimal fetch wrapper (Node 22 global fetch) with timeout. Injectable in tests.
async function defaultHttp({ method, url, headers = {}, body, timeoutMs = 15000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally { clearTimeout(t); }
}
module.exports = { defaultHttp };
