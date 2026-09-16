create table public.financial_assessments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  period_id uuid not null references public.enrollment_periods(id) on delete cascade,
  name text not null,
  description text not null default '',
  amount_kobo bigint not null check(amount_kobo>=0),
  fee_portion_kobo bigint not null default 0 check(fee_portion_kobo>=0),
  future_credit_kobo bigint not null default 0 check(future_credit_kobo>=0),
  credit_year integer not null check(credit_year between 2020 and 2100),
  due_at timestamptz not null,
  beneficiary text not null,
  bank text not null,
  account_number text not null check(account_number~'^[0-9]{10}$'),
  reference_prefix text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id,name),
  check(fee_portion_kobo+future_credit_kobo<=amount_kobo)
);

create table public.enrollment_assessments (
  assessment_id uuid not null references public.financial_assessments(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  adjustment_kobo bigint not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(assessment_id,enrollment_id)
);

alter table public.payments add column assessment_id uuid references public.financial_assessments(id) on delete restrict;
create index payments_assessment_idx on public.payments(assessment_id) where assessment_id is not null;
alter table public.financial_assessments enable row level security;
alter table public.enrollment_assessments enable row level security;

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
      'dueAt',a.due_at,'active',a.active,'paymentAccount',jsonb_build_object(
        'beneficiary',a.beneficiary,'bank',a.bank,'accountNumber',a.account_number,'referencePrefix',a.reference_prefix
      )) order by a.created_at) from public.financial_assessments a where a.period_id=p_period_id),'[]'::jsonb),
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
declare v_period public.enrollment_periods; v_id uuid:=nullif(p_assessment->>'id','')::uuid;
begin
  select * into v_period from public.enrollment_periods where id=(p_assessment->>'periodId')::uuid;
  if v_period.id is null or not public.is_program_admin(v_period.program_id) then raise exception 'Administrator access required'; end if;
  if (p_assessment->>'amountKobo')::bigint<0 or (p_assessment->>'feePortionKobo')::bigint<0 or (p_assessment->>'futureCreditKobo')::bigint<0 then raise exception 'Amounts cannot be negative'; end if;
  if (p_assessment->>'feePortionKobo')::bigint+(p_assessment->>'futureCreditKobo')::bigint>(p_assessment->>'amountKobo')::bigint then raise exception 'Fee and credit portions cannot exceed the assessment'; end if;
  if coalesce(p_assessment->>'accountNumber','')!~'^[0-9]{10}$' then raise exception 'Account number must contain 10 digits'; end if;
  if v_id is null then
    insert into public.financial_assessments(program_id,period_id,name,description,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year,due_at,beneficiary,bank,account_number,reference_prefix,active)
    values(v_period.program_id,v_period.id,trim(p_assessment->>'name'),trim(coalesce(p_assessment->>'description','')),(p_assessment->>'amountKobo')::bigint,(p_assessment->>'feePortionKobo')::bigint,(p_assessment->>'futureCreditKobo')::bigint,(p_assessment->>'creditYear')::integer,(p_assessment->>'dueAt')::timestamptz,trim(p_assessment->>'beneficiary'),trim(p_assessment->>'bank'),p_assessment->>'accountNumber',trim(p_assessment->>'referencePrefix'),coalesce((p_assessment->>'active')::boolean,true)) returning id into v_id;
  else
    update public.financial_assessments set name=trim(p_assessment->>'name'),description=trim(coalesce(p_assessment->>'description','')),amount_kobo=(p_assessment->>'amountKobo')::bigint,fee_portion_kobo=(p_assessment->>'feePortionKobo')::bigint,future_credit_kobo=(p_assessment->>'futureCreditKobo')::bigint,credit_year=(p_assessment->>'creditYear')::integer,due_at=(p_assessment->>'dueAt')::timestamptz,beneficiary=trim(p_assessment->>'beneficiary'),bank=trim(p_assessment->>'bank'),account_number=p_assessment->>'accountNumber',reference_prefix=trim(p_assessment->>'referencePrefix'),active=coalesce((p_assessment->>'active')::boolean,true),updated_at=now() where id=v_id and program_id=v_period.program_id and period_id=v_period.id;
    if not found then raise exception 'Assessment not found'; end if;
  end if;
  return v_id;
end; $$;
revoke all on function public.upsert_financial_assessment(jsonb) from public,anon;
grant execute on function public.upsert_financial_assessment(jsonb) to authenticated;

