import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Search, Users } from 'lucide-react';
import { Button, EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { defaultAdminPeriod } from '../../lib/enrollmentPeriods';
import { downloadAdminFullWorkbook, downloadAvonWorkbook, downloadSummaryWorkbook } from '../../lib/export';
import { fullName } from '../../lib/format';
import { formatNaira } from '../../lib/money';
import { isDemoMode, supabase } from '../../lib/supabase';
import type { EnrollmentPeriod, EnrollmentPeriodSnapshot, ProgramSnapshot } from '../../lib/types';

export function AdminEnrolleesPage() {
  const { snapshot } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [periods, setPeriods] = useState<EnrollmentPeriod[]>([snapshot!.period]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(snapshot!.period.id);
  const [periodData, setPeriodData] = useState<EnrollmentPeriodSnapshot>({
    period: snapshot!.period,
    plans: snapshot!.plans,
    enrollments: snapshot!.enrollments,
    payments: snapshot!.payments,
  });
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState('');

  useEffect(() => {
    if (isDemoMode || !supabase) return;
    let active = true;
    void supabase.rpc('get_admin_enrollment_periods').then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setPeriodError(error.message);
        return;
      }
      const available = (data ?? []) as EnrollmentPeriod[];
      const initial = defaultAdminPeriod(available);
      setPeriods(available);
      if (initial) {
        setSelectedPeriodId((current) => {
          if (initial.id === current) return current;
          setLoadingPeriod(true);
          return initial.id;
        });
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isDemoMode || !supabase) return;
    let active = true;
    setLoadingPeriod(true);
    setPeriodError('');
    void supabase.rpc('get_admin_enrollment_period', { p_period_id: selectedPeriodId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setPeriodError(error.message);
      else setPeriodData(data as EnrollmentPeriodSnapshot);
      setLoadingPeriod(false);
    });
    return () => { active = false; };
  }, [selectedPeriodId]);

  const reportSnapshot = useMemo(() => ({ ...snapshot!, ...periodData }) as ProgramSnapshot, [snapshot, periodData]);
  const rows = useMemo(() => periodData.enrollments.filter((item) => {
    const matchesQuery = fullName(item.principal).toLowerCase().includes(query.toLowerCase()) || item.hospital.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'all' || item.status === status);
  }), [periodData, query, status]);

  const choosePeriod = (periodId: string) => {
    if (periodId === selectedPeriodId) return;
    setLoadingPeriod(true);
    setSelectedPeriodId(periodId);
  };

  const actions = <div className="button-row">
    <Button variant="secondary" disabled={loadingPeriod} icon={<Download size={18} />} onClick={() => void downloadSummaryWorkbook(reportSnapshot)}>Summary</Button>
    <Button variant="secondary" disabled={loadingPeriod} icon={<FileSpreadsheet size={18} />} onClick={() => void downloadAdminFullWorkbook(reportSnapshot)}>Admin full export</Button>
    <Button disabled={loadingPeriod} icon={<FileSpreadsheet size={18} />} onClick={() => void downloadAvonWorkbook(reportSnapshot)}>AVON export</Button>
  </div>;

  return <>
    <PageHeader eyebrow="Administration" title="Enrollees" description="Principal-level enrollment and payment summary." actions={actions} />
    <div className="filter-bar">
      <label className="filter-select"><span>Enrollment year</span><select aria-label="Enrollment year" value={selectedPeriodId} onChange={(event) => choosePeriod(event.target.value)}>{periods.map((period) => <option key={period.id} value={period.id}>{period.year} ({period.status})</option>)}</select></label>
      <div className="input-icon"><Search size={18} /><input aria-label="Search enrollees" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search member or hospital" /></div>
      <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="submitted">Submitted</option><option value="closed">Closed</option></select>
      <span>{loadingPeriod ? 'Loading...' : `${rows.length} records`}</span>
    </div>
    {periodError && <p className="form-error" role="alert">{periodError}</p>}
    {!loadingPeriod && (rows.length ? <div className="data-table admin-table"><div className="data-table__head"><span>Member</span><span>Plan</span><span>Plan type</span><span>Household</span><span>Total payable</span><span>Hospital</span><span>Status</span></div>{rows.map((enrollment) => <div className="data-table__row" key={enrollment.id}><span data-label="Member"><strong>{fullName(enrollment.principal)}</strong><small>{enrollment.principal.email}</small></span><span data-label="Plan">{periodData.plans.find((plan) => plan.id === enrollment.planId)?.name ?? 'Not selected'}</span><span data-label="Plan type">{enrollment.category === 'family' ? 'Family' : 'Individual'}</span><span data-label="Household">{enrollment.dependents.length + 1}</span><strong data-label="Total payable">{formatNaira(enrollment.totalKobo)}</strong><span data-label="Hospital">{enrollment.hospital}</span><span data-label="Status"><StatusBadge status={enrollment.status} /></span></div>)}</div> : <EmptyState icon={<Users size={29} />} title="No matching enrollees" body="Adjust the enrollment year, search, or status filter." />)}
  </>;
}
