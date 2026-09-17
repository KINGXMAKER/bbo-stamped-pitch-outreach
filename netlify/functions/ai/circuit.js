'use strict';
// Circuit breaker for AI models/providers.
//
//   HEALTHY ──failure──▶ DEGRADED ──threshold failures in window──▶ OPEN
//      ▲                    │ success                                 │ cooldown elapsed (prober)
//      └────────────────────┘                                         ▼
//      └──────────── required consecutive probe successes ──────── PROBING ──probe failure──▶ OPEN (cooldown x2)
//
// Normal traffic only goes to HEALTHY / DEGRADED models, so customers never rediscover a known-broken
// model. OPEN / PROBING models are restored ONLY by successful health probes (ai-health-probe).
//
// Transition functions are pure (entry in, new entry out) so they are unit-testable. State is shared
// across function instances through one Netlify Blobs document, cached in memory per instance.

const { getCircuitConfig } = require('./config');

const STATES = { HEALTHY: 'HEALTHY', DEGRADED: 'DEGRADED', OPEN: 'OPEN', PROBING: 'PROBING' };
const STATE_KEY = 'ai-state-v1';

// Failures that indicate capacity/availability trouble. Auth/bad-request errors are config problems
// and never trip the breaker (they would open every model sharing the bad key).
const CIRCUIT_ERROR_CLASSES = new Set(['quota', 'transient', 'timeout', 'network', 'unavailable']);

const fresh = () => ({ state: STATES.HEALTHY, failures: [], openedAt: null, cooldownMs: null,
  probeSuccesses: 0, lastErrorCode: null, updatedAt: 0 });

function recentFailures(entry, now, cfg) {
  return (entry.failures || []).filter(ts => now - ts <= cfg.windowMs);
}

function isRoutable(entry) {
  return !entry || entry.state === STATES.HEALTHY || entry.state === STATES.DEGRADED;
}

function applyFailure(entry, errorClass, errorCode, now, cfg) {
  const base = entry || fresh();
  if (!CIRCUIT_ERROR_CLASSES.has(errorClass)) return base;
  if (base.state === STATES.OPEN || base.state === STATES.PROBING) {
    // A failure while already open (fail-safe attempt or probe) re-opens with a longer cooldown.
    return reopen(base, errorCode, now, cfg);
  }
  const failures = [...recentFailures(base, now, cfg), now];
  if (failures.length >= cfg.failureThreshold) {
    return { ...base, state: STATES.OPEN, failures, openedAt: now, cooldownMs: cfg.cooldownMs,
      probeSuccesses: 0, lastErrorCode: errorCode, updatedAt: now };
  }
  return { ...base, state: STATES.DEGRADED, failures, lastErrorCode: errorCode, updatedAt: now };
}

function reopen(entry, errorCode, now, cfg) {
  const cooldownMs = Math.min((entry.cooldownMs || cfg.cooldownMs) * 2, cfg.maxCooldownMs);
  return { ...entry, state: STATES.OPEN, openedAt: now, cooldownMs, probeSuccesses: 0,
    lastErrorCode: errorCode, updatedAt: now };
}

// Normal-traffic success: only meaningful for routable models.
function applySuccess(entry, now) {
  const base = entry || fresh();
  if (base.state === STATES.HEALTHY && !(base.failures || []).length) return base;
  if (base.state === STATES.OPEN || base.state === STATES.PROBING) return applyProbeResult(base, true, null, now, getCircuitConfig());
  return { ...fresh(), updatedAt: now };
}

function isDueForProbe(entry, now) {
  if (!entry) return false;
  if (entry.state === STATES.PROBING) return true;
  return entry.state === STATES.OPEN && now - entry.openedAt >= (entry.cooldownMs || 0);
}

function applyProbeResult(entry, ok, errorCode, now, cfg) {
  const base = entry || fresh();
  if (!ok) return reopen(base, errorCode, now, cfg);
  const probeSuccesses = (base.probeSuccesses || 0) + 1;
  if (probeSuccesses >= cfg.probeSuccessesRequired) return { ...fresh(), updatedAt: now };
  return { ...base, state: STATES.PROBING, probeSuccesses, updatedAt: now };
}

// ---- shared state manager --------------------------------------------------------------------------

let memory = { circuits: {}, spend: { date: null, usd: 0 }, probes: {} };
let spendDelta = 0;
let store = null;
let loadedAt = 0;
let dirty = false;
const CACHE_TTL_MS = 5000;

