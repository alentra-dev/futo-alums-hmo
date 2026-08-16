create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity text := coalesce(row_data->>'id', row_data->>'user_id', 'unknown');
  program uuid;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
begin
  program := nullif(row_data->>'program_id', '')::uuid;
  if program is null and tg_table_name = 'enrollments' then select h.program_id into program from public.households h where h.id = nullif(row_data->>'household_id','')::uuid; end if;
  if program is null and tg_table_name = 'people' then select h.program_id into program from public.households h where h.id = nullif(row_data->>'household_id','')::uuid; end if;
  if program is null and tg_table_name = 'payments' then select h.program_id into program from public.enrollments e join public.households h on h.id=e.household_id where e.id = nullif(row_data->>'enrollment_id','')::uuid; end if;
  if program is null and tg_table_name = 'plan_offerings' then select p.program_id into program from public.enrollment_periods p where p.id = nullif(row_data->>'period_id','')::uuid; end if;
  insert into public.audit_events(program_id, actor_user_id, action, entity_type, entity_id, old_data, new_data, request_id)
  values (program, auth.uid(), lower(tg_table_name)||'.'||lower(tg_op), tg_table_name, entity,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    headers->>'x-request-id');
  return coalesce(new, old);
end; $$;

create or replace function public.person_json(p public.people, p_enrollment_date date) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id',p.id,'memberType',p.member_type,'surname',p.surname,'firstName',p.first_name,'middleName',p.middle_name,
    'dateOfBirth',p.date_of_birth,'gender',p.gender,'relation',p.relation,'nationality',p.nationality,
    'enrollmentDate',p_enrollment_date,'address',p.address_of_residence,'country',p.country_of_residence,
    'state',p.state_of_residence,'town',p.town_of_residence,'lga',p.lga_of_residence,'mobile',p.mobile_no,'email',p.email
  );
$$;

create or replace function public.get_portal_snapshot() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_program uuid;
  v_period uuid;
  v_role public.program_role;
  result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.program_id,m.role into v_program,v_role from public.program_memberships m where m.user_id=v_user and m.active order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end limit 1;
  if v_program is null then raise exception 'No active program membership'; end if;
  select id into v_period from public.enrollment_periods where program_id=v_program order by (status='open') desc, coverage_year desc limit 1;

  select jsonb_build_object(
    'profile',jsonb_build_object('id',pr.id,'email',pr.email,'displayName',pr.display_name,'role',v_role),
    'period',(select jsonb_build_object('id',ep.id,'year',ep.coverage_year,'startsAt',ep.starts_at,'endsAt',ep.ends_at,'status',ep.status,'extensionNote',ep.extension_note) from public.enrollment_periods ep where ep.id=v_period),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'code',po.code,'name',po.name,'description',po.description,'region',po.region,'individualPremiumKobo',po.individual_premium_kobo,'familyPremiumKobo',po.family_premium_kobo,'highlights',po.highlights,'benefits',po.benefits,'active',po.active) order by po.sort_order) from public.plan_offerings po where po.period_id=v_period),'[]'::jsonb),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'year',ep.coverage_year,
      'principal',(select public.person_json(x,e.enrollment_date) from public.people x where x.household_id=e.household_id and x.member_type='Member' limit 1),
      'dependents',coalesce((select jsonb_agg(public.person_json(x,e.enrollment_date) order by x.date_of_birth) from public.people x where x.household_id=e.household_id and x.member_type='Dependent'),'[]'::jsonb),
      'planId',e.plan_offering_id,'category',e.category,'hospital',e.hospital_name,'status',e.status,'totalKobo',e.subscriber_total_kobo,'consentedAt',e.consented_at,'completeness',e.completeness
    ) order by e.created_at) from public.enrollments e join public.enrollment_periods ep on ep.id=e.period_id where e.period_id=v_period and public.can_access_household(e.household_id)),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pay.id,'enrollmentId',pay.enrollment_id,
      'principalName',(select concat_ws(' ',x.first_name,nullif(x.middle_name,''),x.surname) from public.enrollments ee join public.people x on x.household_id=ee.household_id and x.member_type='Member' where ee.id=pay.enrollment_id limit 1),
      'amountKobo',pay.amount_kobo,'paidAt',pay.paid_at,'reference',pay.reference,'proofName',coalesce(regexp_replace(pay.proof_path,'^.*/',''),'No proof'),'status',pay.status,'submittedAt',pay.created_at
    ) order by pay.created_at desc) from public.payments pay join public.enrollments e on e.id=pay.enrollment_id where e.period_id=v_period and public.can_access_household(e.household_id)),'[]'::jsonb),
    'paymentAccount',coalesce((select jsonb_build_object('beneficiary',pa.beneficiary,'bank',pa.bank,'accountNumber',pa.account_number,'referencePrefix',pa.reference_prefix) from public.payment_accounts pa where pa.program_id=v_program and pa.active_until is null order by pa.active_from desc limit 1),'{}'::jsonb),
    'auditEvents',case when v_role in ('admin','owner') then coalesce((select jsonb_agg(jsonb_build_object('id',a.id::text,'createdAt',a.created_at,'actorName',coalesce(actor.display_name,'System'),'action',a.action,'entityType',a.entity_type,'summary',initcap(replace(a.action,'.',' '))) order by a.created_at desc) from (select * from public.audit_events where program_id=v_program order by created_at desc limit 100) a left join public.profiles actor on actor.id=a.actor_user_id),'[]'::jsonb) else '[]'::jsonb end,
    'hospitalSuggestions',coalesce((select jsonb_agg(name order by name) from public.hospital_suggestions where program_id=v_program),'[]'::jsonb)
  ) into result from public.profiles pr where pr.id=v_user;
  return result;
