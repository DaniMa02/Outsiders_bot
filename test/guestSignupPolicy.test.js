import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGuestSignupCutoff,
  GUEST_ROLE_ID,
  isGuestSignupRestricted,
  memberHasGuestRole,
  SCHEDULED_GUEST_RESERVATION_MS
} from '../utils/guestSignupPolicy.js';

const eventStart = new Date('2026-10-05T00:00:00.000Z');

test('scheduled Hardcore guest cutoff is two hours before the event', () => {
  const cutoff = calculateGuestSignupCutoff(
    eventStart,
    new Date('2026-10-04T00:00:00.000Z'),
    true
  );

  assert.equal(SCHEDULED_GUEST_RESERVATION_MS, 2 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString(), '2026-10-04T22:00:00.000Z');
});

test('ad-hoc Hardcore guest cutoff is one quarter of the creation lead time', () => {
  const cutoff = calculateGuestSignupCutoff(
    eventStart,
    new Date('2026-10-04T23:00:00.000Z'),
    false
  );

  assert.equal(cutoff.toISOString(), '2026-10-04T23:45:00.000Z');
});

test('ad-hoc cutoff never precedes creation when an event has no lead time', () => {
  const cutoff = calculateGuestSignupCutoff(eventStart, eventStart, false);
  assert.equal(cutoff.getTime(), eventStart.getTime());
});

test('rejects invalid dates when calculating a cutoff', () => {
  assert.throws(
    () => calculateGuestSignupCutoff('not a date', eventStart, true),
    /No se pudo calcular/
  );
});

test('guests are restricted until, but not at, the cutoff', () => {
  const event = {
    type: 'hardcore',
    guest_signup_cutoff_at: '2026-10-04T22:00:00.000Z'
  };
  const cutoff = new Date(event.guest_signup_cutoff_at).getTime();

  assert.equal(isGuestSignupRestricted(event, cutoff - 1), true);
  assert.equal(isGuestSignupRestricted(event, cutoff), false);
});

test('restriction applies only to Hardcore events with a cutoff', () => {
  assert.equal(isGuestSignupRestricted({ type: 'hell', guest_signup_cutoff_at: '2099-01-01' }, 0), false);
  assert.equal(isGuestSignupRestricted({ type: 'hardcore' }, 0), false);
});

test('detects the configured Discord guest role safely', () => {
  assert.equal(GUEST_ROLE_ID, '1421888103773245440');
  assert.equal(memberHasGuestRole({ roles: { cache: new Map([[GUEST_ROLE_ID, {}]]) } }), true);
  assert.equal(memberHasGuestRole({ roles: { cache: new Map() } }), false);
  assert.equal(memberHasGuestRole(null), false);
});
