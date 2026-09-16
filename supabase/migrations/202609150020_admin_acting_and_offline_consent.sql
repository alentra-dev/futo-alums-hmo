-- Administrators complete enrollment tasks for subscribers who cannot reach the portal.
--
-- Read and write access already works: get_portal_snapshot selects enrollments through
-- can_access_household, which admits program administrators for every household, and the
-- subscriber mutation RPCs gate on the same helper. audit_row_change records auth.uid(),
-- so an administrator acting for a subscriber is already attributed to the administrator
-- and never to the subscriber who never signed in.
--
-- What is missing is consent provenance. consented_at alone cannot distinguish consent a
-- subscriber gave in the portal from consent an administrator received offline and entered
-- on their behalf, and the privacy notice depends on that distinction being recorded.

alter table public.enrollments add column if not exists consent_channel text;
alter table public.enrollments add column if not exists consent_recorded_by uuid references public.profiles(id);
alter table public.enrollments add column if not exists consent_evidence_note text;
alter table public.enrollments add column if not exists consent_recorded_at timestamptz;

do $$ begin
  alter table public.enrollments add constraint enrollments_consent_channel_check
    check (consent_channel is null or consent_channel in ('portal','offline'));
exception when duplicate_object then null; end $$;

-- Existing consent predates this column and was all captured in the portal.
update public.enrollments set consent_channel = 'portal'
  where consented_at is not null and consent_channel is null;

-- Consent provenance must follow consented_at no matter which RPC writes it, so that
-- update_enrollment_details clearing consent also clears a stale offline attribution.
create or replace function public.sync_consent_provenance() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_channel text := nullif(current_setting('app.consent_channel', true), '');
begin
  if new.consented_at is null then
    new.consent_channel := null;
    new.consent_recorded_by := null;
    new.consent_evidence_note := null;
    new.consent_recorded_at := null;
  elsif new.consented_at is distinct from old.consented_at then
    if coalesce(v_channel, 'portal') = 'offline' then
      new.consent_channel := 'offline';
    else
      new.consent_channel := 'portal';
      new.consent_evidence_note := null;
    end if;
    new.consent_recorded_by := auth.uid();
    new.consent_recorded_at := now();
  end if;
  return new;
end; $$;

drop trigger if exists enrollments_consent_provenance on public.enrollments;
create trigger enrollments_consent_provenance before update on public.enrollments
  for each row execute function public.sync_consent_provenance();

-- An administrator records consent that the subscriber gave outside the portal.
create or replace function public.record_offline_consent(p_enrollment_id uuid, p_note text, p_consented_at timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments; v_program uuid; v_principal text;
begin
  select * into e from public.enrollments where id = p_enrollment_id for update;
  if e.id is null then raise exception 'Enrollment not found'; end if;
  select h.program_id into v_program from public.households h where h.id = e.household_id;
  if not public.is_program_admin(v_program) then
    raise exception 'Only a program administrator can record consent received outside the portal';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Record how the subscriber provided consent';
  end if;
  if p_consented_at > now() then
    raise exception 'Consent date cannot be in the future';
  end if;

  -- Read by sync_consent_provenance; transaction-local so it cannot leak to another statement.
  perform set_config('app.consent_channel', 'offline', true);
  update public.enrollments
    set consented_at = p_consented_at,
        consent_policy_version = '2026-01',
        consent_evidence_note = trim(p_note),
        updated_at = now()
    where id = e.id;

  select concat_ws(' ', x.person_data->>'firstName', nullif(x.person_data->>'middleName',''), x.person_data->>'surname')
    into v_principal
    from public.enrollment_people x where x.enrollment_id = e.id and x.member_type = 'Member' limit 1;

  insert into public.audit_events(program_id, actor_user_id, action, entity_type, entity_id, new_data)
  values (v_program, auth.uid(), 'enrollment.consent_recorded_offline', 'enrollments', e.id::text,
    jsonb_build_object('principal', coalesce(v_principal, 'subscriber'), 'note', trim(p_note), 'consentedAt', p_consented_at));
end; $$;

revoke all on function public.record_offline_consent(uuid, text, timestamptz) from public, anon;
grant execute on function public.record_offline_consent(uuid, text, timestamptz) to authenticated;

-- Side-car read, following get_financial_workspace rather than rewriting get_portal_snapshot.
create or replace function public.get_consent_records(p_period_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'enrollmentId', e.id,
    'consentedAt', e.consented_at,
    'channel', coalesce(e.consent_channel, 'portal'),
    'note', e.consent_evidence_note,
    'recordedAt', e.consent_recorded_at,
    'recordedBy', coalesce(pr.display_name, pr.email)
  ) order by e.consent_recorded_at desc nulls last), '[]'::jsonb)
  from public.enrollments e
  left join public.profiles pr on pr.id = e.consent_recorded_by
  where e.period_id = p_period_id
    and e.consented_at is not null
    and public.can_access_household(e.household_id);
$$;

revoke all on function public.get_consent_records(uuid) from public, anon;
grant execute on function public.get_consent_records(uuid) to authenticated;
