import './style.css';
import { createTimer, transition, duplicate, value, status, formatTime, validTimer } from './model.js';
import { client, readTimers, saveTimer, watchTimers, registerPush, removePush } from './cloud.js';

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
  if (!Array.isArray(data) || data.some(timer => !validTimer(timer))) {
    storageError = true;
    backupStorage(key);
    return [];
  }
  return data;
}
const initial = () => [
  createTimer({ title: '25분 타이머', duration: 25 * 60_000, position: 0 }),
  createTimer({ title: '5분 타이머', duration: 5 * 60_000, position: 1 }),
  createTimer({ title: '스톱워치', mode: 'stopwatch', position: 2 }),
];
let timers = readBoard(GUEST_KEY, initial());
const savedPrefs = read('tempo.preferences', {});
let prefs = { sound: false, notifications: false, ...savedPrefs, push: savedPrefs.push ?? savedPrefs.notifications ?? false };
let user = null, channel = null, cloudReady = false, connected = false, syncing = false;
let activeKey = GUEST_KEY, editingId = null, deferredInstall = null, audioContext, alarmTimer, drag = null;
let noticeTimeout, authGeneration = 0;
let queue = Promise.resolve();
const pending = new Map();
const revisions = new Map();
const failedWrites = new Set();
const notified = new Set(read('tempo.notified', []));
let clockOffset = Number(read('tempo.clockOffset', 0)) || 0;
const clockNow = () => Date.now() + clockOffset;
const labels = { idle: '준비', running: '진행 중', paused: '일시정지', completed: '완료' };
const authCallbackPopup = !!window.opener && new URLSearchParams(location.search).has('code');

