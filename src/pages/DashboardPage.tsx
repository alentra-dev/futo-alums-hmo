import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarDays, CheckCircle2, ClipboardCheck, Copy, HeartPulse, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDate, fullName } from '../lib/format';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { assessmentForEnrollment, enrollmentFinancialPosition } from '../lib/financialPosition';
import { formatNaira } from '../lib/money';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { surchargeRates } from '../lib/surchargeRates';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../components/ui';

export function DashboardPage() {
  const { snapshot, activeEnrollmentId } = useApp();
  const { payments, paymentAccount, period } = snapshot!;
  const enrollment = subscriberEnrollment(snapshot!, activeEnrollmentId);
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
  const currentAccount = assessment?.paymentAccount ?? paymentAccount;

  const copyAccount = () => void navigator.clipboard.writeText(currentAccount.accountNumber);

  return <>
    <PageHeader eyebrow={`${period.year} enrollment`} title={`Welcome, ${enrollment.principal.firstName}`} description={period.status === 'closed' ? 'Enrollment is closed. Your payment records remain available.' : `Enrollment closes ${formatDate(period.endsAt, snapshot!.program.timezone)}.`} actions={assessment || canNotifyPayment ? <Button icon={<Banknote size={18} />} onClick={() => location.assign(import.meta.env.BASE_URL + 'payments')}>{assessment ? 'Pay CAC assessment' : 'Upload payment confirmation'}</Button> : <Button icon={<ClipboardCheck size={18} />} onClick={() => location.assign(import.meta.env.BASE_URL + 'enrollment')}>Continue enrollment</Button>} />

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
          <div><small>Pay to</small><strong>{currentAccount.bank}</strong><span>{currentAccount.beneficiary}</span></div>
          <div><small>Account number</small><strong>{currentAccount.accountNumber}</strong></div>
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
      <div><strong>{assessment ? `${formatNaira(financial.assessmentDueKobo)} CAC payment due.` : canNotifyPayment ? 'Upload your payment confirmation.' : 'Finish your enrollment.'}</strong><span>{assessment ? `${formatNaira(assessment.futureCreditKobo)} will be credited toward your ${assessment.creditYear} enrollment when settled.` : canNotifyPayment ? 'After each transfer, upload its confirmation so administrators can verify your payment.' : 'Review your plan and household details, provide consent, and submit your enrollment.'}</span></div>
      <Link to={assessment || canNotifyPayment ? '/payments' : '/enrollment'}>{assessment ? 'View assessment' : canNotifyPayment ? 'Upload confirmation' : 'Continue enrollment'} <ArrowRight size={18} /></Link>
    </section>
  </>;
}
