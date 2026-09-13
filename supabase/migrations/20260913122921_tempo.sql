create table public.tempo_timers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 0,
  deleted_at timestamptz,
  notified_run uuid,
  notification_token uuid not null default gen_random_uuid(),
  push_claim_until timestamptz,
  deadline_ms bigint generated always as ((data->>'anchor')::bigint + (data->>'runDuration')::bigint - (data->>'elapsed')::bigint) stored,
  constraint valid_timer check (
    jsonb_typeof(data) = 'object' and
    data ?& array['id','title','mode','duration','runDuration','elapsed','anchor','state','position','runId'] and
    data->>'id' = id::text and length(btrim(data->>'title')) between 1 and 60 and
    data->>'mode' in ('timer','stopwatch') and data->>'state' in ('idle','running','paused') and
    (data->>'duration')::bigint between 1000 and 604800000 and
    (data->>'runDuration')::bigint between 1000 and 604800000 and
    (data->>'elapsed')::bigint between 0 and 9007199254740991 and
    (data->>'position')::double precision between -1e12 and 1e12 and
    (data->>'runId')::uuid is not null and
    (data->>'state' <> 'running' or jsonb_typeof(data->'anchor') = 'number')
  )
);
create index tempo_timers_owner on public.tempo_timers(user_id);
create index tempo_timers_due on public.tempo_timers(deadline_ms)
  where deleted_at is null and data->>'mode' = 'timer' and data->>'state' = 'running';
alter table public.tempo_timers enable row level security;
grant select, insert, update, delete on public.tempo_timers to authenticated;
create policy "Own timers" on public.tempo_timers to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A revision check prevents a stale device from undoing another device's operation.
create function public.tempo_save_timer(timer jsonb, expected_revision integer, remove boolean default false)
returns setof public.tempo_timers language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if expected_revision = -1 and not remove then
    return query insert into public.tempo_timers(id, user_id, data)
      values ((timer->>'id')::uuid, auth.uid(), timer - 'revision')
      on conflict (id) do nothing returning *;
  else
    return query update public.tempo_timers set
      data = timer - 'revision', revision = revision + 1,
      deleted_at = case when remove then now() else null end
      where id = (timer->>'id')::uuid and user_id = auth.uid()
        and revision = expected_revision and deleted_at is null returning *;
  end if;
end;
$$;
revoke all on function public.tempo_save_timer(jsonb,integer,boolean) from public, anon;
grant execute on function public.tempo_save_timer(jsonb,integer,boolean) to authenticated;

create table public.tempo_subscriptions (
  endpoint text primary key check (length(endpoint) <= 2048),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  sound boolean not null default false,
  constraint valid_subscription check (
    subscription->>'endpoint' = endpoint and
    endpoint ~ '^https://' and
    jsonb_typeof(subscription->'keys') = 'object' and
    length(subscription->'keys'->>'p256dh') between 80 and 100 and
    length(subscription->'keys'->>'auth') between 20 and 30
  )
);
create index tempo_subscriptions_owner on public.tempo_subscriptions(user_id);
alter table public.tempo_subscriptions enable row level security;
grant select, insert, update, delete on public.tempo_subscriptions to authenticated;
create policy "Own subscriptions" on public.tempo_subscriptions to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Server-only material; never readable by browser roles, including anonymous users.
create table public.tempo_push_config (
  id boolean primary key default true check (id),
  vapid_public text not null,
  vapid_private text not null,
  dispatch_secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
alter table public.tempo_push_config enable row level security;
revoke all on public.tempo_push_config from anon, authenticated;
grant all on public.tempo_push_config to service_role;
grant all on public.tempo_timers, public.tempo_subscriptions to service_role;

create function public.tempo_claim_due()
returns setof public.tempo_timers language sql security invoker set search_path = '' as $$
  update public.tempo_timers t set push_claim_until = now() + interval '45 seconds'
  where t.id in (
    select id from public.tempo_timers
    where deleted_at is null and data->>'mode' = 'timer' and data->>'state' = 'running'
      and deadline_ms <= extract(epoch from now()) * 1000
      and notified_run is distinct from (data->>'runId')::uuid
      and (push_claim_until is null or push_claim_until < now())
    order by deadline_ms limit 25 for update skip locked
  ) returning t.*;
$$;
revoke all on function public.tempo_claim_due() from public, anon, authenticated;
grant execute on function public.tempo_claim_due() to service_role;

alter publication supabase_realtime add table public.tempo_timers;
