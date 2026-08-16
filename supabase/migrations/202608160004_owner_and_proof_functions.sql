create or replace function public.get_program_members() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare program uuid;
begin
  select program_id into program from public.program_memberships where user_id=auth.uid() and active and role='owner' limit 1;
  if program is null then raise exception 'Owner access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId',p.id,'displayName',p.display_name,'email',p.email,'role',m.role,'active',m.active) order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end,p.display_name) from public.program_memberships m join public.profiles p on p.id=m.user_id where m.program_id=program),'[]'::jsonb);
end; $$;

create or replace function public.set_program_member_role(p_user_id uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path = '' as $$
declare program uuid; current_role public.program_role;
begin
  select program_id into program from public.program_memberships where user_id=auth.uid() and active and role='owner' limit 1;
  if program is null then raise exception 'Owner access required'; end if;
  if p_role not in ('subscriber','admin','owner') then raise exception 'Invalid role'; end if;
  select role into current_role from public.program_memberships where program_id=program and user_id=p_user_id;
  if current_role is null then raise exception 'Program member not found'; end if;
  if p_user_id=auth.uid() and (p_role<>'owner' or not p_active) then raise exception 'Transfer ownership before changing your own owner access'; end if;
  update public.program_memberships set role=p_role::public.program_role,active=p_active where program_id=program and user_id=p_user_id;
end; $$;

create or replace function public.get_payment_proof_path(p_payment_id uuid) returns text language plpgsql stable security definer set search_path = '' as $$
declare proof text; program uuid;
begin
  select p.proof_path,h.program_id into proof,program from public.payments p join public.enrollments e on e.id=p.enrollment_id join public.households h on h.id=e.household_id where p.id=p_payment_id;
  if program is null or not public.is_program_admin(program) then raise exception 'Administrator access required'; end if;
  return proof;
end; $$;

revoke all on function public.get_program_members() from public,anon;
revoke all on function public.set_program_member_role(uuid,text,boolean) from public,anon;
revoke all on function public.get_payment_proof_path(uuid) from public,anon;
grant execute on function public.get_program_members() to authenticated;
grant execute on function public.set_program_member_role(uuid,text,boolean) to authenticated;
grant execute on function public.get_payment_proof_path(uuid) to authenticated;
