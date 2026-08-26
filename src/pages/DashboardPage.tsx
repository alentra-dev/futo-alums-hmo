import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarDays, CheckCircle2, ClipboardCheck, Copy, HeartPulse, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDate, fullName } from '../lib/format';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { formatNaira } from '../lib/money';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { surchargeRates } from '../lib/surchargeRates';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../components/ui';

export function DashboardPage() {
  const { snapshot, activeEnrollmentId } = useApp();
  const { payments, paymentAccount, period } = snapshot!;
  const enrollment = subscriberEnrollment(snapshot!, activeEnrollmentId);
  const relevantPayments = payments.filter((item) => item.enrollmentId === enrollment.id);
  const verified = relevantPayments.filter((item) => item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
  const pending = relevantPayments.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amountKobo, 0);
  const outstanding = Math.max(0, enrollment.totalKobo - verified);
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === enrollment.planId);
  const premiumKobo = selectedPlan ? (enrollment.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo) : 0;
  const progress = enrollment.totalKobo ? (verified / enrollment.totalKobo) * 100 : 0;

  const copyAccount = () => void navigator.clipboard.writeText(paymentAccount.accountNumber);

  return <>
    <PageHeader eyebrow={`${period.year} enrollment`} title={`Welcome, ${enrollment.principal.firstName}`} description={`Enrollment closes ${formatDate(period.endsAt, snapshot!.program.timezone)}.`} actions={<Button icon={<Banknote size={18} />} onClick={() => location.assign(`${import.meta.env.BASE_URL}payments`)}>Notify payment</Button>} />

    <section className="metric-grid">
      <article className="metric metric--accent"><span className="metric__icon"><HeartPulse size={21} /></span><div><small>Selected plan</small><strong>{selectedPlan?.name ?? 'Not selected'}</strong><span>{enrollment.category === 'family' ? `${enrollment.dependents.length + 1} covered people` : 'Individual cover'}</span></div></article>
      <article className="metric"><span className="metric__icon"><Banknote size={21} /></span><div><small>Total payable</small><strong>{formatNaira(enrollment.totalKobo)}</strong><span>Includes the configured AVON NHIS, program, and transaction fees</span></div></article>
      <article className="metric"><span className="metric__icon"><CheckCircle2 size={21} /></span><div><small>Verified payments</small><strong>{formatNaira(verified)}</strong><span>{pending > 0 ? `${formatNaira(pending)} awaiting review` : 'No pending payments'}</span></div></article>
      <article className="metric"><span className="metric__icon"><CalendarDays size={21} /></span><div><small>Outstanding</small><strong>{formatNaira(outstanding)}</strong><span>{outstanding === 0 ? 'Payment complete' : 'Full payment is strongly encouraged'}</span></div></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel payment-progress">
        <div className="panel__heading"><div><p className="eyebrow">Payment progress</p><h2>{formatNaira(outstanding)} remaining</h2></div><StatusBadge status={outstanding === 0 ? 'Verified' : pending > 0 ? 'Pending' : 'In progress'} /></div>
        {premiumKobo > 0 && <FeeBreakdown premiumKobo={premiumKobo} rates={surchargeRates(snapshot!.period)} compact />}
        <ProgressBar value={progress} label={`${formatNaira(verified)} of ${formatNaira(enrollment.totalKobo)}`} />
        <div className="account-strip">
          <div><small>Pay to</small><strong>{paymentAccount.bank}</strong><span>{paymentAccount.beneficiary}</span></div>
          <div><small>Account number</small><strong>{paymentAccount.accountNumber}</strong></div>
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
      <div><strong>Your enrollment details are complete.</strong><span>You can update them until administrators close the enrollment period.</span></div>
      <Link to="/enrollment">Review enrollment <ArrowRight size={18} /></Link>
    </section>
  </>;
}
