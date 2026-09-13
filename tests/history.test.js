import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyTagMatch, mergeSessions, normalizeTag, replaceTagPrefix, tagMatches, tagPrefixes, unionDuration, splitByDay, timelineLayout } from '../src/history.js';
import { createTimer, sessionRecord, transition } from '../src/model.js';

test('nested tags normalize, query descendants and merge without duplicates', () => {
  assert.equal(normalizeTag(' SNU / 26-2학기 / 선형대수학 '), '#SNU/26-2학기/선형대수학');
  assert.equal(normalizeTag('#SNU//수학'), null);
  assert.equal(tagMatches('#SNU/26-2학기/선형대수학', '#SNU'), true);
  assert.equal(tagMatches('#SNUT/선형대수학', '#SNU'), false);
  assert.equal(fuzzyTagMatch('#SNU/철학', 'S철'), true);
  assert.equal(fuzzyTagMatch('#SNU/수학', 'S철'), false);
  assert.deepEqual(tagPrefixes('#SNU/26-2학기/선형대수학'), ['#SNU', '#SNU/26-2학기', '#SNU/26-2학기/선형대수학']);
  assert.deepEqual(replaceTagPrefix(['#A/수학', '#B/수학', '#A/물리'], '#A', '#B'), ['#B/수학', '#B/물리']);
});

test('session snapshots survive edits, short pauses merge and short runs disappear', () => {
  const timer = createTimer({ title: '2.2 복습', tags: ['#SNU/선형대수학'], priority: 'high', dueDate: '2026-09-30' });
  const running = transition(timer, 'toggle', {}, 1_000);
  const paused = transition(running, 'toggle', {}, 13_000);
  const resumed = transition(paused, 'toggle', {}, 18_000);
  const edited = transition(resumed, 'edit', { title: '이름 변경', tags: ['#다른태그'], priority: 'low' }, 19_000);
  const pausedAgain = transition(edited, 'toggle', {}, 28_000);
  const record = sessionRecord(pausedAgain, 28_000);
  assert.equal(record.id, running.session.id);
  assert.equal(record.activeMs, 22_000);
  assert.equal(record.title, '2.2 복습');
  assert.deepEqual(record.tags, ['#SNU/선형대수학']);
  assert.equal(record.priority, 'high');
  assert.equal(record.segments.length, 2);
  const next = transition(pausedAgain, 'toggle', {}, 40_000);
  assert.notEqual(next.session.id, record.id);
  const short = transition(transition(createTimer(), 'toggle', {}, 0), 'toggle', {}, 9_999);
  assert.equal(sessionRecord(short, 9_999), null);
});

test('completed countdown records only until its deadline', () => {
  const timer = transition(createTimer({ duration: 10_000 }), 'toggle', {}, 5_000);
  const record = sessionRecord(timer, 30_000);
  assert.equal(record.endedAt, 15_000);
  assert.equal(record.activeMs, 10_000);
});

test('calendar totals count overlaps once and split sessions at timezone midnight', () => {
  assert.equal(unionDuration([[0, 20_000], [5_000, 10_000], [30_000, 40_000]]), 30_000);
  const parts = splitByDay({ startedAt: Date.UTC(2026, 8, 13, 14, 59, 55), endedAt: Date.UTC(2026, 8, 13, 15, 0, 5), segments: [[Date.UTC(2026, 8, 13, 14, 59, 55), Date.UTC(2026, 8, 13, 15, 0, 5)]] }, 'Asia/Seoul');
  assert.deepEqual(parts.map(part => [part.day, part.activeMs]), [['2026-09-13', 5_000], ['2026-09-14', 5_000]]);
});

test('timeline layout places overlapping sessions in separate columns', () => {
  const result = timelineLayout([
    { id: 'a', startedAt: 0, endedAt: 20 },
    { id: 'b', startedAt: 10, endedAt: 30 },
    { id: 'c', startedAt: 30, endedAt: 40 },
  ]);
  assert.deepEqual(result.map(item => [item.id, item.column]), [['a', 0], ['b', 1], ['c', 0]]);
  assert.equal(result[0].columns, 2);
  assert.equal(result[1].columns, 2);
});

test('offline and remote copies keep the longer idempotent session', () => {
  const base = { id: '11111111-1111-4111-8111-111111111111', timerId: '22222222-2222-4222-8222-222222222222', title: '공부', tags: [], priority: 'normal', mode: 'stopwatch', startedAt: 0, endedAt: 10_000, activeMs: 10_000, segments: [[0, 10_000]] };
  const longer = { ...base, endedAt: 20_000, activeMs: 20_000, segments: [[0, 20_000]] };
  assert.deepEqual(mergeSessions([base], [longer]), [longer]);
});
