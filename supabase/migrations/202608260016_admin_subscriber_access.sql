create or replace function public.get_admin_subscriber_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_program uuid;
begin
  select program_id into v_program
  from public.program_memberships
  where user_id=auth.uid() and active and role in('admin','owner')
  limit 1;
  if v_program is null then raise exception 'Administrator access required'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId',account.user_id,
      'displayName',account.display_name,
      'accountEmail',account.email,
      'householdCount',account.household_count,
      'principalNames',account.principal_names
    ) order by account.display_name,account.email)
    from (
      select p.id user_id,p.display_name,p.email,
        (select count(*) from public.account_households ah join public.households h on h.id=ah.household_id where ah.user_id=p.id and h.program_id=v_program) household_count,
        coalesce((select jsonb_agg(names.name order by names.name) from (
          select distinct concat_ws(' ',person.first_name,nullif(person.middle_name,''),person.surname) name
          from public.account_households ah
          join public.households h on h.id=ah.household_id and h.program_id=v_program
          join public.people person on person.household_id=h.id and person.member_type='Member'
          where ah.user_id=p.id
        ) names),'[]'::jsonb) principal_names
      from public.program_memberships membership
      join public.profiles p on p.id=membership.user_id
      where membership.program_id=v_program and membership.active and membership.role='subscriber'
        and exists(select 1 from public.account_households ah join public.households h on h.id=ah.household_id where ah.user_id=p.id and h.program_id=v_program)
    ) account
  ),'[]'::jsonb);
end; $$;

revoke all on function public.get_admin_subscriber_accounts() from public,anon;
grant execute on function public.get_admin_subscriber_accounts() to authenticated;
