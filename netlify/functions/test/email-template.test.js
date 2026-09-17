'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/email-template');

test('email follows the founder live format with the observation inserted', () => {
  const body = t.buildEmailBody('the food shots are A1, but the lifestyle component is missing.');
  assert.ok(body.startsWith('Hey,\n\nI run BBO Stamped — we bring a curated group of 5+ women creators'));
  assert.ok(body.includes('I checked your page out and the food shots are A1, but the lifestyle component is missing. We should show people actually enjoying your place.'));
  assert.ok(body.includes("That's the gap BBO Stamped fills. We differ because you're getting 5+ content creators for the price of 1."));
  assert.ok(body.endsWith('Worth a 10-minute call this week? I can send the package breakdown. Check us out here: https://bbouniverse.com/pages/bbo-stamped'));
  assert.equal((body.match(/bbouniverse\.com/g) || []).length, 1, 'one CTA link');
});

test('observation is normalized to a mid-sentence clause', () => {
  assert.equal(t.cleanObservation('I checked your page out and The jollof rice looks incredible, but nobody is in the room.'), 'the jollof rice looks incredible, but nobody is in the room');
  assert.equal(t.cleanObservation('Island Social runs great themed nights, but the page is mostly flyers'), 'Island Social runs great themed nights, but the page is mostly flyers');
});

test('a missing or junk observation falls back to the template default', () => {
  assert.ok(t.buildEmailBody('').includes(`I checked your page out and ${t.FALLBACK_OBSERVATION}.`));
  assert.ok(t.buildEmailBody(undefined).includes(t.FALLBACK_OBSERVATION));
});
