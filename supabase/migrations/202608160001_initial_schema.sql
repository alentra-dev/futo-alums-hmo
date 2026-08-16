create extension if not exists pgcrypto;

create type public.program_role as enum ('subscriber', 'admin', 'owner');
create type public.period_status as enum ('scheduled', 'open', 'closed');
create type public.enrollment_status as enum ('draft', 'ready', 'submitted', 'closed');
create type public.payment_status as enum ('pending', 'verified', 'rejected');
create type public.coverage_category as enum ('individual', 'family');
create type public.member_type as enum ('Member', 'Dependent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  client_name text not null,
  privacy_contact_name text not null,
  retention_years smallint not null default 7 check (retention_years between 1 and 20),
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now()
);

create table public.program_memberships (
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.program_role not null default 'subscriber',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (program_id, user_id)
);

create table public.enrollment_periods (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  coverage_year integer not null check (coverage_year between 2020 and 2100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.period_status not null default 'scheduled',
  extension_note text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, provider_id, coverage_year),
  check (ends_at > starts_at)
);

create table public.plan_offerings (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.enrollment_periods(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  region text not null default 'Nigeria',
  individual_premium_kobo bigint not null check (individual_premium_kobo >= 0),
  family_premium_kobo bigint not null check (family_premium_kobo >= 0),
  total_fee_basis_points integer not null default 300 check (total_fee_basis_points between 0 and 10000),
  nhis_fee_basis_points integer not null default 100 check (nhis_fee_basis_points between 0 and 10000),
  reserve_fee_basis_points integer not null default 200 check (reserve_fee_basis_points between 0 and 10000),
  highlights jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (period_id, code),
  check (total_fee_basis_points = nhis_fee_basis_points + reserve_fee_basis_points)
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  legacy_key text,
  created_at timestamptz not null default now(),
  unique (program_id, legacy_key)
);

create table public.account_households (
  user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, household_id)
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_type public.member_type not null,
  surname text not null,
  first_name text not null,
  middle_name text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('Male', 'Female')),
  relation text not null,
  nationality text not null,
  address_of_residence text not null,
  country_of_residence text not null,
  state_of_residence text not null,
  town_of_residence text not null,
  lga_of_residence text not null,
  mobile_no text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_principal_per_household on public.people(household_id) where member_type = 'Member';

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  period_id uuid not null references public.enrollment_periods(id) on delete cascade,
  plan_offering_id uuid references public.plan_offerings(id),
  category public.coverage_category not null default 'individual',
  hospital_name text not null default '',
  status public.enrollment_status not null default 'draft',
  enrollment_date date not null default current_date,
  premium_kobo bigint not null default 0 check (premium_kobo >= 0),
  nhis_fee_kobo bigint not null default 0 check (nhis_fee_kobo >= 0),
  reserve_fee_kobo bigint not null default 0 check (reserve_fee_kobo >= 0),
  subscriber_total_kobo bigint not null default 0 check (subscriber_total_kobo >= 0),
  consented_at timestamptz,
  consent_policy_version text,
  completeness smallint not null default 0 check (completeness between 0 and 100),
  submitted_at timestamptz,
  closed_at timestamptz,
  imported_source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, period_id),
  check (subscriber_total_kobo = premium_kobo + nhis_fee_kobo + reserve_fee_kobo)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  paid_at date not null,
  reference text not null,
  proof_path text,
  status public.payment_status not null default 'pending',
  submitted_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  beneficiary text not null,
  bank text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  reference_prefix text not null default 'FUTO HMO',
  active_from timestamptz not null default now(),
  active_until timestamptz,
  created_at timestamptz not null default now(),
  check (active_until is null or active_until > active_from)
);
create unique index one_active_payment_account on public.payment_accounts(program_id) where active_until is null;

