create or replace function public.get_subscriber_enrollment_ids() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(e.id order by e.created_at), '[]'::jsonb)
  from public.account_households ah
  join public.enrollments e on e.household_id = ah.household_id
  where ah.user_id = auth.uid()
    and e.period_id = (
      select ep.id
      from public.enrollment_periods ep
      join public.program_memberships pm on pm.program_id = ep.program_id
      where pm.user_id = auth.uid() and pm.active
      order by (ep.status = 'open') desc, ep.coverage_year desc
      limit 1
    );
$$;

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
  ) order by ep.coverage_year desc)
  from public.enrollments e
  join public.enrollment_periods ep on ep.id=e.period_id
  left join public.plan_offerings po on po.id=e.plan_offering_id
  where ep.program_id=program
    and ep.status='closed'
    and exists (
      select 1 from public.account_households ah
      where ah.user_id=auth.uid() and ah.household_id=e.household_id
    )),'[]'::jsonb);
end; $$;

revoke all on function public.get_subscriber_enrollment_ids() from public,anon;
grant execute on function public.get_subscriber_enrollment_ids() to authenticated;
