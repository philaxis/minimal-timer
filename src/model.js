export const MAX_DURATION = 7 * 24 * 60 * 60 * 1000;

export function createTimer({ title = '새 타이머', mode = 'timer', duration = 25 * 60_000, position = 0 } = {}) {
  if (!['timer', 'stopwatch'].includes(mode)) throw new Error('올바른 모드를 선택해주세요.');
  if (!Number.isInteger(duration) || duration < 1000 || duration > MAX_DURATION) throw new Error('시간은 1초부터 7일까지 설정할 수 있어요.');
  title = title.trim();
  if (!title || title.length > 60) throw new Error('이름은 1~60자로 입력해주세요.');
  return { id: crypto.randomUUID(), title, mode, duration, runDuration: duration, elapsed: 0, anchor: null, state: 'idle', position, runId: crypto.randomUUID(), revision: 0 };
}

export function elapsed(timer, now = Date.now()) {
  return timer.elapsed + (timer.state === 'running' ? Math.max(0, now - timer.anchor) : 0);
}

export function status(timer, now = Date.now()) {
  return timer.mode === 'timer' && elapsed(timer, now) >= timer.runDuration ? 'completed' : timer.state;
}

export function value(timer, now = Date.now()) {
  const passed = elapsed(timer, now);
  return timer.mode === 'stopwatch' ? passed : Math.max(0, timer.runDuration - passed);
}

export function transition(timer, action, data = {}, now = Date.now()) {
  const next = { ...timer };
  const current = status(timer, now);
  switch (action) {
    case 'toggle':
      if (current === 'completed') return timer;
      if (current === 'running') {
        next.elapsed = elapsed(timer, now);
        next.anchor = null;
        next.state = 'paused';
      } else {
        next.anchor = now;
        next.state = 'running';
      }
      break;
    case 'reset':
      Object.assign(next, { elapsed: 0, anchor: null, state: 'idle', runDuration: next.duration, runId: crypto.randomUUID() });
      break;
    case 'extend':
      if (timer.mode !== 'timer' || current !== 'running' || timer.runDuration + 60_000 > MAX_DURATION) return timer;
      next.runDuration += 60_000;
      break;
    case 'edit': {
      const valid = createTimer({ ...timer, ...data });
      Object.assign(next, { title: valid.title, duration: valid.duration, mode: valid.mode });
      if (timer.mode !== next.mode) return transition(next, 'reset', {}, now);
      break;
    }
    case 'position':
      if (!Number.isFinite(data.position)) throw new Error('올바르지 않은 순서입니다.');
      next.position = data.position;
      break;
    default: throw new Error('알 수 없는 동작입니다.');
  }
  return next;
}

export function duplicate(timer, position) {
  return createTimer({ title: `${timer.title.slice(0, 55)} 복사`, mode: timer.mode, duration: timer.duration, position });
}

export function formatTime(ms, mode = 'timer') {
  const seconds = Math.max(0, mode === 'timer' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  return h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function validTimer(timer) {
  return timer && /^[0-9a-f-]{36}$/i.test(timer.id) && typeof timer.title === 'string' && timer.title.trim().length > 0 && timer.title.length <= 60
    && ['timer', 'stopwatch'].includes(timer.mode) && ['idle', 'running', 'paused'].includes(timer.state)
    && Number.isInteger(timer.duration) && timer.duration >= 1000 && timer.duration <= MAX_DURATION
    && Number.isInteger(timer.runDuration) && timer.runDuration >= 1000 && timer.runDuration <= MAX_DURATION
    && Number.isFinite(timer.elapsed) && timer.elapsed >= 0 && timer.elapsed <= Number.MAX_SAFE_INTEGER
    && (timer.anchor === null || Number.isFinite(timer.anchor)) && (timer.state !== 'running' || Number.isFinite(timer.anchor))
    && Number.isFinite(timer.position) && /^[0-9a-f-]{36}$/i.test(timer.runId) && Number.isInteger(timer.revision) && timer.revision >= 0;
}
