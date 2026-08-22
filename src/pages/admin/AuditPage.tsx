import { useMemo, useState } from 'react';
import { FileClock, Search, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDateTime } from '../../lib/format';
import { EmptyState, PageHeader } from '../../components/ui';

export function AuditPage() {
  const { snapshot } = useApp();
  const [query, setQuery] = useState('');
  const events = useMemo(() => snapshot!.auditEvents.filter((event) => [event.actorName, event.actorEmail, event.action, event.summary].join(' ').toLowerCase().includes(query.toLowerCase())), [snapshot, query]);
  return <><PageHeader eyebrow="Administration" title="Audit history" description="Append-only record of enrollment, payment, access, and configuration changes." actions={<span className="secure-label"><ShieldCheck size={17} />Tamper protected</span>} /><div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search audit history" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actor or activity" /></div><span>{events.length} events</span></div>{events.length ? <div className="audit-list">{events.map((event) => <article key={event.id}><span className="audit-icon"><FileClock size={18} /></span><div><strong>{event.summary}</strong><p><span>{event.actorName}</span> · {event.actorEmail} · {event.entityType}</p></div><div><code>{event.action}</code><time>{formatDateTime(event.createdAt, snapshot!.program.timezone)}</time></div></article>)}</div> : <EmptyState icon={<FileClock size={28} />} title="No matching audit events" body="Adjust the search to view other activity." />}</>;
}
