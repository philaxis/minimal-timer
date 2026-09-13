import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createTimer, transition } from '../src/model.js';
const env = Object.fromEntries(readFileSync('.env', 'utf8').trim().split('\n').map(line => line.split('=')));
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const session = JSON.parse(readFileSync('/tmp/tempo-test-session.json', 'utf8'));
const { error: authError } = await client.auth.setSession(session);
if (authError) throw authError;
const timer = transition(createTimer({ title: 'Push pipeline check', duration: 1000 }), 'toggle', {}, Date.now() - 2000);
try {
  const { data, error } = await client.rpc('tempo_save_timer', { timer, expected_revision: -1 });
  if (error) throw error;
  const verify = new URL(env.VITE_SUPABASE_URL + '/functions/v1/tempo-push');
  verify.search = new URLSearchParams({ id: timer.id, run: timer.runId, token: data[0].notification_token });
  assert.equal((await (await fetch(verify)).json()).valid, true);
  let processed = false;
  for (let i = 0; i < 25; i++) {
    const { data: row, error } = await client.from('tempo_timers').select('notified_run').eq('id', timer.id).single();
    if (error) throw error;
    if (row.notified_run === timer.runId) { processed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(processed, 'Cron should invoke the authenticated push function and process the due timer');
  const reset = transition(timer, 'reset');
  const { error: resetError } = await client.rpc('tempo_save_timer', { timer: reset, expected_revision: 0 });
  if (resetError) throw resetError;
  assert.equal((await (await fetch(verify)).json()).valid, false, 'Reset must invalidate an already queued notification');
  console.log('Push pipeline passed: scheduled Edge invocation, due timer processing, capability validation and stale notification cancellation. Real device delivery still requires a browser subscription.');
} finally {
  await client.from('tempo_timers').delete().eq('id', timer.id);
  client.realtime.disconnect();
}
