import { useEffect, useState } from 'react';
import '../../access.css';
import { Search, ShieldCheck, UserCog } from 'lucide-react';
import { isDemoMode, supabase } from '../../lib/supabase';
import { Button, EmptyState, PageHeader, StatusBadge } from '../../components/ui';

interface ProgramMember { userId: string; displayName: string; email: string; role: 'subscriber' | 'admin' | 'owner'; active: boolean }

export function AdminAccessPage() {
  const [members, setMembers] = useState<ProgramMember[]>(isDemoMode ? [{ userId: 'owner-demo', displayName: 'Program Owner', email: 'owner@example.com', role: 'owner', active: true }, { userId: 'admin-demo-1', displayName: 'Program Administrator', email: 'admin.one@example.com', role: 'admin', active: true }, { userId: 'member-demo', displayName: 'Ada Okafor', email: 'ada.okafor@example.com', role: 'subscriber', active: true }] : []);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => { if (!supabase || isDemoMode) return; const { data, error } = await supabase.rpc('get_program_members'); if (error) throw error; setMembers((data ?? []) as ProgramMember[]); };
  useEffect(() => { void load(); }, []);
  const changeRole = async (member: ProgramMember, role: 'subscriber' | 'admin') => { if (isDemoMode) { setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item)); return; } if (!supabase) return; setBusy(member.userId); const { error } = await supabase.rpc('set_program_member_role', { p_user_id: member.userId, p_role: role, p_active: true }); setBusy(''); if (error) window.alert(error.message); else await load(); };
  const visible = members.filter((member) => `${member.displayName} ${member.email}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow="Owner settings" title="Administrator access" description="Promote an existing program member or return an administrator to subscriber access." actions={<span className="secure-label"><ShieldCheck size={17} />Owner only</span>} /><div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search members" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" /></div><span>{visible.length} accounts</span></div>{visible.length ? <div className="access-admin-list">{visible.map((member) => <article className="panel" key={member.userId}><span className="person-dot"><UserCog size={16} /></span><div><strong>{member.displayName}</strong><small>{member.email}</small></div><StatusBadge status={member.role} />{member.role === 'owner' ? <span className="owner-lock">Primary owner</span> : member.role === 'admin' ? <Button variant="danger" disabled={busy === member.userId} onClick={() => void changeRole(member, 'subscriber')}>Remove admin</Button> : <Button variant="secondary" disabled={busy === member.userId} onClick={() => void changeRole(member, 'admin')}>Make admin</Button>}</article>)}</div> : <EmptyState icon={<UserCog size={28} />} title="No matching accounts" body="Only existing program member accounts can be promoted." />}</>;
}
