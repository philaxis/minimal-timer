alter table public.tempo_timers add constraint timer_json_types check (
  jsonb_typeof(data->'title') = 'string' and
  jsonb_typeof(data->'mode') = 'string' and jsonb_typeof(data->'state') = 'string' and
  jsonb_typeof(data->'duration') = 'number' and jsonb_typeof(data->'runDuration') = 'number' and
  jsonb_typeof(data->'elapsed') = 'number' and jsonb_typeof(data->'position') = 'number' and
  jsonb_typeof(data->'runId') = 'string' and
  (jsonb_typeof(data->'anchor') = 'number' or data->'anchor' = 'null'::jsonb)
);
alter table public.tempo_subscriptions add constraint subscription_required_fields check (
  subscription ?& array['endpoint','keys'] and
  (subscription->'keys') ?& array['p256dh','auth'] and
  jsonb_typeof(subscription->'endpoint') = 'string' and
  jsonb_typeof(subscription->'keys'->'p256dh') = 'string' and
  jsonb_typeof(subscription->'keys'->'auth') = 'string'
);
create policy "Server configuration only" on public.tempo_push_config to service_role using (true) with check (true);

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Poll locally; invoke the Edge Function only when a notification is actually due.
select cron.schedule('tempo-completion-push', '5 seconds', $job$
  select net.http_post(
    url := 'https://hgqntslhgrbwkmuqpfbr.supabase.co/functions/v1/tempo-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tempo-secret', c.dispatch_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) from public.tempo_push_config c where exists (
    select 1 from public.tempo_timers
    where deleted_at is null and data->>'mode' = 'timer' and data->>'state' = 'running'
      and deadline_ms <= extract(epoch from now()) * 1000
      and notified_run is distinct from (data->>'runId')::uuid
      and (push_claim_until is null or push_claim_until < now())
  );
$job$);
