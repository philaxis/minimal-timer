import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, transition, value, status, duplicate, formatTime, validTimer, normalizeTimer, MAX_DURATION } from '../src/model.js';

test('independent clocks survive a suspended tab, pause/resume and reset to the latest saved duration', () => {
  const idle = createTimer({ duration: 10_000 });
  const running = transition(idle, 'toggle', {}, 1000);
  assert.equal(value(running, 5000), 6000);
  assert.equal(value(idle, 5000), 10_000);
  const paused = transition(running, 'toggle', {}, 5000);
  assert.equal(value(paused, 500_000), 6000);
  const resumed = transition(paused, 'toggle', {}, 500_000);
  const edited = transition(resumed, 'edit', { title: '바뀐 이름', duration: 30_000 }, 501_000);
  assert.equal(value(edited, 501_000), 5000);
  const extended = transition(edited, 'extend', {}, 501_000);
  assert.equal(value(extended, 501_000), 65_000);
  assert.equal(extended.duration, 30_000);
  const reset = transition(extended, 'reset');
  assert.equal(value(reset), 30_000);
  assert.equal(status(reset), 'idle');
  assert.notEqual(reset.runId, idle.runId);
  assert.equal(status(resumed, 900_000), 'completed');
  assert.strictEqual(transition(resumed, 'toggle', {}, 900_000), resumed);
  assert.strictEqual(transition(resumed, 'extend', {}, 900_000), resumed);
});

test('stopwatches count up, pause, clone fresh and reset when switching modes', () => {
  const timer = transition(createTimer({ mode: 'stopwatch' }), 'toggle', {}, 1000);
  assert.equal(value(timer, 3_601_000), 3_600_000);
  assert.equal(formatTime(value(timer, 3_601_000), 'stopwatch'), '01:00:00');
  assert.equal(value(transition(timer, 'toggle', {}, 4500), 9000), 3500);
  assert.strictEqual(transition(timer, 'extend'), timer);
  const copy = duplicate(timer, 8);
  assert.notEqual(copy.id, timer.id);
  assert.equal(copy.state, 'idle');
  assert.equal(copy.elapsed, 0);
  const switched = transition(timer, 'edit', { mode: 'timer', duration: 5000 });
  assert.equal(switched.state, 'idle');
  assert.equal(value(switched), 5000);
});

test('validate persisted data and input limits, formatting never completes early', () => {
  const timer = createTimer();
  assert.ok(validTimer(timer));
  assert.ok(!validTimer({ ...timer, state: 'running', anchor: null }));
  assert.ok(!validTimer({ ...timer, elapsed: NaN }));
  assert.throws(() => createTimer({ duration: -1 }));
  assert.throws(() => createTimer({ duration: MAX_DURATION + 1 }));
  assert.throws(() => createTimer({ title: ' ' }));
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(999, 'stopwatch'), '00:00');
  assert.equal(formatTime(0), '00:00');
  assert.equal(value(transition(timer, 'toggle', {}, 5000), 4000), timer.duration);
});

test('legacy timers gain safe metadata defaults and new metadata is validated', () => {
  const legacy = createTimer();
  delete legacy.tags; delete legacy.dueDate; delete legacy.priority; delete legacy.session;
  assert.deepEqual(normalizeTimer(legacy).tags, []);
  assert.equal(normalizeTimer(legacy).priority, 'normal');
  assert.equal(normalizeTimer(legacy).dueDate, null);
  assert.throws(() => createTimer({ tags: ['#bad//tag'] }));
  assert.throws(() => createTimer({ dueDate: '2026-02-30' }));
  assert.throws(() => createTimer({ priority: 'urgent' }));
  assert.equal(validTimer(createTimer({ tags: ['#SNU/수학'], dueDate: '2026-09-30', priority: 'high' })), true);
});
