create table public.portal_sign_in_days (
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (program_id, user_id, activity_date)
);

create index portal_sign_in_days_recent_idx
  on public.portal_sign_in_days(program_id, activity_date desc, last_seen_at desc);

alter table public.portal_sign_in_days enable row level security;

create policy portal_sign_in_days_admin_read
  on public.portal_sign_in_days for select to authenticated
  using (public.is_program_admin(program_id));

grant select on public.portal_sign_in_days to authenticated;

create or replace function public.record_portal_sign_in() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_program uuid;
  v_timezone text;
  v_activity_date date;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select pm.program_id, coalesce(p.timezone, 'Africa/Lagos')
    into v_program, v_timezone
  from public.program_memberships pm
  join public.programs p on p.id=pm.program_id
  where pm.user_id=v_user and pm.active
  order by case pm.role when 'owner' then 1 when 'admin' then 2 else 3 end
  limit 1;

  if v_program is null then
    select a.program_id, coalesce(p.timezone, 'Africa/Lagos')
      into v_program, v_timezone
    from public.subscriber_applications a
    join public.programs p on p.id=a.program_id
    where a.user_id=v_user
    order by a.created_at desc
    limit 1;
  end if;

  if v_program is null then
    select p.id, coalesce(p.timezone, 'Africa/Lagos') into v_program, v_timezone
    from public.programs p where p.slug='futo-alums-hmo';
  end if;
  if v_program is null then return; end if;

  v_activity_date := (now() at time zone v_timezone)::date;
  insert into public.portal_sign_in_days(program_id,user_id,activity_date)
  values(v_program,v_user,v_activity_date)
  on conflict(program_id,user_id,activity_date) do update
    set last_seen_at=now();

  delete from public.portal_sign_in_days
  where program_id=v_program and activity_date<(v_activity_date-interval '7 years')::date;
end; $$;

create or replace function public.get_admin_portal_activity(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_program uuid;
  v_timezone text;
  v_today date;
  v_days integer:=least(greatest(coalesce(p_days,30),7),365);
begin
  select pm.program_id,coalesce(p.timezone,'Africa/Lagos') into v_program,v_timezone
  from public.program_memberships pm join public.programs p on p.id=pm.program_id
  where pm.user_id=v_user and pm.active and pm.role in('admin','owner')
  order by case pm.role when 'owner' then 1 else 2 end limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;
  v_today := (now() at time zone v_timezone)::date;

  return jsonb_build_object(
    'timezone',v_timezone,
    'today',v_today,
    'todayUnique',(select count(*) from public.portal_sign_in_days d where d.program_id=v_program and d.activity_date=v_today),
    'last7DaysUnique',(select count(distinct d.user_id) from public.portal_sign_in_days d where d.program_id=v_program and d.activity_date between v_today-6 and v_today),
    'last30DaysUnique',(select count(distinct d.user_id) from public.portal_sign_in_days d where d.program_id=v_program and d.activity_date between v_today-29 and v_today),
    'returningAccounts',(select count(*) from (select d.user_id from public.portal_sign_in_days d where d.program_id=v_program and d.activity_date between v_today-29 and v_today group by d.user_id having count(*)>1) returning_users),
    'daily',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',to_char(series.day::date,'YYYY-MM-DD'),
        'uniqueAccounts',coalesce(counts.unique_accounts,0),
        'subscriberLinked',coalesce(counts.subscriber_linked,0),
        'adminOnly',coalesce(counts.admin_only,0),
        'applicants',coalesce(counts.applicants,0)
      ) order by series.day),'[]'::jsonb)
      from generate_series(v_today-(v_days-1),v_today,interval '1 day') series(day)
      left join lateral (
        select count(*) unique_accounts,
          count(*) filter(where exists(select 1 from public.account_households ah where ah.user_id=d.user_id)) subscriber_linked,
          count(*) filter(where pm.role in('admin','owner') and not exists(select 1 from public.account_households ah where ah.user_id=d.user_id)) admin_only,
          count(*) filter(where not exists(select 1 from public.account_households ah where ah.user_id=d.user_id) and (pm.role is null or pm.role='subscriber')) applicants
        from public.portal_sign_in_days d
        left join public.program_memberships pm on pm.program_id=d.program_id and pm.user_id=d.user_id and pm.active
        where d.program_id=v_program and d.activity_date=series.day::date
      ) counts on true
    ),
    'recentAccounts',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId',recent.user_id,'displayName',recent.display_name,'email',recent.email,
        'accessType',recent.access_type,'activeDays',recent.active_days,
        'lastActiveDate',recent.last_active_date,'lastSeenAt',recent.last_seen_at
      ) order by recent.last_seen_at desc),'[]'::jsonb)
      from (
        select d.user_id,pr.display_name,pr.email,
          case when exists(select 1 from public.account_households ah where ah.user_id=d.user_id) then 'subscriber_linked'
               when pm.role in('admin','owner') then 'admin_only' else 'applicant' end access_type,
          count(*) active_days,max(d.activity_date) last_active_date,max(d.last_seen_at) last_seen_at
        from public.portal_sign_in_days d
        join public.profiles pr on pr.id=d.user_id
        left join public.program_memberships pm on pm.program_id=d.program_id and pm.user_id=d.user_id and pm.active
        where d.program_id=v_program and d.activity_date between v_today-(v_days-1) and v_today
        group by d.user_id,pr.display_name,pr.email,pm.role
        order by max(d.last_seen_at) desc limit 50
      ) recent
    )
  );
end; $$;

revoke all on function public.record_portal_sign_in() from public,anon;
revoke all on function public.get_admin_portal_activity(integer) from public,anon;
grant execute on function public.record_portal_sign_in() to authenticated;
grant execute on function public.get_admin_portal_activity(integer) to authenticated;