end; $$;

create or replace function public.select_enrollment_plan(p_enrollment_id uuid,p_plan_id uuid,p_category text) returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; po public.plan_offerings; premium bigint; nhis bigint; reserve bigint; admin boolean;
begin
  select * into e from public.enrollments where id=p_enrollment_id for update;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  select public.is_program_admin(h.program_id) into admin from public.households h where h.id=e.household_id;
  if not admin and not exists(select 1 from public.enrollment_periods where id=e.period_id and status='open' and now() between starts_at and ends_at) then raise exception 'Enrollment period is closed'; end if;
  select * into po from public.plan_offerings where id=p_plan_id and period_id=e.period_id and active;
  if po.id is null then raise exception 'Plan is not available for this period'; end if;
  if p_category not in ('individual','family') then raise exception 'Invalid category'; end if;
  premium := case when p_category='family' then po.family_premium_kobo else po.individual_premium_kobo end;
  nhis := round(premium * po.nhis_fee_basis_points / 10000.0);
  reserve := round(premium * po.reserve_fee_basis_points / 10000.0);
  update public.enrollments set plan_offering_id=po.id,category=p_category::public.coverage_category,premium_kobo=premium,nhis_fee_kobo=nhis,reserve_fee_kobo=reserve,subscriber_total_kobo=premium+nhis+reserve,status='draft',updated_at=now() where id=e.id;
end; $$;

create or replace function public.apply_person_json(p_household uuid,p_person jsonb,p_member_type public.member_type) returns void language plpgsql security definer set search_path = '' as $$
declare person_id uuid := nullif(p_person->>'id','')::uuid;
begin
  if person_id is null or not exists(select 1 from public.people where id=person_id and household_id=p_household) then person_id:=gen_random_uuid(); end if;
  insert into public.people(id,household_id,member_type,surname,first_name,middle_name,date_of_birth,gender,relation,nationality,address_of_residence,country_of_residence,state_of_residence,town_of_residence,lga_of_residence,mobile_no,email)
  values(person_id,p_household,p_member_type,trim(p_person->>'surname'),trim(p_person->>'firstName'),trim(p_person->>'middleName'),(p_person->>'dateOfBirth')::date,p_person->>'gender',trim(p_person->>'relation'),trim(p_person->>'nationality'),trim(p_person->>'address'),trim(p_person->>'country'),trim(p_person->>'state'),trim(p_person->>'town'),trim(p_person->>'lga'),trim(p_person->>'mobile'),lower(trim(p_person->>'email')))
  on conflict(id) do update set surname=excluded.surname,first_name=excluded.first_name,middle_name=excluded.middle_name,date_of_birth=excluded.date_of_birth,gender=excluded.gender,relation=excluded.relation,nationality=excluded.nationality,address_of_residence=excluded.address_of_residence,country_of_residence=excluded.country_of_residence,state_of_residence=excluded.state_of_residence,town_of_residence=excluded.town_of_residence,lga_of_residence=excluded.lga_of_residence,mobile_no=excluded.mobile_no,email=excluded.email,updated_at=now();
end; $$;

