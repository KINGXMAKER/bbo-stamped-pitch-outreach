'use strict';
// Read-only routing health: current route, disabled models, circuit states, probe telemetry and
// today's estimated AI spend. Exposes model names and states only — never keys or prompts.

const config = require('./ai/config');
const circuit = require('./ai/circuit');
const { initAiRequest } = require('./ai/request-context');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  initAiRequest(event);
  await circuit.load({ force: true });
  const snap = circuit.snapshot();
  const cfg = config.getRouterConfig();
  const route = config.getRoute().map(c => {
    const entry = snap.circuits[c.key] || null;
    return { provider: c.provider, model: c.model, disabled: c.disabled, supportsImages: c.supportsImages,
      pricePer1M: c.price, state: c.disabled ? 'DISABLED' : (entry ? entry.state : 'HEALTHY'),
      lastErrorCode: entry ? entry.lastErrorCode : null, openedAt: entry && entry.openedAt ? new Date(entry.openedAt).toISOString() : null,
      probes: snap.probes[c.key] || null };
  });
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      store: snap.store,
      route,
      limits: { attemptWindowsMs: cfg.attemptWindowsMs, minAttemptMs: cfg.minAttemptMs, sameModelRetries: cfg.sameModelRetries,
        maxCostPerPitchUsd: cfg.maxCostPerPitchUsd, dailyBudgetUsd: cfg.dailyBudgetUsd, freeTier: cfg.freeTier },
      spendToday: snap.spend,
    }, null, 2),
  };
};
