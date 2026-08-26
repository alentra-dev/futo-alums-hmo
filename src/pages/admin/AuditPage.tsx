import { useMemo, useState } from 'react';
import { FileClock, Search, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDateTime } from '../../lib/format';
import { EmptyState, PageHeader } from '../../components/ui';
import type { AuditEvent } from '../../lib/types';

const ACCESS_EMAIL_ACTION = 'subscriber.access_email_updated:';

function displayEvent(event: AuditEvent) {
  if (!event.action.startsWith(ACCESS_EMAIL_ACTION)) return { summary: event.summary, action: event.action };
  const subscriber = event.action.slice(ACCESS_EMAIL_ACTION.length) || 'subscriber';
  return { summary: `Changed subscriber account access email for ${subscriber}`, action: 'subscriber.access_email_updated' };
}

export function AuditPage() {
  const { snapshot } = useApp();
  const [query, setQuery] = useState('');
  const events = useMemo(() => snapshot!.auditEvents.filter((event) => {
    const display = displayEvent(event);
    return [event.actorName, event.actorEmail, display.action, display.summary].join(' ').toLowerCase().includes(query.toLowerCase());
  }), [snapshot, query]);
  return <><PageHeader eyebrow="Administration" title="Audit history" description="Append-only record of enrollment, payment, access, and configuration changes." actions={<span className="secure-label"><ShieldCheck size={17} />Tamper protected</span>} /><div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search audit history" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actor or activity" /></div><span>{events.length} events</span></div>{events.length ? <div className="audit-list">{events.map((event) => { const display = displayEvent(event); return <article key={event.id}><span className="audit-icon"><FileClock size={18} /></span><div><strong>{display.summary}</strong><p><span>{event.actorName}</span> · {event.actorEmail} · {event.entityType}</p></div><div><code>{display.action}</code><time>{formatDateTime(event.createdAt, snapshot!.program.timezone)}</time></div></article>; })}</div> : <EmptyState icon={<FileClock size={28} />} title="No matching audit events" body="Adjust the search to view other activity." />}</>;
}
