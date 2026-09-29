-- Tiered access: SuperAdmin → CompanyAdmin → Manager → Employee.
--
-- admin_profiles stays the "active company" pointer every server action and
-- RLS policy already reads. Roles live in company_memberships, and the two
-- existing gates now require one:
--
--   * current_company_id() returns a company only for an active Manager,
--     CompanyAdmin, or SuperAdmin. Every existing company-scoped policy
--     therefore excludes Employees and deactivated users without edits.
--   * The admin_profiles read policy applies the same rule, so every server
--     action's "load my admin profile" check denies them too.
--
-- Employees see only their assigned JobNimbus records until the journey
-- dashboard ships their scoped view.

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.company_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null check (role in ('company_admin', 'manager', 'employee')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index company_memberships_company_idx on public.company_memberships(company_id, role);

-- Every existing profile is a full admin of its company today.
insert into public.company_memberships (user_id, company_id, role)
select profile.id, profile.company_id, 'company_admin'
from public.admin_profiles as profile
on conflict (user_id, company_id) do nothing;

-- The documented provisioning path inserts an admin_profiles row. Keep that
-- path granting what it grants today rather than silently locking the new
-- user out; a narrower role is set on the membership afterwards, or up front
-- through grant_company_membership().
create function public.ensure_admin_profile_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_memberships (user_id, company_id, role)
  values (new.id, new.company_id, 'company_admin')
  on conflict (user_id, company_id) do nothing;
  return new;
end;
$$;

create trigger admin_profiles_ensure_membership
  after insert on public.admin_profiles
  for each row execute function public.ensure_admin_profile_membership();

create function public.company_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'employee' then 1
    when 'manager' then 2
    when 'company_admin' then 3
    when 'super_admin' then 4
    else 0
  end
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  )
$$;

-- The caller's role in their active company (admin_profiles.company_id), or
-- null. Security definer so policies on admin_profiles can call it without
-- recursing through their own RLS.
create function public.current_company_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
      then 'super_admin'
    else (
      select membership.role
      from public.admin_profiles as profile
      join public.company_memberships as membership
        on membership.user_id = profile.id
       and membership.company_id = profile.company_id
       and membership.is_active
      where profile.id = (select auth.uid())
    )
  end
$$;

create function public.has_company_role(p_minimum text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.company_role_rank(public.current_company_role())
      >= public.company_role_rank(p_minimum),
    false
  ) and public.company_role_rank(p_minimum) > 0
$$;

-- Company for any active member, including Employees. Used only by policies
-- that also apply an assignment check.
create function public.current_member_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.company_id
  from public.admin_profiles as profile
  where profile.id = (select auth.uid())
    and public.current_company_role() is not null
$$;

-- Company for CRM access: Managers and above. Every existing company-scoped
-- policy reads this function.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.company_id
  from public.admin_profiles as profile
  where profile.id = (select auth.uid())
    and public.company_role_rank(public.current_company_role()) >= 2
$$;

drop policy "admins read own profile" on public.admin_profiles;
create policy "managers read own profile" on public.admin_profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    and public.company_role_rank((select public.current_company_role())) >= 2
  );

-- -----------------------------------------------------------------------------
-- Session access summary for the app shell
-- -----------------------------------------------------------------------------

create function public.get_my_access()
returns table (
  user_id uuid,
  company_id uuid,
  display_name text,
  role text,
  is_platform_admin boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.company_id,
    profile.display_name,
    public.current_company_role(),
    public.is_platform_admin()
  from public.admin_profiles as profile
  where profile.id = (select auth.uid())
    and public.current_company_role() is not null
$$;

-- -----------------------------------------------------------------------------
-- Provisioning (service role only)
-- -----------------------------------------------------------------------------

create function public.grant_company_membership(
  p_email text,
  p_company_id uuid,
  p_role text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if p_role not in ('company_admin', 'manager', 'employee') then
    raise exception 'Unknown company role %', p_role using errcode = '22023';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_display_name, ''))) = 0 then
    raise exception 'A display name is required' using errcode = '22023';
  end if;

  select id into v_user_id
  from auth.users
  where pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_user_id is null then
    raise exception 'No auth user exists for that email' using errcode = 'P0002';
  end if;

  -- Membership first, so the admin_profiles trigger does not grant a broader
  -- default role.
  insert into public.company_memberships (user_id, company_id, role, is_active)
  values (v_user_id, p_company_id, p_role, true)
  on conflict (user_id, company_id) do update
  set role = excluded.role, is_active = true, updated_at = pg_catalog.now();

  insert into public.admin_profiles (id, company_id, display_name)
  values (v_user_id, p_company_id, pg_catalog.btrim(p_display_name))
  on conflict (id) do nothing;

  return v_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rep identities: one person across PIW, JobNimbus and LeadMaster
-- -----------------------------------------------------------------------------

create table public.rep_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_system text not null check (source_system in ('jobnimbus', 'leadmaster')),
  external_user_id text not null check (length(btrim(external_user_id)) > 0),
  external_name text,
  external_email text,
  user_id uuid references auth.users(id) on delete set null,
  match_method text check (match_method in ('email', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, external_user_id),
  check ((user_id is null) = (match_method is null))
);

create index rep_identities_user_idx on public.rep_identities(user_id) where user_id is not null;

