create table public.email_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  campaign_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  principal_names text[] not null default '{}',
  provider_message_id text,
  status text not null check(status in('sending','sent','failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_key,user_id)
);

alter table public.email_campaign_deliveries enable row level security;

create policy email_campaign_admin_read on public.email_campaign_deliveries for select to authenticated using (
  public.is_program_admin(program_id)
);

grant select on public.email_campaign_deliveries to authenticated;

create trigger audit_email_campaign_deliveries after insert or update or delete on public.email_campaign_deliveries
for each row execute function public.audit_row_change();
