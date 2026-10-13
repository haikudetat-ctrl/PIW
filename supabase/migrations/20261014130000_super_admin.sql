-- Super admin and team management.
--
-- A platform admin (public.platform_admins) is a super admin: every role
-- check already ranks them above company admin. This adds what the role is
-- for:
--   * switching the active company (admin_profiles.company_id, which every
--     company-scoped policy reads through current_company_id());
--   * creating companies;
--   * a platform health summary across companies.
-- And, for company admins and super admins, the Team & roles screen: list
-- the company's members and change their role or deactivate them.
--
-- Invitations create the auth user through the Supabase admin API on the
-- server, then call grant_company_membership(); nothing here touches
-- credentials.

-- -----------------------------------------------------------------------------
-- Companies the caller can switch to
-- -----------------------------------------------------------------------------

create function public.list_my_companies()
returns table (id uuid, name text, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select company.id, company.name,
    company.id = (select profile.company_id from public.admin_profiles as profile where profile.id = (select auth.uid()))
  from public.companies as company
  where public.is_platform_admin()
     or exists (
       select 1 from public.company_memberships as membership
       where membership.user_id = (select auth.uid())
         and membership.company_id = company.id
         and membership.is_active
     )
  order by company.name, company.id
$$;

create function public.switch_active_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.is_platform_admin() and not exists (
    select 1 from public.company_memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.company_id = p_company_id
      and membership.is_active
  ) then
    raise exception 'Not a member of that company' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  update public.admin_profiles
  set company_id = p_company_id
  where id = (select auth.uid());
  if not found then
    raise exception 'No profile to switch' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Companies (super admin)
-- -----------------------------------------------------------------------------

create function public.create_company(p_name text, p_jobnimbus_env_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a super admin can create companies' using errcode = '42501';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'A company name is required' using errcode = '22023';
  end if;

  insert into public.companies (name) values (pg_catalog.btrim(p_name))
  returning id into v_company_id;

  -- The sync stays disabled until the named environment variable is set on
  -- the server and someone turns it on.
  if nullif(pg_catalog.btrim(p_jobnimbus_env_key), '') is not null then
    insert into public.company_integrations (company_id, provider, env_key_name, history_start, enabled)
    values (v_company_id, 'jobnimbus', pg_catalog.btrim(p_jobnimbus_env_key), pg_catalog.now() - interval '1 year', false);
  end if;

  return v_company_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Team & roles (company admin and above, in the active company)
-- -----------------------------------------------------------------------------

create function public.list_company_members()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  is_active boolean,
  invited_at timestamptz,
  confirmed boolean,
  last_sign_in_at timestamptz,
  open_tasks bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.user_id,
    login.email::text,
    coalesce(profile.display_name, login.email::text),
    membership.role,
    membership.is_active,
    login.invited_at,
    login.email_confirmed_at is not null,
    login.last_sign_in_at,
    (
      select count(*) from public.tasks as task
      where task.company_id = membership.company_id
        and task.assigned_to = membership.user_id
        and task.status = 'open'
    )
  from public.company_memberships as membership
  join auth.users as login on login.id = membership.user_id
  left join public.admin_profiles as profile on profile.id = membership.user_id
  where public.has_company_role('company_admin')
    and membership.company_id = public.current_company_id()
  order by membership.is_active desc,
    case membership.role when 'company_admin' then 1 when 'manager' then 2 else 3 end,
    coalesce(profile.display_name, login.email::text)
$$;

create function public.update_company_member(p_user_id uuid, p_role text, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if not public.has_company_role('company_admin') or v_company_id is null then
    raise exception 'Only a company admin can change roles' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own role or access' using errcode = '42501';
  end if;
  if p_role not in ('company_admin', 'manager', 'employee') then
    raise exception 'Unknown company role %', p_role using errcode = '22023';
  end if;

  update public.company_memberships
  set role = p_role, is_active = p_is_active, updated_at = pg_catalog.now()
  where user_id = p_user_id and company_id = v_company_id;
  if not found then
    raise exception 'That person is not a member of this company' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Platform health (super admin)
-- -----------------------------------------------------------------------------

create function public.platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a super admin can see platform health' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'company_id', company.id,
      'name', company.name,
      'members', (
        select count(*) from public.company_memberships as membership
        where membership.company_id = company.id and membership.is_active
      ),
      'leads_7d', (
        select count(*) from public.leads as lead
        where lead.company_id = company.id and not lead.is_test
          and lead.created_at >= pg_catalog.now() - interval '7 days'
      ),
      'leads_total', (
        select count(*) from public.leads as lead
        where lead.company_id = company.id and not lead.is_test
      ),
      'jobnimbus_enabled', coalesce((
        select integration.enabled from public.company_integrations as integration
        where integration.company_id = company.id and integration.provider = 'jobnimbus'
      ), false),
      'jobnimbus_jobs', (select count(*) from public.jn_jobs as job where job.company_id = company.id),
      'last_sync', (
        select jsonb_build_object('status', run.status, 'started_at', run.started_at, 'record_type', run.record_type)
        from public.jobnimbus_sync_runs as run
        where run.company_id = company.id
        order by run.started_at desc
        limit 1
      ),
      'failed_syncs_24h', (
        select count(*) from public.jobnimbus_sync_runs as run
        where run.company_id = company.id and run.status in ('failed', 'reconcile_mismatch')
          and run.started_at >= pg_catalog.now() - interval '24 hours'
      ),
      'unmapped_statuses', coalesce((
        select pg_catalog.jsonb_array_length(census.unmapped_statuses)
        from public.jobnimbus_census as census
        where census.company_id = company.id
        order by census.captured_at desc
        limit 1
      ), 0),
      'stuck_pipelines', (
        select count(*) from public.pipeline_runs as run
        where run.company_id = company.id and run.status <> 'complete'
          and run.started_at < pg_catalog.now() - interval '30 minutes'
      ),
      'open_reviews', (
        select count(*) from public.review_tasks as review
        where review.company_id = company.id and review.status = 'open'
      )
    ) order by company.name)
    from public.companies as company
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.list_my_companies() from public, anon;
revoke execute on function public.switch_active_company(uuid) from public, anon;
revoke execute on function public.create_company(text, text) from public, anon;
revoke execute on function public.list_company_members() from public, anon;
revoke execute on function public.update_company_member(uuid, text, boolean) from public, anon;
revoke execute on function public.platform_health() from public, anon;
grant execute on function public.list_my_companies() to authenticated;
grant execute on function public.switch_active_company(uuid) to authenticated;
grant execute on function public.create_company(text, text) to authenticated;
grant execute on function public.list_company_members() to authenticated;
grant execute on function public.update_company_member(uuid, text, boolean) to authenticated;
grant execute on function public.platform_health() to authenticated;
