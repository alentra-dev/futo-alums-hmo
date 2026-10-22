-- An HMO overpayment is reconciled against the member's full assessment contribution
-- (fee + adjustment + future credit), not only its one-time fee. This matches how members
-- were asked to pay: a contribution reduced by their premium overpayment. Net carry-forward
-- is unchanged; only its split between premium and assessment changes, so a member who paid
-- ₦33,000 less their overpayment is shown the ₦18,000 credit, not a reduced credit plus a
-- separate overpayment.
--
-- Mirrored by nextEnrollmentCarryForward in src/lib/financialPosition.ts; keep them identical.
begin;

create or replace function public.enrollment_carry_forward(p_enrollment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  e public.enrollments; ep public.enrollment_periods; a public.financial_assessments; ea public.enrollment_assessments;
  v_carry_in bigint; v_paid bigint; v_premium bigint; v_assessment bigint := 0; v_assessment_paid bigint := 0;
  v_assessment_unpaid bigint := 0; v_proration bigint; v_applied bigint := 0;
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
      -- What remains of the full contribution the member was asked to pay.
      v_assessment_unpaid := greatest(0, ea.amount_kobo + ea.adjustment_kobo - v_assessment_paid);
    else
      v_assessment := -a.fee_portion_kobo;
      v_assessment_unpaid := a.fee_portion_kobo;
    end if;
  end if;
  v_proration := coalesce(e.proration_credit_kobo,0);

  if v_premium>0 and v_assessment_unpaid>0 then
    v_applied := least(v_premium,v_assessment_unpaid);
    v_premium := v_premium-v_applied;
    v_assessment := v_assessment+v_applied;
  end if;

  return jsonb_build_object(
    'sourceEnrollmentId',e.id,'sourceYear',ep.coverage_year,'creditYear',ep.coverage_year+1,
    'premiumBalanceKobo',v_premium,'assessmentBalanceKobo',v_assessment,'prorationCreditKobo',v_proration,
    'overpaymentAppliedKobo',v_applied,'netKobo',v_premium+v_assessment+v_proration);
end; $$;
revoke all on function public.enrollment_carry_forward(uuid) from public,anon,authenticated;

commit;
