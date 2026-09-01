create table public.privacy_consent_evidence (
  evidence_id uuid primary key,
  consent_id uuid not null,
  company_id uuid references public.companies(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  policy_version text not null check (policy_version = 'piw-privacy-v1'),
  necessary_granted boolean not null default true check (necessary_granted),
  analytics_granted boolean not null,
  advertising_granted boolean not null,
  gpc_detected boolean not null,
  source text not null check (source in ('banner','preferences','gpc')),
  request_ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (consent_id, policy_version, occurred_at, source)
);

create index privacy_consent_evidence_consent_idx
  on public.privacy_consent_evidence(consent_id, occurred_at desc);
create index privacy_consent_evidence_lead_idx
  on public.privacy_consent_evidence(company_id, lead_id, occurred_at desc)
  where lead_id is not null;

alter table public.privacy_consent_evidence enable row level security;
revoke all on public.privacy_consent_evidence from public, anon, authenticated;
grant all on public.privacy_consent_evidence to service_role;

create or replace function public.record_privacy_consent(
  p_evidence_id uuid,
  p_consent_id uuid,
  p_company_id uuid,
  p_lead_id uuid,
  p_policy_version text,
  p_analytics_granted boolean,
  p_advertising_granted boolean,
  p_gpc_detected boolean,
  p_source text,
  p_request_ip inet,
  p_user_agent text,
  p_occurred_at timestamptz
) returns table(evidence_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.privacy_consent_evidence(
    evidence_id, consent_id, company_id, lead_id, policy_version,
    necessary_granted, analytics_granted, advertising_granted,
    gpc_detected, source, request_ip, user_agent, occurred_at
  ) values (
    p_evidence_id, coalesce(p_consent_id, p_evidence_id), p_company_id, p_lead_id, p_policy_version,
    true, p_analytics_granted, p_advertising_granted,
    p_gpc_detected, p_source, p_request_ip,
    nullif(left(trim(p_user_agent), 512), ''), p_occurred_at
  ) on conflict on constraint privacy_consent_evidence_pkey do nothing;
  return query select p_evidence_id;
end;
$$;

revoke all on function public.record_privacy_consent(
  uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.record_privacy_consent(
  uuid,uuid,uuid,uuid,text,boolean,boolean,boolean,text,inet,text,timestamptz
) to service_role;
