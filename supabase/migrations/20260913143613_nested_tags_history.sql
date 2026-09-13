create table public.tempo_tags (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path text not null,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, path),
  constraint valid_tag_path check (length(path) between 2 and 120 and path ~ '^#[^/#]+(/[^/#]+)*$')
);
alter table public.tempo_tags enable row level security;
grant select, insert, update, delete on public.tempo_tags to authenticated;
grant all on public.tempo_tags to service_role;
create policy "Own tags" on public.tempo_tags to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.tempo_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint valid_session check (
    jsonb_typeof(data) = 'object' and
    data ?& array['id','timerId','title','tags','priority','mode','startedAt','endedAt','activeMs','segments'] and
    data->>'id' = id::text and (data->>'timerId')::uuid is not null and
    length(btrim(data->>'title')) between 1 and 60 and jsonb_typeof(data->'tags') = 'array' and
    data->>'priority' in ('low','normal','high') and data->>'mode' in ('timer','stopwatch') and
    (data->>'startedAt')::bigint >= 0 and (data->>'endedAt')::bigint >= (data->>'startedAt')::bigint and
    (data->>'activeMs')::bigint between 10000 and 9007199254740991 and jsonb_typeof(data->'segments') = 'array'
  )
);
create index tempo_sessions_owner_started on public.tempo_sessions(user_id, ((data->>'startedAt')::bigint));
alter table public.tempo_sessions enable row level security;
grant select, insert, update, delete on public.tempo_sessions to authenticated;
grant all on public.tempo_sessions to service_role;
create policy "Own sessions" on public.tempo_sessions to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.tempo_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  timezone text not null check (length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);
alter table public.tempo_profiles enable row level security;
grant select, insert, update, delete on public.tempo_profiles to authenticated;
grant all on public.tempo_profiles to service_role;
create policy "Own profile" on public.tempo_profiles to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- The same session can be finalized by several devices. Keep the most complete copy.
create function public.tempo_save_session(entry jsonb)
returns setof public.tempo_sessions language sql security invoker set search_path = '' as $$
  insert into public.tempo_sessions(id, user_id, data)
  values ((entry->>'id')::uuid, auth.uid(), entry)
  on conflict (id) do update set data = excluded.data, updated_at = now()
    where public.tempo_sessions.user_id = auth.uid()
      and (public.tempo_sessions.data->>'activeMs')::bigint <= (excluded.data->>'activeMs')::bigint
  returning *
$$;
revoke all on function public.tempo_save_session(jsonb) from public, anon;
grant execute on function public.tempo_save_session(jsonb) to authenticated;

-- Renaming a prefix to an existing path is a merge. History rows are snapshots and stay untouched.
create function public.tempo_merge_tag(source text, target text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if source !~ '^#[^/#]+(/[^/#]+)*$' or target !~ '^#[^/#]+(/[^/#]+)*$'
    or length(source) > 120 or length(target) > 120 or source = target or left(target, length(source) + 1) = source || '/'
  then raise exception 'Invalid tag merge'; end if;

  insert into public.tempo_tags(user_id, path, archived)
    select auth.uid(), target || substr(path, length(source) + 1), false
    from public.tempo_tags
    where user_id = auth.uid() and (path = source or left(path, length(source) + 1) = source || '/')
  on conflict (user_id, path) do update set archived = false, updated_at = now();

  update public.tempo_timers set
    data = jsonb_set(data, '{tags}', (
      select coalesce(jsonb_agg(path order by path), '[]'::jsonb)
      from (
        select distinct case when tag = source or left(tag, length(source) + 1) = source || '/'
          then target || substr(tag, length(source) + 1) else tag end as path
        from jsonb_array_elements_text(coalesce(data->'tags', '[]'::jsonb)) as item(tag)
      ) mapped
    )), revision = revision + 1
    where user_id = auth.uid() and deleted_at is null and exists (
      select 1 from jsonb_array_elements_text(coalesce(data->'tags', '[]'::jsonb)) as item(tag)
      where tag = source or left(tag, length(source) + 1) = source || '/'
    );

  update public.tempo_tags set archived = true, updated_at = now()
    where user_id = auth.uid() and (path = source or left(path, length(source) + 1) = source || '/');
end;
$$;
revoke all on function public.tempo_merge_tag(text,text) from public, anon;
grant execute on function public.tempo_merge_tag(text,text) to authenticated;

alter publication supabase_realtime add table public.tempo_tags, public.tempo_sessions, public.tempo_profiles;