function bindStore(blobStore) { store = blobStore; }
function storeKind() { return store ? store.kind : 'memory'; }

async function load({ force = false } = {}) {
  if (!store || (!force && Date.now() - loadedAt < CACHE_TTL_MS)) return memory;
  try {
    const remote = await store.getJSON(STATE_KEY);
    if (remote) memory = merge(memory, remote);
    loadedAt = Date.now();
  } catch (e) {
    console.warn(`[ai-circuit] state load failed (${e.message}) — using in-memory state`);
  }
  return memory;
}

// Newest entry wins per model; spend adds this instance's unflushed delta onto the remote total.
function merge(local, remote) {
  const circuits = { ...(remote.circuits || {}) };
  for (const [key, entry] of Object.entries(local.circuits || {})) {
    if (!circuits[key] || (entry.updatedAt || 0) > (circuits[key].updatedAt || 0)) circuits[key] = entry;
  }
  const probes = { ...(remote.probes || {}), ...(local.probes || {}) };
  const spend = remote.spend && remote.spend.date ? { ...remote.spend } : { ...(local.spend || {}) };
  return { circuits, spend, probes };
}

async function flush() {
  if (!store || !dirty) return;
  try {
    const remote = (await store.getJSON(STATE_KEY)) || { circuits: {}, spend: { date: null, usd: 0 }, probes: {} };
    const merged = merge(memory, remote);
    const today = utcDate();
    const remoteUsd = merged.spend.date === today ? merged.spend.usd || 0 : 0;
    merged.spend = { date: today, usd: +(remoteUsd + spendDelta).toFixed(6) };
    await store.setJSON(STATE_KEY, merged);
    memory = merged;
    spendDelta = 0;
    dirty = false;
  } catch (e) {
    console.warn(`[ai-circuit] state flush failed (${e.message}) — state kept in memory for this instance`);
  }
}

const utcDate = () => new Date().toISOString().slice(0, 10);

function get(key) { return memory.circuits[key] || null; }

function set(key, entry) {
  if (entry === memory.circuits[key]) return;
  memory = { ...memory, circuits: { ...memory.circuits, [key]: entry } };
  dirty = true;
}

function recordFailure(key, errorClass, errorCode) {
  set(key, applyFailure(get(key), errorClass, errorCode, Date.now(), getCircuitConfig()));
}

function recordSuccess(key) { set(key, applySuccess(get(key), Date.now())); }

function recordProbe(key, ok, errorCode, latencyMs) {
  const now = Date.now();
  const entry = get(key);
  // Probes of a HEALTHY model only record telemetry; they never demote or promote it.
  if (!entry || entry.state === STATES.HEALTHY || entry.state === STATES.DEGRADED) {
    if (!ok && entry && entry.state === STATES.DEGRADED) recordFailure(key, 'transient', errorCode);
  } else {
    set(key, applyProbeResult(entry, ok, errorCode, now, getCircuitConfig()));
  }
  const prev = memory.probes[key] || { ok: 0, failed: 0 };
  memory = { ...memory, probes: { ...memory.probes, [key]: { ok: prev.ok + (ok ? 1 : 0),
    failed: prev.failed + (ok ? 0 : 1), lastAt: now, lastOk: ok, lastLatencyMs: latencyMs, lastErrorCode: errorCode || null } } };
  dirty = true;
}

function lastProbeAt(key) { return (memory.probes[key] || {}).lastAt || 0; }

function spentTodayUsd() {
  const base = memory.spend && memory.spend.date === utcDate() ? memory.spend.usd || 0 : 0;
  return base + spendDelta;
}

function addSpend(usd) {
  if (!(usd > 0)) return;
  spendDelta += usd;
  dirty = true;
}

function snapshot() { return { store: storeKind(), ...memory, spend: { date: utcDate(), usd: +spentTodayUsd().toFixed(6) } }; }

// Test hook.
function _reset() { memory = { circuits: {}, spend: { date: null, usd: 0 }, probes: {} }; spendDelta = 0; store = null; loadedAt = 0; dirty = false; }

module.exports = {
  STATES, CIRCUIT_ERROR_CLASSES,
  isRoutable, applyFailure, applySuccess, applyProbeResult, isDueForProbe,
  bindStore, storeKind, load, flush, get, recordFailure, recordSuccess, recordProbe, lastProbeAt,
  spentTodayUsd, addSpend, snapshot, _reset,
};
