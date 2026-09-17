'use strict';
// Minimal Netlify Blobs client for Lambda-compatible functions, with no dependency. The runtime passes
// base64 JSON {url, token} as event.blobs plus the x-nf-site-id header — the same contract
// @netlify/blobs' connectLambda() reads (that package would pull OpenTelemetry into the committed
// node_modules). Edge reads are eventually consistent, which is acceptable for health state.

const DEFAULT_TIMEOUT_MS = 500;

function readContext(event) {
  try {
    if (!event || !event.blobs) return null;
    const data = JSON.parse(Buffer.from(event.blobs, 'base64').toString('utf8'));
    const headers = event.headers || {};
    const siteID = headers['x-nf-site-id'] || headers['X-Nf-Site-Id'];
    return data.url && data.token && siteID ? { url: data.url, token: data.token, siteID } : null;
  } catch (e) {
    return null;
  }
}

// Returns null when the Blobs context is absent (local runs, tests) so callers fall back to memory.
function createBlobStore(event, storeName, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctx = readContext(event);
  if (!ctx) return null;

  const request = async (method, key, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(`/${ctx.siteID}/site:${storeName}/${key}`, ctx.url).toString();
      return await fetch(url, {
        method,
        headers: { authorization: `Bearer ${ctx.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    kind: 'netlify-blobs',
    async getJSON(key) {
      const res = await request('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`blobs GET ${res.status}`);
      return res.json();
    },
    async setJSON(key, value) {
      const res = await request('PUT', key, JSON.stringify(value));
      if (!res.ok) throw new Error(`blobs PUT ${res.status}`);
    },
  };
}

module.exports = { createBlobStore };
