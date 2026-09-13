import './style.css';
import { createTimer, transition, duplicate, value, status, formatTime, normalizeTimer, sessionRecord } from './model.js';
import { dayKey, fuzzyTagMatch, mergeSessions, normalizeTag, replaceTagPrefix, splitByDay, tagMatches, tagPrefixes, timelineLayout, unionDuration, validSession, validTimezone } from './history.js';
import { client, readTimers, saveTimer, watchTimers, registerPush, removePush, readTags, saveTag, archiveTag, mergeTag, readSessions, saveSession, deleteSession, readTimezone, saveTimezone } from './cloud.js';

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M12 10v4l2.5 1.5M9 2h6M12 2v4M18 6l2-2"/>',
  watch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3-2M9 2h6M12 2v3"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3 1-1h4l1 3 3 1 3 2v4l-2 2-1 3-2 3h-4l-2-2-3-1-3-2v-4l2-2 1-3Z"/>',
  sliders: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6"/>',
  play: '<path fill="currentColor" stroke="none" d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 12-12"/>',
  cloudOff: '<path d="M7 17H6a4 4 0 1 1 1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9h-2M10 15l4 4m0-4-4 4"/>',
  cloud: '<path d="M7 18H6a4 4 0 1 1 1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9h-2M9 17l2 2 4-4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke-width="2.5"/>',
  tag: '<path d="M20 13 13 20 4 11V4h7l9 9Z"/><path d="M8 8h.01" stroke-width="3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.timer}</svg>`;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = selector => document.querySelector(selector);
const BASE = import.meta.env.BASE_URL;
const GUEST_KEY = 'tempo.guest.v1';
let storageError = false;
function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
  catch { storageError = true; backupStorage(key); return fallback; }
}
function backupStorage(key) {
  try { const raw = localStorage.getItem(key); if (raw !== null) localStorage.setItem(`${key}.recovery`, raw); } catch { /* Preserve the original if storage itself is unavailable. */ }
}
function write(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; }
  catch { toast('브라우저에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해주세요.', true); return false; }
}
function readBoard(key, fallback = []) {
  const data = read(key, fallback);
  const normalized = Array.isArray(data) ? data.map(normalizeTimer) : [];
  if (!Array.isArray(data) || normalized.some(timer => !timer)) {
    storageError = true;
    backupStorage(key);
    return [];
  }
  return normalized;
}
const initial = () => [
  createTimer({ title: '딴짓', duration: 5 * 60_000, position: 0 }),
  createTimer({ title: '수학', duration: 25 * 60_000, position: 1 }),
  createTimer({ title: '총 공부시간', mode: 'stopwatch', position: 2 }),
];
let timers = readBoard(GUEST_KEY, initial());
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const sideKey = (kind, key = activeKey) => `${key}.${kind}`;
function readTagList(key = GUEST_KEY) {
  const data = read(sideKey('tags', key), []);
  return Array.isArray(data) ? data.filter(tag => tag && normalizeTag(tag.path) === tag.path && typeof tag.archived === 'boolean') : [];
}
function readSessionList(key = GUEST_KEY) {
  const data = read(sideKey('sessions', key), []);
  return Array.isArray(data) ? data.filter(validSession) : [];
}
let tags = readTagList(), sessions = readSessionList(), sessionQueue = read(sideKey('sessionQueue', GUEST_KEY), []).filter(validSession), timezone = read(sideKey('timezone', GUEST_KEY), deviceTimezone);
if (!validTimezone(timezone)) timezone = deviceTimezone;
const savedPrefs = read('tempo.preferences', {});
let prefs = { sound: false, notifications: false, cardSize: 0, sortMode: 'due', ...savedPrefs, push: savedPrefs.push ?? savedPrefs.notifications ?? false };
prefs.cardSize = Math.max(0, Math.min(2, Number(prefs.cardSize) || 0));
if (!['due', 'priority', 'manual'].includes(prefs.sortMode)) prefs.sortMode = 'due';
let selectedTags = [], recentTags = read('tempo.recentTags', []);
if (!Array.isArray(recentTags)) recentTags = [];
let user = null, channel = null, cloudReady = false, connected = false, syncing = false;
let activeKey = GUEST_KEY, editingId = null, editingTag = null, deferredInstall = null, audioContext, alarmTimer, drag = null;
let view = 'timers', calendarMonth = dayKey(Date.now(), timezone).slice(0, 7), selectedDay = null;
let noticeTimeout, authGeneration = 0;
let queue = Promise.resolve();
const pending = new Map();
const revisions = new Map();
const failedWrites = new Set();
const notified = new Set(read('tempo.notified', []));
let clockOffset = Number(read('tempo.clockOffset', 0)) || 0;
const clockNow = () => Date.now() + clockOffset;
const authCallbackPopup = !!window.opener && new URLSearchParams(location.search).has('code');

