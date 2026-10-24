import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCompositionLabel,
  getMaxRolesForEvent,
  getToggleCompositionLabel,
  isValidEventType
} from '../config/eventConfig.js';

test('accepts configured event types only', () => {
  assert.equal(isValidEventType('hell'), true);
  assert.equal(isValidEventType('hardcore'), true);
  assert.equal(isValidEventType('raid'), true);
  assert.equal(isValidEventType('unknown'), false);
});

test('uses the persisted Hardcore composition to determine role capacity', () => {
  assert.equal(getMaxRolesForEvent({ type: 'hardcore', composition: 0 }).debuffer, 1);
  assert.equal(getMaxRolesForEvent({ type: 'hardcore', composition: 1 }).debuffer, undefined);
  assert.equal(getMaxRolesForEvent({ type: 'hardcore' }).dd, 5);
  assert.deepEqual(getMaxRolesForEvent({ type: 'raid' }), {});
  assert.deepEqual(getMaxRolesForEvent({ type: 'unknown' }), {});
});

test('describes and toggles Hardcore compositions', () => {
  assert.match(getCompositionLabel({ type: 'hardcore', composition: 0 }), /4 DD/);
  assert.equal(getToggleCompositionLabel({ type: 'hardcore', composition: 0 }), '🔄 Cambiar a B');
  assert.equal(getToggleCompositionLabel({ type: 'hardcore', composition: 1 }), '🔄 Cambiar a A');
  assert.equal(getCompositionLabel({ type: 'raid' }), null);
});
