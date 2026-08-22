create table if not exists public.enrollment_people (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  person_id uuid not null,
  member_type public.member_type not null,
  person_data jsonb not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, person_id)
);

alter table public.enrollment_people enable row level security;
create policy enrollment_people_read on public.enrollment_people for select to authenticated using (
  exists(select 1 from public.enrollments e where e.id=enrollment_id and public.can_access_household(e.household_id))
);
grant select on public.enrollment_people to authenticated;

insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order)
select e.id,p.id,p.member_type,public.person_json(p,e.enrollment_date),case when p.member_type='Member' then 0 else row_number() over(partition by e.id,p.member_type order by p.date_of_birth,p.id)::smallint end
from public.enrollments e join public.people p on p.household_id=e.household_id
on conflict(enrollment_id,person_id) do nothing;

create or replace function public.apply_person_json(p_household uuid,p_person jsonb,p_member_type public.member_type) returns void language plpgsql security definer set search_path = '' as $$
declare person_id uuid := nullif(p_person->>'id','')::uuid;
begin
  if person_id is null then person_id:=gen_random_uuid(); end if;
  if exists(select 1 from public.people where id=person_id and household_id<>p_household) then raise exception 'Person identifier is already in use'; end if;
  insert into public.people(id,household_id,member_type,surname,first_name,middle_name,date_of_birth,gender,relation,nationality,address_of_residence,country_of_residence,state_of_residence,town_of_residence,lga_of_residence,mobile_no,email)
  values(person_id,p_household,p_member_type,trim(p_person->>'surname'),trim(p_person->>'firstName'),trim(p_person->>'middleName'),(p_person->>'dateOfBirth')::date,p_person->>'gender',trim(p_person->>'relation'),trim(p_person->>'nationality'),trim(p_person->>'address'),trim(p_person->>'country'),trim(p_person->>'state'),trim(p_person->>'town'),trim(p_person->>'lga'),trim(p_person->>'mobile'),lower(trim(p_person->>'email')))
  on conflict(id) do update set member_type=excluded.member_type,surname=excluded.surname,first_name=excluded.first_name,middle_name=excluded.middle_name,date_of_birth=excluded.date_of_birth,gender=excluded.gender,relation=excluded.relation,nationality=excluded.nationality,address_of_residence=excluded.address_of_residence,country_of_residence=excluded.country_of_residence,state_of_residence=excluded.state_of_residence,town_of_residence=excluded.town_of_residence,lga_of_residence=excluded.lga_of_residence,mobile_no=excluded.mobile_no,email=excluded.email,updated_at=now();
end; $$;

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
  if submitted and exists(select 1 from public.enrollments x where x.id=e.id and (x.plan_offering_id is null or trim(x.hospital_name)='')) then raise exception 'Plan and hospital are required'; end if;
end; $$;

