-- Continuous (late) enrollment.
--
-- The renewal window closes, but AVON keeps accepting new members for the rest of the
-- coverage term. A late member still pays the full annual subscriber total. AVON bills the
-- program only for the months from the member's coverage start month to the end of the
-- term, and the difference between the full premium + NHIS collected and AVON's prorated
-- premium + NHIS is stored as a credit toward the member's next annual enrollment.
--
-- Worked example (AVON supplementary invoice, Plus family, coverage from October 2026):
--   annual premium 26,408,300 kobo, 11 of 12 months
--   prorated premium round(26,408,300 * 11 / 12) = 24,207,608; 1% NHIS = 242,076
--   credit (26,408,300 + 264,083) - (24,207,608 + 242,076) = 2,222,699 kobo
begin;

alter table public.enrollment_periods
  add column coverage_starts_on date,
  add column late_enrollment_open boolean not null default true;
-- AVON's term for coverage year N runs September N through August N+1.
update public.enrollment_periods set coverage_starts_on=make_date(coverage_year,9,1);
alter table public.enrollment_periods
  alter column coverage_starts_on set not null,
  add constraint enrollment_period_coverage_month check (extract(day from coverage_starts_on)=1);

create or replace function public.default_period_coverage_start() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.coverage_starts_on is null then new.coverage_starts_on:=make_date(new.coverage_year,9,1); end if;
  return new;
end; $$;
revoke all on function public.default_period_coverage_start() from public,anon,authenticated;
create trigger default_period_coverage_start before insert on public.enrollment_periods
for each row execute function public.default_period_coverage_start();

alter table public.enrollments
  add column avon_coverage_start date,
  add column avon_coverage_note text,
  add column avon_billed_months smallint,
  add column avon_prorated_premium_kobo bigint,
  add column avon_prorated_nhis_kobo bigint,
  add column proration_credit_kobo bigint,
  add constraint enrollment_avon_proration_consistent check (
    (avon_coverage_start is null and avon_billed_months is null and avon_prorated_premium_kobo is null
      and avon_prorated_nhis_kobo is null and proration_credit_kobo is null)
    or (extract(day from avon_coverage_start)=1 and avon_billed_months between 1 and 12
      and avon_prorated_premium_kobo between 0 and premium_kobo and avon_prorated_nhis_kobo>=0
      and proration_credit_kobo>=0
      and proration_credit_kobo=premium_kobo+nhis_fee_kobo-avon_prorated_premium_kobo-avon_prorated_nhis_kobo)
  );

-- Runs after apply_enrollment_surcharges (BEFORE triggers fire in name order), so
-- nhis_fee_kobo is already the NHIS collected for the full annual premium.
create or replace function public.apply_enrollment_proration() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_term_start date; v_nhis integer; v_months integer;
begin
  if new.avon_coverage_start is null then
    new.avon_billed_months:=null; new.avon_prorated_premium_kobo:=null;
    new.avon_prorated_nhis_kobo:=null; new.proration_credit_kobo:=null;
    return new;
  end if;
  select ep.coverage_starts_on,ep.nhis_fee_basis_points into v_term_start,v_nhis
  from public.enrollment_periods ep where ep.id=new.period_id;
  new.avon_coverage_start:=date_trunc('month',new.avon_coverage_start)::date;
  v_months:=12-((extract(year from new.avon_coverage_start)::integer*12+extract(month from new.avon_coverage_start)::integer)
    -(extract(year from v_term_start)::integer*12+extract(month from v_term_start)::integer));
  if v_months not between 1 and 12 then
    raise exception 'AVON coverage must start between % and %',
      to_char(v_term_start,'Mon YYYY'),to_char((v_term_start+interval '11 months')::date,'Mon YYYY');
  end if;
  new.avon_billed_months:=v_months;
  new.avon_prorated_premium_kobo:=round(new.premium_kobo*v_months/12.0);
  new.avon_prorated_nhis_kobo:=round(new.avon_prorated_premium_kobo*coalesce(v_nhis,0)/10000.0);
  new.proration_credit_kobo:=new.premium_kobo+new.nhis_fee_kobo-new.avon_prorated_premium_kobo-new.avon_prorated_nhis_kobo;
  return new;
end; $$;
revoke all on function public.apply_enrollment_proration() from public,anon,authenticated;
create trigger apply_enrollment_surcharges_proration before insert or update on public.enrollments
for each row execute function public.apply_enrollment_proration();

-- The period accepting new-subscriber applications: the open renewal window first, otherwise
-- the latest period that has closed but whose AVON coverage term is still running.
create or replace function public.application_intake(p_program uuid)
returns table(period_id uuid, mode text) language sql stable security definer set search_path='' as $$
  select c.id,c.mode from (
    select ep.id,'regular'::text as mode,1 as priority,ep.coverage_year
    from public.enrollment_periods ep
    where ep.program_id=p_program and ep.status='open' and now() between ep.starts_at and ep.ends_at
    union all
    select ep.id,'late',2,ep.coverage_year
    from public.enrollment_periods ep join public.programs p on p.id=ep.program_id
    where ep.program_id=p_program and ep.late_enrollment_open and ep.status<>'scheduled'
      and now()>=ep.starts_at and (ep.status='closed' or now()>ep.ends_at)
      and (now() at time zone coalesce(p.timezone,'Africa/Lagos'))::date<(ep.coverage_starts_on+interval '12 months')::date
  ) c order by c.priority,c.coverage_year desc limit 1;