$('#app').innerHTML = `
  <header class="topbar"><a class="brand" href="${BASE}" aria-label="minimal timer 홈">minimal timer</a>
    <div class="top-actions"><button class="icon-button cloud-status" id="cloud-button" aria-label="기기 간 연동 안 됨" title="기기 간 연동 안 됨">${icon('cloudOff')}</button><span class="top-divider"></span><button class="icon-button" id="preferences-button" aria-label="앱 설정">${icon('sliders')}</button><button class="login-button" id="login-button"><span class="google-g">G</span><span id="login-label">Google 로그인</span></button></div>
  </header>
  <main><div class="view-bar"><nav class="view-tabs" aria-label="보기"><button id="timers-view" class="active">${icon('list')} 타이머</button><button id="calendar-view">${icon('calendar')} 달력</button><button id="due-view">${icon('tag')} 마감별</button></nav><div class="view-controls"><select id="timer-sort" aria-label="타이머 정렬"><option value="due">마감일순</option><option value="priority">중요도순</option><option value="manual">직접 정렬</option></select><div class="size-controls" aria-label="블록 크기"><button id="size-down" aria-label="블록 작게">−</button><button id="size-up" aria-label="블록 크게">+</button></div></div></div><section class="workspace" id="timer-workspace" aria-label="타이머">
      <div class="timer-grid" id="timer-grid"></div>
    </section><section class="calendar-workspace" id="calendar-workspace" aria-label="달력" hidden><div class="calendar-toolbar"><button class="icon-button" id="previous-month" aria-label="이전 달">${icon('left')}</button><h1 id="calendar-title"></h1><button class="icon-button" id="next-month" aria-label="다음 달">${icon('right')}</button><select id="calendar-tag-filter" aria-label="태그 필터"><option value="">모든 태그</option></select><select id="calendar-priority-filter" aria-label="중요도 필터"><option value="">모든 중요도</option><option value="high">높음</option><option value="normal">보통</option><option value="low">낮음</option></select></div><div class="month-grid" id="month-grid"></div></section><section id="due-workspace" aria-label="마감별" hidden><div id="due-groups"></div></section>
  </main>
  <dialog id="timer-dialog"><form id="timer-form"><div class="dialog-heading"><h2 id="dialog-title">새 타이머</h2><button class="icon-button" type="button" data-close="timer-dialog" aria-label="닫기">${icon('close')}</button></div>
    <label class="field-label" for="timer-name">이름</label><input id="timer-name" name="title" maxlength="60" placeholder="비워두면 자동 지정" autocomplete="off" />
    <fieldset class="mode-picker"><legend class="field-label">모드</legend><label><input type="radio" name="mode" value="timer" checked><span>${icon('timer')} 타이머</span></label><label><input type="radio" name="mode" value="stopwatch"><span>${icon('watch')} 스톱워치</span></label></fieldset>
    <div id="duration-fields"><span class="field-label">설정 시간</span><div class="duration-inputs"><label><input name="hours" type="number" min="0" max="168" value="0" inputmode="numeric" required><span>시간</span></label><b>:</b><label><input name="minutes" type="number" min="0" max="59" value="25" inputmode="numeric" required><span>분</span></label><b>:</b><label><input name="seconds" type="number" min="0" max="59" value="0" inputmode="numeric" required><span>초</span></label></div></div>
    <div class="metadata-fields"><label><span class="field-label">종료일</span><input name="dueDate" type="date"></label><label><span class="field-label">중요도</span><select name="priority"><option value="low">낮음</option><option value="normal" selected>보통</option><option value="high">높음</option></select></label></div>
    <fieldset class="tag-picker"><legend class="field-label">태그</legend><input id="timer-tag-search" type="search" placeholder="태그 검색" autocomplete="off"><div class="selected-tags" id="selected-tags"></div><div class="tag-suggestions" id="timer-tag-options"></div></fieldset>
    <p class="field-note" id="mode-note">설정한 시간부터 거꾸로 셉니다.</p><p class="form-error" id="form-error" role="alert"></p>
    <div class="dialog-tools" id="edit-tools"><button type="button" class="text-button" id="duplicate-button">${icon('copy')} 복제</button><button type="button" class="text-button" id="move-first-button">${icon('arrow')} 맨 앞으로</button><button type="button" class="text-button danger" id="delete-button">${icon('trash')} 삭제</button></div>
    <button class="primary-button full-width" type="submit" id="save-button">만들기 ${icon('plus')}</button></form></dialog>
  <dialog id="preferences-dialog"><div class="dialog-heading"><h2>설정</h2><button class="icon-button" data-close="preferences-dialog" aria-label="닫기">${icon('close')}</button></div>
    <section class="settings-section"><div class="settings-label"><strong>태그</strong><small>경로로 범주 만들기</small></div><form id="tag-add-form" class="inline-form"><input id="new-tag" maxlength="120" placeholder="#SNU/26-2학기"><button class="secondary-button" type="submit">추가</button></form><div class="tag-list" id="tag-list"></div></section>
    <section class="settings-section"><label class="settings-label" for="timezone-input"><strong>시간대</strong><small>달력의 날짜 기준</small></label><div class="inline-form"><input id="timezone-input" list="timezone-options" maxlength="64"><button class="secondary-button" id="save-timezone" type="button">저장</button></div><datalist id="timezone-options"></datalist></section>
    <div class="preference-row"><div>${icon('bell')}<span><strong>완료 알림</strong><small>이 기기에서 알림 받기</small></span></div><label class="switch"><input id="notification-toggle" type="checkbox" aria-label="완료 알림"><span></span></label></div>
    <div class="preference-row"><div>${icon('sound')}<span><strong>알림 소리</strong><small>앱이 열려 있을 때 짧은 소리</small></span></div><label class="switch"><input id="sound-toggle" type="checkbox" aria-label="알림 소리"><span></span></label></div>
    <p class="field-note">앱을 닫았을 때 알림 소리는 기기의 알림 설정을 따릅니다.</p><button class="text-button" id="test-notification">${icon('bell')} 알림 테스트</button>
    <div class="settings-account"><span id="account-description">이 브라우저에 저장 중</span><button class="text-button" id="account-action">Google 로그인 ${icon('cloud')}</button></div>
    <button class="secondary-button full-width" id="install-button">${icon('download')} 앱 설치</button><p class="field-note" id="install-note"></p></dialog>
  <dialog id="delete-dialog"><div class="dialog-heading"><h2>타이머를 삭제할까요?</h2><button class="icon-button" data-close="delete-dialog" aria-label="닫기">${icon('close')}</button></div><p id="delete-description"></p><div class="confirm-actions"><button class="secondary-button" data-close="delete-dialog">취소</button><button class="primary-button danger-fill" id="confirm-delete">삭제하기</button></div></dialog>
  <dialog id="tag-dialog"><form id="tag-rename-form"><div class="dialog-heading"><h2>태그 이름 변경</h2><button class="icon-button" type="button" data-close="tag-dialog" aria-label="닫기">${icon('close')}</button></div><p class="field-note" id="tag-source"></p><label class="field-label" for="tag-target">새 경로</label><input id="tag-target" maxlength="120" required><p class="field-note">기존 경로를 입력하면 두 태그가 합쳐집니다.</p><p class="form-error" id="tag-error" role="alert"></p><button class="primary-button full-width" type="submit">변경</button></form></dialog>
  <dialog id="day-dialog" class="day-dialog"><div class="dialog-heading"><h2 id="day-title"></h2><button class="icon-button" data-close="day-dialog" aria-label="닫기">${icon('close')}</button></div><div id="day-summary"></div><div class="day-timeline" id="day-timeline"></div></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;

function toast(message, error = false) {
  const el = $('#toast');
  (document.querySelector('dialog[open]') || document.body).append(el);
  clearTimeout(noticeTimeout);
  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  noticeTimeout = setTimeout(() => { el.hidden = true; }, error ? 7000 : 3500);
}
function persist() { return write(activeKey, timers); }
function persistWorkspace() {
  persist(); write(sideKey('tags'), tags); write(sideKey('sessions'), sessions); write(sideKey('timezone'), timezone);
}
function savePrefs() { write('tempo.preferences', prefs); }
const priorityRank = { high: 0, normal: 1, low: 2 };
function ordered(mode = prefs.sortMode) {
  return [...timers].sort((a, b) => {
    const position = a.position - b.position || a.id.localeCompare(b.id);
    const due = (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99');
    const priority = priorityRank[a.priority] - priorityRank[b.priority];
    return mode === 'due' ? due || priority || position : mode === 'priority' ? priority || due || position : position;
  });
}
function nextPosition() { return Math.max(-1, ...timers.map(t => t.position)) + 1; }
function activeTags() { return tags.filter(tag => !tag.archived).sort((a, b) => a.path.localeCompare(b.path, 'ko')); }
function filterTags() {
  const paths = new Set(activeTags().map(tag => tag.path));
  for (const session of sessions) for (const path of session.tags) {
    const parts = path.slice(1).split('/');
    for (let index = 1; index <= parts.length; index++) paths.add(`#${parts.slice(0, index).join('/')}`);
  }
  return [...paths].sort((a, b) => a.localeCompare(b, 'ko'));
}
function formatMinutes(ms) { return ms < 60_000 ? `${Math.floor(ms / 1000)}초` : `${Math.round(ms / 60_000)}분`; }
function dueLabel(date) {
  if (!date) return '';
  const today = dayKey(Date.now(), timezone), days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const short = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
  return `${short} · ${days === 0 ? '오늘' : days > 0 ? `D-${days}` : `D+${-days}`}`;
}
function filtered(session) {
  const tag = $('#calendar-tag-filter')?.value, priority = $('#calendar-priority-filter')?.value;
  return (!tag || session.tags.some(path => tagMatches(path, tag))) && (!priority || session.priority === priority);
}
function sessionParts(day = null) {
  return sessions.filter(filtered).flatMap(session => splitByDay(session, timezone)).filter(part => !day || part.day === day);
}
function upsertLocalSession(entry) {
  if (!entry) return false;
  const index = sessions.findIndex(session => session.id === entry.id);
  if (index >= 0 && sessions[index].activeMs > entry.activeMs) return false;
  if (index >= 0) sessions[index] = entry;
  else sessions.push(entry);
  write(sideKey('sessions'), sessions); renderCalendar();
  return true;
}
function saveTimerSession(timer, now = clockNow()) {
  const entry = sessionRecord(timer, now);
  if (!entry || !upsertLocalSession(entry) || !user) return;
  sessionQueue = sessionQueue.filter(item => item.id !== entry.id).concat(entry); write(sideKey('sessionQueue'), sessionQueue);
  if (!cloudReady) return;
  queue = queue.then(() => saveSession(entry)).then(() => {
    sessionQueue = sessionQueue.filter(item => item.id !== entry.id); write(sideKey('sessionQueue'), sessionQueue);
  }).catch(error => toast(error.message || '기록을 동기화하지 못했어요.', true));
}
function localClock(ms) {
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  return `${parts.find(part => part.type === 'hour').value}:${parts.find(part => part.type === 'minute').value}`;
}
function localMinute(ms) {
  const [hour, minute] = localClock(ms).split(':').map(Number);
  return hour * 60 + minute;
}