create or replace function public.get_portal_snapshot() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_program uuid; v_period uuid; v_role public.program_role; result jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.program_id,m.role into v_program,v_role from public.program_memberships m where m.user_id=v_user and m.active order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end limit 1;
  if v_program is null then raise exception 'No active program membership'; end if;
  select id into v_period from public.enrollment_periods where program_id=v_program order by (status='open') desc,coverage_year desc limit 1;
  select jsonb_build_object(
    'program',jsonb_build_object('name',pg.name,'timezone',coalesce(pg.timezone,'Africa/Lagos')),
    'profile',jsonb_build_object('id',pr.id,'email',pr.email,'displayName',pr.display_name,'role',v_role),
    'period',(select jsonb_build_object('id',ep.id,'year',ep.coverage_year,'startsAt',ep.starts_at,'endsAt',ep.ends_at,'status',ep.status,'extensionNote',ep.extension_note) from public.enrollment_periods ep where ep.id=v_period),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'code',po.code,'name',po.name,'description',po.description,'region',po.region,'individualPremiumKobo',po.individual_premium_kobo,'familyPremiumKobo',po.family_premium_kobo,'highlights',po.highlights,'benefits',po.benefits,'active',po.active) order by po.sort_order) from public.plan_offerings po where po.period_id=v_period),'[]'::jsonb),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'year',ep.coverage_year,'principal',(select x.person_data from public.enrollment_people x where x.enrollment_id=e.id and x.member_type='Member' limit 1),'dependents',coalesce((select jsonb_agg(x.person_data order by x.sort_order) from public.enrollment_people x where x.enrollment_id=e.id and x.member_type='Dependent'),'[]'::jsonb),'planId',e.plan_offering_id,'category',e.category,'hospital',e.hospital_name,'status',e.status,'totalKobo',e.subscriber_total_kobo,'consentedAt',e.consented_at,'completeness',e.completeness) order by e.created_at) from public.enrollments e join public.enrollment_periods ep on ep.id=e.period_id where e.period_id=v_period and public.can_access_household(e.household_id)),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',pay.id,'enrollmentId',pay.enrollment_id,'principalName',(select concat_ws(' ',x.person_data->>'firstName',nullif(x.person_data->>'middleName',''),x.person_data->>'surname') from public.enrollment_people x where x.enrollment_id=pay.enrollment_id and x.member_type='Member' limit 1),'amountKobo',pay.amount_kobo,'paidAt',pay.paid_at,'reference',pay.reference,'proofName',coalesce(regexp_replace(pay.proof_path,'^.*/',''),'No proof'),'status',pay.status,'submittedAt',pay.created_at) order by pay.created_at desc) from public.payments pay join public.enrollments e on e.id=pay.enrollment_id where e.period_id=v_period and public.can_access_household(e.household_id)),'[]'::jsonb),
    'paymentAccount',coalesce((select jsonb_build_object('beneficiary',pa.beneficiary,'bank',pa.bank,'accountNumber',pa.account_number,'referencePrefix',pa.reference_prefix) from public.payment_accounts pa where pa.program_id=v_program and pa.active_until is null order by pa.active_from desc limit 1),'{}'::jsonb),
    'auditEvents',case when v_role in ('admin','owner') then coalesce((select jsonb_agg(jsonb_build_object('id',a.id::text,'createdAt',a.created_at,'actorName',coalesce(actor.display_name,actor.email,'System'),'actorEmail',coalesce(actor.email,'system'),'action',a.action,'entityType',a.entity_type,'summary',case when a.entity_type='payments' then case when a.new_data->>'status'='verified' then 'Verified a subscriber payment for ' when a.new_data->>'status'='rejected' then 'Rejected a subscriber payment for ' else 'Updated a payment for ' end||coalesce((select concat_ws(' ',x.person_data->>'firstName',nullif(x.person_data->>'middleName',''),x.person_data->>'surname') from public.enrollment_people x where x.enrollment_id=((coalesce(a.new_data,a.old_data)->>'enrollment_id')::uuid) and x.member_type='Member' limit 1),'subscriber') else initcap(replace(a.action,'.',' ')) end) order by a.created_at desc) from (select * from public.audit_events where program_id=v_program order by created_at desc limit 100) a left join public.profiles actor on actor.id=a.actor_user_id),'[]'::jsonb) else '[]'::jsonb end,
    'hospitalSuggestions',coalesce((select jsonb_agg(name order by name) from public.hospital_suggestions where program_id=v_program),'[]'::jsonb)
  ) into result from public.profiles pr cross join public.programs pg where pr.id=v_user and pg.id=v_program;
  return result;
end; $$;

create or replace function public.update_program_settings(p_changes jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_program uuid; v_timezone text:=trim(p_changes->>'timezone');
begin
  select program_id into v_program from public.program_memberships where user_id=auth.uid() and active and role in('admin','owner') limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'Select a valid IANA time zone'; end if;
  update public.programs set timezone=v_timezone where id=v_program;
end; $$;
revoke all on function public.update_program_settings(jsonb) from public,anon;
grant execute on function public.update_program_settings(jsonb) to authenticated;

create or replace function public.get_public_join_config() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_program uuid; v_timezone text; v_period public.enrollment_periods;
begin
  select p.id,coalesce(p.timezone,'Africa/Lagos') into v_program,v_timezone from public.programs p where p.slug='futo-alums-hmo';
  select ep.* into v_period from public.enrollment_periods ep where ep.program_id=v_program and ep.status='open' and now() between ep.starts_at and ep.ends_at order by ep.coverage_year desc limit 1;
  return jsonb_build_object('timezone',v_timezone,'acceptingApplications',v_period.id is not null,'period',case when v_period.id is null then null else jsonb_build_object('id',v_period.id,'year',v_period.coverage_year,'startsAt',v_period.starts_at,'endsAt',v_period.ends_at,'status',v_period.status) end,'plans',case when v_period.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'code',po.code,'name',po.name,'description',po.description,'region',po.region,'individualPremiumKobo',po.individual_premium_kobo,'familyPremiumKobo',po.family_premium_kobo,'highlights',po.highlights,'benefits',po.benefits,'active',po.active) order by po.sort_order) from public.plan_offerings po where po.period_id=v_period.id and po.active),'[]'::jsonb) end);
end; $$;

