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
  const [error, setError] = useState('');
  const load = async () => { if (!supabase || isDemoMode) return; const { data, error: loadError } = await supabase.rpc('get_program_members'); if (loadError) throw loadError; setMembers((data ?? []) as ProgramMember[]); };
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load program members.')); }, []);
  const changeRole = async (member: ProgramMember, role: 'subscriber' | 'admin') => { if (!window.confirm(role === 'admin' ? `Grant ${member.displayName} full administrator access to every subscriber record?` : `Remove administrator access from ${member.displayName}?`)) return; if (isDemoMode) { setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item)); return; } if (!supabase) return; setBusy(member.userId); setError(''); const { error: roleError } = await supabase.rpc('set_program_member_role', { p_user_id: member.userId, p_role: role, p_active: true }); setBusy(''); if (roleError) setError(roleError.message); else await load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to reload program members.')); };
  const visible = members.filter((member) => `${member.displayName} ${member.email}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow="Owner settings" title="Administrator access" description="Promote an existing program member or return an administrator to subscriber access." actions={<span className="secure-label"><ShieldCheck size={17} />Owner only</span>} />{error && <p className="form-error admin-page-error" role="alert">{error}</p>}<div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search members" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" /></div><span>{visible.length} accounts</span></div>{visible.length ? <div className="access-admin-list">{visible.map((member) => <article className="panel" key={member.userId}><span className="person-dot"><UserCog size={16} /></span><div><strong>{member.displayName}</strong><small>{member.email}</small></div><StatusBadge status={member.role} />{member.role === 'owner' ? <span className="owner-lock">Primary owner</span> : member.role === 'admin' ? <Button variant="danger" disabled={busy === member.userId} onClick={() => void changeRole(member, 'subscriber')}>Remove admin</Button> : <Button variant="secondary" disabled={busy === member.userId} onClick={() => void changeRole(member, 'admin')}>Make admin</Button>}</article>)}</div> : <EmptyState icon={<UserCog size={28} />} title="No matching accounts" body="Only existing program member accounts can be promoted." />}</>;
}
