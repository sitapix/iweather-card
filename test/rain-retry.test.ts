import assert from 'node:assert/strict';
import { test } from 'vitest';
import { failedWait } from '../src/map/rain-gl.ts';
import { MINUTE, SECOND } from '../src/lib/time.ts';

test('a failed radar tile waits half a minute, then twice as long each time, up to ten minutes', () => {
  const waits: number[] = [];
  let wait: number | undefined;
  for (let i = 0; i < 7; i += 1) {
    wait = failedWait(wait);
    waits.push(wait);
  }
  assert.deepEqual(waits, [30 * SECOND, MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE, 10 * MINUTE, 10 * MINUTE]);
});