create or replace function public.get_enrollment_history() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare program uuid;
begin
  select program_id into program from public.program_memberships where user_id=auth.uid() and active limit 1;
  if program is null then raise exception 'No active program membership'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'year',ep.coverage_year,'principalName',(select concat_ws(' ',x.person_data->>'firstName',nullif(x.person_data->>'middleName',''),x.person_data->>'surname') from public.enrollment_people x where x.enrollment_id=e.id and x.member_type='Member' limit 1),'planName',coalesce(po.name,'Not selected'),'category',e.category,'peopleCount',(select count(*) from public.enrollment_people x where x.enrollment_id=e.id),'hospital',e.hospital_name,'totalKobo',e.subscriber_total_kobo,'status',e.status) order by ep.coverage_year desc) from public.enrollments e join public.enrollment_periods ep on ep.id=e.period_id left join public.plan_offerings po on po.id=e.plan_offering_id where ep.program_id=program and ep.status='closed' and exists(select 1 from public.account_households ah where ah.user_id=auth.uid() and ah.household_id=e.household_id)),'[]'::jsonb);
end; $$;

create or replace function public.create_next_enrollment_year(p_source_period_id uuid,p_year integer,p_starts_at timestamptz,p_ends_at timestamptz) returns uuid language plpgsql security definer set search_path = '' as $$
declare source public.enrollment_periods; next_id uuid; source_enrollment public.enrollments; next_enrollment uuid;
begin
  select * into source from public.enrollment_periods where id=p_source_period_id for update;
  if source.id is null or not public.is_program_admin(source.program_id) then raise exception 'Administrator access required'; end if;
  if p_year<=source.coverage_year then raise exception 'New coverage year must follow the source year'; end if;
  insert into public.enrollment_periods(program_id,provider_id,coverage_year,starts_at,ends_at,status) values(source.program_id,source.provider_id,p_year,p_starts_at,p_ends_at,'scheduled') returning id into next_id;
  insert into public.plan_offerings(period_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active) select next_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active from public.plan_offerings where period_id=source.id;
  for source_enrollment in select * from public.enrollments where period_id=source.id loop
    insert into public.enrollments(household_id,period_id,category,hospital_name,status,enrollment_date,completeness) values(source_enrollment.household_id,next_id,source_enrollment.category,source_enrollment.hospital_name,'draft',(p_starts_at at time zone (select timezone from public.programs where id=source.program_id))::date,80) returning id into next_enrollment;
    insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order) select next_enrollment,person_id,member_type,jsonb_set(person_data,'{enrollmentDate}',to_jsonb((p_starts_at at time zone (select timezone from public.programs where id=source.program_id))::date)),sort_order from public.enrollment_people where enrollment_id=source_enrollment.id on conflict(enrollment_id,person_id) do update set person_data=excluded.person_data,member_type=excluded.member_type,sort_order=excluded.sort_order,updated_at=now();
  end loop;
  return next_id;
end; $$;

create or replace function public.get_payment_proof_path(p_payment_id uuid) returns text language plpgsql stable security definer set search_path = '' as $$
declare v_path text; v_household uuid; v_program uuid;
begin
  select p.proof_path,e.household_id,h.program_id into v_path,v_household,v_program from public.payments p join public.enrollments e on e.id=p.enrollment_id join public.households h on h.id=e.household_id where p.id=p_payment_id;
  if v_path is null or not(public.is_program_admin(v_program) or public.can_access_household(v_household)) then raise exception 'Payment proof not found'; end if;
  return v_path;
end; $$;

create or replace function public.submit_payment(p_enrollment_id uuid,p_amount_kobo bigint,p_paid_at date,p_reference text,p_proof_path text) returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; payment_id uuid; program uuid;
begin
  select * into e from public.enrollments where id=p_enrollment_id;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  if e.status not in('submitted','closed') or e.subscriber_total_kobo<=0 then raise exception 'Complete and submit enrollment before notifying a payment'; end if;
  if p_amount_kobo<=0 then raise exception 'Payment amount must be positive'; end if;
  if p_proof_path is null or p_proof_path not like p_enrollment_id::text||'/%' then raise exception 'A valid payment proof is required'; end if;
  insert into public.payments(enrollment_id,amount_kobo,paid_at,reference,proof_path,submitted_by) values(e.id,p_amount_kobo,p_paid_at,trim(p_reference),p_proof_path,auth.uid()) returning id into payment_id;
  select h.program_id into program from public.households h where h.id=e.household_id;
  insert into public.notification_outbox(program_id,event_type,payload) values(program,'payment.submitted',jsonb_build_object('payment_id',payment_id,'enrollment_id',e.id,'amount_kobo',p_amount_kobo)); return payment_id;
end; $$;

-- Existing application approvals create the enrollment after canonical people; capture that year immediately.
create or replace function public.initialize_enrollment_people() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order) select new.id,p.id,p.member_type,public.person_json(p,new.enrollment_date),case when p.member_type='Member' then 0 else row_number() over(partition by p.member_type order by p.date_of_birth,p.id)::smallint end from public.people p where p.household_id=new.household_id on conflict do nothing;
  return new;
