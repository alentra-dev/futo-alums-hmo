create or replace function public.get_admin_enrollment_periods() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_program uuid;
begin
  select pm.program_id into v_program
  from public.program_memberships pm
  where pm.user_id = auth.uid() and pm.active and pm.role in ('admin', 'owner')
  order by case pm.role when 'owner' then 1 else 2 end
  limit 1;

  if v_program is null then raise exception 'Administrator access required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ep.id,
      'year', ep.coverage_year,
      'startsAt', ep.starts_at,
      'endsAt', ep.ends_at,
      'status', ep.status,
      'extensionNote', ep.extension_note
    ) order by
      case ep.status when 'open' then 1 when 'closed' then 2 else 3 end,
      ep.coverage_year desc)
    from public.enrollment_periods ep
    where ep.program_id = v_program
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_admin_enrollment_period(p_period_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_program uuid;
  v_period public.enrollment_periods;
begin
  select pm.program_id into v_program
  from public.program_memberships pm
  where pm.user_id = auth.uid() and pm.active and pm.role in ('admin', 'owner')
  order by case pm.role when 'owner' then 1 else 2 end
  limit 1;

  if v_program is null then raise exception 'Administrator access required'; end if;

  select ep.* into v_period
  from public.enrollment_periods ep
  where ep.id = p_period_id and ep.program_id = v_program;

  if v_period.id is null then raise exception 'Enrollment period not found'; end if;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'id', v_period.id,
      'year', v_period.coverage_year,
      'startsAt', v_period.starts_at,
      'endsAt', v_period.ends_at,
      'status', v_period.status,
      'extensionNote', v_period.extension_note
    ),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', po.id, 'code', po.code, 'name', po.name, 'description', po.description,
        'region', po.region, 'individualPremiumKobo', po.individual_premium_kobo,
        'familyPremiumKobo', po.family_premium_kobo, 'highlights', po.highlights,
        'benefits', po.benefits, 'active', po.active
      ) order by po.sort_order)
      from public.plan_offerings po where po.period_id = v_period.id
    ), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'year', v_period.coverage_year,
        'principal', (select public.person_json(x, e.enrollment_date) from public.people x where x.household_id = e.household_id and x.member_type = 'Member' limit 1),
        'dependents', coalesce((select jsonb_agg(public.person_json(x, e.enrollment_date) order by x.date_of_birth) from public.people x where x.household_id = e.household_id and x.member_type = 'Dependent'), '[]'::jsonb),
        'planId', e.plan_offering_id, 'category', e.category, 'hospital', e.hospital_name,
        'status', e.status, 'totalKobo', e.subscriber_total_kobo,
        'consentedAt', e.consented_at, 'completeness', e.completeness
      ) order by e.created_at)
      from public.enrollments e where e.period_id = v_period.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id, 'enrollmentId', pay.enrollment_id,
        'principalName', (select concat_ws(' ', x.first_name, nullif(x.middle_name, ''), x.surname) from public.enrollments ee join public.people x on x.household_id = ee.household_id and x.member_type = 'Member' where ee.id = pay.enrollment_id limit 1),
        'amountKobo', pay.amount_kobo, 'paidAt', pay.paid_at, 'reference', pay.reference,
        'proofName', coalesce(regexp_replace(pay.proof_path, '^.*/', ''), 'No proof'),
        'status', pay.status, 'submittedAt', pay.created_at
      ) order by pay.created_at desc)
      from public.payments pay
      join public.enrollments e on e.id = pay.enrollment_id
      where e.period_id = v_period.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_enrollment_periods() from public, anon;
revoke all on function public.get_admin_enrollment_period(uuid) from public, anon;
grant execute on function public.get_admin_enrollment_periods() to authenticated;
grant execute on function public.get_admin_enrollment_period(uuid) to authenticated;
