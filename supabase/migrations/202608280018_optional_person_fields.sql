create or replace function public.valid_application_person(p_person jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_person) = 'object'
    and trim(coalesce(p_person->>'surname', '')) <> ''
    and trim(coalesce(p_person->>'firstName', '')) <> ''
    and coalesce(p_person->>'dateOfBirth', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and coalesce(p_person->>'gender', '') in ('Male', 'Female')
    and trim(coalesce(p_person->>'relation', '')) <> ''
    and trim(coalesce(p_person->>'nationality', '')) <> ''
    and trim(coalesce(p_person->>'address', '')) <> ''
    and trim(coalesce(p_person->>'country', '')) <> ''
    and trim(coalesce(p_person->>'state', '')) <> ''
    and trim(coalesce(p_person->>'town', '')) <> ''
    and trim(coalesce(p_person->>'lga', '')) <> ''
    and (
      coalesce(p_person->>'memberType', 'Member') = 'Dependent'
      or (
        length(public.normalize_program_phone(p_person->>'mobile')) >= 10
        and position('@' in coalesce(p_person->>'email', '')) > 1
      )
    )
    and (
      trim(coalesce(p_person->>'mobile', '')) = ''
      or length(public.normalize_program_phone(p_person->>'mobile')) >= 10
    )
    and (
      trim(coalesce(p_person->>'email', '')) = ''
      or position('@' in coalesce(p_person->>'email', '')) > 1
    );
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

create or replace function public.update_enrollment_details(p_enrollment_id uuid,p_changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; dep jsonb; v_person_id uuid; desired uuid[] := '{}'; submitted boolean := coalesce(p_changes->>'status','')='submitted'; dep_count integer;
begin
  select * into e from public.enrollments where id=p_enrollment_id for update;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  if not public.is_program_admin((select program_id from public.households where id=e.household_id)) and not exists(select 1 from public.enrollment_periods where id=e.period_id and status='open' and now() between starts_at and ends_at) then raise exception 'Enrollment period is closed'; end if;
  dep_count:=jsonb_array_length(coalesce(p_changes->'dependents','[]'::jsonb));
  if dep_count>5 then raise exception 'Family enrollment supports no more than five dependents'; end if;
  if e.category='individual' and dep_count>0 then raise exception 'Remove dependents or select family coverage'; end if;
  if submitted and e.category='family' and dep_count=0 then raise exception 'Add at least one dependent or select individual coverage'; end if;
  perform public.apply_person_json(e.household_id,p_changes->'principal','Member');
  v_person_id:=(p_changes->'principal'->>'id')::uuid;
  insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order) values(e.id,v_person_id,'Member',p_changes->'principal',0)
  on conflict(enrollment_id,person_id) do update set person_data=excluded.person_data,member_type='Member',sort_order=0,updated_at=now();
  desired:=array_append(desired,v_person_id);
  for dep in select value from jsonb_array_elements(coalesce(p_changes->'dependents','[]'::jsonb)) loop
    v_person_id:=coalesce(nullif(dep->>'id','')::uuid,gen_random_uuid()); dep:=jsonb_set(dep,'{id}',to_jsonb(v_person_id));
    perform public.apply_person_json(e.household_id,dep,'Dependent');
    insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order) values(e.id,v_person_id,'Dependent',dep,array_length(desired,1))
    on conflict(enrollment_id,person_id) do update set person_data=excluded.person_data,member_type='Dependent',sort_order=excluded.sort_order,updated_at=now();
    desired:=array_append(desired,v_person_id);
  end loop;
  delete from public.enrollment_people ep where ep.enrollment_id=e.id and not(ep.person_id=any(desired));
  update public.enrollments set hospital_name=trim(coalesce(p_changes->>'hospital',hospital_name)),consented_at=nullif(p_changes->>'consentedAt','')::timestamptz,consent_policy_version=case when nullif(p_changes->>'consentedAt','') is not null then '2026-01' else null end,status=case when submitted then 'submitted' else 'draft' end,completeness=case when submitted then 100 else coalesce((p_changes->>'completeness')::smallint,completeness) end,submitted_at=case when submitted then now() else submitted_at end,updated_at=now() where id=e.id;
  if submitted and exists(select 1 from public.enrollments x where x.id=e.id and x.plan_offering_id is null) then raise exception 'Plan is required'; end if;
end; $$;
