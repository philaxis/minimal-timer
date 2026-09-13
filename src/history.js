export const MIN_SESSION_MS = 10_000;

export function normalizeTag(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.startsWith('##')) return null;
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  if (body.includes('//')) return null;
  const parts = body.split('/').map(part => part.trim());
  if (parts.some(part => !part || part.includes('#'))) return null;
  const path = `#${parts.join('/')}`;
  return path.length <= 120 ? path : null;
}

export function tagMatches(path, parent) {
  const tag = normalizeTag(path), query = normalizeTag(parent);
  return !!tag && !!query && (tag === query || tag.startsWith(`${query}/`));
}

export function tagPrefixes(path) {
  path = normalizeTag(path);
  if (!path) return [];
  const parts = path.slice(1).split('/');
  return parts.map((_, index) => `#${parts.slice(0, index + 1).join('/')}`);
}

export function replaceTagPrefix(paths, source, target) {
  source = normalizeTag(source); target = normalizeTag(target);
  if (!source || !target || target.startsWith(`${source}/`)) throw new Error('하위 태그로 이름을 바꿀 수 없어요.');
  return [...new Set(paths.map(path => tagMatches(path, source) ? `${target}${path.slice(source.length)}` : path))];
}

export function unionDuration(segments) {
  const sorted = segments.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0, start = null, end = null;
  for (const segment of sorted) {
    if (start === null) [start, end] = segment;
    else if (segment[0] <= end) end = Math.max(end, segment[1]);
    else { total += end - start; [start, end] = segment; }
  }
  return total + (start === null ? 0 : end - start);
}

export function validTimezone(timezone) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true; }
  catch { return false; }
}

export function dayKey(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nextDayBoundary(start, end, timezone, day) {
  if (dayKey(end - 1, timezone) === day) return end;
  let low = start + 1, high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayKey(middle, timezone) === day) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function splitByDay(session, timezone) {
  if (!validTimezone(timezone)) throw new Error('올바른 시간대를 선택해주세요.');
  const days = new Map();
  for (const [segmentStart, segmentEnd] of session.segments || []) {
    let start = segmentStart;
    while (start < segmentEnd) {
      const day = dayKey(start, timezone), end = nextDayBoundary(start, segmentEnd, timezone, day);
      const part = days.get(day) || { ...session, day, activeMs: 0, segments: [] };
      part.segments.push([start, end]); part.activeMs += end - start; days.set(day, part);
      start = end;
    }
  }
  return [...days.values()].map(part => ({ ...part, startedAt: part.segments[0][0], endedAt: part.segments.at(-1)[1] })).sort((a, b) => a.day.localeCompare(b.day));
}

export function validSession(session) {
  return session && /^[0-9a-f-]{36}$/i.test(session.id) && /^[0-9a-f-]{36}$/i.test(session.timerId)
    && typeof session.title === 'string' && session.title.trim().length > 0 && session.title.length <= 60
    && Array.isArray(session.tags) && session.tags.length <= 20 && session.tags.every(tag => normalizeTag(tag) === tag)
    && ['low', 'normal', 'high'].includes(session.priority) && ['timer', 'stopwatch'].includes(session.mode)
    && Number.isFinite(session.startedAt) && Number.isFinite(session.endedAt) && session.endedAt >= session.startedAt
    && Number.isFinite(session.activeMs) && session.activeMs >= MIN_SESSION_MS
    && Array.isArray(session.segments) && session.segments.every(segment => Array.isArray(segment) && segment.length === 2 && Number.isFinite(segment[0]) && Number.isFinite(segment[1]) && segment[1] >= segment[0]);
}

export function mergeSessions(...lists) {
  const merged = new Map();
  for (const session of lists.flat()) if (validSession(session) && (!merged.has(session.id) || merged.get(session.id).activeMs <= session.activeMs)) merged.set(session.id, session);
  return [...merged.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

export function timelineLayout(sessions) {
  const result = [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt || a.id.localeCompare(b.id)).map(item => ({ ...item }));
  let active = [], cluster = [], maxColumns = 0;
  const finish = () => { for (const item of cluster) item.columns = maxColumns; cluster = []; maxColumns = 0; };
  for (const item of result) {
    active = active.filter(entry => entry.endedAt > item.startedAt);
    if (!active.length && cluster.length) finish();
    const used = new Set(active.map(entry => entry.column));
    let column = 0; while (used.has(column)) column++;
    item.column = column; active.push(item); cluster.push(item); maxColumns = Math.max(maxColumns, column + 1);
  }
  if (cluster.length) finish();
  return result;
}
