create or replace function public.get_enrollment_history() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare program uuid;
begin
  select program_id into program from public.program_memberships where user_id=auth.uid() and active limit 1;
  if program is null then raise exception 'No active program membership'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'year',ep.coverage_year,
    'principalName',(select concat_ws(' ',p.first_name,nullif(p.middle_name,''),p.surname) from public.people p where p.household_id=e.household_id and p.member_type='Member' limit 1),
    'planName',coalesce(po.name,'Not selected'),'category',e.category,
    'peopleCount',(select count(*) from public.people p where p.household_id=e.household_id),
    'hospital',e.hospital_name,'totalKobo',e.subscriber_total_kobo,'status',e.status
  ) order by ep.coverage_year desc) from public.enrollments e join public.enrollment_periods ep on ep.id=e.period_id left join public.plan_offerings po on po.id=e.plan_offering_id where ep.program_id=program and ep.status='closed' and public.can_access_household(e.household_id)),'[]'::jsonb);
end; $$;

create or replace function public.create_next_enrollment_year(p_source_period_id uuid,p_year integer,p_starts_at timestamptz,p_ends_at timestamptz) returns uuid language plpgsql security definer set search_path = '' as $$
declare source public.enrollment_periods; next_id uuid;
begin
  select * into source from public.enrollment_periods where id=p_source_period_id for update;
  if source.id is null or not public.is_program_admin(source.program_id) then raise exception 'Administrator access required'; end if;
  if p_year<=source.coverage_year then raise exception 'New coverage year must follow the source year'; end if;
  insert into public.enrollment_periods(program_id,provider_id,coverage_year,starts_at,ends_at,status) values(source.program_id,source.provider_id,p_year,p_starts_at,p_ends_at,'scheduled') returning id into next_id;
  insert into public.plan_offerings(period_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active)
  select next_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active from public.plan_offerings where period_id=source.id;
  insert into public.enrollments(household_id,period_id,category,hospital_name,status,enrollment_date,completeness)
  select e.household_id,next_id,e.category,e.hospital_name,'draft',p_starts_at::date,80 from public.enrollments e where e.period_id=source.id;
  return next_id;
end; $$;

revoke all on function public.get_enrollment_history() from public,anon;
revoke all on function public.create_next_enrollment_year(uuid,integer,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_enrollment_history() to authenticated;
grant execute on function public.create_next_enrollment_year(uuid,integer,timestamptz,timestamptz) to authenticated;
