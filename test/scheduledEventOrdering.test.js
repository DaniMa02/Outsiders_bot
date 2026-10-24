import test from 'node:test';
import assert from 'node:assert/strict';
import { groupScheduledEventTemplates } from '../utils/scheduledEventOrdering.js';

const template = (id, overrides = {}) => ({
  id,
  active: true,
  send_time: '22:00',
  event_time: '22:00',
  days_of_week: '0,1,2,3,4,5,6',
  created_at: `2026-10-01T00:00:0${id}.000Z`,
  ...overrides
});

test('groups templates sharing a trigger and orders them by event start time', () => {
  const groups = groupScheduledEventTemplates([
    template(1, { title: 'Late Hell', event_time: '22:05' }),
    template(2, { title: 'Early Hell', event_time: '17:05' })
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(item => item.title), ['Early Hell', 'Late Hell']);
});

test('normalizes weekdays when grouping templates', () => {
  const groups = groupScheduledEventTemplates([
    template(1, { days_of_week: '1,2,3' }),
    template(2, { days_of_week: '3, 1, 2' })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

test('keeps different triggers or weekdays in separate groups', () => {
  const groups = groupScheduledEventTemplates([
    template(1),
    template(2, { send_time: '23:00' }),
    template(3, { days_of_week: '1,2' })
  ]);

  assert.equal(groups.length, 3);
});

test('skips inactive templates and templates without a trigger time', () => {
  const groups = groupScheduledEventTemplates([
    template(1, { active: false }),
    template(2, { send_time: '' })
  ]);

  assert.deepEqual(groups, []);
});

test('breaks ties by creation timestamp and puts invalid start times last', () => {
  const groups = groupScheduledEventTemplates([
    template(1, { event_time: 'invalid', created_at: '2026-10-01T00:00:01.000Z' }),
    template(2, { event_time: '17:05', created_at: '2026-10-01T00:00:02.000Z' }),
    template(3, { event_time: '17:05', created_at: '2026-10-01T00:00:01.000Z' })
  ]);

  assert.deepEqual(groups[0].map(item => item.id), [3, 2, 1]);
});
