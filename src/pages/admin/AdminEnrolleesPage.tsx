import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileSpreadsheet, Search, SlidersHorizontal, UserCog, Users } from 'lucide-react';
import { Button, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { loadFinancialWorkspace, useApp } from '../../context/AppContext';
import { defaultAdminPeriod } from '../../lib/enrollmentPeriods';
import { downloadAdminFullWorkbook, downloadAvonWorkbook, downloadSummaryWorkbook } from '../../lib/export';
import { fullName } from '../../lib/format';
import { assessmentForEnrollment, enrollmentFinancialPosition } from '../../lib/financialPosition';
import { formatNaira, nairaToKobo } from '../../lib/money';
import { isDemoMode, supabase } from '../../lib/supabase';
import { loadSurchargeRates, withSurchargeRates } from '../../lib/surchargeRates';
import type { Enrollment, EnrollmentPeriod, EnrollmentPeriodSnapshot, ProgramSnapshot } from '../../lib/types';

export function AdminEnrolleesPage() {
  const { snapshot, actForSubscriber } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [periods, setPeriods] = useState<EnrollmentPeriod[]>([snapshot!.period]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(snapshot!.period.id);
  const [periodData, setPeriodData] = useState<EnrollmentPeriodSnapshot>({
    period: snapshot!.period,
    plans: snapshot!.plans,
    enrollments: snapshot!.enrollments,
    payments: snapshot!.payments,
    assessments: snapshot!.assessments,
    assessmentAdjustments: snapshot!.assessmentAdjustments,
  });
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState<Enrollment | null>(null);
  const [included, setIncluded] = useState(false);
  const [adjustment, setAdjustment] = useState('0');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);

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
    void supabase.rpc('get_admin_enrollment_period', { p_period_id: selectedPeriodId }).then(async ({ data, error }) => {
      if (!active) return;
      if (error) setPeriodError(error.message);
      else {
        try {
          const next = data as EnrollmentPeriodSnapshot;
          const rates = await loadSurchargeRates(next.period.id);
          const financial = await loadFinancialWorkspace({ ...snapshot!, ...next } as ProgramSnapshot);
          if (active) setPeriodData({ ...next, payments: financial.payments, assessments: financial.assessments, assessmentAdjustments: financial.assessmentAdjustments, period: withSurchargeRates(next.period, rates) });
        } catch (reason) {
          if (active) setPeriodError(reason instanceof Error ? reason.message : 'Unable to load enrollment year.');
        }
      }
      setLoadingPeriod(false);
    });
    return () => { active = false; };
  }, [selectedPeriodId, snapshot]);

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


  const beginActingFor = (enrollment: Enrollment) => {
    if (!window.confirm(`Work in ${fullName(enrollment.principal)}'s portal on their behalf? Every change you make is recorded in the audit history against your administrator account.`)) return;
    actForSubscriber(enrollment.id);
    navigate('/account');
  };

  const activeAssessment = periodData.assessments.find((item) => item.active);
  const openFinancialAdjustment = (enrollment: Enrollment) => {
    const current = activeAssessment ? periodData.assessmentAdjustments.find((item) => item.assessmentId === activeAssessment.id && item.enrollmentId === enrollment.id) : undefined;
    setSelectedEnrollment(enrollment);
    setIncluded(Boolean(current));
    setAdjustment(String((current?.adjustmentKobo ?? 0) / 100));
    setAdjustmentNote(current?.note ?? '');
  };
  const saveFinancialAdjustment = async () => {
    if (!activeAssessment || !selectedEnrollment) return;
    const adjustmentKobo = nairaToKobo(adjustment);
    setSavingAdjustment(true);
    try {
      if (!isDemoMode && supabase) {
        const { error } = await supabase.rpc('set_enrollment_assessment', {
          p_assessment_id: activeAssessment.id,
          p_enrollment_id: selectedEnrollment.id,
          p_included: included,
          p_adjustment_kobo: adjustmentKobo,
          p_note: adjustmentNote,
        });
        if (error) throw error;
      }
      setPeriodData((current) => ({
        ...current,
        assessmentAdjustments: included
          ? [...current.assessmentAdjustments.filter((item) => item.assessmentId !== activeAssessment.id || item.enrollmentId !== selectedEnrollment.id), { assessmentId: activeAssessment.id, enrollmentId: selectedEnrollment.id, adjustmentKobo, note: adjustmentNote }]
          : current.assessmentAdjustments.filter((item) => item.assessmentId !== activeAssessment.id || item.enrollmentId !== selectedEnrollment.id),
      }));
      setSelectedEnrollment(null);
    } catch (reason) {
      setPeriodError(reason instanceof Error ? reason.message : 'Unable to update subscriber assessment.');
    } finally {
      setSavingAdjustment(false);
    }
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
    {activeAssessment && <p className="table-legend">Assessment columns show <strong>{activeAssessment.name}</strong>. Net due also carries any HMO under or overpayment reconciled into it, so it will not always equal payable minus paid.</p>}
    {!loadingPeriod && (rows.length ? <div className="data-table admin-table"><div className="data-table__head"><span>Member</span><span>Plan</span><span>Plan type</span><span>Total payable</span><span>Verified paid</span><span>HMO position</span><span>Assessment payable</span><span>Assessment paid</span><span>Assessment net due</span><span>Enrollment</span><span>Manage</span></div>{rows.map((enrollment) => {
      const assigned = assessmentForEnrollment(enrollment.id, periodData.assessments, periodData.assessmentAdjustments);
      const financial = enrollmentFinancialPosition(enrollment, periodData.payments, assigned.assessment, assigned.adjustment);
      const variance = financial.premium.status === 'overpaid' ? financial.premium.overpaymentKobo : financial.premium.underpaymentKobo;
      return <div className="data-table__row" key={enrollment.id}>
        <span data-label="Member"><strong>{fullName(enrollment.principal)}</strong><small>{enrollment.principal.email}</small></span>
        <span data-label="Plan">{periodData.plans.find((plan) => plan.id === enrollment.planId)?.name ?? 'Not selected'}</span>
        <span data-label="Plan type">{enrollment.category === 'family' ? 'Family' : 'Individual'}</span>
        <strong data-label="Total payable">{formatNaira(enrollment.totalKobo)}</strong>
        <strong data-label="Verified paid">{formatNaira(financial.premiumPaidKobo)}</strong>
        <span data-label="HMO position"><StatusBadge status={financial.premium.status} /><small>{formatNaira(variance)}</small></span>
        <span data-label="Assessment payable" className="assessment-net">
          <strong>{assigned.assessment ? formatNaira(assigned.assessment.amountKobo + financial.adjustmentKobo) : 'Not assigned'}</strong>
          {assigned.assessment && financial.adjustmentKobo !== 0 && <small>incl. {formatNaira(financial.adjustmentKobo)} adjustment</small>}
        </span>
        <strong data-label="Assessment paid">{assigned.assessment ? formatNaira(financial.assessmentPaidKobo) : '—'}</strong>
        {/* Net due is the reconciliation position: it also carries the swept HMO variance,
            so it deliberately does not equal payable minus paid. The breakdown is rendered
            rather than left to a title, which does not exist on a touch device. */}
        <span data-label="Assessment net due" className="assessment-net">
          <strong>{assigned.assessment ? formatNaira(financial.assessmentDueKobo) : '—'}</strong>
          {assigned.assessment && financial.premiumVarianceKobo !== 0 && <small>incl. {formatNaira(Math.abs(financial.premiumVarianceKobo))} HMO {financial.premiumVarianceKobo > 0 ? 'shortfall' : 'credit'}</small>}
        </span>
        <span data-label="Enrollment"><StatusBadge status={enrollment.status} /></span>
        <span data-label="Manage">{activeAssessment && <Button variant="secondary" icon={<SlidersHorizontal size={15} />} onClick={() => openFinancialAdjustment(enrollment)}>Adjust</Button>}{selectedPeriodId === snapshot!.period.id && <Button variant="secondary" icon={<UserCog size={15} />} onClick={() => beginActingFor(enrollment)}>Act for</Button>}</span>
      </div>;
    })}</div> : <EmptyState icon={<Users size={29} />} title="No matching enrollees" body="Adjust the enrollment year, search, or status filter." />)}
    {selectedEnrollment && activeAssessment && <Modal title={`Manage ${activeAssessment.name}`} onClose={() => setSelectedEnrollment(null)}>
      <div className="modal-form">
        <p><strong>{fullName(selectedEnrollment.principal)}</strong></p>
        <label className="checkbox-line"><input type="checkbox" checked={included} onChange={(event) => setIncluded(event.target.checked)} />Include this subscriber in the assessment</label>
        <label>Subscriber adjustment (₦)<input type="number" step="0.01" value={adjustment} disabled={!included} onChange={(event) => setAdjustment(event.target.value)} /><small>Positive amounts increase the net due; negative amounts reduce it.</small></label>
        <label>Adjustment note<textarea rows={3} value={adjustmentNote} disabled={!included} onChange={(event) => setAdjustmentNote(event.target.value)} /></label>
        <div className="modal__actions"><Button variant="secondary" onClick={() => setSelectedEnrollment(null)}>Cancel</Button><Button disabled={savingAdjustment} onClick={() => void saveFinancialAdjustment()}>{savingAdjustment ? 'Saving...' : 'Save subscriber assessment'}</Button></div>
      </div>
    </Modal>}
  </>;
}