function renderCalendar() {
  if (view !== 'calendar') return;
  const [year, month] = calendarMonth.split('-').map(Number), days = new Date(Date.UTC(year, month, 0)).getUTCDate(), offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  $('#calendar-title').textContent = `${year}년 ${month}월`;
  const tagValue = $('#calendar-tag-filter').value;
  $('#calendar-tag-filter').innerHTML = '<option value="">모든 태그</option>' + filterTags().map(path => `<option value="${escape(path)}">${escape(path)}</option>`).join('');
  $('#calendar-tag-filter').value = tagValue;
  const parts = sessionParts(), byDay = new Map();
  for (const part of parts) {
    const list = byDay.get(part.day) || []; list.push(part); byDay.set(part.day, list);
  }
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'].map(day => `<span class="weekday">${day}</span>`).join('');
  let cells = '<span class="calendar-pad"></span>'.repeat(offset);
  for (let date = 1; date <= days; date++) {
    const key = `${calendarMonth}-${String(date).padStart(2, '0')}`, entries = byDay.get(key) || [];
    const total = unionDuration(entries.flatMap(entry => entry.segments));
    const names = new Map(); for (const entry of entries) names.set(entry.title, (names.get(entry.title) || 0) + entry.activeMs);
    const due = timers.filter(timer => timer.dueDate === key && filtered({ tags: timer.tags, priority: timer.priority }));
    const today = key === dayKey(Date.now(), timezone);
    cells += `<button class="calendar-day${today ? ' today' : ''}" data-day="${key}" aria-label="${key}"><span class="date-number">${date}</span>${total ? `<strong>${formatMinutes(total)}</strong>` : ''}${[...names].slice(0, 2).map(([name, ms]) => `<small>${escape(name)} ${formatMinutes(ms)}</small>`).join('')}${due.slice(0, 2).map(timer => `<small class="due-item">${escape(timer.title)} 마감</small>`).join('')}</button>`;
  }
  $('#month-grid').innerHTML = weekdays + cells;
}

function renderDay(day) {
  selectedDay = day;
  const entries = timelineLayout(sessionParts(day));
  const total = unionDuration(entries.flatMap(entry => entry.segments));
  const due = timers.filter(timer => timer.dueDate === day && filtered({ tags: timer.tags, priority: timer.priority }));
  $('#day-title').textContent = day;
  $('#day-summary').innerHTML = `<div class="day-total"><strong>${formatMinutes(total)}</strong><span>총 실행</span></div>${due.length ? `<div class="due-list"><strong>종료 예정</strong>${due.map(timer => `<span>${escape(timer.title)}</span>`).join('')}</div>` : ''}`;
  $('#day-timeline').innerHTML = `<div class="timeline-hours">${Array.from({ length: 25 }, (_, hour) => `<span style="top:${hour / 24 * 100}%">${String(hour).padStart(2, '0')}:00</span>`).join('')}</div><div class="timeline-events">${entries.map(entry => {
    const top = localMinute(entry.startedAt) / 1440 * 100;
    const boundaryEnd = dayKey(entry.endedAt - 1, timezone) === entry.day && dayKey(entry.endedAt, timezone) !== entry.day;
    const end = boundaryEnd ? 1440 : entry.endedAt === entry.startedAt ? localMinute(entry.endedAt) : Math.max(localMinute(entry.endedAt), localMinute(entry.startedAt) + 1);
    const height = Math.max(2.6, (end - localMinute(entry.startedAt)) / 1440 * 100), width = 100 / entry.columns;
    return `<article class="timeline-event priority-${entry.priority}" style="top:${top}%;height:${height}%;left:${entry.column * width}%;width:${width}%" title="${escape(entry.title)} ${localClock(entry.startedAt)}–${localClock(entry.endedAt)}"><strong>${escape(entry.title)}</strong><span>${localClock(entry.startedAt)} · ${formatMinutes(entry.activeMs)}</span><button data-delete-session="${entry.id}" aria-label="${escape(entry.title)} 기록 삭제">×</button></article>`;
  }).join('')}</div>`;
  if (!$('#day-dialog').open) $('#day-dialog').showModal();
}
function sound() {
  if (!prefs.sound) return;
  try {
    audioContext ||= new AudioContext();
    audioContext.resume();
    for (let i = 0; i < 2; i++) {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.connect(gain); gain.connect(audioContext.destination);
      const start = audioContext.currentTime + i * .2;
      oscillator.frequency.value = i ? 880 : 660;
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.14, start + .015); gain.gain.exponentialRampToValueAtTime(.0001, start + .16);
      oscillator.start(start); oscillator.stop(start + .18);
    }
  } catch { /* Sound is optional on browsers without Web Audio. */ }
}
function syncAlarm(completed) {
  if (prefs.sound && completed) {
    if (!alarmTimer) { sound(); alarmTimer = setInterval(sound, 2000); }
  } else if (alarmTimer) {
    clearInterval(alarmTimer); alarmTimer = null;
  }
}

