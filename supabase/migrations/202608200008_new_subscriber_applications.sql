create table public.subscriber_applications (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_id uuid not null references public.enrollment_periods(id),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'request_changes', 'approved', 'rejected')),
  graduation_year integer not null default 1996 check (graduation_year between 1960 and 2100),
  principal jsonb not null default '{}'::jsonb,
  dependents jsonb not null default '[]'::jsonb check (jsonb_typeof(dependents) = 'array'),
  plan_offering_id uuid references public.plan_offerings(id),
  category public.coverage_category not null default 'individual',
  hospital_name text not null default '',
  consented_at timestamptz,
  consent_policy_version text,
  duplicate_status text not null default 'unchecked' check (duplicate_status in ('unchecked', 'clear', 'review_required', 'resolved', 'confirmed_duplicate')),
  admin_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  enrollment_id uuid references public.enrollments(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.subscriber_applications(id) on delete cascade,
  candidate_person_id uuid not null references public.people(id) on delete cascade,
  confidence text not null check (confidence in ('likely', 'possible')),
  signals jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'distinct', 'duplicate')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (application_id, candidate_person_id)
);

create index subscriber_applications_user_idx on public.subscriber_applications(user_id, created_at desc);
create index subscriber_applications_review_idx on public.subscriber_applications(program_id, status, created_at desc);
create index duplicate_candidates_application_idx on public.duplicate_candidates(application_id, status);

alter table public.subscriber_applications enable row level security;
alter table public.duplicate_candidates enable row level security;

create policy applications_owner_select on public.subscriber_applications
for select using (user_id = auth.uid() or public.is_program_admin(program_id));

create policy duplicate_candidates_admin_select on public.duplicate_candidates
for select using (
  exists (
    select 1 from public.subscriber_applications a
    where a.id = application_id and public.is_program_admin(a.program_id)
  )
);

grant select on public.subscriber_applications, public.duplicate_candidates to authenticated;

create trigger audit_subscriber_applications
after insert or update or delete on public.subscriber_applications
for each row execute function public.audit_row_change();

create or replace function public.normalize_program_phone(p_value text) returns text
language sql immutable set search_path = '' as $$
  select case
    when digits ~ '^0[0-9]{10}$' then '234' || substring(digits from 2)
    when digits ~ '^234[0-9]{10}$' then digits
    else digits
  end
  from (select regexp_replace(coalesce(p_value, ''), '[^0-9]+', '', 'g') as digits) normalized;
$$;

create or replace function public.normalize_program_name(p_value text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(p_value, ''), '[^a-zA-Z0-9]+', '', 'g'));
$$;

