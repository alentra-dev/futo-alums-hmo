import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Download, FileSpreadsheet, Search, SlidersHorizontal, UserCog, Users } from 'lucide-react';
import { Button, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { loadCarryForwards, loadEnrollmentCoverage, loadFinancialWorkspace, useApp } from '../../context/AppContext';
import { ProrationBreakdown } from '../../components/ProrationBreakdown';
import { avonProration, coverageRange, coverageTermEnd, coverageTermStart, formatCoverageMonth, lateCoverageStart } from '../../lib/proration';
import { defaultAdminPeriod } from '../../lib/enrollmentPeriods';
import { downloadAdminFullWorkbook, downloadAvonWorkbook, downloadSummaryWorkbook } from '../../lib/export';
import { fullName } from '../../lib/format';
import { assignedAssessmentTerms, assessmentForEnrollment, enrollmentFinancialPosition, nextEnrollmentCarryForward, registrationFeeKobo } from '../../lib/financialPosition';
import { formatNaira, formatSignedNaira, nairaToKobo } from '../../lib/money';
import { parseNumericInput } from '../../lib/numericInput';
import { isDemoMode, supabase } from '../../lib/supabase';
import { loadSurchargeRates, withSurchargeRates } from '../../lib/surchargeRates';
import type { Enrollment, EnrollmentPeriod, EnrollmentPeriodSnapshot, ProgramSnapshot } from '../../lib/types';

export function AdminEnrolleesPage() {
  const { snapshot, actForSubscriber, updateAssessmentAssignment, updateEnrollmentCoverage } = useApp();
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
  const [contribution, setContribution] = useState('0');
  const [feePortion, setFeePortion] = useState('0');
  const [futureCredit, setFutureCredit] = useState('0');
  const [creditYear, setCreditYear] = useState(String(snapshot!.period.year + 1));
  const [adjustmentError, setAdjustmentError] = useState('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [coverageEnrollment, setCoverageEnrollment] = useState<Enrollment | null>(null);
  const [coverageLate, setCoverageLate] = useState(false);
  const [coverageMonth, setCoverageMonth] = useState('');
  const [coverageNote, setCoverageNote] = useState('');
  const [coverageError, setCoverageError] = useState('');
  const [savingCoverage, setSavingCoverage] = useState(false);

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
    // Demo edits live in the shared snapshot, so mirror them into the displayed year.
    if (isDemoMode) setPeriodData((current) => ({ ...current, period: snapshot!.period, enrollments: snapshot!.enrollments }));
  }, [snapshot]);

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
          const next = await loadCarryForwards(await loadEnrollmentCoverage(data as EnrollmentPeriodSnapshot));
          const rates = await loadSurchargeRates(next.period.id);
          const financial = await loadFinancialWorkspace({ ...snapshot!, ...next } as ProgramSnapshot);
          if (active) setPeriodData({ ...next, enrollments: next.enrollments, payments: financial.payments, assessments: financial.assessments, assessmentAdjustments: financial.assessmentAdjustments, period: withSurchargeRates(next.period, rates) });
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
    return matchesQuery && (status === 'all' || (status === 'late' ? Boolean(item.proration) : item.status === status));
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
  const termStart = coverageTermStart(periodData.period);
  const enrollmentPremium = (enrollment: Enrollment) => {
    const plan = periodData.plans.find((item) => item.id === enrollment.planId);
    return plan ? (enrollment.category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo) : 0;
  };
  const coveragePreview = coverageEnrollment && coverageLate && coverageMonth
    ? avonProration(enrollmentPremium(coverageEnrollment), periodData.period.nhisFeeBasisPoints, termStart, `${coverageMonth}-01`, periodData.period.year + 1)
    : null;
  const openCoverage = (enrollment: Enrollment) => {
    setCoverageEnrollment(enrollment);
    setCoverageLate(Boolean(enrollment.proration));
    setCoverageMonth((enrollment.proration?.coverageStartMonth ?? lateCoverageStart(periodData.period, snapshot!.program.timezone)).slice(0, 7));
    setCoverageNote(enrollment.proration?.note ?? '');
    setCoverageError('');
  };
  const saveCoverage = async () => {
    if (!coverageEnrollment) return;
    if (coverageLate && !coveragePreview) {
      setCoverageError(`Choose a month from ${formatCoverageMonth(termStart)} to ${formatCoverageMonth(coverageTermEnd(termStart))}.`);
      return;
    }
    if (!coverageNote.trim()) {
      setCoverageError('Enter the reason, such as the AVON invoice that confirms the start month.');
      return;
    }
    setSavingCoverage(true);
    setCoverageError('');
    try {
      await updateEnrollmentCoverage(coverageEnrollment.id, coverageLate ? `${coverageMonth}-01` : null, coverageNote.trim());
      setCoverageEnrollment(null);
    } catch (reason) {
      setCoverageError(reason instanceof Error ? reason.message : 'Unable to update the AVON coverage start.');
    } finally {
      setSavingCoverage(false);
    }
  };
  const openFinancialAdjustment = (enrollment: Enrollment) => {
    const current = activeAssessment ? periodData.assessmentAdjustments.find((item) => item.assessmentId === activeAssessment.id && item.enrollmentId === enrollment.id) : undefined;
    setSelectedEnrollment(enrollment);
    setIncluded(Boolean(current));
    setAdjustment(String((current?.adjustmentKobo ?? 0) / 100));
    setAdjustmentNote(current?.note ?? '');
    const terms = assignedAssessmentTerms(activeAssessment!, current);
    setContribution(String(terms.amountKobo / 100));
    setFeePortion(String(terms.feePortionKobo / 100));
    setFutureCredit(String(terms.futureCreditKobo / 100));
    setCreditYear(String(terms.creditYear));
    setAdjustmentError('');
  };
  const saveFinancialAdjustment = async () => {
    if (!activeAssessment || !selectedEnrollment) return;
    const parsedAmounts = [contribution, feePortion, futureCredit, adjustment].map((value) => parseNumericInput(value));
    const [amountKobo, feePortionKobo, futureCreditKobo, adjustmentKobo] = parsedAmounts.map((value) => value === null ? NaN : nairaToKobo(value));
    const parsedYear = parseNumericInput(creditYear, { min: periodData.period.year + 1, max: 2100, integer: true });
    if (included && (![amountKobo, feePortionKobo, futureCreditKobo, adjustmentKobo].every(Number.isSafeInteger)
      || amountKobo < 0 || feePortionKobo < 0 || futureCreditKobo < 0
      || feePortionKobo + futureCreditKobo !== amountKobo || amountKobo + adjustmentKobo < 0
      || parsedYear === null)) {
      setAdjustmentError('Enter valid amounts: the fee and future credit must add up to the contribution, the adjusted payable cannot be negative, and the credit year must be after the enrollment year.');
      return;
    }
    if (!adjustmentNote.trim()) {
      setAdjustmentError('Enter a reason for this subscriber assessment change.');
      return;
    }
    setAdjustmentError('');
    setSavingAdjustment(true);
    try {
      const assignment = { assessmentId: activeAssessment.id, enrollmentId: selectedEnrollment.id, adjustmentKobo, note: adjustmentNote.trim(), amountKobo, feePortionKobo, futureCreditKobo, creditYear: parsedYear ?? activeAssessment.creditYear };
      await updateAssessmentAssignment(assignment, included);
      setPeriodData((current) => ({
        ...current,
        assessmentAdjustments: included
          ? [...current.assessmentAdjustments.filter((item) => item.assessmentId !== activeAssessment.id || item.enrollmentId !== selectedEnrollment.id), assignment]
          : current.assessmentAdjustments.filter((item) => item.assessmentId !== activeAssessment.id || item.enrollmentId !== selectedEnrollment.id),
      }));
      setSelectedEnrollment(null);
    } catch (reason) {
      setAdjustmentError(reason instanceof Error ? reason.message : 'Unable to update subscriber assessment.');
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
      <select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="submitted">Submitted</option><option value="closed">Closed</option><option value="late">Late enrollees</option></select>
      <span>{loadingPeriod ? 'Loading...' : `${rows.length} records`}</span>
    </div>
    {periodError && <p className="form-error" role="alert">{periodError}</p>}
    {periodData.enrollments.some((item) => item.proration) && <p className="table-legend"><strong>Late</strong> enrollees pay the full annual total; AVON bills from their coverage start month, and the premium and NHIS difference is credited toward {periodData.period.year + 1} enrollment. The {periodData.period.year} AVON term runs {coverageRange(termStart, termStart)}.</p>}
    {activeAssessment && <p className="table-legend">Assessment columns show <strong>{activeAssessment.name}</strong>. Net due also carries any HMO under or overpayment reconciled into it, so it will not always equal payable minus paid.</p>}
    {periodData.period.carryForwardEnabled !== false && <p className="table-legend"><strong>Carry to {periodData.period.year + 1}</strong> is each submitted enrollment's balance from verified payments: HMO over or underpayment, CAC credit or the one-time CAC registration fee still owed, and any late-enrollment credit. It is applied automatically to the household's {periodData.period.year + 1} enrollment.</p>}
    {!loadingPeriod && (rows.length ? <div className="data-table admin-table"><div className="data-table__head"><span>Member</span><span>Plan</span><span>Plan type</span><span>Total payable</span><span>Verified paid</span><span>HMO position</span><span>Assessment payable</span><span>Assessment paid</span><span>Assessment net due</span><span>Carry to {periodData.period.year + 1}</span><span>Enrollment</span><span>Manage</span></div>{rows.map((enrollment) => {
      const assigned = assessmentForEnrollment(enrollment.id, periodData.assessments, periodData.assessmentAdjustments);
      const financial = enrollmentFinancialPosition(enrollment, periodData.payments, assigned.assessment, assigned.adjustment);
      const variance = financial.premium.status === 'overpaid' ? financial.premium.overpaymentKobo : financial.premium.underpaymentKobo;
      const carry = nextEnrollmentCarryForward(enrollment, periodData.payments, registrationFeeKobo(periodData.assessments), assigned.assessment, assigned.adjustment, periodData.period.carryForwardEnabled !== false);
      return <div className="data-table__row" key={enrollment.id}>
        <span data-label="Member"><strong>{fullName(enrollment.principal)}</strong><small>{enrollment.principal.email}</small></span>
        <span data-label="Plan">{periodData.plans.find((plan) => plan.id === enrollment.planId)?.name ?? 'Not selected'}</span>
        <span data-label="Plan type">{enrollment.category === 'family' ? 'Family' : 'Individual'}{enrollment.proration && <><span className="late-badge">Late · {formatCoverageMonth(enrollment.proration.coverageStartMonth)}</span><small className="proration-credit">{formatNaira(enrollment.proration.creditKobo)} credit → {enrollment.proration.creditYear}</small></>}</span>
        <strong data-label="Total payable">{formatNaira(enrollment.totalKobo)}</strong>
        <strong data-label="Verified paid">{formatNaira(financial.premiumPaidKobo)}</strong>
        <span data-label="HMO position"><StatusBadge status={financial.premium.status} /><small>{formatNaira(variance)}</small>{enrollment.carryIn && <small>incl. {formatSignedNaira(enrollment.carryIn.netKobo)} from {enrollment.carryIn.sourceYear}</small>}</span>
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
        <span data-label={`Carry to ${periodData.period.year + 1}`} className="assessment-net carry-cell">
          <strong className={carry && carry.netKobo < 0 ? 'carry-owed' : undefined}>{carry ? formatSignedNaira(carry.netKobo) : '—'}</strong>
          {carry && carry.assessmentBalanceKobo < 0 && <small>incl. {formatNaira(-carry.assessmentBalanceKobo)} CAC fee</small>}
          {carry && carry.prorationCreditKobo > 0 && <small>incl. {formatNaira(carry.prorationCreditKobo)} late credit</small>}
        </span>
        <span data-label="Enrollment"><StatusBadge status={enrollment.status} /></span>
        <span data-label="Manage">{enrollment.planId && <Button variant="secondary" icon={<CalendarClock size={15} />} onClick={() => openCoverage(enrollment)}>Coverage</Button>}{activeAssessment && <Button variant="secondary" icon={<SlidersHorizontal size={15} />} onClick={() => openFinancialAdjustment(enrollment)}>Adjust</Button>}{selectedPeriodId === snapshot!.period.id && <Button variant="secondary" icon={<UserCog size={15} />} onClick={() => beginActingFor(enrollment)}>Act for</Button>}</span>
      </div>;
    })}</div> : <EmptyState icon={<Users size={29} />} title="No matching enrollees" body="Adjust the enrollment year, search, or status filter." />)}
    {selectedEnrollment && activeAssessment && <Modal title={`Manage ${activeAssessment.name}`} onClose={() => setSelectedEnrollment(null)}>
      <div className="modal-form">
        <p><strong>{fullName(selectedEnrollment.principal)}</strong></p>
        <label className="checkbox-line"><input type="checkbox" checked={included} onChange={(event) => setIncluded(event.target.checked)} />Include this subscriber in the assessment</label>
        <p>These terms apply only to this subscriber. Earlier enrollees keep their own assigned terms.</p>
        <label>Assigned contribution (₦)<input type="number" min="0" step="0.01" value={contribution} disabled={!included} onChange={(event) => setContribution(event.target.value)} /></label>
        <label>One-time program fee (₦)<input type="number" min="0" step="0.01" value={feePortion} disabled={!included} onChange={(event) => setFeePortion(event.target.value)} /></label>
        <label>Future enrollment credit (₦)<input type="number" min="0" step="0.01" value={futureCredit} disabled={!included} onChange={(event) => setFutureCredit(event.target.value)} /><small>Set to zero when this subscriber receives no future credit.</small></label>
        <label>Credit enrollment year<input type="number" min={periodData.period.year + 1} max="2100" value={creditYear} disabled={!included} onChange={(event) => setCreditYear(event.target.value)} /></label>
        <label>Subscriber adjustment (₦)<input type="number" step="0.01" value={adjustment} disabled={!included} onChange={(event) => setAdjustment(event.target.value)} /><small>Positive amounts increase the net due; negative amounts reduce it.</small></label>
        <label>Reason for change<textarea required rows={3} value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} /></label>
        {included && <p>Assessment payable: <strong>{formatNaira(nairaToKobo(contribution) + nairaToKobo(adjustment))}</strong>. Planned future credit: <strong>{formatNaira(nairaToKobo(futureCredit))}</strong>. HMO reconciliation is calculated separately.</p>}
        {adjustmentError && <p className="form-error" role="alert">{adjustmentError}</p>}
        <div className="modal__actions"><Button variant="secondary" onClick={() => setSelectedEnrollment(null)}>Cancel</Button><Button disabled={savingAdjustment} onClick={() => void saveFinancialAdjustment()}>{savingAdjustment ? 'Saving...' : 'Save subscriber assessment'}</Button></div>
      </div>
    </Modal>}
    {coverageEnrollment && <Modal title="AVON coverage start" onClose={() => setCoverageEnrollment(null)}>
      <div className="modal-form">
        <p><strong>{fullName(coverageEnrollment.principal)}</strong></p>
        <p>The {periodData.period.year} AVON term runs {coverageRange(termStart, termStart)}. Members who join after the renewal window still pay the full annual total ({formatNaira(coverageEnrollment.totalKobo)}); AVON bills the program only from their coverage start month.</p>
        <label className="checkbox-line"><input type="checkbox" checked={coverageLate} onChange={(event) => setCoverageLate(event.target.checked)} />Joined after the renewal window (AVON prorates the premium)</label>
        <label>AVON coverage start month<input type="month" min={termStart.slice(0, 7)} max={coverageTermEnd(termStart).slice(0, 7)} value={coverageMonth} disabled={!coverageLate} onChange={(event) => setCoverageMonth(event.target.value)} /><small>Use the first month shown on AVON's invoice for this member.</small></label>
        {coveragePreview && <ProrationBreakdown proration={coveragePreview} termStart={termStart} nhisFeeBasisPoints={periodData.period.nhisFeeBasisPoints} />}
        {!coverageLate && <p>Full-term coverage: AVON bills all twelve months and no proration credit is recorded.</p>}
        <label>Reason for change<textarea required rows={2} value={coverageNote} onChange={(event) => setCoverageNote(event.target.value)} placeholder="Matches AVON supplementary invoice dated 12 Oct 2026" /></label>
        {coverageError && <p className="form-error" role="alert">{coverageError}</p>}
        <div className="modal__actions"><Button variant="secondary" onClick={() => setCoverageEnrollment(null)}>Cancel</Button><Button disabled={savingCoverage} onClick={() => void saveCoverage()}>{savingCoverage ? 'Saving...' : 'Save coverage start'}</Button></div>
      </div>
    </Modal>}
  </>;
}
