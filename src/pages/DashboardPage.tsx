import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarDays, CheckCircle2, ClipboardCheck, Copy, HeartPulse, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDate, fullName } from '../lib/format';
import { workspaceEnrollment } from '../lib/enrollmentAccess';
import { assessmentForEnrollment, enrollmentFinancialPosition } from '../lib/financialPosition';
import { formatNaira } from '../lib/money';
import { paymentInstruction } from '../lib/paymentInstruction';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { surchargeRates } from '../lib/surchargeRates';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../components/ui';

export function DashboardPage() {
  const { snapshot, activeEnrollmentId, actingEnrollmentId } = useApp();
  const navigate = useNavigate();
  const { payments, paymentAccount, period } = snapshot!;
  const enrollment = workspaceEnrollment(snapshot!, activeEnrollmentId, actingEnrollmentId);
  const relevantPayments = payments.filter((item) => item.enrollmentId === enrollment.id);
  const { assessment, adjustment } = assessmentForEnrollment(enrollment.id, snapshot!.assessments, snapshot!.assessmentAdjustments);
  const financial = enrollmentFinancialPosition(enrollment, relevantPayments, assessment, adjustment);
  const verified = financial.premiumPaidKobo;
  const pending = relevantPayments.filter((item) => item.status === 'pending' && !item.assessmentId).reduce((sum, item) => sum + item.amountKobo, 0);
  const position = financial.premium;
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === enrollment.planId);
  const premiumKobo = selectedPlan ? (enrollment.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo) : 0;
  const progress = enrollment.totalKobo ? (verified / enrollment.totalKobo) * 100 : 0;
  const canNotifyPayment = Boolean(enrollment.planId) && ['submitted', 'closed'].includes(enrollment.status) && enrollment.totalKobo > 0;
  // One account collects everything, so the next step must name whichever obligation is
  // actually outstanding and the reference that separates it, not default to the assessment.
  const premiumOutstanding = canNotifyPayment && position.status === 'underpaid';
  const assessmentOutstanding = Boolean(assessment) && financial.assessmentOwnDueKobo > 0;
  const currentInstruction = paymentInstruction(paymentAccount, !premiumOutstanding && assessmentOutstanding ? assessment : undefined);
  const nextStep = premiumOutstanding
    ? { title: `${formatNaira(position.underpaymentKobo)} HMO premium outstanding.`, body: `Transfer the balance using the ${paymentAccount.referencePrefix} reference, then upload the confirmation so administrators can verify it.`, to: '/payments', cta: 'Upload confirmation' }
    : assessmentOutstanding && assessment
      ? { title: `${formatNaira(financial.assessmentOwnDueKobo)} ${assessment.name} due.`, body: `Use the ${assessment.paymentAccount.referencePrefix} reference. ${formatNaira(assessment.futureCreditKobo)} will be credited toward your ${assessment.creditYear} enrollment when settled.`, to: '/payments', cta: 'View assessment' }
      : canNotifyPayment
        ? { title: 'Your payments are up to date.', body: 'Verified payments cover everything currently due. Upload a confirmation for any transfer missing from your history.', to: '/payments', cta: 'View payments' }
        : { title: 'Finish your enrollment.', body: 'Review your plan and household details, provide consent, and submit your enrollment.', to: '/enrollment', cta: 'Continue enrollment' };

  const copyAccount = () => void navigator.clipboard.writeText(currentInstruction.accountNumber);

  return <>
    <PageHeader eyebrow={`${period.year} enrollment`} title={`Welcome, ${enrollment.principal.firstName}`} description={period.status === 'closed' ? 'Enrollment is closed. Your payment records remain available.' : `Enrollment closes ${formatDate(period.endsAt, snapshot!.program.timezone)}.`} actions={<Button icon={nextStep.to === '/payments' ? <Banknote size={18} /> : <ClipboardCheck size={18} />} onClick={() => navigate(nextStep.to)}>{nextStep.cta}</Button>} />

    <section className="metric-grid">
      <article className="metric metric--accent"><span className="metric__icon"><HeartPulse size={21} /></span><div><small>Selected plan</small><strong>{selectedPlan?.name ?? 'Not selected'}</strong><span>{enrollment.category === 'family' ? `${enrollment.dependents.length + 1} covered people` : 'Individual cover'}</span></div></article>
      <article className="metric"><span className="metric__icon"><Banknote size={21} /></span><div><small>Total payable</small><strong>{formatNaira(enrollment.totalKobo)}</strong><span>Includes the configured AVON NHIS and program administrative fees</span></div></article>
      <article className="metric"><span className="metric__icon"><CheckCircle2 size={21} /></span><div><small>Verified payments</small><strong>{formatNaira(verified)}</strong><span>{pending > 0 ? `${formatNaira(pending)} awaiting review` : 'No pending payments'}</span></div></article>
      <article className="metric"><span className="metric__icon"><CalendarDays size={21} /></span><div><small>Payment position</small><strong>{position.status === 'overpaid' ? formatNaira(position.overpaymentKobo) : position.status === 'underpaid' ? formatNaira(position.underpaymentKobo) : formatNaira(0)}</strong><span>{position.status === 'overpaid' ? 'Overpayment credit' : position.status === 'underpaid' ? 'Underpayment remaining' : 'Paid in full'}</span></div></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel payment-progress">
        <div className="panel__heading"><div><p className="eyebrow">Payment position</p><h2>{position.status === 'overpaid' ? `${formatNaira(position.overpaymentKobo)} overpaid` : position.status === 'underpaid' ? `${formatNaira(position.underpaymentKobo)} remaining` : 'Paid in full'}</h2></div><StatusBadge status={pending > 0 ? 'Pending' : position.status} /></div>
        {premiumKobo > 0 && <FeeBreakdown premiumKobo={premiumKobo} rates={surchargeRates(snapshot!.period)} compact />}
        <ProgressBar value={progress} label={`${formatNaira(verified)} of ${formatNaira(enrollment.totalKobo)}`} />
        <div className="account-strip">
          <div><small>Program payment account</small><strong>{currentInstruction.bank}</strong><span>{currentInstruction.beneficiary}</span></div>
          <div><small>Account number</small><strong>{currentInstruction.accountNumber}</strong></div>
          <div><small>Reference</small><strong>{currentInstruction.referencePrefix}</strong></div>
          <button title="Copy account number" aria-label="Copy account number" onClick={copyAccount}><Copy size={18} /></button>
        </div>
        <div className="panel__actions"><Link to="/payments">View payments <ArrowRight size={17} /></Link></div>
      </article>

      <article className="panel household-panel">
        <div className="panel__heading"><div><p className="eyebrow">Household</p><h2>{fullName(enrollment.principal)}</h2></div><span className="count-badge"><Users size={16} />{enrollment.dependents.length + 1}</span></div>
        <div className="people-list">
          <div><span className="person-dot person-dot--principal">{enrollment.principal.firstName[0]}</span><span><strong>{fullName(enrollment.principal)}</strong><small>Principal member</small></span><CheckCircle2 size={18} /></div>
          {enrollment.dependents.map((person) => <div key={person.id}><span className="person-dot">{person.firstName[0]}</span><span><strong>{fullName(person)}</strong><small>{person.relation.toLowerCase()}</small></span><CheckCircle2 size={18} /></div>)}
        </div>
        <div className="panel__actions"><Link to="/enrollment">Review details <ArrowRight size={17} /></Link></div>
      </article>
    </section>

    <section className="next-step-band">
      <ClipboardCheck size={24} />
      <div><strong>{nextStep.title}</strong><span>{nextStep.body}</span></div>
      <Link to={nextStep.to}>{nextStep.cta} <ArrowRight size={18} /></Link>
    </section>
  </>;
}