create or replace function public.valid_application_person(p_person jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_person) = 'object'
    and trim(coalesce(p_person->>'surname', '')) <> ''
    and trim(coalesce(p_person->>'firstName', '')) <> ''
    and trim(coalesce(p_person->>'middleName', '')) <> ''
    and coalesce(p_person->>'dateOfBirth', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and coalesce(p_person->>'gender', '') in ('Male', 'Female')
    and trim(coalesce(p_person->>'relation', '')) <> ''
    and trim(coalesce(p_person->>'nationality', '')) <> ''
    and trim(coalesce(p_person->>'address', '')) <> ''
    and trim(coalesce(p_person->>'country', '')) <> ''
    and trim(coalesce(p_person->>'state', '')) <> ''
    and trim(coalesce(p_person->>'town', '')) <> ''
    and trim(coalesce(p_person->>'lga', '')) <> ''
    and length(public.normalize_program_phone(p_person->>'mobile')) >= 10
    and position('@' in coalesce(p_person->>'email', '')) > 1;
$$;

create or replace function public.get_public_join_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_program uuid;
  v_period public.enrollment_periods;
begin
  select p.id into v_program from public.programs p where p.slug = 'futo-alums-hmo';

  select ep.* into v_period
  from public.enrollment_periods ep
  where ep.program_id = v_program
    and ep.status = 'open'
    and now() between ep.starts_at and ep.ends_at
  order by ep.coverage_year desc
  limit 1;

  return jsonb_build_object(
    'acceptingApplications', v_period.id is not null,
    'period', case when v_period.id is null then null else jsonb_build_object(
      'id', v_period.id, 'year', v_period.coverage_year, 'startsAt', v_period.starts_at,
      'endsAt', v_period.ends_at, 'status', v_period.status
    ) end,
    'plans', case when v_period.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', po.id, 'code', po.code, 'name', po.name, 'description', po.description,
        'region', po.region, 'individualPremiumKobo', po.individual_premium_kobo,
        'familyPremiumKobo', po.family_premium_kobo, 'highlights', po.highlights,
        'benefits', po.benefits, 'active', po.active
      ) order by po.sort_order)
      from public.plan_offerings po where po.period_id = v_period.id and po.active
    ), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.get_join_workspace() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_program uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select p.id into v_program from public.programs p where p.slug = 'futo-alums-hmo';

  return jsonb_build_object(
    'email', (select pr.email from public.profiles pr where pr.id = v_user),
    'accountHasMembership', exists(
      select 1 from public.program_memberships pm
      where pm.program_id = v_program and pm.user_id = v_user and pm.active
    ),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'periodId', a.period_id, 'year', ep.coverage_year,
        'status', a.status, 'graduationYear', a.graduation_year,
        'principal', a.principal, 'dependents', a.dependents,
        'planId', a.plan_offering_id, 'category', a.category,
        'hospital', a.hospital_name, 'consentedAt', a.consented_at,
        'duplicateStatus', a.duplicate_status, 'adminNote', a.admin_note,
        'enrollmentId', a.enrollment_id, 'submittedAt', a.submitted_at,
        'createdAt', a.created_at
      ) order by a.created_at desc)
      from public.subscriber_applications a
      join public.enrollment_periods ep on ep.id = a.period_id
      where a.user_id = v_user and a.program_id = v_program
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_subscriber_application() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_program uuid;
  v_period uuid;
  v_email text;
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select p.id into v_program from public.programs p where p.slug = 'futo-alums-hmo';
  select ep.id into v_period
  from public.enrollment_periods ep
  where ep.program_id = v_program and ep.status = 'open' and now() between ep.starts_at and ep.ends_at
  order by ep.coverage_year desc limit 1;
  if v_period is null then raise exception 'Enrollment is not accepting new applications at this time'; end if;

  select pr.email into v_email from public.profiles pr where pr.id = v_user;
  insert into public.subscriber_applications(program_id, user_id, period_id, principal)
  values(v_program, v_user, v_period, jsonb_build_object(
    'id', gen_random_uuid(), 'memberType', 'Member', 'surname', '', 'firstName', '',
    'middleName', '', 'dateOfBirth', '', 'gender', 'Female', 'relation', 'SELF',
    'nationality', 'Nigerian', 'enrollmentDate', current_date, 'address', '',
    'country', 'Nigeria', 'state', '', 'town', '', 'lga', '', 'mobile', '', 'email', v_email
  ))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.save_subscriber_application(
  p_application_id uuid,
  p_payload jsonb,
  p_submit boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_application public.subscriber_applications;
  v_principal jsonb := coalesce(p_payload->'principal', '{}'::jsonb);
  v_dependents jsonb := coalesce(p_payload->'dependents', '[]'::jsonb);
  v_plan uuid := nullif(p_payload->>'planId', '')::uuid;
  v_category text := coalesce(p_payload->>'category', 'individual');
  v_hospital text := trim(coalesce(p_payload->>'hospital', ''));
  v_graduation integer := coalesce((p_payload->>'graduationYear')::integer, 1996);
  v_dependent jsonb;
  v_notify boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_application
  from public.subscriber_applications
  where id = p_application_id and user_id = v_user
  for update;

  if v_application.id is null then raise exception 'Application not found'; end if;
  if v_application.status in ('approved', 'rejected') then raise exception 'This application can no longer be changed'; end if;
  if jsonb_typeof(v_dependents) <> 'array' then raise exception 'Dependents must be a list'; end if;
  if jsonb_array_length(v_dependents) > 5 then raise exception 'Family cover supports no more than five dependents'; end if;
  if v_category not in ('individual', 'family') then raise exception 'Invalid plan type'; end if;

  if p_submit then
    if not public.valid_application_person(v_principal) then raise exception 'Complete every required principal field'; end if;
    if v_graduation < 1960 or v_graduation > extract(year from current_date)::integer then raise exception 'Enter a valid graduation year'; end if;
    if v_plan is null or not exists(
      select 1 from public.plan_offerings po
      where po.id = v_plan and po.period_id = v_application.period_id and po.active
    ) then raise exception 'Select an available plan'; end if;
    if v_hospital = '' then raise exception 'Enter a preferred hospital'; end if;
    if v_category = 'individual' and jsonb_array_length(v_dependents) > 0 then raise exception 'Individual cover cannot include dependents'; end if;
    if v_category = 'family' and jsonb_array_length(v_dependents) = 0 then raise exception 'Add at least one dependent for family cover'; end if;
    for v_dependent in select value from jsonb_array_elements(v_dependents) loop
      if not public.valid_application_person(v_dependent) then raise exception 'Complete every required dependent field'; end if;
    end loop;
    if not coalesce((p_payload->>'consented')::boolean, false) then raise exception 'Consent is required before submission'; end if;
  end if;

  v_notify := p_submit and v_application.status <> 'pending_review';

  update public.subscriber_applications set
    graduation_year = v_graduation,
    principal = v_principal,
    dependents = v_dependents,
    plan_offering_id = v_plan,
    category = v_category::public.coverage_category,
    hospital_name = v_hospital,
    status = case when p_submit then 'pending_review' else 'draft' end,
    consented_at = case when p_submit then now() else consented_at end,
    consent_policy_version = case when p_submit then '2026-01' else consent_policy_version end,
    submitted_at = case when p_submit then now() else submitted_at end,
    admin_note = case when p_submit then null else admin_note end,
    updated_at = now()
  where id = v_application.id;

  if p_submit then
    delete from public.duplicate_candidates
    where application_id = v_application.id and status = 'open';

    insert into public.duplicate_candidates(application_id, candidate_person_id, confidence, signals)
    select
      v_application.id,
      person.id,
      case when
        lower(trim(person.email)) = lower(trim(v_principal->>'email'))
        or (
          public.normalize_program_name(person.first_name) = public.normalize_program_name(v_principal->>'firstName')
          and public.normalize_program_name(person.surname) = public.normalize_program_name(v_principal->>'surname')
          and person.date_of_birth = (v_principal->>'dateOfBirth')::date
        )
        or (
          public.normalize_program_phone(person.mobile_no) = public.normalize_program_phone(v_principal->>'mobile')
          and person.date_of_birth = (v_principal->>'dateOfBirth')::date
        )
        or (
          public.normalize_program_phone(person.mobile_no) = public.normalize_program_phone(v_principal->>'mobile')
          and public.normalize_program_name(person.first_name) = public.normalize_program_name(v_principal->>'firstName')
          and public.normalize_program_name(person.surname) = public.normalize_program_name(v_principal->>'surname')
        )
      then 'likely' else 'possible' end,
      to_jsonb(array_remove(array[
        case when lower(trim(person.email)) = lower(trim(v_principal->>'email')) then 'Same principal email' end,
        case when public.normalize_program_phone(person.mobile_no) = public.normalize_program_phone(v_principal->>'mobile') then 'Same mobile number' end,
        case when person.date_of_birth = (v_principal->>'dateOfBirth')::date then 'Same date of birth' end,
        case when public.normalize_program_name(person.first_name) = public.normalize_program_name(v_principal->>'firstName')
          and public.normalize_program_name(person.surname) = public.normalize_program_name(v_principal->>'surname') then 'Same first name and surname' end,
        case when public.normalize_program_name(person.surname) = public.normalize_program_name(v_principal->>'surname')
          and left(public.normalize_program_name(person.first_name), 1) = left(public.normalize_program_name(v_principal->>'firstName'), 1) then 'Same surname and first initial' end
      ], null))
    from public.people person
    join public.households household on household.id = person.household_id
    where household.program_id = v_application.program_id
      and person.member_type = 'Member'
      and (
        lower(trim(person.email)) = lower(trim(v_principal->>'email'))
        or public.normalize_program_phone(person.mobile_no) = public.normalize_program_phone(v_principal->>'mobile')
        or (
          person.date_of_birth = (v_principal->>'dateOfBirth')::date
          and public.normalize_program_name(person.surname) = public.normalize_program_name(v_principal->>'surname')
          and left(public.normalize_program_name(person.first_name), 1) = left(public.normalize_program_name(v_principal->>'firstName'), 1)
        )
      )
    on conflict (application_id, candidate_person_id) do update set
      confidence = excluded.confidence,
      signals = excluded.signals,
      status = case when public.duplicate_candidates.status = 'distinct' then 'distinct' else 'open' end,
      reviewed_by = case when public.duplicate_candidates.status = 'distinct' then public.duplicate_candidates.reviewed_by else null end,
      reviewed_at = case when public.duplicate_candidates.status = 'distinct' then public.duplicate_candidates.reviewed_at else null end;

    update public.subscriber_applications set duplicate_status = case
      when exists(select 1 from public.duplicate_candidates dc where dc.application_id = v_application.id and dc.status = 'open') then 'review_required'
      else 'clear'
    end where id = v_application.id;

    if v_notify then
      insert into public.notification_outbox(program_id, event_type, payload)
      values(v_application.program_id, 'subscriber_application.submitted', jsonb_build_object('application_id', v_application.id));
    end if;
  end if;

  return public.get_join_workspace();
end;
$$;

create or replace function public.get_admin_subscriber_applications() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_program uuid;
begin
  select pm.program_id into v_program
  from public.program_memberships pm
  where pm.user_id = auth.uid() and pm.active and pm.role in ('admin', 'owner')
  limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'year', ep.coverage_year, 'status', a.status,
      'graduationYear', a.graduation_year, 'principal', a.principal,
      'dependents', a.dependents, 'planId', a.plan_offering_id,
      'planName', coalesce(po.name, 'Not selected'), 'category', a.category,
      'hospital', a.hospital_name, 'duplicateStatus', a.duplicate_status,
      'adminNote', a.admin_note, 'submittedAt', a.submitted_at,
      'accountEmail', profile.email,
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', dc.id, 'confidence', dc.confidence, 'signals', dc.signals,
          'status', dc.status, 'personId', person.id,
          'name', concat_ws(' ', person.first_name, nullif(person.middle_name, ''), person.surname),
          'dateOfBirth', person.date_of_birth, 'mobile', person.mobile_no,
          'email', person.email,
          'managedBy', (select manager.email from public.account_households ah join public.profiles manager on manager.id = ah.user_id where ah.household_id = person.household_id order by ah.created_at limit 1)
        ) order by case dc.confidence when 'likely' then 1 else 2 end, dc.created_at)
        from public.duplicate_candidates dc
        join public.people person on person.id = dc.candidate_person_id
        where dc.application_id = a.id
      ), '[]'::jsonb)
    ) order by case a.status when 'pending_review' then 1 when 'request_changes' then 2 when 'draft' then 3 else 4 end, a.created_at desc)
    from public.subscriber_applications a
    join public.enrollment_periods ep on ep.id = a.period_id
    join public.profiles profile on profile.id = a.user_id
    left join public.plan_offerings po on po.id = a.plan_offering_id
    where a.program_id = v_program
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_subscriber_application(
  p_application_id uuid,
  p_action text,
  p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_program uuid;
  v_application public.subscriber_applications;
  v_plan public.plan_offerings;
  v_household uuid;
  v_enrollment uuid;
  v_dependent jsonb;
  v_premium bigint;
  v_nhis bigint;
  v_reserve bigint;
begin
  select pm.program_id into v_program
  from public.program_memberships pm
  where pm.user_id = auth.uid() and pm.active and pm.role in ('admin', 'owner')
  limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;

  select * into v_application
  from public.subscriber_applications
  where id = p_application_id and program_id = v_program
  for update;
  if v_application.id is null then raise exception 'Application not found'; end if;
  if v_application.status in ('approved', 'rejected') then raise exception 'Application is already resolved'; end if;

  if p_action = 'request_changes' then
    if nullif(trim(p_note), '') is null then raise exception 'Explain the changes the applicant should make'; end if;
    update public.subscriber_applications set
      status = 'request_changes', admin_note = nullif(trim(p_note), ''),
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = v_application.id;
    return;
  end if;

  if p_action = 'mark_duplicate' then
    update public.duplicate_candidates set status = 'duplicate', reviewed_by = auth.uid(), reviewed_at = now()
    where application_id = v_application.id and status = 'open';
    update public.subscriber_applications set
      status = 'rejected', duplicate_status = 'confirmed_duplicate',
      admin_note = coalesce(nullif(trim(p_note), ''), 'Matched to an existing subscriber record.'),
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = v_application.id;
    return;
  end if;

  if p_action <> 'approve' then raise exception 'Invalid review action'; end if;
  if v_application.status <> 'pending_review' then raise exception 'Only submitted applications can be approved'; end if;
  if not public.valid_application_person(v_application.principal) then raise exception 'Principal details are incomplete'; end if;

  select * into v_plan
  from public.plan_offerings po
  where po.id = v_application.plan_offering_id and po.period_id = v_application.period_id;
  if v_plan.id is null then raise exception 'Selected plan is unavailable'; end if;

  v_premium := case when v_application.category = 'family' then v_plan.family_premium_kobo else v_plan.individual_premium_kobo end;
  v_nhis := round(v_premium * v_plan.nhis_fee_basis_points / 10000.0);
  v_reserve := round(v_premium * v_plan.reserve_fee_basis_points / 10000.0);

  insert into public.program_memberships(program_id, user_id, role, active)
  values(v_program, v_application.user_id, 'subscriber', true)
  on conflict (program_id, user_id) do update set active = true;

  insert into public.households(program_id) values(v_program) returning id into v_household;
  insert into public.account_households(user_id, household_id) values(v_application.user_id, v_household);

  perform public.apply_person_json(v_household, v_application.principal, 'Member');
  for v_dependent in select value from jsonb_array_elements(v_application.dependents) loop
    perform public.apply_person_json(v_household, v_dependent, 'Dependent');
  end loop;

  insert into public.enrollments(
    household_id, period_id, plan_offering_id, category, hospital_name, status,
    enrollment_date, premium_kobo, nhis_fee_kobo, reserve_fee_kobo,
    subscriber_total_kobo, consented_at, consent_policy_version,
    completeness, submitted_at
  ) values(
    v_household, v_application.period_id, v_plan.id, v_application.category,
    v_application.hospital_name, 'submitted', current_date, v_premium, v_nhis,
    v_reserve, v_premium + v_nhis + v_reserve, v_application.consented_at,
    v_application.consent_policy_version, 100, now()
  ) returning id into v_enrollment;

  if trim(v_application.hospital_name) <> '' then
    insert into public.hospital_suggestions(program_id, name)
    values(v_program, v_application.hospital_name)
    on conflict (program_id, normalized_name) do nothing;
  end if;

  update public.duplicate_candidates set status = 'distinct', reviewed_by = auth.uid(), reviewed_at = now()
  where application_id = v_application.id and status = 'open';

  update public.subscriber_applications set
    status = 'approved', duplicate_status = case when duplicate_status = 'review_required' then 'resolved' else duplicate_status end,
    enrollment_id = v_enrollment, admin_note = nullif(trim(p_note), ''),
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = v_application.id;

  update public.profiles set
    display_name = concat_ws(' ', v_application.principal->>'firstName', nullif(v_application.principal->>'middleName', ''), v_application.principal->>'surname'),
    updated_at = now()
  where id = v_application.user_id;

  insert into public.notification_outbox(program_id, event_type, payload)
  values(v_program, 'subscriber_application.approved', jsonb_build_object('application_id', v_application.id, 'enrollment_id', v_enrollment));
end;
$$;

revoke all on function public.get_public_join_config() from public;
revoke all on function public.get_join_workspace() from public, anon;
revoke all on function public.create_subscriber_application() from public, anon;
revoke all on function public.save_subscriber_application(uuid, jsonb, boolean) from public, anon;
revoke all on function public.get_admin_subscriber_applications() from public, anon;
revoke all on function public.review_subscriber_application(uuid, text, text) from public, anon;

grant execute on function public.get_public_join_config() to anon, authenticated;
grant execute on function public.get_join_workspace() to authenticated;
grant execute on function public.create_subscriber_application() to authenticated;
grant execute on function public.save_subscriber_application(uuid, jsonb, boolean) to authenticated;
grant execute on function public.get_admin_subscriber_applications() to authenticated;
grant execute on function public.review_subscriber_application(uuid, text, text) to authenticated;
