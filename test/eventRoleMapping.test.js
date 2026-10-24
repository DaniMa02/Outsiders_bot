import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUserFulfillRole,
  getRoleRequirementText
} from '../config/eventRoleMapping.js';

test('checks the capabilities required for each event role', () => {
  assert.equal(canUserFulfillRole(['HTank'], 'tank'), true);
  assert.equal(canUserFulfillRole(['HHealer'], 'holy'), true);
  assert.equal(canUserFulfillRole(['HDD'], 'tank'), false);
  assert.equal(canUserFulfillRole(['HDD'], 'unknown'), false);
});

test('formats role requirements and unknown roles', () => {
  assert.equal(getRoleRequirementText('tank'), 'Requiere: Tank');
  assert.equal(getRoleRequirementText('holy'), 'Requiere: Holy');
  assert.equal(getRoleRequirementText('unknown'), 'Rol desconocido: unknown');
});
