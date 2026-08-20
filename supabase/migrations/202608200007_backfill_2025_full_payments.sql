insert into public.payments (
  enrollment_id,
  amount_kobo,
  paid_at,
  reference,
  status,
  reviewed_at
)
select
  e.id,
  e.subscriber_total_kobo,
  ep.ends_at::date,
  '2025 historical enrollment - paid in full',
  'verified',
  ep.closed_at
from public.enrollments e
join public.enrollment_periods ep on ep.id = e.period_id
join public.programs p on p.id = ep.program_id
where p.slug = 'futo-alums-hmo'
  and ep.coverage_year = 2025
  and e.subscriber_total_kobo > 0
  and not exists (
    select 1
    from public.payments pay
    where pay.enrollment_id = e.id
  );