-- Records every JobNimbus sales rep seen on a job or contact so a CompanyAdmin
-- can link them. JobNimbus does not expose rep email on these records, so
-- JobNimbus reps are linked manually; LeadMaster exports carry email.
create function public.discover_jobnimbus_reps(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  insert into public.rep_identities (company_id, source_system, external_user_id, external_name)
  select distinct on (rep.sales_rep_jnid)
    p_company_id, 'jobnimbus', rep.sales_rep_jnid, rep.sales_rep_name
  from (
    select sales_rep_jnid, sales_rep_name, jn_updated_at
    from public.jn_jobs
    where company_id = p_company_id and sales_rep_jnid is not null
    union all
    select sales_rep_jnid, sales_rep_name, jn_updated_at
    from public.jn_contacts
    where company_id = p_company_id and sales_rep_jnid is not null
  ) as rep
  order by rep.sales_rep_jnid, rep.jn_updated_at desc nulls last
  on conflict (company_id, source_system, external_user_id) do update
  set external_name = coalesce(excluded.external_name, public.rep_identities.external_name),
      updated_at = pg_catalog.now()
  where public.rep_identities.external_name is distinct from excluded.external_name
    and excluded.external_name is not null;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- Links unlinked identities whose email matches an active member's login.
create function public.link_rep_identities_by_email(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked integer;
begin
  update public.rep_identities as identity
  set user_id = member.user_id, match_method = 'email', updated_at = pg_catalog.now()
  from public.company_memberships as member
  join auth.users as login on login.id = member.user_id
  where identity.company_id = p_company_id
    and identity.user_id is null
    and identity.external_email is not null
    and member.company_id = p_company_id
    and member.is_active
    and pg_catalog.lower(pg_catalog.btrim(identity.external_email)) = pg_catalog.lower(login.email);
  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.platform_admins enable row level security;
alter table public.company_memberships enable row level security;
alter table public.rep_identities enable row level security;

revoke all on public.platform_admins, public.company_memberships, public.rep_identities
  from anon, authenticated;
grant select, insert, update, delete
  on public.platform_admins, public.company_memberships, public.rep_identities
  to service_role;
grant select on public.platform_admins, public.company_memberships, public.rep_identities
  to authenticated;

create policy "users read own platform admin row" on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members read own memberships" on public.company_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "company admins read company memberships" on public.company_memberships
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.has_company_role('company_admin'))
  );

create policy "members read own rep identities" on public.rep_identities
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "company admins read company rep identities" on public.rep_identities
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.has_company_role('company_admin'))
  );

-- JobNimbus projections: Managers and above see the whole company; Employees
-- see only records whose JobNimbus sales rep is linked to them.
grant select on public.jn_jobs, public.jn_contacts, public.jn_estimates,
  public.jobnimbus_sync_runs, public.company_integrations
  to authenticated;

create function public.is_assigned_jobnimbus_rep(p_company_id uuid, p_sales_rep_jnid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_sales_rep_jnid is not null and exists (
    select 1
    from public.rep_identities
    where company_id = p_company_id
      and source_system = 'jobnimbus'
      and external_user_id = p_sales_rep_jnid
      and user_id = (select auth.uid())
  )
$$;

create policy "members read visible jobnimbus jobs" on public.jn_jobs
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (
      (select public.has_company_role('manager'))
      or public.is_assigned_jobnimbus_rep(company_id, sales_rep_jnid)
    )
  );

create policy "members read visible jobnimbus contacts" on public.jn_contacts
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (
      (select public.has_company_role('manager'))
      or public.is_assigned_jobnimbus_rep(company_id, sales_rep_jnid)
    )
  );

create policy "members read visible jobnimbus estimates" on public.jn_estimates
  for select to authenticated
  using (
    company_id = (select public.current_member_company_id())
    and (
      (select public.has_company_role('manager'))
      or exists (
        select 1 from public.jn_jobs as job
        where job.company_id = jn_estimates.company_id
          and job.jnid = jn_estimates.related_job_jnid
          and public.is_assigned_jobnimbus_rep(job.company_id, job.sales_rep_jnid)
      )
    )
  );

create policy "company admins read jobnimbus sync runs" on public.jobnimbus_sync_runs
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.has_company_role('company_admin'))
  );

create policy "company admins read integrations" on public.company_integrations
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.has_company_role('company_admin'))
  );

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke execute on function
  public.ensure_admin_profile_membership(),
  public.grant_company_membership(text, uuid, text, text),
  public.discover_jobnimbus_reps(uuid),
  public.link_rep_identities_by_email(uuid)
from public, anon, authenticated;
grant execute on function
  public.grant_company_membership(text, uuid, text, text),
  public.discover_jobnimbus_reps(uuid),
  public.link_rep_identities_by_email(uuid)
to service_role;

revoke execute on function
  public.company_role_rank(text),
  public.is_platform_admin(),
  public.current_company_role(),
  public.has_company_role(text),
  public.current_member_company_id(),
  public.current_company_id(),
  public.get_my_access(),
  public.is_assigned_jobnimbus_rep(uuid, text)
from public, anon;
grant execute on function
  public.company_role_rank(text),
  public.is_platform_admin(),
  public.current_company_role(),
  public.has_company_role(text),
  public.current_member_company_id(),
  public.current_company_id(),
  public.get_my_access(),
  public.is_assigned_jobnimbus_rep(uuid, text)
to authenticated, service_role;