function card(timer, grouped = false) {
  const state = status(timer, clockNow());
  const due = timer.dueDate ? `<div class="card-due${timer.dueDate < dayKey(Date.now(), timezone) ? ' overdue' : ''}">${dueLabel(timer.dueDate)}</div>` : '';
  return `<article class="timer-card ${state} priority-${timer.priority}" data-id="${timer.id}" aria-label="${escape(timer.title)}"><div class="card-heading"><h3>${escape(timer.title)}</h3><span class="card-kind" title="${timer.mode === 'timer' ? '타이머' : '스톱워치'}">${icon(timer.mode === 'timer' ? 'timer' : 'watch')}<span>${timer.mode === 'timer' ? 'TIMER' : 'STOPWATCH'}</span></span>${grouped ? '' : `<button class="drag-handle icon-button" data-action="drag" aria-label="${escape(timer.title)} 순서 이동. 방향키로 변경" title="끌어서 순서 변경">${icon('grip')}</button>`}</div>${due}<button class="clock-button" data-action="toggle" aria-label="${escape(timer.title)} ${state === 'running' ? '일시정지' : '시작'}" ${state === 'completed' ? 'disabled' : ''}><span class="time-digits">${formatTime(value(timer, clockNow()), timer.mode)}</span></button>
    <div class="progress-track" aria-hidden="true"><div class="progress-fill"></div></div><div class="card-bottom"><button class="minute-button" data-action="extend" aria-label="${escape(timer.title)} 1분 추가" ${state !== 'running' || timer.mode !== 'timer' ? 'hidden' : ''}>+1분</button><div class="card-controls"><button class="icon-button" data-action="reset" aria-label="${escape(timer.title)} 새로고침" title="초기화">${icon('reset')}</button><button class="icon-button" data-action="settings" aria-label="${escape(timer.title)} 설정" title="설정">${icon('sliders')}</button></div></div></article>`;
}

function renderDueGroups() {
  if (view !== 'due') return;
  const groups = new Map();
  for (const timer of ordered('due')) {
    const key = timer.dueDate || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(timer);
  }
  $('#due-groups').innerHTML = [...groups].map(([date, items]) => `<section class="due-group"><h2>${date ? dueLabel(date) : '마감 없음'}</h2><div class="timer-grid">${items.map(timer => card(timer, true)).join('')}</div></section>`).join('') || '<p class="empty-state">타이머가 없습니다.</p>';
}
function applyCardSize() {
  document.documentElement.dataset.cardSize = prefs.cardSize;
  $('#size-down').disabled = prefs.cardSize === 0;
  $('#size-up').disabled = prefs.cardSize === 2;
}
function render() {
  const focus = document.activeElement;
  const focusId = focus?.closest('[data-id]')?.dataset.id;
  const focusAction = focus?.dataset.action;
  $('#timer-grid').innerHTML = ordered().map(timer => card(timer)).join('') + `<button class="add-card" id="add-card" aria-label="타이머 추가"><span class="add-card-icon">${icon('plus')}</span><strong>추가</strong></button>`;
  $('#timer-sort').value = prefs.sortMode;
  renderDueGroups();
  if (focusId && focusAction) $(`[data-id="${focusId}"] [data-action="${focusAction}"]`)?.focus({ preventScroll: true });
  updateClocks(); updateConnection();
  renderCalendar(); applyCardSize();
}

function updateConnection() {
  const linked = user && !user.is_anonymous;
  const healthy = linked && cloudReady && connected && navigator.onLine;
  const title = healthy ? (pending.size ? '변경 사항 저장 중' : '모든 기기와 연동됨') : linked ? '연결을 확인하고 있어요' : '기기 간 연동 안 됨';
  $('#cloud-button').innerHTML = icon(healthy ? 'cloud' : 'cloudOff');
  $('#cloud-button').title = title;
  $('#cloud-button').setAttribute('aria-label', title);
  $('#cloud-button').classList.toggle('linked', !!healthy);
  $('#login-label').textContent = linked ? '내 계정' : 'Google 로그인';
  $('#account-description').textContent = linked ? user.email : '이 브라우저에 저장 중';
  $('#account-action').innerHTML = linked ? '로그아웃' : `Google 로그인 ${icon('cloud')}`;
}

