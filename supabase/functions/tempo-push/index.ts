import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';
import { timingSafeEqual } from 'node:crypto';

const project = Deno.env.get('SUPABASE_URL')!;
const db = createClient(project, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function due(row: any) {
  return !row.deleted_at && row.data.mode === 'timer' && row.data.state === 'running' && row.deadline_ms <= Date.now();
}

// Endpoints are supplied by clients: restrict outbound requests to actual browser push services.
function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && (
      url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}

Deno.serve(async req => {
  const url = new URL(req.url);
  // A per-timer unguessable capability checks delayed pushes without exposing an account session.
  if (req.method === 'GET') {
    const id = url.searchParams.get('id'), token = url.searchParams.get('token'), run = url.searchParams.get('run');
    if (![id, token, run].every(value => value && uuid.test(value))) return response({ valid: false }, 400);
    const { data, error } = await db.from('tempo_timers').select('data,deleted_at,deadline_ms').eq('id', id).eq('notification_token', token).maybeSingle();
    if (error) return response({ valid: false }, 503);
    return response({ valid: !!data && due(data) && data.data.runId === run && Date.now() - data.deadline_ms < 15 * 60_000 });
  }
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const { data: config, error: configError } = await db.from('tempo_push_config').select('*').eq('id', true).single();
  if (configError || !config) return response({ error: 'Push is not configured' }, 503);
  const provided = new TextEncoder().encode(req.headers.get('x-tempo-secret') || '');
  const expected = new TextEncoder().encode(config.dispatch_secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return response({ error: 'Unauthorized' }, 401);
  webpush.setVapidDetails(project, config.vapid_public, config.vapid_private);
  const { data: rows, error } = await db.rpc('tempo_claim_due');
  if (error) return response({ error: 'Could not claim due timers' }, 500);
  let sent = 0;
  for (const row of rows || []) {
    const { data: subscriptions, error: subError } = await db.from('tempo_subscriptions').select('*').eq('user_id', row.user_id);
    if (subError) continue;
    let retry = false;
    // Old timers stay completed on screen, but do not send a burst of stale system alerts.
    if (Date.now() - row.deadline_ms < 15 * 60_000) {
      for (const sub of subscriptions || []) {
        if (!validEndpoint(sub.endpoint)) { await db.from('tempo_subscriptions').delete().eq('endpoint', sub.endpoint); continue; }
        const verify = `${project}/functions/v1/tempo-push?id=${row.id}&token=${row.notification_token}&run=${row.data.runId}`;
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify({
            title: `${row.data.title} · 완료`, body: '수고했어요. 새로고침하면 다시 시작할 수 있어요.',
            tag: `${row.id}:${row.data.runId}`, timerId: row.id, sound: sub.sound, verifyUrl: verify,
          }), { TTL: 60, urgency: 'high', timeout: 5000 });
          sent++;
        } catch (error: any) {
          if ([404, 410, 400, 413].includes(error.statusCode)) await db.from('tempo_subscriptions').delete().eq('endpoint', sub.endpoint);
          else retry = true;
        }
      }
    }
    if (!retry) await db.from('tempo_timers').update({ notified_run: row.data.runId }).eq('id', row.id).eq('data->>runId', row.data.runId);
  }
  return response({ checked: rows?.length || 0, sent });
});