create or replace function public.update_enrollment_details(p_enrollment_id uuid,p_changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; dep jsonb; desired uuid[] := '{}'; submitted boolean := coalesce(p_changes->>'status','')='submitted';
begin
  select * into e from public.enrollments where id=p_enrollment_id for update;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  if not public.is_program_admin((select program_id from public.households where id=e.household_id)) and not exists(select 1 from public.enrollment_periods where id=e.period_id and status='open' and now() between starts_at and ends_at) then raise exception 'Enrollment period is closed'; end if;
  perform public.apply_person_json(e.household_id,p_changes->'principal','Member');
  for dep in select value from jsonb_array_elements(coalesce(p_changes->'dependents','[]'::jsonb)) loop
    perform public.apply_person_json(e.household_id,dep,'Dependent');
    if nullif(dep->>'id','') is not null then desired:=array_append(desired,(dep->>'id')::uuid); end if;
  end loop;
  delete from public.people where household_id=e.household_id and member_type='Dependent' and id<>all(desired);
  update public.enrollments set hospital_name=trim(coalesce(p_changes->>'hospital',hospital_name)),consented_at=nullif(p_changes->>'consentedAt','')::timestamptz,consent_policy_version=case when nullif(p_changes->>'consentedAt','') is not null then '2026-01' else null end,status=case when submitted then 'submitted' else 'draft' end,completeness=case when submitted then 100 else coalesce((p_changes->>'completeness')::smallint,completeness) end,submitted_at=case when submitted then now() else submitted_at end,updated_at=now() where id=e.id;
  if submitted and exists(select 1 from public.enrollments x where x.id=e.id and (x.plan_offering_id is null or trim(x.hospital_name)='')) then raise exception 'Plan and hospital are required'; end if;
end; $$;

create or replace function public.submit_payment(p_enrollment_id uuid,p_amount_kobo bigint,p_paid_at date,p_reference text,p_proof_path text) returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; payment_id uuid; program uuid;
begin
  select * into e from public.enrollments where id=p_enrollment_id;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  if p_amount_kobo<=0 then raise exception 'Payment amount must be positive'; end if;
  if p_proof_path is null or p_proof_path not like p_enrollment_id::text||'/%' then raise exception 'A valid payment proof is required'; end if;
  insert into public.payments(enrollment_id,amount_kobo,paid_at,reference,proof_path,submitted_by) values(e.id,p_amount_kobo,p_paid_at,trim(p_reference),p_proof_path,auth.uid()) returning id into payment_id;
  select h.program_id into program from public.households h where h.id=e.household_id;
  insert into public.notification_outbox(program_id,event_type,payload) values(program,'payment.submitted',jsonb_build_object('payment_id',payment_id,'enrollment_id',e.id,'amount_kobo',p_amount_kobo));
  return payment_id;
end; $$;

create or replace function public.review_payment(p_payment_id uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
declare program uuid;
begin
  select h.program_id into program from public.payments p join public.enrollments e on e.id=p.enrollment_id join public.households h on h.id=e.household_id where p.id=p_payment_id;
  if program is null or not public.is_program_admin(program) then raise exception 'Administrator access required'; end if;
  if p_status not in ('verified','rejected') then raise exception 'Invalid payment status'; end if;
  update public.payments set status=p_status::public.payment_status,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_payment_id and status='pending';
end; $$;

create or replace function public.update_enrollment_period(p_changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare period public.enrollment_periods;
begin
  select * into period from public.enrollment_periods where id=(p_changes->>'id')::uuid for update;
  if period.id is null or not public.is_program_admin(period.program_id) then raise exception 'Administrator access required'; end if;
  update public.enrollment_periods set starts_at=coalesce((p_changes->>'startsAt')::timestamptz,starts_at),ends_at=coalesce((p_changes->>'endsAt')::timestamptz,ends_at),status=coalesce((p_changes->>'status')::public.period_status,status),extension_note=p_changes->>'extensionNote',closed_at=case when p_changes->>'status'='closed' then now() else null end,updated_at=now() where id=period.id;
end; $$;

create or replace function public.update_payment_account(p_account jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare program uuid;
begin
  select program_id into program from public.program_memberships where user_id=auth.uid() and active and role in ('admin','owner') limit 1;
  if program is null then raise exception 'Administrator access required'; end if;
  if coalesce(p_account->>'accountNumber','') !~ '^[0-9]{10}$' then raise exception 'Account number must contain 10 digits'; end if;
  update public.payment_accounts set active_until=now() where program_id=program and active_until is null;
  insert into public.payment_accounts(program_id,beneficiary,bank,account_number,reference_prefix) values(program,trim(p_account->>'beneficiary'),trim(p_account->>'bank'),p_account->>'accountNumber',trim(p_account->>'referencePrefix'));
end; $$;

revoke all on function public.get_portal_snapshot() from public,anon;
revoke all on function public.select_enrollment_plan(uuid,uuid,text) from public,anon;
revoke all on function public.update_enrollment_details(uuid,jsonb) from public,anon;
revoke all on function public.submit_payment(uuid,bigint,date,text,text) from public,anon;
revoke all on function public.review_payment(uuid,text) from public,anon;
revoke all on function public.update_enrollment_period(jsonb) from public,anon;
revoke all on function public.update_payment_account(jsonb) from public,anon;
grant execute on function public.get_portal_snapshot() to authenticated;
grant execute on function public.select_enrollment_plan(uuid,uuid,text) to authenticated;
grant execute on function public.update_enrollment_details(uuid,jsonb) to authenticated;
grant execute on function public.submit_payment(uuid,bigint,date,text,text) to authenticated;
grant execute on function public.review_payment(uuid,text) to authenticated;
grant execute on function public.update_enrollment_period(jsonb) to authenticated;
grant execute on function public.update_payment_account(jsonb) to authenticated;
