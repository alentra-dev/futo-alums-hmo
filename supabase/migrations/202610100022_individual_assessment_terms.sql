-- Assignment terms are snapshots. Program defaults never rewrite existing obligations.
-- Before production deployment, verify shared defaults against configuration audit history.
begin;
lock table public.financial_assessments in share mode;
alter table public.enrollment_assessments
  add column amount_kobo bigint,
  add column fee_portion_kobo bigint,
  add column future_credit_kobo bigint,
  add column credit_year integer;

update public.enrollment_assessments ea set
  amount_kobo=a.amount_kobo, fee_portion_kobo=a.fee_portion_kobo,
  future_credit_kobo=a.future_credit_kobo, credit_year=a.credit_year
from public.financial_assessments a where a.id=ea.assessment_id;

alter table public.enrollment_assessments
  alter column amount_kobo set not null,
  alter column fee_portion_kobo set not null,
  alter column future_credit_kobo set not null,
  alter column credit_year set not null,
  add constraint enrollment_assessment_terms_valid check (
    amount_kobo>=0 and fee_portion_kobo>=0 and future_credit_kobo>=0
    and fee_portion_kobo+future_credit_kobo=amount_kobo
    and amount_kobo+adjustment_kobo>=0 and credit_year between 2020 and 2100
  );

-- Preserve legacy inclusion RPCs and operational inserts: snapshot defaults on first insert.
-- On updates, snapshots stay unchanged unless explicit individual terms are supplied.
create or replace function public.validate_enrollment_assessment_terms() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.financial_assessments; e public.enrollments; v_year integer;
begin
  select * into a from public.financial_assessments where id=new.assessment_id for share;
  select * into e from public.enrollments where id=new.enrollment_id;
  if a.id is null or e.id is null or a.period_id<>e.period_id or new.program_id<>a.program_id then
    raise exception 'Assessment and enrollment must belong to the same program and period';
  end if;
  select coverage_year into v_year from public.enrollment_periods where id=e.period_id;
  if tg_op='INSERT' and new.amount_kobo is null and new.fee_portion_kobo is null
    and new.future_credit_kobo is null and new.credit_year is null then
    new.amount_kobo:=a.amount_kobo; new.fee_portion_kobo:=a.fee_portion_kobo;
    new.future_credit_kobo:=a.future_credit_kobo; new.credit_year:=a.credit_year;
  end if;
  if new.credit_year<=v_year then raise exception 'Credit year must follow the enrollment year'; end if;
  return new;
end; $$;
revoke all on function public.validate_enrollment_assessment_terms() from public,anon,authenticated;
create trigger validate_enrollment_assessment_terms before insert or update
on public.enrollment_assessments for each row execute function public.validate_enrollment_assessment_terms();

create or replace function public.set_enrollment_assessment_terms(
  p_assessment_id uuid, p_enrollment_id uuid, p_amount_kobo bigint,
  p_fee_portion_kobo bigint, p_future_credit_kobo bigint, p_credit_year integer,
  p_adjustment_kobo bigint, p_note text
) returns void language plpgsql security definer set search_path='' as $$
declare a public.financial_assessments; e public.enrollments;
begin
  select * into a from public.financial_assessments where id=p_assessment_id for share;
  select * into e from public.enrollments where id=p_enrollment_id;
  if a.id is null or e.id is null or a.period_id<>e.period_id or not public.is_program_admin(a.program_id) then
    raise exception 'Administrator access to this assessment and enrollment required';
  end if;
  if p_amount_kobo is null or p_fee_portion_kobo is null or p_future_credit_kobo is null
    or p_credit_year is null or p_adjustment_kobo is null then raise exception 'All individual terms are required'; end if;
  if trim(coalesce(p_note,''))='' then raise exception 'A reason for the individual assessment terms is required'; end if;
  insert into public.enrollment_assessments(
    assessment_id,enrollment_id,program_id,amount_kobo,fee_portion_kobo,future_credit_kobo,credit_year,adjustment_kobo,note
  ) values(a.id,e.id,a.program_id,p_amount_kobo,p_fee_portion_kobo,p_future_credit_kobo,p_credit_year,p_adjustment_kobo,trim(p_note))
  on conflict(assessment_id,enrollment_id) do update set
    amount_kobo=excluded.amount_kobo,fee_portion_kobo=excluded.fee_portion_kobo,
    future_credit_kobo=excluded.future_credit_kobo,credit_year=excluded.credit_year,
    adjustment_kobo=excluded.adjustment_kobo,note=excluded.note,updated_at=now();
end; $$;
revoke all on function public.set_enrollment_assessment_terms(uuid,uuid,bigint,bigint,bigint,integer,bigint,text) from public,anon;
grant execute on function public.set_enrollment_assessment_terms(uuid,uuid,bigint,bigint,bigint,integer,bigint,text) to authenticated;

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
      'adjustmentKobo',ea.adjustment_kobo,'note',ea.note,
      'amountKobo',ea.amount_kobo,'feePortionKobo',ea.fee_portion_kobo,
      'futureCreditKobo',ea.future_credit_kobo,'creditYear',ea.credit_year
    )) from public.enrollment_assessments ea join public.enrollments e on e.id=ea.enrollment_id
      where e.period_id=p_period_id and ea.program_id=v_program and (public.is_program_admin(v_program) or public.can_access_household(e.household_id))),'[]'::jsonb),
    'paymentLinks',coalesce((select jsonb_agg(jsonb_build_object('paymentId',p.id,'assessmentId',p.assessment_id))
      from public.payments p join public.enrollments e on e.id=p.enrollment_id
      where e.period_id=p_period_id and p.assessment_id is not null
        and (public.is_program_admin(v_program) or public.can_access_household(e.household_id))),'[]'::jsonb)
  );
end; $$;
revoke all on function public.get_financial_workspace(uuid) from public,anon;
grant execute on function public.get_financial_workspace(uuid) to authenticated;

commit;