$('#app').innerHTML = `
  <header class="topbar"><a class="brand" href="${BASE}" aria-label="minimal timer 홈">minimal timer</a>
    <div class="top-actions"><button class="icon-button cloud-status" id="cloud-button" aria-label="기기 간 연동 안 됨" title="기기 간 연동 안 됨">${icon('cloudOff')}</button><span class="top-divider"></span><button class="icon-button" id="preferences-button" aria-label="앱 설정">${icon('sliders')}</button><button class="login-button" id="login-button"><span class="google-g">G</span><span id="login-label">Google 로그인</span></button></div>
  </header>
  <main><section class="workspace" aria-label="타이머"><div class="workspace-toolbar"><div class="workspace-title"><h1>타이머 <span id="total-count">0</span></h1><span class="running-count" id="running-count"></span></div></div>
      <div class="timer-grid" id="timer-grid"></div>
    </section>
  </main>
  <dialog id="timer-dialog"><form id="timer-form"><div class="dialog-heading"><h2 id="dialog-title">새 타이머</h2><button class="icon-button" type="button" data-close="timer-dialog" aria-label="닫기">${icon('close')}</button></div>
    <label class="field-label" for="timer-name">이름</label><input id="timer-name" name="title" maxlength="60" placeholder="타이머 이름" required autocomplete="off" />
    <fieldset class="mode-picker"><legend class="field-label">모드</legend><label><input type="radio" name="mode" value="timer" checked><span>${icon('timer')} 타이머</span></label><label><input type="radio" name="mode" value="stopwatch"><span>${icon('watch')} 스톱워치</span></label></fieldset>
    <div id="duration-fields"><span class="field-label">설정 시간</span><div class="duration-inputs"><label><input name="hours" type="number" min="0" max="168" value="0" inputmode="numeric" required><span>시간</span></label><b>:</b><label><input name="minutes" type="number" min="0" max="59" value="25" inputmode="numeric" required><span>분</span></label><b>:</b><label><input name="seconds" type="number" min="0" max="59" value="0" inputmode="numeric" required><span>초</span></label></div></div>
    <p class="field-note" id="mode-note">설정한 시간부터 거꾸로 셉니다.</p><p class="form-error" id="form-error" role="alert"></p>
    <div class="dialog-tools" id="edit-tools"><button type="button" class="text-button" id="duplicate-button">${icon('copy')} 복제</button><button type="button" class="text-button" id="move-first-button">${icon('arrow')} 맨 앞으로</button><button type="button" class="text-button danger" id="delete-button">${icon('trash')} 삭제</button></div>
    <button class="primary-button full-width" type="submit" id="save-button">만들기 ${icon('plus')}</button></form></dialog>
  <dialog id="preferences-dialog"><div class="dialog-heading"><h2>설정</h2><button class="icon-button" data-close="preferences-dialog" aria-label="닫기">${icon('close')}</button></div>
    <div class="preference-row"><div>${icon('bell')}<span><strong>완료 알림</strong><small>이 기기에서 알림 받기</small></span></div><label class="switch"><input id="notification-toggle" type="checkbox" aria-label="완료 알림"><span></span></label></div>
    <div class="preference-row"><div>${icon('sound')}<span><strong>알림 소리</strong><small>앱이 열려 있을 때 짧은 소리</small></span></div><label class="switch"><input id="sound-toggle" type="checkbox" aria-label="알림 소리"><span></span></label></div>
    <p class="field-note">앱을 닫았을 때 알림 소리는 기기의 알림 설정을 따릅니다.</p><button class="text-button" id="test-notification">${icon('bell')} 알림 테스트</button>
    <div class="settings-account"><span id="account-description">이 브라우저에 저장 중</span><button class="text-button" id="account-action">Google 로그인 ${icon('cloud')}</button></div>
    <button class="secondary-button full-width" id="install-button">${icon('download')} 앱 설치</button><p class="field-note" id="install-note"></p></dialog>
  <dialog id="delete-dialog"><div class="dialog-heading"><h2>타이머를 삭제할까요?</h2><button class="icon-button" data-close="delete-dialog" aria-label="닫기">${icon('close')}</button></div><p id="delete-description"></p><div class="confirm-actions"><button class="secondary-button" data-close="delete-dialog">취소</button><button class="primary-button danger-fill" id="confirm-delete">삭제하기</button></div></dialog>
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
function savePrefs() { write('tempo.preferences', prefs); }
function ordered() { return [...timers].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)); }
function nextPosition() { return Math.max(-1, ...timers.map(t => t.position)) + 1; }
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

function card(timer) {
  const state = status(timer, clockNow());
  return `<article class="timer-card ${state}" data-id="${timer.id}" aria-label="${escape(timer.title)}"><div class="card-heading"><span class="card-kind">${icon(timer.mode === 'timer' ? 'timer' : 'watch')} ${timer.mode === 'timer' ? 'TIMER' : 'STOPWATCH'}</span><button class="drag-handle icon-button" data-action="drag" aria-label="${escape(timer.title)} 순서 이동. 방향키로 변경" title="끌어서 순서 변경">${icon('grip')}</button></div>
    <h3>${escape(timer.title)}</h3><button class="clock-button" data-action="toggle" aria-label="${escape(timer.title)} ${state === 'running' ? '일시정지' : '시작'}" ${state === 'completed' ? 'disabled' : ''}><span class="time-digits">${formatTime(value(timer, clockNow()), timer.mode)}</span><span class="clock-hint"><span class="state-icon">${icon(state === 'running' ? 'pause' : state === 'completed' ? 'check' : 'play')}</span><span class="state-label">${labels[state]}</span></span></button>
    <div class="progress-track" aria-hidden="true"><div class="progress-fill"></div></div><div class="card-bottom"><span class="duration-caption">${timer.mode === 'timer' ? `설정 ${formatTime(timer.duration)}` : '경과 시간'}</span><div class="card-controls"><button class="minute-button" data-action="extend" aria-label="${escape(timer.title)} 1분 추가" ${state !== 'running' || timer.mode !== 'timer' ? 'hidden' : ''}>+1분</button><button class="icon-button" data-action="reset" aria-label="${escape(timer.title)} 새로고침" title="초기화">${icon('reset')}</button><button class="icon-button" data-action="settings" aria-label="${escape(timer.title)} 설정" title="설정">${icon('sliders')}</button></div></div></article>`;
}

function render() {
  const focus = document.activeElement;
  const focusId = focus?.closest('[data-id]')?.dataset.id;
  const focusAction = focus?.dataset.action;
  $('#timer-grid').innerHTML = ordered().map(card).join('') + `<button class="add-card" id="add-card" aria-label="타이머 추가"><span class="add-card-icon">${icon('plus')}</span><strong>추가</strong></button>`;
  $('#total-count').textContent = timers.length;
  if (focusId && focusAction) $(`[data-id="${focusId}"] [data-action="${focusAction}"]`)?.focus({ preventScroll: true });
  updateClocks(); updateConnection();
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
    const state = status(timer, now), el = $(`[data-id="${timer.id}"]`);
    if (state === 'running') running++;
    if (state === 'completed') completed++;
    if (!el) continue;
    if (!el.classList.contains(state)) {
      el.classList.remove('idle', 'running', 'paused', 'completed'); el.classList.add(state);
      el.querySelector('.state-label').textContent = labels[state];
      el.querySelector('.state-icon').innerHTML = icon(state === 'completed' ? 'check' : state === 'running' ? 'pause' : 'play');
    }
    const display = formatTime(value(timer, now), timer.mode), digits = el.querySelector('.time-digits');
    if (digits.textContent !== display) digits.textContent = display;
    digits.classList.toggle('long-time', display.length > 5);
    const toggle = el.querySelector('[data-action="toggle"]');
    toggle.disabled = state === 'completed';
    toggle.setAttribute('aria-label', `${timer.title} ${state === 'completed' ? '완료' : state === 'running' ? '일시정지' : '시작'}`);
    el.querySelector('[data-action="extend"]').hidden = state !== 'running' || timer.mode !== 'timer';
    el.querySelector('.progress-fill').style.transform = `scaleX(${timer.mode === 'timer' ? Math.max(0, Math.min(1, 1 - value(timer, now) / timer.runDuration)) : 0})`;
    const key = `${timer.id}:${timer.runId}`;
    if (state === 'completed' && !notified.has(key)) {
      notified.add(key); write('tempo.notified', [...notified].slice(-150));
      notify(timer).catch(() => toast('알림을 표시하지 못했어요. 기기 설정을 확인해주세요.', true));
    }
  }
  syncAlarm(completed);
  $('#running-count').innerHTML = running ? `<span class="live-dot"></span>${running}개 진행 중` : '';
  document.title = running ? `${running}개 진행 중 · minimal timer` : 'minimal timer';
}

async function refreshCloud() {
  if (!user || !navigator.onLine || pending.size || syncing) return;
  const generation = authGeneration;
  const remote = await readTimers();
  if (generation !== authGeneration || pending.size) return;
  timers = remote; cloudReady = true;
  for (const timer of remote) revisions.set(timer.id, timer.revision);
  persist(); render();
}

function commit(next, previous = null, remove = false) {
  if (user && (!navigator.onLine || !cloudReady)) {
    toast('연결되면 다시 조작할 수 있어요. 진행 중인 시간은 계속 흘러갑니다.', true); return false;
  }
  const before = timers;
  timers = remove ? timers.filter(t => t.id !== next.id) : previous ? timers.map(t => t.id === next.id ? next : t) : [...timers, next];
  if (!persist()) { timers = before; return false; }
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
  $('#dialog-title').textContent = id ? '타이머 설정' : '새로운 시간';
  $('#save-button').innerHTML = id ? `저장하기 ${icon('check')}` : `만들기 ${icon('plus')}`;
  $('#edit-tools').hidden = !id;
  $('#form-error').textContent = '';
  updateModeNote(); $('#timer-dialog').showModal();
}
function updateModeNote() {
  const mode = $('#timer-form').elements.mode.value;
  $('#duration-fields').hidden = mode === 'stopwatch';
  for (const name of ['hours', 'minutes', 'seconds']) $('#timer-form').elements[name].disabled = mode === 'stopwatch';
  const original = timers.find(t => t.id === editingId);
  $('#mode-note').textContent = original && original.mode !== mode ? '모드를 바꾸면 이 블록은 초기화되고 대기합니다.' : mode === 'stopwatch' ? '0부터 시간을 셉니다. 원하는 순간에 멈추세요.' : editingId ? '시간 변경은 다음 새로고침부터 적용돼요.' : '설정한 시간부터 거꾸로 셉니다.';
}

$('#timer-form').addEventListener('change', updateModeNote);
$('#timer-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const form = event.currentTarget, original = timers.find(t => t.id === editingId);
    const mode = form.elements.mode.value;
    const duration = mode === 'stopwatch' ? (original?.duration || 25 * 60_000) : (Number(form.elements.hours.value) * 3600 + Number(form.elements.minutes.value) * 60 + Number(form.elements.seconds.value)) * 1000;
    const fields = { title: form.elements.title.value, mode, duration };
    const next = original ? transition(original, 'edit', fields) : createTimer({ ...fields, position: nextPosition() });
    if (commit(next, original)) { $('#timer-dialog').close(); toast(original ? '저장됨' : '추가됨'); }
  } catch (error) { $('#form-error').textContent = error.message; }
});

$('#timer-grid').addEventListener('click', event => {
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
});
$('#duplicate-button').onclick = () => { const original = timers.find(t => t.id === editingId); if (original && commit(duplicate(original, nextPosition()))) { $('#timer-dialog').close(); toast('대기 상태로 복제했어요.'); } };
$('#move-first-button').onclick = () => { const original = timers.find(t => t.id === editingId); if (original && commit(transition(original, 'position', { position: Math.min(...timers.map(t => t.position)) - 1 }), original)) $('#timer-dialog').close(); };
$('#delete-button').onclick = () => { const timer = timers.find(t => t.id === editingId); if (!timer) return; $('#delete-description').textContent = `‘${timer.title}’ 블록과 진행 중인 시간이 삭제돼요.`; $('#delete-dialog').showModal(); };
$('#confirm-delete').onclick = () => { const timer = timers.find(t => t.id === editingId); if (timer && commit(timer, timer, true)) { $('#delete-dialog').close(); $('#timer-dialog').close(); toast('타이머를 삭제했어요.'); } };
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(`#${button.dataset.close}`).close(); });
document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }); });

