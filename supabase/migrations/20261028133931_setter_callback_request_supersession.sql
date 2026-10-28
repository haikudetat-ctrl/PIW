-- Unify homeowner and setter callback promises under the queue lock.
create or replace function public.request_estimate_callback(
  p_public_token uuid,
  p_call_window text,
  p_due_at timestamptz
) returns table (task_id uuid, call_window text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate record;
  v_task public.tasks%rowtype;
  v_window text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_call_window, '')));
  v_label text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_label := case v_window
    when 'asap' then 'as soon as possible'
    when 'morning' then 'in the morning (9 to 12)'
    when 'afternoon' then 'in the afternoon (12 to 5)'
    when 'evening' then 'in the early evening (5 to 8)'
  end;
  if v_label is null then
    raise exception 'Unsupported call window';
  end if;
  if p_due_at is null then
    raise exception 'A due time is required';
  end if;

  select estimate.company_id, estimate.lead_id into v_estimate
  from public.roof_estimates estimate
  where estimate.public_token = p_public_token;
  if not found or v_estimate.lead_id is null then
    raise exception 'Estimate not found';
  end if;

  -- Match the queue writer's lock order before locking a task row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('setter-company:' || v_estimate.company_id::text, 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estimate-callback:' || v_estimate.lead_id::text, 0)
  );

  select task.* into v_task
  from public.tasks task
  where task.lead_id = v_estimate.lead_id
    and task.company_id = v_estimate.company_id
    and task.origin = 'callback_request'
    and task.status = 'open'
  for update;

  -- The homeowner's latest callback promise supersedes other open queue
  -- work, including a currently claimed intake/follow-up call. An old
  -- outcome must not cancel or overwrite that promise.
  update public.tasks task set status = 'cancelled',
    claim_user_id = null, claim_token = null, claim_expires_at = null,
    claimed_at = null, updated_at = v_now
  where task.company_id = v_estimate.company_id
    and task.lead_id = v_estimate.lead_id
    and task.queue_bucket is not null and task.status = 'open'
    and task.id is distinct from v_task.id;

  if v_task.id is not null then
    update public.tasks task set
      description = 'The homeowner asked for a call ' || v_label || ', Eastern time.',
      due_at = p_due_at,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    return query select v_task.id, v_window, false;
    return;
  end if;

  insert into public.tasks(company_id, lead_id, title, description, due_at, origin, created_at, updated_at)
  values (
    v_estimate.company_id,
    v_estimate.lead_id,
    'Call back: homeowner asked for a call',
    'The homeowner asked for a call ' || v_label || ', Eastern time.',
    p_due_at,
    'callback_request',
    v_now,
    v_now
  )
  returning * into v_task;

  insert into public.notifications(company_id, lead_id, type, title, body, correlation_id, created_at)
  values (
    v_estimate.company_id,
    v_estimate.lead_id,
    'callback_requested',
    'Callback requested',
    'A homeowner asked for a call ' || v_label || '.',
    v_task.id,
    v_now
  )
  on conflict do nothing;

  return query select v_task.id, v_window, true;
end;
$$;

revoke execute on function public.request_estimate_callback(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.request_estimate_callback(uuid, text, timestamptz) to service_role;
