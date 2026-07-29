insert into public.companies (id, name)
values ('00000000-0000-4000-8000-000000000001', 'PIW Local Roofing')
on conflict (id) do nothing;
