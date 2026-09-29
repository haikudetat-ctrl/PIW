# Access roles and memberships

PIW has four access tiers:

| Role | Where it lives | Sees | Manages |
|---|---|---|---|
| Super admin | `platform_admins` | Every company | Everything |
| Company admin | `company_memberships.role = 'company_admin'` | Their whole company, including integration status | Users, integrations, cost table |
| Manager | `company_memberships.role = 'manager'` | Every customer, revenue and cost per sale in their company | Customer reassignment |
| Employee | `company_memberships.role = 'employee'` | Only customers assigned to them | Nothing |

The database enforces these rules; the UI only reflects them.

## How it works

- `admin_profiles` is each user's **active company** and display name. It is
  unchanged in shape; every existing server action still reads it.
- `company_memberships` holds the role per (user, company) and an
  `is_active` flag. Deactivating a membership removes access everywhere on the
  next request.
- `current_company_id()`, which every existing company-scoped policy uses,
  now returns a company only for an active Manager, Company admin or Super
  admin. The `admin_profiles` read policy applies the same rule. Employees and
  deactivated users are therefore excluded from the existing CRM (leads,
  pipeline, review, access route) without changes to those policies.
- Employees are identified to JobNimbus through `rep_identities`: a JobNimbus
  sales rep linked to their login. They can read `jn_jobs`, `jn_contacts` and
  `jn_estimates` only for their linked reps. Their full view arrives with the
  journey dashboard; until then the app shows them a holding page.
- `get_my_access()` returns the signed-in user's company, display name and
  role. The app shell uses it and shows a clear "No access yet" page instead
  of bouncing a signed-in but unprovisioned user back to the login form.

## Add a user

1. Create the login in the Supabase dashboard (**Authentication → Users → Add
   user**), auto-confirmed. Emails are matched case-insensitively.
2. Grant the membership in the SQL editor:

   ```sql
   select public.grant_company_membership(
     'person@example.com',        -- login email
     '<company uuid>',
     'employee',                  -- company_admin | manager | employee
     'Person Name'
   );
   ```

   This creates or reactivates the membership and, if the user has none, sets
   this company as their active company.

A bare `insert into public.admin_profiles` still works and grants
**company admin**, which is what a profile meant before roles existed. Prefer
`grant_company_membership` so the role is explicit.

## Change or remove access

```sql
-- Change a role
update public.company_memberships
set role = 'manager', updated_at = now()
where user_id = (select id from auth.users where lower(email) = lower('person@example.com'))
  and company_id = '<company uuid>';

-- Remove access (keeps history; do not delete the auth user, audit rows reference it)
update public.company_memberships
set is_active = false, updated_at = now()
where user_id = (select id from auth.users where lower(email) = lower('person@example.com'))
  and company_id = '<company uuid>';
```

## Super admin

```sql
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('owner@example.com')
on conflict do nothing;
```

A super admin acts in whichever company `admin_profiles.company_id` points at.
To switch companies, update that column for the super admin's row.

## Link employees to JobNimbus reps

JobNimbus does not expose rep email on jobs or contacts, so JobNimbus reps are
linked by hand after discovery:

```sql
-- Record every sales rep seen on synced jobs and contacts
select public.discover_jobnimbus_reps('<company uuid>');

-- Review them
select external_user_id, external_name, user_id
from public.rep_identities
where company_id = '<company uuid>' and source_system = 'jobnimbus'
order by external_name;

-- Link one rep to a login
update public.rep_identities
set user_id = (select id from auth.users where lower(email) = lower('person@example.com')),
    match_method = 'manual',
    updated_at = now()
where company_id = '<company uuid>'
  and source_system = 'jobnimbus'
  and external_user_id = '<JobNimbus sales rep jnid>';
```

Where an identity carries an email (LeadMaster exports),
`select public.link_rep_identities_by_email('<company uuid>');` links every
identity whose email matches an active member's login.