create table public.hospital_suggestions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (program_id, normalized_name)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  program_id uuid references public.programs(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  old_data jsonb,
  new_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  delivered_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  requester_id uuid not null references public.profiles(id),
  request_type text not null,
  details text not null,
  status text not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_program_member(p_program_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.program_memberships where program_id = p_program_id and user_id = auth.uid() and active);
$$;
create or replace function public.is_program_admin(p_program_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.program_memberships where program_id = p_program_id and user_id = auth.uid() and active and role in ('admin', 'owner'));
$$;
create or replace function public.is_program_owner(p_program_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.program_memberships where program_id = p_program_id and user_id = auth.uid() and active and role = 'owner');
$$;
create or replace function public.can_access_household(p_household_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.account_households where household_id = p_household_id and user_id = auth.uid())
    or exists(select 1 from public.households h where h.id = p_household_id and public.is_program_admin(h.program_id));
$$;

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity text := coalesce(row_data->>'id', 'unknown');
  program uuid;
begin
  program := nullif(row_data->>'program_id', '')::uuid;
  if program is null and tg_table_name = 'enrollments' then select h.program_id into program from public.households h where h.id = nullif(row_data->>'household_id','')::uuid; end if;
  if program is null and tg_table_name = 'people' then select h.program_id into program from public.households h where h.id = nullif(row_data->>'household_id','')::uuid; end if;
  if program is null and tg_table_name = 'payments' then select h.program_id into program from public.enrollments e join public.households h on h.id=e.household_id where e.id = nullif(row_data->>'enrollment_id','')::uuid; end if;
  insert into public.audit_events(program_id, actor_user_id, action, entity_type, entity_id, old_data, new_data, request_id)
  values (program, auth.uid(), lower(tg_table_name)||'.'||lower(tg_op), tg_table_name, entity,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    current_setting('request.headers', true)::jsonb->>'x-request-id');
  return coalesce(new, old);
end; $$;

create trigger audit_people after insert or update or delete on public.people for each row execute function public.audit_row_change();
create trigger audit_enrollments after insert or update or delete on public.enrollments for each row execute function public.audit_row_change();
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.audit_row_change();
create trigger audit_periods after insert or update or delete on public.enrollment_periods for each row execute function public.audit_row_change();
create trigger audit_plans after insert or update or delete on public.plan_offerings for each row execute function public.audit_row_change();
create trigger audit_payment_accounts after insert or update or delete on public.payment_accounts for each row execute function public.audit_row_change();
create trigger audit_memberships after insert or update or delete on public.program_memberships for each row execute function public.audit_row_change();

alter table public.profiles enable row level security;
alter table public.providers enable row level security;
alter table public.programs enable row level security;
alter table public.program_memberships enable row level security;
alter table public.enrollment_periods enable row level security;
alter table public.plan_offerings enable row level security;
alter table public.households enable row level security;
alter table public.account_households enable row level security;
alter table public.people enable row level security;
alter table public.enrollments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.hospital_suggestions enable row level security;
alter table public.audit_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.privacy_requests enable row level security;

create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_admin_select on public.profiles for select using (exists(select 1 from public.program_memberships mine join public.program_memberships theirs on theirs.program_id=mine.program_id where mine.user_id=auth.uid() and mine.active and mine.role in ('admin','owner') and theirs.user_id=profiles.id));
create policy programs_member_select on public.programs for select using (public.is_program_member(id));
create policy memberships_self_select on public.program_memberships for select using (user_id=auth.uid() or public.is_program_admin(program_id));
create policy periods_member_select on public.enrollment_periods for select using (public.is_program_member(program_id));
create policy plans_member_select on public.plan_offerings for select using (exists(select 1 from public.enrollment_periods p where p.id=period_id and public.is_program_member(p.program_id)));
create policy households_access_select on public.households for select using (public.can_access_household(id));
create policy account_households_access_select on public.account_households for select using (user_id=auth.uid() or public.can_access_household(household_id));
create policy people_access_select on public.people for select using (public.can_access_household(household_id));
create policy enrollments_access_select on public.enrollments for select using (public.can_access_household(household_id));
create policy payments_access_select on public.payments for select using (exists(select 1 from public.enrollments e where e.id=enrollment_id and public.can_access_household(e.household_id)));
create policy payment_accounts_member_select on public.payment_accounts for select using (public.is_program_member(program_id));
create policy hospital_member_select on public.hospital_suggestions for select using (public.is_program_member(program_id));
create policy audit_admin_select on public.audit_events for select using (public.is_program_admin(program_id));
create policy privacy_self_insert on public.privacy_requests for insert with check (requester_id=auth.uid() and public.is_program_member(program_id));
create policy privacy_self_select on public.privacy_requests for select using (requester_id=auth.uid() or public.is_program_admin(program_id));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs','payment-proofs',false,10485760,array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

create policy proof_owner_insert on storage.objects for insert to authenticated with check (
  bucket_id='payment-proofs' and exists(select 1 from public.enrollments e where e.id=((storage.foldername(name))[1])::uuid and public.can_access_household(e.household_id))
);
create policy proof_authorized_select on storage.objects for select to authenticated using (
  bucket_id='payment-proofs' and exists(select 1 from public.enrollments e where e.id=((storage.foldername(name))[1])::uuid and public.can_access_household(e.household_id))
);

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on public.profiles, public.programs, public.program_memberships, public.enrollment_periods, public.plan_offerings, public.households, public.account_households, public.people, public.enrollments, public.payments, public.payment_accounts, public.hospital_suggestions, public.audit_events, public.privacy_requests to authenticated;
grant insert on public.privacy_requests to authenticated;

insert into public.providers(name,code) values ('Avon Healthcare Limited','AVON') on conflict (code) do nothing;
insert into public.programs(slug,name,client_name,privacy_contact_name,retention_years)
values ('futo-alums-hmo','FUTO Alums HMO Program','FUTO Alumni HMO','Jude Oruoghor',7)
on conflict (slug) do nothing;

with program as (select id from public.programs where slug='futo-alums-hmo'), provider as (select id from public.providers where code='AVON')
insert into public.enrollment_periods(program_id,provider_id,coverage_year,starts_at,ends_at,status,closed_at)
select program.id,provider.id,2025,'2025-06-01 00:00:00+01','2025-08-31 23:59:59+01','closed','2025-08-31 23:59:59+01' from program,provider
on conflict do nothing;
with program as (select id from public.programs where slug='futo-alums-hmo'), provider as (select id from public.providers where code='AVON')
insert into public.enrollment_periods(program_id,provider_id,coverage_year,starts_at,ends_at,status)
select program.id,provider.id,2026,'2026-06-01 00:00:00+01','2026-08-31 23:59:59+01','open' from program,provider
on conflict do nothing;

with p as (select id from public.enrollment_periods where coverage_year=2026 and program_id=(select id from public.programs where slug='futo-alums-hmo'))
insert into public.plan_offerings(period_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,highlights,benefits,sort_order)
select p.id,v.code,v.name,v.description,v.region,v.individual_premium_kobo,v.family_premium_kobo,v.highlights::jsonb,v.benefits::jsonb,v.sort_order from p cross join (values
('PLUS','Plus Plan','Essential nationwide care for routine and unexpected health needs.','Nigeria',7761500::bigint,36479000::bigint,'["General and specialist consultations","Prescribed drugs and tests","Hospital admission"]','[{"label":"Chronic care annual limit","value":"₦132,000"},{"label":"Physiotherapy","value":"7 sessions yearly"},{"label":"Admission ward","value":"General ward"},{"label":"Intensive care","value":"2 days"}]',1),
('PREMIUM','Premium Plan','Broader annual limits and upgraded inpatient accommodation.','Nigeria',9980000,46906000,'["Quarterly nutrition support","Expanded chronic care","Semi-private admission"]','[{"label":"Chronic care annual limit","value":"₦481,500"},{"label":"Physiotherapy","value":"10 sessions yearly"},{"label":"Admission ward","value":"Semi-private ward"},{"label":"Intensive care","value":"3 days"}]',2),
('PREMIUM_PLUS','Premium Plus','Higher outpatient limits with private inpatient care.','Nigeria',17777700,83554900,'["Private ward admission","Higher chronic care limit","Extended physiotherapy"]','[{"label":"Chronic care annual limit","value":"₦866,700"},{"label":"Physiotherapy","value":"15 sessions yearly"},{"label":"Admission ward","value":"Private ward"},{"label":"Intensive care","value":"4 days"}]',3),
('PRESTIGE','Prestige Plan','Premium care in Nigeria with eligible India treatment refunds.','Nigeria & India',27507900,129287200,'["Nigeria and India coverage","Private ward admission","Enhanced specialist limits"]','[{"label":"Chronic care annual limit","value":"₦1,926,000"},{"label":"Physiotherapy","value":"20 sessions yearly"},{"label":"Admission ward","value":"Private ward"},{"label":"Intensive care","value":"10 days"}]',4),
('PRESTIGE_PLUS','Prestige Plus','Substantial annual limits for comprehensive premium care.','Nigeria & India',55008100,258538100,'["High chronic care limit","30 physiotherapy sessions","Extended intensive care"]','[{"label":"Chronic care annual limit","value":"₦2,889,000"},{"label":"Physiotherapy","value":"30 sessions yearly"},{"label":"Admission ward","value":"Private ward"},{"label":"Intensive care","value":"15 days"}]',5),
('EXECUTIVE_PRESTIGE','Executive Prestige','AVON’s highest corporate plan with its broadest care allowances.','Nigeria & India',65007600,305535700,'["Executive-level benefits","International refund option","Broadest inpatient support"]','[{"label":"Chronic care annual limit","value":"₦2,889,000"},{"label":"Physiotherapy","value":"30 sessions yearly"},{"label":"Admission ward","value":"Private ward"},{"label":"Intensive care","value":"15 days"}]',6)
) as v(code,name,description,region,individual_premium_kobo,family_premium_kobo,highlights,benefits,sort_order)
on conflict (period_id,code) do update set name=excluded.name,description=excluded.description,region=excluded.region,individual_premium_kobo=excluded.individual_premium_kobo,family_premium_kobo=excluded.family_premium_kobo,highlights=excluded.highlights,benefits=excluded.benefits,sort_order=excluded.sort_order;
