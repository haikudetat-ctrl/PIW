-- Just enough of pgTAP (plan, ok, is, isnt, lives_ok, throws_ok, finish) to
-- run supabase/tests/*.test.sql files in the sandbox. CI uses real pgTAP.
create table if not exists pg_temp_tap (n serial, ok boolean, description text);
create or replace function plan(integer) returns text language plpgsql as $$
begin
  perform set_config('tap.planned', $1::text, false);
  truncate pg_temp_tap restart identity;
  return '1..' || $1;
end $$;
create or replace function ok(boolean, text default '') returns text language plpgsql as $$
begin
  insert into pg_temp_tap(ok, description) values (coalesce($1, false), $2);
  return case when coalesce($1, false) then 'ok ' else 'not ok ' end || (select max(n) from pg_temp_tap) || ' - ' || $2;
end $$;
create or replace function is(anyelement, anyelement, text default '') returns text language plpgsql as $$
begin
  if $1 is not distinct from $2 then return ok(true, $3); end if;
  raise warning 'FAILED: % (have %, want %)', $3, $1, $2;
  return ok(false, $3);
end $$;
create or replace function isnt(anyelement, anyelement, text default '') returns text language plpgsql as $$
begin return ok($1 is distinct from $2, $3); end $$;
create or replace function lives_ok(text, text default '') returns text language plpgsql as $$
begin
  execute $1;
  return ok(true, $2);
exception when others then
  raise warning 'FAILED: % (%)', $2, sqlerrm;
  return ok(false, $2);
end $$;
create or replace function throws_ok(text, text, text, text) returns text language plpgsql as $$
begin
  execute $1;
  raise warning 'FAILED: % (no error)', $4;
  return ok(false, $4);
exception when others then
  if sqlstate = $2 then return ok(true, $4); end if;
  raise warning 'FAILED: % (sqlstate %, %)', $4, sqlstate, sqlerrm;
  return ok(false, $4);
end $$;
create or replace function finish() returns setof text language plpgsql as $$
declare v_planned integer := current_setting('tap.planned')::integer; v_run integer; v_failed integer;
begin
  select count(*), count(*) filter (where not ok) into v_run, v_failed from pg_temp_tap;
  if v_run <> v_planned then return next 'PLAN MISMATCH: planned ' || v_planned || ', ran ' || v_run; end if;
  return next 'RESULT: ' || (v_run - v_failed) || '/' || v_run || ' passed';
end $$;