create or replace function public.set_enrollment_assessment(p_assessment_id uuid,p_enrollment_id uuid,p_included boolean,p_adjustment_kobo bigint default 0,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare v_assessment public.financial_assessments; v_enrollment public.enrollments;
begin
  select * into v_assessment from public.financial_assessments where id=p_assessment_id;
  select * into v_enrollment from public.enrollments where id=p_enrollment_id;
  if v_assessment.id is null or v_enrollment.id is null or v_assessment.period_id<>v_enrollment.period_id or not public.is_program_admin(v_assessment.program_id) then raise exception 'Assessment or enrollment not found'; end if;
  if p_included then
    insert into public.enrollment_assessments(assessment_id,enrollment_id,program_id,adjustment_kobo,note) values(v_assessment.id,v_enrollment.id,v_assessment.program_id,p_adjustment_kobo,trim(coalesce(p_note,'')))
    on conflict(assessment_id,enrollment_id) do update set adjustment_kobo=excluded.adjustment_kobo,note=excluded.note,updated_at=now();
  else
    if exists(select 1 from public.payments where enrollment_id=p_enrollment_id and assessment_id=p_assessment_id) then raise exception 'Cannot remove an assessment with payment records'; end if;
    delete from public.enrollment_assessments where assessment_id=p_assessment_id and enrollment_id=p_enrollment_id;
  end if;
end; $$;
revoke all on function public.set_enrollment_assessment(uuid,uuid,boolean,bigint,text) from public,anon;
grant execute on function public.set_enrollment_assessment(uuid,uuid,boolean,bigint,text) to authenticated;

create or replace function public.submit_assessment_payment(p_enrollment_id uuid,p_assessment_id uuid,p_amount_kobo bigint,p_paid_at date,p_reference text,p_proof_path text) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.enrollments; a public.financial_assessments; payment_id uuid; program uuid;
begin
  select * into e from public.enrollments where id=p_enrollment_id;
  select fa.* into a from public.financial_assessments fa join public.enrollment_assessments ea on ea.assessment_id=fa.id and ea.enrollment_id=p_enrollment_id where fa.id=p_assessment_id and fa.active;
  if e.id is null or a.id is null or a.period_id<>e.period_id or not public.can_access_household(e.household_id) then raise exception 'Assessment not found for this subscriber'; end if;
  if p_amount_kobo<=0 then raise exception 'Payment amount must be positive'; end if;
  if p_proof_path is null or p_proof_path not like p_enrollment_id::text||'/%' then raise exception 'A valid payment proof is required'; end if;
  insert into public.payments(enrollment_id,assessment_id,amount_kobo,paid_at,reference,proof_path,submitted_by) values(e.id,a.id,p_amount_kobo,p_paid_at,trim(p_reference),p_proof_path,auth.uid()) returning id into payment_id;
  select h.program_id into program from public.households h where h.id=e.household_id;
  insert into public.notification_outbox(program_id,event_type,payload) values(program,'assessment_payment.submitted',jsonb_build_object('payment_id',payment_id,'enrollment_id',e.id,'assessment_id',a.id,'amount_kobo',p_amount_kobo));
  return payment_id;
end; $$;
revoke all on function public.submit_assessment_payment(uuid,uuid,bigint,date,text,text) from public,anon;
grant execute on function public.submit_assessment_payment(uuid,uuid,bigint,date,text,text) to authenticated;

drop trigger if exists audit_financial_assessments on public.financial_assessments;
create trigger audit_financial_assessments after insert or update or delete on public.financial_assessments for each row execute function public.audit_row_change();
drop trigger if exists audit_enrollment_assessments on public.enrollment_assessments;
create trigger audit_enrollment_assessments after insert or update or delete on public.enrollment_assessments for each row execute function public.audit_row_change();

-- The finalized 2026 premium uses only 1% NHIS and 2% program administration.
update public.enrollment_periods set nhis_fee_basis_points=100,program_fee_basis_points=200 where coverage_year=2026;
update public.plan_offerings po set nhis_fee_basis_points=100,reserve_fee_basis_points=200,total_fee_basis_points=300 from public.enrollment_periods ep where ep.id=po.period_id and ep.coverage_year=2026;
update public.enrollments e set nhis_fee_kobo=round(e.premium_kobo*.01),reserve_fee_kobo=round(e.premium_kobo*.02),subscriber_total_kobo=e.premium_kobo+round(e.premium_kobo*.01)+round(e.premium_kobo*.02) from public.enrollment_periods ep where ep.id=e.period_id and ep.coverage_year=2026;