function openPreferences() {
  $('#notification-toggle').checked = prefs.notifications;
  $('#sound-toggle').checked = prefs.sound;
  updateConnection(); $('#preferences-dialog').showModal();
}
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
    const before = list[index - 1]?.position ?? (list[0]?.position ?? 0) - 2;
    const after = list[index]?.position ?? before + 2;
    const timer = timers.find(t => t.id === drag.id);
    commit(transition(timer, 'position', { position: (before + after) / 2 }), timer);
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
  const neighbor = list[index + direction], outer = list[index + direction * 2];
  const position = outer ? (neighbor.position + outer.position) / 2 : neighbor.position + direction;
  commit(transition(list[index], 'position', { position }), list[index]);
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
  const remote = await readTimers();
  const localImport = user.is_anonymous ? timers : readBoard('tempo.import');
  const combined = [...remote];
  for (const timer of localImport) {
    if (combined.some(t => t.id === timer.id)) continue;
    const saved = await saveTimer({ ...timer, anchor: timer.anchor === null ? null : timer.anchor + clockOffset - oldOffset, position: Math.max(-1, ...combined.map(t => t.position)) + 1 });
    combined.push(saved);
  }
  if (generation !== authGeneration) return;
  timers = combined;
  revisions.clear();
  for (const timer of timers) revisions.set(timer.id, timer.revision);
  persist();
  if (!user.is_anonymous) { localStorage.removeItem('tempo.import'); write(GUEST_KEY, []); }
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

window.addEventListener('storage', event => { if (event.key === activeKey && !pending.size && !syncing) { timers = readBoard(activeKey); render(); } });
window.addEventListener('online', () => { if (user) { cloudReady = false; setSession({ user }); } updateConnection(); });
window.addEventListener('offline', () => { connected = false; updateConnection(); });
document.addEventListener('visibilitychange', () => { updateClocks(); if (!document.hidden && user) refreshCloud().catch(() => { connected = false; updateConnection(); }); });

render(); persist();
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
