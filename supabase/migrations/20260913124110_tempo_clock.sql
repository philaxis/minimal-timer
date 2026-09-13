create function public.tempo_server_time() returns bigint
language sql volatile security invoker set search_path = ''
as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
revoke all on function public.tempo_server_time() from public;
grant execute on function public.tempo_server_time() to anon, authenticated;
