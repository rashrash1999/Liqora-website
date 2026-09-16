import test from 'node:test';
import { memoryDb } from '../helpers/memory-db.mjs';
import { runScenarios } from '../helpers/service-scenarios.mjs';
test('complete business flow rejects unauthorized and duplicate state transitions', async () => {
  await runScenarios(memoryDb());
});
