drop trigger if exists apply_enrollment_surcharges on public.enrollments;
alter table public.enrollments drop constraint if exists enrollment_total_matches_components;

create or replace function public.apply_enrollment_surcharges() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_nhis integer:=0; v_program integer:=0;
begin
  select ep.nhis_fee_basis_points,ep.program_fee_basis_points into v_nhis,v_program
  from public.enrollment_periods ep where ep.id=new.period_id;
  new.nhis_fee_kobo:=round(new.premium_kobo*coalesce(v_nhis,0)/10000.0);
  new.reserve_fee_kobo:=round(new.premium_kobo*coalesce(v_program,0)/10000.0);
  new.subscriber_total_kobo:=new.premium_kobo+new.nhis_fee_kobo+new.reserve_fee_kobo;
  return new;
end; $$;

create trigger apply_enrollment_surcharges
before insert or update of period_id,premium_kobo,nhis_fee_kobo,reserve_fee_kobo,subscriber_total_kobo
on public.enrollments for each row execute function public.apply_enrollment_surcharges();

create or replace function public.get_period_surcharge_rates(p_period_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('nhisFeeBasisPoints',ep.nhis_fee_basis_points,'programFeeBasisPoints',ep.program_fee_basis_points)
  from public.enrollment_periods ep join public.programs p on p.id=ep.program_id
  where ep.id=p_period_id and p.slug='futo-alums-hmo';
$$;

drop function if exists public.update_enrollment_surcharge_rates(uuid,integer,integer,integer);
create function public.update_enrollment_surcharge_rates(
  p_period_id uuid,p_nhis_basis_points integer,p_program_basis_points integer
) returns void language plpgsql security definer set search_path='' as $$
declare v_period public.enrollment_periods;
begin
  select * into v_period from public.enrollment_periods where id=p_period_id for update;
  if v_period.id is null or not public.is_program_admin(v_period.program_id) then raise exception 'Administrator access required'; end if;
  if p_nhis_basis_points not between 0 and 10000 or p_program_basis_points not between 0 and 10000 or p_nhis_basis_points+p_program_basis_points>10000 then
    raise exception 'Each surcharge rate must be between 0%% and 100%%, and their sum cannot exceed 100%%';
  end if;
  update public.enrollment_periods set nhis_fee_basis_points=p_nhis_basis_points,program_fee_basis_points=p_program_basis_points where id=v_period.id;
  update public.plan_offerings set nhis_fee_basis_points=p_nhis_basis_points,reserve_fee_basis_points=p_program_basis_points,total_fee_basis_points=p_nhis_basis_points+p_program_basis_points where period_id=v_period.id;
  update public.enrollments set subscriber_total_kobo=subscriber_total_kobo,updated_at=now() where period_id=v_period.id;
end; $$;

create or replace function public.create_next_enrollment_year(p_source_period_id uuid,p_year integer,p_starts_at timestamptz,p_ends_at timestamptz) returns uuid language plpgsql security definer set search_path = '' as $$
declare source public.enrollment_periods; next_id uuid; source_enrollment public.enrollments; next_enrollment uuid;
begin
  select * into source from public.enrollment_periods where id=p_source_period_id for update;
  if source.id is null or not public.is_program_admin(source.program_id) then raise exception 'Administrator access required'; end if;
  if p_year<=source.coverage_year then raise exception 'New coverage year must follow the source year'; end if;
  insert into public.enrollment_periods(program_id,provider_id,coverage_year,starts_at,ends_at,status,nhis_fee_basis_points,program_fee_basis_points)
  values(source.program_id,source.provider_id,p_year,p_starts_at,p_ends_at,'scheduled',source.nhis_fee_basis_points,source.program_fee_basis_points) returning id into next_id;
  insert into public.plan_offerings(period_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active) select next_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,total_fee_basis_points,nhis_fee_basis_points,reserve_fee_basis_points,highlights,benefits,sort_order,active from public.plan_offerings where period_id=source.id;
  for source_enrollment in select * from public.enrollments where period_id=source.id loop
    insert into public.enrollments(household_id,period_id,category,hospital_name,status,enrollment_date,completeness) values(source_enrollment.household_id,next_id,source_enrollment.category,source_enrollment.hospital_name,'draft',(p_starts_at at time zone (select timezone from public.programs where id=source.program_id))::date,80) returning id into next_enrollment;
    insert into public.enrollment_people(enrollment_id,person_id,member_type,person_data,sort_order) select next_enrollment,person_id,member_type,jsonb_set(person_data,'{enrollmentDate}',to_jsonb((p_starts_at at time zone (select timezone from public.programs where id=source.program_id))::date)),sort_order from public.enrollment_people where enrollment_id=source_enrollment.id on conflict(enrollment_id,person_id) do update set person_data=excluded.person_data,member_type=excluded.member_type,sort_order=excluded.sort_order,updated_at=now();
  end loop;
  return next_id;
end; $$;

update public.enrollment_periods set program_fee_basis_points=1500 where coverage_year>=2026;
update public.plan_offerings po set reserve_fee_basis_points=1500,total_fee_basis_points=po.nhis_fee_basis_points+1500
from public.enrollment_periods ep where ep.id=po.period_id and ep.coverage_year>=2026;
update public.enrollments e set subscriber_total_kobo=e.subscriber_total_kobo,updated_at=now()
from public.enrollment_periods ep where ep.id=e.period_id and ep.coverage_year>=2026;

alter table public.enrollments drop column transaction_tax_fee_kobo;
alter table public.enrollment_periods drop column transaction_tax_basis_points;
alter table public.enrollments add constraint enrollment_total_matches_components
  check(subscriber_total_kobo=premium_kobo+nhis_fee_kobo+reserve_fee_kobo);

revoke all on function public.get_period_surcharge_rates(uuid) from public;
revoke all on function public.update_enrollment_surcharge_rates(uuid,integer,integer) from public,anon;
grant execute on function public.get_period_surcharge_rates(uuid) to anon,authenticated;
grant execute on function public.update_enrollment_surcharge_rates(uuid,integer,integer) to authenticated;