async function notify(timer) {
  if (!prefs.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  // Cloud push owns system notifications when available, avoiding a duplicate foreground alert.
  if (user && cloudReady && prefs.push) return;
  const registration = await navigator.serviceWorker?.getRegistration();
  const options = { body: '수고했어요. 새로고침하면 다시 시작할 수 있어요.', icon: `${BASE}icon-192.png`, tag: `${timer.id}:${timer.runId}`, silent: true, data: { timerId: timer.id } };
  if (registration) await registration.showNotification(`${timer.title} · 완료`, options);
}

function updateClocks() {
  const now = clockNow();
  let running = 0, completed = 0;
  for (const timer of timers) {
    const state = status(timer, now), elements = document.querySelectorAll(`[data-id="${timer.id}"]`);
    if (state === 'running') running++;
    if (state === 'completed') completed++;
    const display = formatTime(value(timer, now), timer.mode);
    for (const el of elements) {
      el.classList.remove('idle', 'running', 'paused', 'completed'); el.classList.add(state);
      const digits = el.querySelector('.time-digits');
      if (digits.textContent !== display) digits.textContent = display;
      digits.classList.toggle('long-time', display.length > 5);
      const toggle = el.querySelector('[data-action="toggle"]');
      toggle.disabled = state === 'completed';
      toggle.setAttribute('aria-label', `${timer.title} ${state === 'completed' ? '완료' : state === 'running' ? '일시정지' : '시작'}`);
      el.querySelector('[data-action="extend"]').hidden = state !== 'running' || timer.mode !== 'timer';
      el.querySelector('.progress-fill').style.transform = `scaleX(${timer.mode === 'timer' ? Math.max(0, Math.min(1, 1 - value(timer, now) / timer.runDuration)) : 0})`;
    }
    const key = `${timer.id}:${timer.runId}`;
    if (state === 'completed' && !notified.has(key)) {
      saveTimerSession(timer, now);
      notified.add(key); write('tempo.notified', [...notified].slice(-150));
      notify(timer).catch(() => toast('알림을 표시하지 못했어요. 기기 설정을 확인해주세요.', true));
    }
  }
  syncAlarm(completed);
  document.title = running ? `${running}개 진행 중 · minimal timer` : 'minimal timer';
}

async function refreshCloud() {
  if (!user || !navigator.onLine || pending.size || syncing) return;
  const generation = authGeneration;
  const [remote, remoteTags, remoteSessions, remoteTimezone] = await Promise.all([readTimers(), readTags(), readSessions(), readTimezone()]);
  for (const entry of sessionQueue) {
    const saved = await saveSession(entry);
    const index = remoteSessions.findIndex(item => item.id === saved.id);
    if (index >= 0) remoteSessions[index] = saved; else remoteSessions.push(saved);
  }
  sessionQueue = []; write(sideKey('sessionQueue'), sessionQueue);
  if (generation !== authGeneration || pending.size) return;
  timers = remote; tags = remoteTags; sessions = remoteSessions.filter(validSession); timezone = remoteTimezone || timezone; cloudReady = true;
  for (const timer of remote) revisions.set(timer.id, timer.revision);
  persistWorkspace(); render();
}

function commit(next, previous = null, remove = false) {
  if (user && (!navigator.onLine || !cloudReady)) {
    toast('연결되면 다시 조작할 수 있어요. 진행 중인 시간은 계속 흘러갑니다.', true); return false;
  }
  const before = timers;
  timers = remove ? timers.filter(t => t.id !== next.id) : previous ? timers.map(t => t.id === next.id ? next : t) : [...timers, next];
  if (!persist()) { timers = before; return false; }
  if (remove || (previous && (previous.mode !== next.mode || previous.runId !== next.runId || previous.session?.id !== next.session?.id || (previous.state === 'running' && next.state === 'paused')))) saveTimerSession(previous);
  render();
  if (!user) return true;
  const generation = authGeneration;
  pending.set(next.id, (pending.get(next.id) || 0) + 1); updateConnection();
  queue = queue.then(async () => {
    try {
      if (!failedWrites.has(next.id)) {
        const saved = await saveTimer(next, previous ? (revisions.get(next.id) ?? previous.revision) : -1, remove);
        revisions.set(next.id, saved.revision);
        if (generation === authGeneration && !remove && pending.get(next.id) === 1) timers = timers.map(t => t.id === saved.id ? saved : t);
      }
    } catch (error) {
      failedWrites.add(next.id);
      if (generation === authGeneration) {
        timers = previous ? timers.filter(t => t.id !== next.id).concat(previous) : timers.filter(t => t.id !== next.id);
        toast(error.message || '저장하지 못했어요. 다시 시도해주세요.', true);
      }
    } finally {
      if (pending.get(next.id) === 1) { pending.delete(next.id); failedWrites.delete(next.id); }
      else pending.set(next.id, pending.get(next.id) - 1);
      if (generation === authGeneration) { persist(); render(); }
    }
    if (!pending.size && generation === authGeneration) await refreshCloud().catch(() => { cloudReady = false; updateConnection(); });
  });
  return true;
}

function openEditor(id = null) {
  editingId = id;
  const timer = timers.find(t => t.id === id) || createTimer();
  const form = $('#timer-form');
  form.reset();
  form.elements.title.value = id ? timer.title : '';
  form.elements.mode.value = timer.mode;
  form.elements.hours.value = Math.floor(timer.duration / 3_600_000);
  form.elements.minutes.value = Math.floor(timer.duration / 60_000) % 60;
  form.elements.seconds.value = Math.floor(timer.duration / 1000) % 60;
  form.elements.dueDate.value = timer.dueDate || '';
  form.elements.priority.value = timer.priority || 'normal';
  selectedTags = [...(timer.tags || [])];
  $('#timer-tag-search').value = '';
  renderTagPicker();
  $('#dialog-title').textContent = id ? '타이머 설정' : '새로운 시간';
  $('#save-button').innerHTML = id ? `저장하기 ${icon('check')}` : `만들기 ${icon('plus')}`;
  $('#edit-tools').hidden = !id;
  $('#form-error').textContent = '';
  updateModeNote(); $('#timer-dialog').showModal();
}
function renderTagPicker() {
  const query = $('#timer-tag-search').value.trim(), paths = activeTags().map(tag => tag.path);
  const available = paths.filter(path => !selectedTags.includes(path));
  const suggestions = query ? available.filter(path => fuzzyTagMatch(path, query)).slice(0, 8) : [...new Set([...recentTags, ...available])].filter(path => available.includes(path)).slice(0, 5);
  $('#selected-tags').innerHTML = selectedTags.map(path => `<button type="button" data-tag-remove="${escape(path)}" aria-label="${escape(path)} 제거">${escape(path)} ×</button>`).join('');
  $('#timer-tag-options').innerHTML = suggestions.map(path => `<button type="button" data-tag-add="${escape(path)}" aria-label="${escape(path)} 선택">${escape(path)}</button>`).join('') || `<span class="field-note">${paths.length ? '일치하는 태그가 없습니다.' : '설정에서 태그를 추가하세요.'}</span>`;
}
function updateModeNote() {
  const mode = $('#timer-form').elements.mode.value;
  $('#duration-fields').hidden = mode === 'stopwatch';
  for (const name of ['hours', 'minutes', 'seconds']) $('#timer-form').elements[name].disabled = mode === 'stopwatch';
  const original = timers.find(t => t.id === editingId);
  $('#mode-note').textContent = original && original.mode !== mode ? '모드를 바꾸면 이 블록은 초기화되고 대기합니다.' : mode === 'stopwatch' ? '0부터 시간을 셉니다. 원하는 순간에 멈추세요.' : editingId ? '시간 변경은 다음 새로고침부터 적용돼요.' : '설정한 시간부터 거꾸로 셉니다.';
}

$('#timer-form').addEventListener('change', updateModeNote);
$('#timer-tag-search').addEventListener('input', renderTagPicker);
$('#timer-form').addEventListener('click', event => {
  const add = event.target.closest('[data-tag-add]')?.dataset.tagAdd, remove = event.target.closest('[data-tag-remove]')?.dataset.tagRemove;
  if (add) { selectedTags.push(add); $('#timer-tag-search').value = ''; }
  if (remove) selectedTags = selectedTags.filter(path => path !== remove);
  if (add || remove) renderTagPicker();
});
$('#timer-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const form = event.currentTarget, original = timers.find(t => t.id === editingId);
    const mode = form.elements.mode.value;
    const duration = mode === 'stopwatch' ? (original?.duration || 25 * 60_000) : (Number(form.elements.hours.value) * 3600 + Number(form.elements.minutes.value) * 60 + Number(form.elements.seconds.value)) * 1000;
    const prefix = mode === 'stopwatch' ? '스톱워치' : '타이머';
    let number = 1;
    while (timers.some(timer => timer.title === `${prefix}${number}`)) number++;
    const title = form.elements.title.value.trim() || original?.title || `${prefix}${number}`;
    const fields = { title, mode, duration, tags: selectedTags, dueDate: form.elements.dueDate.value || null, priority: form.elements.priority.value };
    const next = original ? transition(original, 'edit', fields) : createTimer({ ...fields, position: nextPosition() });
    if (commit(next, original)) { recentTags = [...new Set([...selectedTags, ...recentTags])].slice(0, 5); write('tempo.recentTags', recentTags); $('#timer-dialog').close(); toast(original ? '저장됨' : '추가됨'); }
  } catch (error) { $('#form-error').textContent = error.message; }
});

