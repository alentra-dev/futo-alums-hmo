-- Automatic next-year carry-forward.
--
-- A submitted or closed enrollment's balance follows the household into its enrollment for
-- the next coverage year, where it is applied to the HMO premium position. Everything is
-- derived live from verified, audited records, so it is applied exactly once (one household
-- enrollment per period) and stays correct if a prior-year payment is verified late.
--
--   premium balance    = verified HMO payments + carry-in from the year before - subscriber total
--   assessment balance = verified assessment payments - one-time fee - signed adjustment
--                        (assigned terms; unpaid higher contributions therefore owe only the
--                        one-time fee, and fully paid ones carry their future credit), or
--                        -(active assessment's default one-time fee) when never assigned
--   proration credit   = stored late-enrollment credit
-- An HMO overpayment first covers an assessment balance owed, so a member who paid both in
-- one transfer is shown as settled. Net = the sum of the three.
--
-- Mirrored by nextEnrollmentCarryForward in src/lib/financialPosition.ts; keep them identical.
begin;

alter table public.enrollment_periods add column carry_forward_enabled boolean not null default true;
-- 2026 is the first live portal year; imported 2025 records never carry forward.
update public.enrollment_periods set carry_forward_enabled = coverage_year >= 2026;

create or replace function public.enrollment_carry_forward(p_enrollment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  e public.enrollments; ep public.enrollment_periods; a public.financial_assessments; ea public.enrollment_assessments;
  v_carry_in bigint; v_paid bigint; v_premium bigint; v_assessment bigint := 0; v_assessment_paid bigint;
  v_proration bigint; v_applied bigint := 0;
begin
  select * into e from public.enrollments where id=p_enrollment_id;
  if e.id is null or e.status not in ('submitted','closed') then return null; end if;
  select * into ep from public.enrollment_periods where id=e.period_id;
  if not ep.carry_forward_enabled then return null; end if;

  v_carry_in := coalesce((public.enrollment_carry_in(e.id)->>'netKobo')::bigint,0);
  select coalesce(sum(p.amount_kobo),0) into v_paid from public.payments p
  where p.enrollment_id=e.id and p.status='verified' and p.assessment_id is null;
  v_premium := v_paid + v_carry_in - e.subscriber_total_kobo;

  select * into a from public.financial_assessments where period_id=e.period_id and active order by created_at limit 1;
  if a.id is not null then
    select * into ea from public.enrollment_assessments where assessment_id=a.id and enrollment_id=e.id;
    if ea.assessment_id is not null then
      select coalesce(sum(p.amount_kobo),0) into v_assessment_paid from public.payments p
      where p.enrollment_id=e.id and p.status='verified' and p.assessment_id=a.id;
      v_assessment := v_assessment_paid - ea.fee_portion_kobo - ea.adjustment_kobo;
    else
      v_assessment := -a.fee_portion_kobo;
    end if;
  end if;
  v_proration := coalesce(e.proration_credit_kobo,0);

  if v_premium>0 and v_assessment<0 then
    v_applied := least(v_premium,-v_assessment);
    v_premium := v_premium-v_applied;
    v_assessment := v_assessment+v_applied;
  end if;

  return jsonb_build_object(
    'sourceEnrollmentId',e.id,'sourceYear',ep.coverage_year,'creditYear',ep.coverage_year+1,
    'premiumBalanceKobo',v_premium,'assessmentBalanceKobo',v_assessment,'prorationCreditKobo',v_proration,
    'overpaymentAppliedKobo',v_applied,'netKobo',v_premium+v_assessment+v_proration);
end; $$;
revoke all on function public.enrollment_carry_forward(uuid) from public,anon,authenticated;

-- What an enrollment receives: the carry-forward of the same household's enrollment in the
-- immediately preceding coverage year.
create or replace function public.enrollment_carry_in(p_enrollment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_prior uuid;
begin
  select prior.id into v_prior
  from public.enrollments e
  join public.enrollment_periods ep on ep.id=e.period_id
  join public.enrollment_periods pp on pp.program_id=ep.program_id and pp.coverage_year=ep.coverage_year-1
  join public.enrollments prior on prior.period_id=pp.id and prior.household_id=e.household_id
  where e.id=p_enrollment_id;
  if v_prior is null then return null; end if;
  return public.enrollment_carry_forward(v_prior);
end; $$;
revoke all on function public.enrollment_carry_in(uuid) from public,anon,authenticated;

-- Side-car read: the carry-in applied to each accessible enrollment of the period.
create or replace function public.get_enrollment_carry_forwards(p_period_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_period public.enrollment_periods;
begin
  select * into v_period from public.enrollment_periods where id=p_period_id;
  if v_period.id is null or not public.is_program_member(v_period.program_id) then raise exception 'Program access required'; end if;
  return jsonb_build_object(
    'carryForwardEnabled',v_period.carry_forward_enabled,
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object('enrollmentId',x.id,'carryIn',x.carry_in))
      from (select e.id,public.enrollment_carry_in(e.id) as carry_in from public.enrollments e
            where e.period_id=v_period.id and public.can_access_household(e.household_id)) x
      where x.carry_in is not null),'[]'::jsonb));
end; $$;
revoke all on function public.get_enrollment_carry_forwards(uuid) from public,anon;
grant execute on function public.get_enrollment_carry_forwards(uuid) to authenticated;

commit;
