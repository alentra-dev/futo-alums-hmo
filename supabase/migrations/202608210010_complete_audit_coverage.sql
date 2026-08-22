create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity text := coalesce(row_data->>'id',row_data->>'person_id',row_data->>'user_id','unknown');
  program uuid;
  headers jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
begin
  program:=nullif(row_data->>'program_id','')::uuid;
  if tg_table_name='programs' then program:=nullif(row_data->>'id','')::uuid; end if;
  if program is null and tg_table_name in('enrollments','people') then select h.program_id into program from public.households h where h.id=nullif(row_data->>'household_id','')::uuid; end if;
  if program is null and tg_table_name='enrollment_people' then select h.program_id into program from public.enrollments e join public.households h on h.id=e.household_id where e.id=nullif(row_data->>'enrollment_id','')::uuid; end if;
  if program is null and tg_table_name='payments' then select h.program_id into program from public.enrollments e join public.households h on h.id=e.household_id where e.id=nullif(row_data->>'enrollment_id','')::uuid; end if;
  if program is null and tg_table_name='plan_offerings' then select p.program_id into program from public.enrollment_periods p where p.id=nullif(row_data->>'period_id','')::uuid; end if;
  insert into public.audit_events(program_id,actor_user_id,action,entity_type,entity_id,old_data,new_data,request_id)
  values(program,auth.uid(),lower(tg_table_name)||'.'||lower(tg_op),tg_table_name,entity,case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end,headers->>'x-request-id');
  return coalesce(new,old);
end; $$;

drop trigger if exists audit_enrollment_people on public.enrollment_people;
create trigger audit_enrollment_people after insert or update or delete on public.enrollment_people for each row execute function public.audit_row_change();

drop trigger if exists audit_programs on public.programs;
create trigger audit_programs after update on public.programs for each row execute function public.audit_row_change();
