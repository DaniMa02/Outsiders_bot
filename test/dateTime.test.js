import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFechaMadrid,
  formatHoraMadrid,
  isMadridDST
} from '../utils/dateTime.js';

test('Madrid DST starts at 01:00 UTC on the last Sunday in March', () => {
  assert.equal(isMadridDST(new Date('2026-03-29T00:59:59.000Z')), false);
  assert.equal(isMadridDST(new Date('2026-03-29T01:00:00.000Z')), true);
});

test('Madrid DST ends at 01:00 UTC on the last Sunday in October', () => {
  assert.equal(isMadridDST(new Date('2026-10-25T00:59:59.000Z')), true);
  assert.equal(isMadridDST(new Date('2026-10-25T01:00:00.000Z')), false);
});

test('formats event date and time in Europe/Madrid', () => {
  assert.equal(formatFechaMadrid('2026-01-01T23:30:00.000Z'), '2/1');
  assert.equal(formatHoraMadrid('2026-10-24T20:05:00.000Z'), '22:05');
});