$$;
revoke all on function public.application_intake(uuid) from public,anon,authenticated;

-- The AVON coverage month an approval made today would record: the current month in the
-- program time zone, never earlier than the start of the coverage term.
create or replace function public.late_coverage_start(p_period_id uuid) returns date
language sql stable security definer set search_path='' as $$
  select greatest(ep.coverage_starts_on,date_trunc('month',now() at time zone coalesce(p.timezone,'Africa/Lagos'))::date)
  from public.enrollment_periods ep join public.programs p on p.id=ep.program_id where ep.id=p_period_id;
$$;
revoke all on function public.late_coverage_start(uuid) from public,anon,authenticated;

create or replace function public.period_after_renewal_window(p_period public.enrollment_periods) returns boolean
language sql stable set search_path='' as $$
  select p_period.status<>'scheduled' and (p_period.status='closed' or now()>p_period.ends_at);
$$;
revoke all on function public.period_after_renewal_window(public.enrollment_periods) from public,anon,authenticated;

create or replace function public.get_public_join_config() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_program uuid; v_timezone text; v_period_id uuid; v_mode text; v_period public.enrollment_periods;
begin
  select p.id,coalesce(p.timezone,'Africa/Lagos') into v_program,v_timezone from public.programs p where p.slug='futo-alums-hmo';
  select i.period_id,i.mode into v_period_id,v_mode from public.application_intake(v_program) i;
  select * into v_period from public.enrollment_periods ep where ep.id=v_period_id;
  return jsonb_build_object(
    'timezone',v_timezone,
    'acceptingApplications',v_period.id is not null,
    'enrollmentMode',v_mode,
    'period',case when v_period.id is null then null else jsonb_build_object(
      'id',v_period.id,'year',v_period.coverage_year,'startsAt',v_period.starts_at,'endsAt',v_period.ends_at,
      'status',v_period.status,'coverageStartsOn',v_period.coverage_starts_on,
      'lateCoverageStartsOn',case when v_mode='late' then public.late_coverage_start(v_period.id) end) end,
    'plans',case when v_period.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',po.id,'code',po.code,'name',po.name,'description',po.description,'region',po.region,
      'individualPremiumKobo',po.individual_premium_kobo,'familyPremiumKobo',po.family_premium_kobo,
      'highlights',po.highlights,'benefits',po.benefits,'active',po.active) order by po.sort_order)
      from public.plan_offerings po where po.period_id=v_period.id and po.active),'[]'::jsonb) end,
    -- Only the published new-enrollee amounts; no subscriber data.
    'newEnrolleeAssessment',(select jsonb_build_object('name',a.name,'amountKobo',a.amount_kobo,
      'feePortionKobo',a.fee_portion_kobo,'futureCreditKobo',a.future_credit_kobo,'creditYear',a.credit_year)
      from public.financial_assessments a where a.period_id=v_period.id and a.active order by a.created_at limit 1)
  );
end; $$;

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
  select i.period_id into v_period from public.application_intake(v_program) i;
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
      'id', a.id, 'periodId', a.period_id, 'year', ep.coverage_year, 'status', a.status,
      'graduationYear', a.graduation_year, 'principal', a.principal,
      'dependents', a.dependents, 'planId', a.plan_offering_id,
      'planName', coalesce(po.name, 'Not selected'), 'category', a.category,
      'hospital', a.hospital_name, 'duplicateStatus', a.duplicate_status,
      'adminNote', a.admin_note, 'submittedAt', a.submitted_at,
      'accountEmail', profile.email,
      'premiumKobo', case when a.category = 'family' then po.family_premium_kobo else po.individual_premium_kobo end,
      'nhisFeeBasisPoints', ep.nhis_fee_basis_points,
      'coverageStartsOn', ep.coverage_starts_on,
      -- The AVON coverage month an approval now would record; null within the renewal window.
      'lateCoverageStartsOn', case when public.period_after_renewal_window(ep) then public.late_coverage_start(ep.id) end,
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

