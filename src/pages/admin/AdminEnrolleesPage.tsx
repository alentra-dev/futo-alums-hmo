import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Search, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { downloadAvonWorkbook, downloadSummaryWorkbook } from '../../lib/export';
import { fullName } from '../../lib/format';
import { formatNaira } from '../../lib/money';
import { Button, EmptyState, PageHeader, StatusBadge } from '../../components/ui';

export function AdminEnrolleesPage() {
  const { snapshot } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const rows = useMemo(() => snapshot!.enrollments.filter((item) => {
    const matchesQuery = fullName(item.principal).toLowerCase().includes(query.toLowerCase()) || item.hospital.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || item.status === status);
  }), [snapshot, query, status]);

  return <>
    <PageHeader eyebrow="Administration" title="Enrollees" description="Principal-level enrollment and payment summary." actions={<div className="button-row"><Button variant="secondary" icon={<Download size={18} />} onClick={() => void downloadSummaryWorkbook(snapshot!)}>Summary</Button><Button icon={<FileSpreadsheet size={18} />} onClick={() => void downloadAvonWorkbook(snapshot!)}>AVON export</Button></div>} />
    <div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search enrollees" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search member or hospital" /></div><select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="closed">Closed</option></select><span>{rows.length} records</span></div>
    {rows.length ? <div className="data-table admin-table"><div className="data-table__head"><span>Member</span><span>Plan</span><span>Household</span><span>Total payable</span><span>Hospital</span><span>Status</span></div>{rows.map((enrollment) => <div className="data-table__row" key={enrollment.id}><span data-label="Member"><strong>{fullName(enrollment.principal)}</strong><small>{enrollment.principal.email}</small></span><span data-label="Plan">{snapshot!.plans.find((plan) => plan.id === enrollment.planId)?.name ?? 'Not selected'}</span><span data-label="Household">{enrollment.dependents.length + 1}</span><strong data-label="Total payable">{formatNaira(enrollment.totalKobo)}</strong><span data-label="Hospital">{enrollment.hospital}</span><span data-label="Status"><StatusBadge status={enrollment.status} /></span></div>)}</div> : <EmptyState icon={<Users size={29} />} title="No matching enrollees" body="Adjust the search or status filter." />}
  </>;
}
