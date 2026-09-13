// Integration check against the configured Supabase project. Uses one temporary anonymous user.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createTimer, transition } from '../src/model.js';
const env = Object.fromEntries(readFileSync('.env', 'utf8').trim().split('\n').map(line => line.split('=')));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const a = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, options);
const b = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, options);
const session = JSON.parse(readFileSync(process.env.TEMPO_TEST_SESSION || '/tmp/tempo-test-session.json', 'utf8'));
for (const client of [a, b]) { const { error } = await client.auth.setSession(session); if (error) throw error; }
await b.realtime.setAuth(session.access_token);
const save = async (timer, expected_revision) => {
  const { data, error } = await a.rpc('tempo_save_timer', { timer, expected_revision });
  if (error) throw error;
  return data;
};
const timer = createTimer({ title: 'Integration check', mode: 'stopwatch' });
let channel;
try {
  const created = await save(timer, -1);
  assert.equal(created.length, 1);
  let changed;
  const change = new Promise(resolve => { changed = resolve; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timeout')), 20_000);
    channel = b.channel(`test-${timer.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tempo_timers', filter: `id=eq.${timer.id}` }, payload => changed(payload.new))
      .subscribe(state => { if (state === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); } });
  });
  const running = transition(timer, 'toggle');
  assert.equal((await save(running, 0))[0].revision, 1);
  const event = await Promise.race([change, new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime event timeout')), 15_000))]);
  assert.equal(event.data.state, 'running');
  assert.equal((await save(timer, 0)).length, 0, 'A stale device must not overwrite the running timer');
  const { data: otherRead, error } = await b.from('tempo_timers').select('data').eq('id', timer.id).single();
  if (error) throw error;
  assert.equal(otherRead.data.state, 'running');
  const secretRead = await a.from('tempo_push_config').select('*');
  assert.ok(secretRead.error, 'Browser credentials must never read push private keys');
  const unauthenticated = await fetch(env.VITE_SUPABASE_URL + '/functions/v1/tempo-push', { method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 401, 'Push sender must authenticate dispatch');
  console.log('Cloud checks passed: anonymous auth, persistence, realtime across clients, revision conflict, secret isolation, protected push dispatch.');
} finally {
  await a.from('tempo_timers').delete().eq('id', timer.id);
  if (channel) await b.removeChannel(channel);
  a.realtime.disconnect();
  b.realtime.disconnect();
}
