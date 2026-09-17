'use strict';
// Per-invocation AI wiring for function handlers: binds the shared circuit/spend store (Netlify Blobs
// when the runtime provides it, in-memory otherwise) and creates a generation id + trace + budget.

const crypto = require('crypto');
const circuit = require('./circuit');
const config = require('./config');
const { createBlobStore } = require('./blob-store');

let loggedStore = false;

function initAiRequest(event, { maxCostUsd } = {}) {
  circuit.bindStore(createBlobStore(event, 'ai-routing'));
  if (!loggedStore) {
    console.log(`[ai] routing state store: ${circuit.storeKind()}`);
    loggedStore = true;
  }
  return {
    generationId: crypto.randomUUID(),
    trace: { attempts: [] },
    budget: { maxUsd: maxCostUsd !== undefined ? maxCostUsd : config.getRouterConfig().maxCostPerPitchUsd, spentUsd: 0 },
  };
}

// Persist breaker/spend state. Never throws and never waits long — it must not affect the response.
async function finishAiRequest(maxWaitMs = 800) {
  await Promise.race([circuit.flush(), new Promise(r => setTimeout(r, maxWaitMs))]);
}

// Roll a trace up into the fields the generation record and summary log need.
function summarizeTrace(trace) {
  const attempts = trace.attempts || [];
  const ok = attempts.filter(a => a.status === 'success');
  const final = ok[ok.length - 1] || null;
  const sum = (k) => attempts.reduce((s, a) => s + (a[k] || 0), 0);
  return {
    attemptsCount: attempts.filter(a => a.status !== 'skipped').length,
    providerUsed: final ? final.provider : null,
    modelUsed: final ? final.model : null,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    estimatedCostUsd: +sum('estCostUsd').toFixed(6),
    fallbackReasons: attempts.filter(a => a.fallbackReason).map(a => `${a.model}:${a.fallbackReason}`),
  };
}

module.exports = { initAiRequest, finishAiRequest, summarizeTrace };