function handleCardClick(event) {
  if (drag?.moved) return;
  if (event.target.closest('#add-card')) return openEditor();
  const el = event.target.closest('[data-id]');
  const timer = timers.find(t => t.id === el?.dataset.id);
  if (!timer) return;
  const action = event.target.closest('[data-action]')?.dataset.action || 'toggle';
  if (action === 'drag') return;
  if (action === 'settings') return openEditor(timer.id);
  if (prefs.sound) { try { audioContext ||= new AudioContext(); audioContext.resume(); } catch { /* optional */ } }
  const next = transition(timer, action, {}, clockNow());
  if (next !== timer) commit(next, timer);
  if (action === 'reset') navigator.serviceWorker?.getRegistration().then(async reg => { for (const note of await reg?.getNotifications() || []) if (note.tag === `${timer.id}:${timer.runId}`) note.close(); });
}
$('#timer-grid').addEventListener('click', handleCardClick);
$('#due-groups').addEventListener('click', handleCardClick);
$('#duplicate-button').onclick = () => { const original = timers.find(t => t.id === editingId); if (original && commit(duplicate(original, nextPosition()))) { $('#timer-dialog').close(); toast('대기 상태로 복제했어요.'); } };
$('#move-first-button').onclick = () => { const original = timers.find(t => t.id === editingId); prefs.sortMode = 'manual'; savePrefs(); if (original && commit(transition(original, 'position', { position: Math.min(...timers.map(t => t.position)) - 1 }), original)) $('#timer-dialog').close(); };
$('#delete-button').onclick = () => { const timer = timers.find(t => t.id === editingId); if (!timer) return; $('#delete-description').textContent = `‘${timer.title}’ 블록을 삭제합니다. 지난 기록은 남습니다.`; $('#delete-dialog').showModal(); };
$('#confirm-delete').onclick = () => { const timer = timers.find(t => t.id === editingId); if (timer && commit(timer, timer, true)) { $('#delete-dialog').close(); $('#timer-dialog').close(); toast('타이머를 삭제했어요.'); } };
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(`#${button.dataset.close}`).close(); });
document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }); });

function openPreferences() {
  $('#notification-toggle').checked = prefs.notifications;
  $('#sound-toggle').checked = prefs.sound;
  $('#timezone-input').value = timezone;
  $('#timezone-options').innerHTML = Intl.supportedValuesOf('timeZone').map(zone => `<option value="${escape(zone)}"></option>`).join('');
  renderTagList();
  updateConnection(); $('#preferences-dialog').showModal();
}
function renderTagList() {
  $('#tag-list').innerHTML = activeTags().map(tag => `<div class="tag-row"><span>${escape(tag.path)}</span><button data-tag-action="rename" data-path="${escape(tag.path)}" aria-label="${escape(tag.path)} 이름 변경">변경</button><button data-tag-action="archive" data-path="${escape(tag.path)}" aria-label="${escape(tag.path)} 보관">보관</button></div>`).join('');
}
function tagReady() { return !user || (navigator.onLine && cloudReady); }
$('#tag-add-form').onsubmit = async event => {
  event.preventDefault();
  const path = normalizeTag($('#new-tag').value);
  if (!path) return toast('태그 경로를 확인해주세요.', true);
  if (!tagReady()) return toast('연결되면 다시 시도해주세요.', true);
  try {
    for (const prefix of tagPrefixes(path)) {
      if (user) await saveTag(prefix);
      const item = tags.find(tag => tag.path === prefix);
      if (item) item.archived = false; else tags.push({ path: prefix, archived: false });
    }
    write(sideKey('tags'), tags); $('#new-tag').value = ''; renderTagList(); renderCalendar();
  } catch (error) { toast(error.message, true); }
};
$('#tag-list').onclick = async event => {
  const button = event.target.closest('[data-tag-action]'); if (!button) return;
  const path = button.dataset.path;
  if (button.dataset.tagAction === 'rename') { editingTag = path; $('#tag-source').textContent = path; $('#tag-target').value = path; $('#tag-error').textContent = ''; $('#tag-dialog').showModal(); return; }
  if (!tagReady()) return toast('연결되면 다시 시도해주세요.', true);
  try { if (user) await archiveTag(path); tags.find(tag => tag.path === path).archived = true; write(sideKey('tags'), tags); renderTagList(); renderCalendar(); }
  catch (error) { toast(error.message, true); }
};
$('#tag-rename-form').onsubmit = async event => {
  event.preventDefault();
  const target = normalizeTag($('#tag-target').value), source = editingTag;
  if (!target || target === source || target.startsWith(`${source}/`)) return $('#tag-error').textContent = '다른 태그 경로를 입력해주세요.';
  if (!tagReady()) return $('#tag-error').textContent = '연결되면 다시 시도해주세요.';
  try {
    if (user) await mergeTag(source, target);
    else {
      const sourceTags = tags.filter(tag => tag.path === source || tag.path.startsWith(`${source}/`));
      for (const tag of sourceTags) {
        const mapped = `${target}${tag.path.slice(source.length)}`;
        const item = tags.find(other => other.path === mapped);
        if (item) item.archived = false; else tags.push({ path: mapped, archived: false });
        tag.archived = true;
      }
      timers = timers.map(timer => ({ ...timer, tags: replaceTagPrefix(timer.tags || [], source, target) }));
      persistWorkspace();
    }
    if (user) await refreshCloud();
    render(); renderTagList(); $('#tag-dialog').close(); toast('태그 변경됨');
  } catch (error) { $('#tag-error').textContent = error.message; }
};
$('#save-timezone').onclick = async () => {
  const next = $('#timezone-input').value.trim();
  if (!validTimezone(next)) return toast('올바른 시간대를 입력해주세요.', true);
  if (!tagReady()) return toast('연결되면 다시 시도해주세요.', true);
  try { if (user) await saveTimezone(next); timezone = next; write(sideKey('timezone'), next); renderCalendar(); toast('시간대 저장됨'); }
  catch (error) { toast(error.message, true); }
};
function setView(next) {
  view = next;
  for (const name of ['timers', 'calendar', 'due']) {
    $(`#${name === 'timers' ? 'timer' : name}-workspace`).hidden = name !== next;
    $(`#${name}-view`).classList.toggle('active', name === next);
  }
  if (next === 'calendar') renderCalendar();
  if (next === 'due') renderDueGroups(); else $('#due-groups').innerHTML = '';
}
$('#timers-view').onclick = () => setView('timers');
$('#calendar-view').onclick = () => setView('calendar');
$('#due-view').onclick = () => setView('due');
$('#timer-sort').onchange = event => { prefs.sortMode = event.target.value; savePrefs(); render(); };
$('#size-down').onclick = () => { prefs.cardSize = Math.max(0, prefs.cardSize - 1); savePrefs(); applyCardSize(); };
$('#size-up').onclick = () => { prefs.cardSize = Math.min(2, prefs.cardSize + 1); savePrefs(); applyCardSize(); };
function changeMonth(delta) { const [year, month] = calendarMonth.split('-').map(Number); calendarMonth = new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7); renderCalendar(); }
$('#previous-month').onclick = () => changeMonth(-1);
$('#next-month').onclick = () => changeMonth(1);
$('#calendar-tag-filter').onchange = renderCalendar;
$('#calendar-priority-filter').onchange = renderCalendar;
$('#month-grid').onclick = event => { const day = event.target.closest('[data-day]')?.dataset.day; if (day) renderDay(day); };
$('#day-timeline').onclick = async event => {
  const id = event.target.closest('[data-delete-session]')?.dataset.deleteSession;
  if (!id || !confirm('이 기록을 삭제할까요?')) return;
  if (user && !tagReady()) return toast('연결되면 다시 시도해주세요.', true);
  try {
    if (user) await deleteSession(id);
    sessions = sessions.filter(session => session.id !== id);
    sessionQueue = sessionQueue.filter(session => session.id !== id); write(sideKey('sessionQueue'), sessionQueue);
    write(sideKey('sessions'), sessions); renderCalendar(); renderDay(selectedDay);
  } catch (error) { toast(error.message, true); }
};
$('#preferences-button').onclick = openPreferences;
$('#cloud-button').onclick = openPreferences;
$('#login-button').onclick = () => user && !user.is_anonymous ? openPreferences() : login();
$('#account-action').onclick = async () => {
  if (!user || user.is_anonymous) return login();
  try {
    await queue; await removePush();
    prefs.notifications = false; prefs.push = false; savePrefs();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    $('#preferences-dialog').close(); toast('이 기기에서 로그아웃했어요.');
  } catch (error) { toast(error.message, true); }
};