end; $$;
drop trigger if exists initialize_enrollment_people on public.enrollments;
create trigger initialize_enrollment_people after insert on public.enrollments for each row execute function public.initialize_enrollment_people();

create or replace function public.select_enrollment_plan(p_enrollment_id uuid,p_plan_id uuid,p_category text) returns void language plpgsql security definer set search_path='' as $$
declare e public.enrollments; po public.plan_offerings; premium bigint; nhis bigint; reserve bigint; admin boolean;
begin
  select * into e from public.enrollments where id=p_enrollment_id for update;
  if e.id is null or not public.can_access_household(e.household_id) then raise exception 'Enrollment not found'; end if;
  select public.is_program_admin(h.program_id) into admin from public.households h where h.id=e.household_id;
  if not admin and not exists(select 1 from public.enrollment_periods where id=e.period_id and status='open' and now() between starts_at and ends_at) then raise exception 'Enrollment period is closed'; end if;
  select * into po from public.plan_offerings where id=p_plan_id and period_id=e.period_id and active;
  if po.id is null then raise exception 'Plan is not available for this period'; end if;
  if p_category not in('individual','family') then raise exception 'Invalid category'; end if;
  if p_category='individual' and exists(select 1 from public.enrollment_people where enrollment_id=e.id and member_type='Dependent') then raise exception 'Remove dependents before selecting individual coverage'; end if;
  premium:=case when p_category='family' then po.family_premium_kobo else po.individual_premium_kobo end; nhis:=round(premium*po.nhis_fee_basis_points/10000.0); reserve:=round(premium*po.reserve_fee_basis_points/10000.0);
  update public.enrollments set plan_offering_id=po.id,category=p_category::public.coverage_category,premium_kobo=premium,nhis_fee_kobo=nhis,reserve_fee_kobo=reserve,subscriber_total_kobo=premium+nhis+reserve,status='draft',updated_at=now() where id=e.id;
end; $$;

create or replace function public.get_admin_enrollment_period(p_period_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_program uuid; v_period public.enrollment_periods;
begin
  select pm.program_id into v_program from public.program_memberships pm where pm.user_id=auth.uid() and pm.active and pm.role in('admin','owner') order by case pm.role when 'owner' then 1 else 2 end limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;
  select * into v_period from public.enrollment_periods where id=p_period_id and program_id=v_program;
  if v_period.id is null then raise exception 'Enrollment period not found'; end if;
  return jsonb_build_object(
    'period',jsonb_build_object('id',v_period.id,'year',v_period.coverage_year,'startsAt',v_period.starts_at,'endsAt',v_period.ends_at,'status',v_period.status,'extensionNote',v_period.extension_note),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'code',po.code,'name',po.name,'description',po.description,'region',po.region,'individualPremiumKobo',po.individual_premium_kobo,'familyPremiumKobo',po.family_premium_kobo,'highlights',po.highlights,'benefits',po.benefits,'active',po.active) order by po.sort_order) from public.plan_offerings po where po.period_id=v_period.id),'[]'::jsonb),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'year',v_period.coverage_year,'principal',(select x.person_data from public.enrollment_people x where x.enrollment_id=e.id and x.member_type='Member' limit 1),'dependents',coalesce((select jsonb_agg(x.person_data order by x.sort_order) from public.enrollment_people x where x.enrollment_id=e.id and x.member_type='Dependent'),'[]'::jsonb),'planId',e.plan_offering_id,'category',e.category,'hospital',e.hospital_name,'status',e.status,'totalKobo',e.subscriber_total_kobo,'consentedAt',e.consented_at,'completeness',e.completeness) order by e.created_at) from public.enrollments e where e.period_id=v_period.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('id',pay.id,'enrollmentId',pay.enrollment_id,'principalName',(select concat_ws(' ',x.person_data->>'firstName',nullif(x.person_data->>'middleName',''),x.person_data->>'surname') from public.enrollment_people x where x.enrollment_id=pay.enrollment_id and x.member_type='Member' limit 1),'amountKobo',pay.amount_kobo,'paidAt',pay.paid_at,'reference',pay.reference,'proofName',coalesce(regexp_replace(pay.proof_path,'^.*/',''),'No proof'),'status',pay.status,'submittedAt',pay.created_at) order by pay.created_at desc) from public.payments pay join public.enrollments e on e.id=pay.enrollment_id where e.period_id=v_period.id),'[]'::jsonb)
  );
end; $$;

revoke all on function public.get_portal_snapshot() from public,anon;
grant execute on function public.get_portal_snapshot() to authenticated;