-- Approval now records the AVON coverage start for a late member and assigns the active
-- program assessment at its new-enrollee default terms (snapshotted by the assignment trigger).
create or replace function public.review_subscriber_application(
  p_application_id uuid,
  p_action text,
  p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_program uuid;
  v_application public.subscriber_applications;
  v_period public.enrollment_periods;
  v_plan public.plan_offerings;
  v_household uuid;
  v_enrollment uuid;
  v_dependent jsonb;
  v_premium bigint;
  v_nhis bigint;
  v_reserve bigint;
  v_late boolean;
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
  select * into v_period from public.enrollment_periods where id = v_application.period_id;
  v_late := public.period_after_renewal_window(v_period);

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
    completeness, submitted_at, avon_coverage_start, avon_coverage_note
  ) values(
    v_household, v_application.period_id, v_plan.id, v_application.category,
    v_application.hospital_name, 'submitted', current_date, v_premium, v_nhis,
    v_reserve, v_premium + v_nhis + v_reserve, v_application.consented_at,
    v_application.consent_policy_version, 100, now(),
    case when v_late then public.late_coverage_start(v_period.id) end,
    case when v_late then 'Approved after the renewal window; AVON coverage starts in the approval month.' end
  ) returning id into v_enrollment;

  insert into public.enrollment_assessments(assessment_id, enrollment_id, program_id, note)
  select a.id, v_enrollment, a.program_id, 'Assigned automatically at approval using the new-enrollee terms.'
  from public.financial_assessments a
  where a.period_id = v_application.period_id and a.active
  order by a.created_at limit 1
  on conflict (assessment_id, enrollment_id) do nothing;

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

create or replace function public.set_enrollment_coverage_start(p_enrollment_id uuid, p_coverage_start date, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.enrollments; v_program uuid;
begin
  select * into e from public.enrollments where id=p_enrollment_id for update;
  select h.program_id into v_program from public.households h where h.id=e.household_id;
  if e.id is null or not public.is_program_admin(v_program) then raise exception 'Administrator access required'; end if;
  if trim(coalesce(p_note,''))='' then raise exception 'Explain why the AVON coverage start is being changed'; end if;
  update public.enrollments set avon_coverage_start=p_coverage_start,avon_coverage_note=trim(p_note),updated_at=now() where id=e.id;
end; $$;
revoke all on function public.set_enrollment_coverage_start(uuid,date,text) from public,anon;
grant execute on function public.set_enrollment_coverage_start(uuid,date,text) to authenticated;

-- Side-car read, like get_financial_workspace: period coverage settings and the stored AVON
-- proration of each accessible late enrollment.
create or replace function public.get_enrollment_coverage(p_period_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_period public.enrollment_periods; v_mode text; v_admin boolean;
begin
  select * into v_period from public.enrollment_periods where id=p_period_id;
  if v_period.id is null or not public.is_program_member(v_period.program_id) then raise exception 'Program access required'; end if;
  v_admin:=public.is_program_admin(v_period.program_id);
  select i.mode into v_mode from public.application_intake(v_period.program_id) i where i.period_id=v_period.id;
  return jsonb_build_object(
    'coverageStartsOn',v_period.coverage_starts_on,
    'lateEnrollmentOpen',v_period.late_enrollment_open,
    'intakeMode',v_mode,
    'lateCoverageStartsOn',public.late_coverage_start(v_period.id),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object(
      'enrollmentId',e.id,'coverageStartMonth',e.avon_coverage_start,'billedMonths',e.avon_billed_months,
      'proratedPremiumKobo',e.avon_prorated_premium_kobo,'proratedNhisKobo',e.avon_prorated_nhis_kobo,
      'creditKobo',e.proration_credit_kobo,'creditYear',v_period.coverage_year+1,
      'note',case when v_admin then e.avon_coverage_note end))
      from public.enrollments e
      where e.period_id=v_period.id and e.avon_coverage_start is not null and public.can_access_household(e.household_id)),'[]'::jsonb)
  );
end; $$;
revoke all on function public.get_enrollment_coverage(uuid) from public,anon;
grant execute on function public.get_enrollment_coverage(uuid) to authenticated;

create or replace function public.update_enrollment_period(p_changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare period public.enrollment_periods; v_status public.period_status; v_coverage date;
begin
  select * into period from public.enrollment_periods where id=(p_changes->>'id')::uuid for update;
  if period.id is null or not public.is_program_admin(period.program_id) then raise exception 'Administrator access required'; end if;
  v_status:=coalesce((p_changes->>'status')::public.period_status,period.status);
  v_coverage:=coalesce(nullif(p_changes->>'coverageStartsOn','')::date,period.coverage_starts_on);
  if extract(day from v_coverage)<>1 then raise exception 'AVON coverage must start on the first day of a month'; end if;
  update public.enrollment_periods set
    starts_at=coalesce((p_changes->>'startsAt')::timestamptz,starts_at),
    ends_at=coalesce((p_changes->>'endsAt')::timestamptz,ends_at),
    status=v_status,
    extension_note=p_changes->>'extensionNote',
    closed_at=case when v_status='closed' then case when period.status='closed' then coalesce(period.closed_at,now()) else now() end else null end,
    coverage_starts_on=v_coverage,
    late_enrollment_open=coalesce((p_changes->>'lateEnrollmentOpen')::boolean,late_enrollment_open),
    updated_at=now()
  where id=period.id;
  -- Recompute stored prorations; the enrollment trigger refuses a term that excludes them.
  if v_coverage<>period.coverage_starts_on then
    update public.enrollments set updated_at=now() where period_id=period.id and avon_coverage_start is not null;
  end if;
end; $$;

commit;
