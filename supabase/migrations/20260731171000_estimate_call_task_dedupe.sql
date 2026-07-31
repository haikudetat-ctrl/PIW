create unique index tasks_one_immediate_estimate_call_idx
  on public.tasks(lead_id)
  where title = 'Call new roof-estimate lead now';
