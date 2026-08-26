do $$
declare
  v_program uuid;
  v_period_2025 uuid;
  v_period_2026 uuid;
  v_vital_plan uuid;
  v_updated integer;
begin
  select id into v_program from public.programs where slug='futo-alums-hmo';
  select id into v_period_2025 from public.enrollment_periods where program_id=v_program and coverage_year=2025;
  select id into v_period_2026 from public.enrollment_periods where program_id=v_program and coverage_year=2026;
  if v_period_2025 is null or v_period_2026 is null then raise exception 'The 2025 and 2026 enrollment periods are required'; end if;

  update public.plan_offerings po set
    individual_premium_kobo=r.individual_premium_kobo,
    family_premium_kobo=r.family_premium_kobo
  from (values
    ('PLUS',5868500::bigint,26408300::bigint),
    ('PREMIUM',9476800::bigint,42645300::bigint),
    ('PREMIUM_PLUS',13247100::bigint,59611900::bigint),
    ('PRESTIGE',19407900::bigint,87335400::bigint),
    ('PRESTIGE_PLUS',31518100::bigint,141831400::bigint),
    ('EXECUTIVE_PRESTIGE',53427600::bigint,240424000::bigint)
  ) as r(code,individual_premium_kobo,family_premium_kobo)
  where po.period_id=v_period_2026 and po.code=r.code;
  get diagnostics v_updated=row_count;
  if v_updated<>6 then raise exception 'Expected to update six 2026 plan offerings, updated %',v_updated; end if;

  -- Basic and Vital remain historical only and cannot be selected for 2026.
  update public.plan_offerings set active=false where period_id=v_period_2026 and code in('BASIC','VITAL');

  update public.enrollments e set
    premium_kobo=case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end,
    nhis_fee_kobo=round((case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end)*po.nhis_fee_basis_points/10000.0),
    reserve_fee_kobo=round((case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end)*po.reserve_fee_basis_points/10000.0),
    subscriber_total_kobo=(case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end)
      +round((case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end)*po.nhis_fee_basis_points/10000.0)
      +round((case when e.category='family' then po.family_premium_kobo else po.individual_premium_kobo end)*po.reserve_fee_basis_points/10000.0),
    updated_at=now()
  from public.plan_offerings po where e.period_id=v_period_2026 and e.plan_offering_id=po.id;

  insert into public.plan_offerings(period_id,code,name,description,region,individual_premium_kobo,family_premium_kobo,sort_order,active)
  values(v_period_2025,'VITAL','Vital Plan','Historical 2025 offering','Nigeria',4235000,19057500,2,false)
  on conflict(period_id,code) do update set name=excluded.name,individual_premium_kobo=excluded.individual_premium_kobo,family_premium_kobo=excluded.family_premium_kobo,active=false
  returning id into v_vital_plan;

  update public.enrollments set
    plan_offering_id=v_vital_plan,
    imported_source=jsonb_set(imported_source,'{normalized_plan_code}','"VITAL"'::jsonb),
    updated_at=now()
  where period_id=v_period_2025 and lower(coalesce(imported_source->>'original_plan_label','')) like '%vital%';
  get diagnostics v_updated=row_count;
  if v_updated<>3 then raise exception 'Expected to restore three historical Vital enrollments, restored %',v_updated; end if;
end $$;
