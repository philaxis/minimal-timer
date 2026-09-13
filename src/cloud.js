import { createClient } from '@supabase/supabase-js';
import { normalizeTimer } from './model.js';

export const projectUrl = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const client = projectUrl && key ? createClient(projectUrl, key, { auth: { flowType: 'pkce' } }) : null;
export const pushKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function decode(row) {
  const timer = normalizeTimer({ ...row.data, revision: row.revision });
  if (!timer) throw new Error('저장된 타이머를 읽을 수 없어요.');
  return timer;
}

export async function readTimers() {
  const { data, error } = await client.from('tempo_timers').select('data,revision').is('deleted_at', null);
  if (error) throw error;
  return data.map(decode).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export async function saveTimer(timer, revision = -1, remove = false) {
  const { data, error } = await client.rpc('tempo_save_timer', { timer, expected_revision: revision, remove });
  if (error) throw error;
  if (!data?.length) throw new Error('다른 기기에서 변경했어요. 최신 상태로 다시 불러옵니다.');
  return decode(data[0]);
}

export function watchTimers(userId, onChange, onConnection) {
  return client.channel(`tempo:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tempo_timers', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tempo_tags', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tempo_sessions', filter: `user_id=eq.${userId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tempo_profiles', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe(state => onConnection(state === 'SUBSCRIBED'));
}

export async function readTags() {
  const { data, error } = await client.from('tempo_tags').select('path,archived').order('path');
  if (error) throw error;
  return data;
}

export async function saveTag(path) {
  const { error } = await client.from('tempo_tags').upsert({ path, archived: false }, { onConflict: 'user_id,path' });
  if (error) throw error;
}

export async function archiveTag(path) {
  const { error } = await client.from('tempo_tags').update({ archived: true, updated_at: new Date().toISOString() }).eq('path', path);
  if (error) throw error;
}

export async function mergeTag(source, target) {
  const { error } = await client.rpc('tempo_merge_tag', { source, target });
  if (error) throw error;
}

export async function readSessions() {
  const { data, error } = await client.from('tempo_sessions').select('data');
  if (error) throw error;
  return data.map(row => row.data);
}

export async function saveSession(entry) {
  const { data, error } = await client.rpc('tempo_save_session', { entry });
  if (error) throw error;
  return data?.[0]?.data || entry;
}

export async function deleteSession(id) {
  const { error } = await client.from('tempo_sessions').delete().eq('id', id);
  if (error) throw error;
}

export async function readTimezone() {
  const { data, error } = await client.from('tempo_profiles').select('timezone').maybeSingle();
  if (error) throw error;
  return data?.timezone || null;
}

export async function saveTimezone(timezone) {
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) throw userError || new Error('로그인이 필요해요.');
  const { error } = await client.from('tempo_profiles').upsert({ user_id: user.id, timezone, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function registerPush(sound = false) {
  if (!client || !pushKey) throw new Error('백그라운드 알림 연결을 준비 중이에요.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('홈 화면에 앱을 설치한 뒤 알림을 켜주세요.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const raw = atob(pushKey.replace(/-/g, '+').replace(/_/g, '/'));
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
  }
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('알림 연결을 위해 다시 시도해주세요.');
  const { error } = await client.from('tempo_subscriptions').upsert({
    endpoint: subscription.endpoint, user_id: user.id, subscription: subscription.toJSON(), sound,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return subscription;
}

export async function removePush() {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription && client) {
    const { error } = await client.from('tempo_subscriptions').delete().eq('endpoint', subscription.endpoint);
    if (error) throw error;
  }
  if (subscription) await subscription.unsubscribe();
}
