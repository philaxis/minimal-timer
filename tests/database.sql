-- Run with an admin database connection. All fixtures and writes roll back.
begin;
insert into auth.users(id, aud, role) values
 ('a0a0a0a0-0000-4000-8000-000000000001','authenticated','authenticated'),
 ('a0a0a0a0-0000-4000-8000-000000000002','authenticated','authenticated');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0a0a0a0-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare timer jsonb := '{"id":"b0b0b0b0-0000-4000-8000-000000000001","title":"RLS check","mode":"timer","duration":1000,"runDuration":1000,"elapsed":0,"anchor":null,"state":"idle","position":0,"runId":"c0c0c0c0-0000-4000-8000-000000000001"}';
n integer;
begin
  select count(*) into n from public.tempo_save_timer(timer, -1);
  assert n = 1, 'Timer creation failed';
  select count(*) into n from public.tempo_save_timer(timer || '{"title":"changed"}', 0);
  assert n = 1, 'Valid update failed';
  select count(*) into n from public.tempo_save_timer(timer || '{"title":"stale"}', 0);
  assert n = 0, 'Stale revision was accepted';
  begin
    perform public.tempo_save_timer(timer || '{"title":null}', 1);
    raise exception 'Invalid input was accepted';
  exception when check_violation then null;
  end;
  begin
    perform * from public.tempo_push_config;
    raise exception 'Server secrets readable by a user';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"a0a0a0a0-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare n integer;
begin
  select count(*) into n from public.tempo_timers;
  assert n = 0, 'Another user can read timers';
  update public.tempo_timers set data = data || '{"title":"stolen"}';
  get diagnostics n = row_count;
  assert n = 0, 'Another user can edit timers';
end $$;
reset role;
rollback;