async function login() {
  if (!client) return toast('Google 연결을 준비 중이에요. 지금은 로그인 없이 사용할 수 있어요.');
  const popup = window.open('', 'minimal-timer-google-login', 'popup,width=500,height=650');
  if (!popup) return toast('팝업을 허용해주세요.', true);
  try {
    await queue;
    if (!write('tempo.import', timers.map(t => ({ ...t, id: crypto.randomUUID(), revision: 0, runId: crypto.randomUUID() })))) { popup.close(); return; }
    write('tempo.import.tags', tags);
    write('tempo.import.sessions', sessions);
    write('tempo.import.timezone', timezone);
    if (user?.is_anonymous) await removePush();
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + BASE, skipBrowserRedirect: true } });
    if (error) throw error;
    if (!data.url) throw new Error('로그인 주소를 열 수 없습니다.');
    popup.location.href = data.url;
  } catch (error) { popup.close(); toast(error.message, true); }
}

$('#sound-toggle').onchange = async event => {
  prefs.sound = event.target.checked; savePrefs();
  const completed = timers.some(timer => status(timer, clockNow()) === 'completed');
  updateClocks();
  if (prefs.sound && !completed) sound();
  if (prefs.notifications && prefs.push && user) await registerPush(prefs.sound).catch(() => { prefs.push = false; savePrefs(); });
};
$('#notification-toggle').onchange = async event => {
  const checkbox = event.target;
  checkbox.disabled = true;
  try {
    if (checkbox.checked) {
      if (!('Notification' in window)) throw new Error('이 브라우저에서는 홈 화면에 앱을 설치한 후 알림을 켜주세요.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('브라우저 설정에서 알림 권한을 허용해주세요.');
      let pushError = null;
      try {
        if (!client) throw new Error('백그라운드 알림 연결을 사용할 수 없습니다.');
        if (!user) {
          const { data, error } = await client.auth.signInAnonymously();
          if (error) throw error;
          await setSession(data.session);
        }
        await queue;
        if (!cloudReady) throw new Error('백그라운드 알림 연결을 사용할 수 없습니다.');
        await registerPush(prefs.sound);
        prefs.push = true;
      } catch (error) {
        prefs.push = false;
        pushError = error;
      }
      prefs.notifications = true;
      toast(pushError ? (navigator.brave ? '알림 켜짐 · Brave의 Google 푸시 메시징을 켜면 백그라운드에서도 알림' : '알림 켜짐 · 백그라운드 알림은 브라우저에서 차단됨') : '알림 켜짐');
    } else { await removePush().catch(() => {}); prefs.notifications = false; prefs.push = false; }
    savePrefs();
  } catch (error) { checkbox.checked = prefs.notifications; toast(error.message, true); }
  finally { checkbox.disabled = false; }
};
$('#test-notification').onclick = async () => {
  sound();
  if (!prefs.notifications || !('Notification' in window) || Notification.permission !== 'granted') return toast('먼저 완료 알림을 켜주세요.');
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('minimal timer', { body: '알림 테스트', tag: 'tempo-test', icon: `${BASE}icon-192.png`, silent: !prefs.sound });
};

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; });
$('#install-button').onclick = async () => {
  if (deferredInstall) { await deferredInstall.prompt(); deferredInstall = null; }
  else $('#install-note').textContent = matchMedia('(display-mode: standalone)').matches ? '이미 앱으로 사용 중이에요.' : /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'Safari의 공유 버튼 → ‘홈 화면에 추가’를 선택하세요.' : '브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.';
};

