alter table public.enrollment_periods
  add column transaction_tax_basis_points integer not null default 1500
  check(transaction_tax_basis_points between 0 and 10000);

update public.enrollment_periods
set transaction_tax_basis_points=case when coverage_year>=2026 then 1500 else 0 end;

alter table public.enrollments
  add column transaction_tax_fee_kobo bigint not null default 0
  check(transaction_tax_fee_kobo>=0);

do $$
declare v_constraint text;
begin
  select c.conname into v_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid='public.enrollments'::regclass
    and c.contype='c'
    and pg_catalog.pg_get_constraintdef(c.oid) like '%subscriber_total_kobo%premium_kobo%'
  limit 1;
  if v_constraint is not null then
    execute format('alter table public.enrollments drop constraint %I',v_constraint);
  end if;
end; $$;

alter table public.enrollments add constraint enrollment_total_matches_components
  check(subscriber_total_kobo=premium_kobo+nhis_fee_kobo+reserve_fee_kobo+transaction_tax_fee_kobo);

create or replace function public.apply_enrollment_transaction_tax() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_rate integer:=0; v_subtotal bigint;
begin
  select ep.transaction_tax_basis_points into v_rate
  from public.enrollment_periods ep where ep.id=new.period_id;
  v_subtotal:=new.premium_kobo+new.nhis_fee_kobo+new.reserve_fee_kobo;
  new.transaction_tax_fee_kobo:=round(v_subtotal*coalesce(v_rate,0)/10000.0);
  new.subscriber_total_kobo:=v_subtotal+new.transaction_tax_fee_kobo;
  return new;
end; $$;

drop trigger if exists apply_enrollment_transaction_tax on public.enrollments;
create trigger apply_enrollment_transaction_tax
before insert or update of period_id,premium_kobo,nhis_fee_kobo,reserve_fee_kobo,subscriber_total_kobo
on public.enrollments for each row execute function public.apply_enrollment_transaction_tax();

update public.enrollments e
set subscriber_total_kobo=e.subscriber_total_kobo
from public.enrollment_periods ep
where ep.id=e.period_id and ep.coverage_year>=2026;
