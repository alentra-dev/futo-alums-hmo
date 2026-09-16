-- The program collects every payment into one bank account. HMO premiums and program
-- assessments are told apart only by the transfer reference the subscriber writes on the
-- transfer, which is what makes the deposits reconcilable.
--
-- financial_assessments nevertheless carried its own beneficiary/bank/account_number: a
-- second, separately editable copy of that one account that could drift and hand a
-- subscriber a stale account number. Only the reference prefix is genuinely per-assessment.

-- Dropping columns cannot be undone, so refuse to run if any assessment still holds bank
-- details that differ from the program payment account. Divergence would mean the copy
-- being discarded is not in fact redundant, and a human has to reconcile it first.
do $$
declare v_divergent text;
begin
  select string_agg(format('%s (assessment holds bank %L account %L; program account is bank %L account %L)',
                           a.name, a.bank, a.account_number, pa.bank, pa.account_number), '; ')
    into v_divergent
    from public.financial_assessments a
    join lateral (
      select p.bank, p.account_number
        from public.payment_accounts p
       where p.program_id = a.program_id and p.active_until is null
       order by p.active_from desc
       limit 1
    ) pa on true
   where a.bank is distinct from pa.bank or a.account_number is distinct from pa.account_number;

  if v_divergent is not null then
    raise exception 'Assessment bank details differ from the program payment account: %. Reconcile them before dropping the duplicate columns.', v_divergent;
  end if;
end $$;

alter table public.financial_assessments drop column if exists beneficiary;
alter table public.financial_assessments drop column if exists bank;
alter table public.financial_assessments drop column if exists account_number;

-- An assessment now contributes only its transfer reference; bank details always come from
-- the single program payment account.
create or replace function public.get_financial_workspace(p_period_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_program uuid;
begin
  select ep.program_id into v_program from public.enrollment_periods ep where ep.id=p_period_id;
  if v_program is null or not public.is_program_member(v_program) then raise exception 'Program access required'; end if;
  return jsonb_build_object(
    'assessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'periodId',a.period_id,'name',a.name,'description',a.description,
      'amountKobo',a.amount_kobo,'feePortionKobo',a.fee_portion_kobo,
      'futureCreditKobo',a.future_credit_kobo,'creditYear',a.credit_year,
      'dueAt',a.due_at,'active',a.active,'referencePrefix',a.reference_prefix
      ) order by a.created_at) from public.financial_assessments a where a.period_id=p_period_id),'[]'::jsonb),
    'assessmentAdjustments',coalesce((select jsonb_agg(jsonb_build_object(
      'assessmentId',ea.assessment_id,'enrollmentId',ea.enrollment_id,
      'adjustmentKobo',ea.adjustment_kobo,'note',ea.note
    )) from public.enrollment_assessments ea join public.enrollments e on e.id=ea.enrollment_id
      where ea.program_id=v_program and (public.is_program_admin(v_program) or public.can_access_household(e.household_id))),'[]'::jsonb),
    'paymentLinks',coalesce((select jsonb_agg(jsonb_build_object('paymentId',p.id,'assessmentId',p.assessment_id))
      from public.payments p join public.enrollments e on e.id=p.enrollment_id
      where e.period_id=p_period_id and p.assessment_id is not null
        and (public.is_program_admin(v_program) or public.can_access_household(e.household_id))),'[]'::jsonb)
  );
end; $$;
revoke all on function public.get_financial_workspace(uuid) from public,anon;
grant execute on function public.get_financial_workspace(uuid) to authenticated;

create or replace function public.upsert_financial_assessment(p_assessment jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_period public.enrollment_periods; v_id uuid:=nullif(p_assessment->>'id','')::uuid; v_reference text:=trim(coalesce(p_assessment->>'referencePrefix','')); v_program_reference text;
begin
  select * into v_period from public.enrollment_periods where id=(p_assessment->>'periodId')::uuid;
  if v_period.id is null or not public.is_program_admin(v_period.program_id) then raise exception 'Administrator access required'; end if;
  if (p_assessment->>'amountKobo')::bigint<0 or (p_assessment->>'feePortionKobo')::bigint<0 or (p_assessment->>'futureCreditKobo')::bigint<0 then raise exception 'Amounts cannot be negative'; end if;
  if (p_assessment->>'feePortionKobo')::bigint+(p_assessment->>'futureCreditKobo')::bigint>(p_assessment->>'amountKobo')::bigint then raise exception 'Fee and credit portions cannot exceed the assessment'; end if;
  if v_reference='' then raise exception 'A transfer reference prefix is required'; end if;

  -- One account collects both purposes, so an assessment sharing the HMO reference would
  -- make the two impossible to reconcile apart.
  select p.reference_prefix into v_program_reference
    from public.payment_accounts p
   where p.program_id=v_period.program_id and p.active_until is null
   order by p.active_from desc limit 1;
  if v_program_reference is not null and upper(v_reference)=upper(trim(v_program_reference)) then
    raise exception 'Use a transfer reference that differs from the HMO premium reference %', v_program_reference;
  end if;

  if v_id is null then
    insert into public.financial_assessments(program_id,period_id,name,description,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year,due_at,reference_prefix,active)
    values(v_period.program_id,v_period.id,trim(p_assessment->>'name'),trim(coalesce(p_assessment->>'description','')),(p_assessment->>'amountKobo')::bigint,(p_assessment->>'feePortionKobo')::bigint,(p_assessment->>'futureCreditKobo')::bigint,(p_assessment->>'creditYear')::integer,(p_assessment->>'dueAt')::timestamptz,v_reference,coalesce((p_assessment->>'active')::boolean,true)) returning id into v_id;
  else
    update public.financial_assessments set name=trim(p_assessment->>'name'),description=trim(coalesce(p_assessment->>'description','')),amount_kobo=(p_assessment->>'amountKobo')::bigint,fee_portion_kobo=(p_assessment->>'feePortionKobo')::bigint,future_credit_kobo=(p_assessment->>'futureCreditKobo')::bigint,credit_year=(p_assessment->>'creditYear')::integer,due_at=(p_assessment->>'dueAt')::timestamptz,reference_prefix=v_reference,active=coalesce((p_assessment->>'active')::boolean,true),updated_at=now() where id=v_id and program_id=v_period.program_id and period_id=v_period.id;
    if not found then raise exception 'Assessment not found'; end if;
  end if;
  return v_id;
end; $$;
revoke all on function public.upsert_financial_assessment(jsonb) from public,anon;
grant execute on function public.upsert_financial_assessment(jsonb) to authenticated;