// One pointer handler supports both touch and mouse; dragging the handle never toggles the clock.
$('#timer-grid').addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-action="drag"]');
  if (!handle || event.button !== 0) return;
  const el = handle.closest('[data-id]');
  drag = { id: el.dataset.id, x: event.clientX, y: event.clientY, moved: false, target: null, after: false };
  handle.setPointerCapture(event.pointerId);
});
$('#timer-grid').addEventListener('pointermove', event => {
  if (!drag) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
  if (!drag.moved) return;
  $(`[data-id="${drag.id}"]`)?.classList.add('dragging');
  document.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  drag.target = null;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.timer-card');
  if (target && target.dataset.id !== drag.id) {
    const source = $(`[data-id="${drag.id}"]`), box = target.getBoundingClientRect();
    drag.after = Math.abs(target.offsetTop - source.offsetTop) < 10 ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
    target.classList.add(drag.after ? 'drop-after' : 'drop-before'); drag.target = target.dataset.id;
  }
});
function finishDrag(cancel = false) {
  if (!drag) return;
  const moved = drag.moved;
  if (!cancel && moved && drag.target) {
    const list = ordered().filter(t => t.id !== drag.id);
    const index = list.findIndex(t => t.id === drag.target) + (drag.after ? 1 : 0);
    const timer = timers.find(t => t.id === drag.id);
    list.splice(index, 0, timer);
    prefs.sortMode = 'manual'; savePrefs();
    for (const [position, item] of list.entries()) if (item.position !== position) commit(transition(timers.find(t => t.id === item.id), 'position', { position }), timers.find(t => t.id === item.id));
  }
  document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
  setTimeout(() => { drag = null; }, 0);
}
$('#timer-grid').addEventListener('pointerup', () => finishDrag());
$('#timer-grid').addEventListener('pointercancel', () => finishDrag(true));
$('#timer-grid').addEventListener('keydown', event => {
  if (event.target.dataset.action !== 'drag' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const list = ordered(), index = list.findIndex(t => t.id === event.target.closest('[data-id]').dataset.id);
  const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
  if (!list[index + direction]) return;
  [list[index], list[index + direction]] = [list[index + direction], list[index]];
  prefs.sortMode = 'manual'; savePrefs();
  for (const [position, item] of list.entries()) if (item.position !== position) commit(transition(timers.find(t => t.id === item.id), 'position', { position }), timers.find(t => t.id === item.id));
});

let sessionSetup = Promise.resolve();
function setSession(session) {
  sessionSetup = sessionSetup.then(() => applySession(session)).catch(error => { cloudReady = false; syncing = false; toast(error.message || '연결을 확인해주세요.', true); updateConnection(); });
  return sessionSetup;
}
async function applySession(session) {
  if ((session?.user?.id || null) === (user?.id || null) && cloudReady) return;
  await queue;
  const generation = ++authGeneration;
  if (channel) { await client.removeChannel(channel); channel = null; }
  user = session?.user || null;
  cloudReady = false; connected = false;
  activeKey = !user || user.is_anonymous ? GUEST_KEY : `tempo.account.${user.id}`;
  timers = readBoard(activeKey);
  tags = readTagList(activeKey);
  sessions = readSessionList(activeKey);
  sessionQueue = read(sideKey('sessionQueue'), []).filter(validSession);
  timezone = read(sideKey('timezone'), deviceTimezone);
  if (!validTimezone(timezone)) timezone = deviceTimezone;
  render();
  if (!user) return;
  syncing = true;
  const requestStart = Date.now();
  const { data: serverTime, error: timeError } = await client.rpc('tempo_server_time');
  const oldOffset = clockOffset;
  if (!timeError && Number.isFinite(serverTime)) {
    clockOffset = serverTime - (requestStart + Date.now()) / 2;
    clockOffset = Math.round(clockOffset);
    write('tempo.clockOffset', clockOffset);
  }
  const [remote, remoteTags, remoteSessions, remoteTimezone] = await Promise.all([readTimers(), readTags(), readSessions(), readTimezone()]);
  const localImport = user.is_anonymous ? timers : readBoard('tempo.import');
  const importTags = user.is_anonymous ? tags : readTagList('tempo.import');
  const importSessions = user.is_anonymous ? sessions : readSessionList('tempo.import');
  const combined = [...remote];
  for (const timer of localImport) {
    if (combined.some(t => t.id === timer.id)) continue;
    const saved = await saveTimer({ ...timer, anchor: timer.anchor === null ? null : timer.anchor + clockOffset - oldOffset, position: Math.max(-1, ...combined.map(t => t.position)) + 1 });
    combined.push(saved);
  }
  for (const tag of importTags) if (!remoteTags.some(item => item.path === tag.path)) { await saveTag(tag.path); remoteTags.push({ path: tag.path, archived: false }); }
  for (const entry of importSessions) {
    const remoteEntry = remoteSessions.find(item => item.id === entry.id);
    if (!remoteEntry || remoteEntry.activeMs <= entry.activeMs) await saveSession(entry);
  }
  if (!remoteTimezone) await saveTimezone(user.is_anonymous ? timezone : read('tempo.import.timezone', timezone));
  if (generation !== authGeneration) return;
  timers = combined;
  tags = remoteTags; sessions = mergeSessions(remoteSessions, importSessions); timezone = remoteTimezone || (user.is_anonymous ? timezone : read('tempo.import.timezone', timezone));
  revisions.clear();
  for (const timer of timers) revisions.set(timer.id, timer.revision);
  persistWorkspace();
  if (!user.is_anonymous) { for (const key of ['tempo.import', 'tempo.import.tags', 'tempo.import.sessions', 'tempo.import.timezone']) localStorage.removeItem(key); write(GUEST_KEY, []); write(sideKey('tags', GUEST_KEY), []); write(sideKey('sessions', GUEST_KEY), []); }
  cloudReady = true; syncing = false;
  const { data: auth } = await client.auth.getSession();
  if (auth.session) await client.realtime.setAuth(auth.session.access_token);
  channel = watchTimers(user.id, () => refreshCloud().catch(() => { connected = false; updateConnection(); }), ok => {
    connected = ok; updateConnection();
    if (ok) refreshCloud().catch(() => { connected = false; updateConnection(); });
  });
  if (prefs.notifications && prefs.push && 'Notification' in window && Notification.permission === 'granted') registerPush(prefs.sound).catch(() => { prefs.push = false; savePrefs(); });
  render();
}

window.addEventListener('storage', event => {
  if (pending.size || syncing) return;
  if (event.key === activeKey) timers = readBoard(activeKey);
  else if (event.key === sideKey('tags')) tags = readTagList(activeKey);
  else if (event.key === sideKey('sessions')) sessions = readSessionList(activeKey);
  else if (event.key === sideKey('timezone')) timezone = read(sideKey('timezone'), deviceTimezone);
  else return;
  render();
});
window.addEventListener('online', () => { if (user) { cloudReady = false; setSession({ user }); } updateConnection(); });
window.addEventListener('offline', () => { connected = false; updateConnection(); });
document.addEventListener('visibilitychange', () => { updateClocks(); if (!document.hidden && user) refreshCloud().catch(() => { connected = false; updateConnection(); }); });

render(); persistWorkspace();
if (storageError) toast('저장 데이터를 읽지 못했어요. 브라우저 저장 설정을 확인해주세요.', true);
setInterval(updateClocks, 100);
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => toast('앱 설치 기능을 준비하지 못했어요.', true));
if (client) {
  client.auth.onAuthStateChange((_event, session) => {
    if (authCallbackPopup && session) {
      window.opener?.postMessage({ type: 'minimal-timer-auth' }, location.origin);
      window.close();
      return;
    }
    setTimeout(() => setSession(session), 0);
  });
  client.auth.getSession().then(({ data, error }) => { if (error) throw error; return setSession(data.session); }).catch(error => toast(error.message, true));
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !client) return;
  if (event.data?.type === 'minimal-timer-auth-error') return toast(event.data.message || '로그인하지 못했습니다.', true);
  if (event.data?.type !== 'minimal-timer-auth') return;
  client.auth.getSession().then(({ data, error }) => { if (error) throw error; return setSession(data.session); }).then(() => toast('로그인됨')).catch(error => toast(error.message, true));
});
const authError = new URLSearchParams(location.hash.slice(1)).get('error_description') || new URLSearchParams(location.search).get('error_description');
if (authError && window.opener) { window.opener.postMessage({ type: 'minimal-timer-auth-error', message: authError }, location.origin); window.close(); }
else if (authError) { toast(`Google 연결: ${authError}`, true); history.replaceState(null, '', BASE); }
