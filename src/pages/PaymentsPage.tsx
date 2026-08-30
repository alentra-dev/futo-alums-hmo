import { useMemo, useState } from 'react';
import { Banknote, ClipboardCheck, Copy, FileUp, Info, ReceiptText } from 'lucide-react';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { PaymentSubmissionForm } from '../components/PaymentSubmissionForm';
import { Button, EmptyState, Modal, PageHeader, ProgressBar, StatusBadge } from '../components/ui';
import { useApp } from '../context/AppContext';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { formatDate, formatDateTime } from '../lib/format';
import { formatNaira } from '../lib/money';
import { surchargeRates } from '../lib/surchargeRates';

export function PaymentsPage() {
  const { snapshot, activeEnrollmentId, submitPayment } = useApp();
  const enrollment = subscriberEnrollment(snapshot!, activeEnrollmentId);
  const account = snapshot!.paymentAccount;
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === enrollment.planId);
  const premiumKobo = selectedPlan ? (enrollment.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo) : 0;
  const payments = useMemo(() => snapshot!.payments.filter((item) => item.enrollmentId === enrollment.id), [snapshot, enrollment.id]);
  const verified = payments.filter((item) => item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
  const pending = payments.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amountKobo, 0);
  const outstanding = Math.max(0, enrollment.totalKobo - verified);
  const canUploadPayment = Boolean(enrollment.planId) && ['submitted', 'closed'].includes(enrollment.status) && enrollment.totalKobo > 0;
  const [open, setOpen] = useState(false);

  return <div className="payments-page">
    <PageHeader
      eyebrow={`${snapshot!.period.year} payments`}
      title="Payments and confirmations"
      description="Upload the transaction confirmation after every full or partial transfer."
      actions={canUploadPayment
        ? <Button icon={<FileUp size={18} />} onClick={() => setOpen(true)}>Upload payment confirmation</Button>
        : <Button icon={<ClipboardCheck size={18} />} onClick={() => location.assign(import.meta.env.BASE_URL + 'enrollment')}>Complete enrollment first</Button>}
    />
    <div className="payment-summary-grid">
      <article className="panel amount-due">
        <p className="eyebrow">Total payable</p><strong>{formatNaira(enrollment.totalKobo)}</strong>
        <span>Includes the configured AVON NHIS and program administrative fees</span>
        {premiumKobo > 0 && <FeeBreakdown premiumKobo={premiumKobo} rates={surchargeRates(snapshot!.period)} compact />}
        <ProgressBar value={enrollment.totalKobo ? (verified / enrollment.totalKobo) * 100 : 0} />
        <div><span>Verified {formatNaira(verified)}</span><span>Outstanding {formatNaira(outstanding)}</span></div>
        {pending > 0 && <p className="pending-note"><Info size={16} />{formatNaira(pending)} is awaiting administrator review.</p>}
      </article>
      <article className="panel bank-card">
        <div className="bank-card__head"><Banknote size={22} /><span>Program payment account</span></div>
        <small>Bank</small><strong>{account.bank}</strong><small>Account name</small><strong>{account.beneficiary}</strong><small>Account number</small>
        <div className="account-number"><strong>{account.accountNumber}</strong><button aria-label="Copy account number" title="Copy account number" onClick={() => void navigator.clipboard.writeText(account.accountNumber)}><Copy size={18} /></button></div>
        <p>Use <b>{account.referencePrefix} - {enrollment.principal.firstName} {enrollment.principal.surname}</b> as your transfer reference.</p>
      </article>
    </div>
    <section className="table-section">
      <div className="section-title"><h2>Payment history</h2><span>{payments.length} confirmations</span></div>
      {payments.length ? <div className="data-table">
        <div className="data-table__head"><span>Date paid</span><span>Amount</span><span>Confirmation</span><span>Uploaded</span><span>Status</span></div>
        {payments.map((payment) => <div className="data-table__row" key={payment.id}>
          <span data-label="Date paid">{formatDate(payment.paidAt, snapshot!.program.timezone)}</span>
          <strong data-label="Amount">{formatNaira(payment.amountKobo)}</strong>
          <span data-label="Confirmation"><ReceiptText size={16} />{payment.proofName}</span>
          <span data-label="Uploaded">{formatDateTime(payment.submittedAt, snapshot!.program.timezone)}</span>
          <span data-label="Status"><StatusBadge status={payment.status} /></span>
        </div>)}
      </div> : <EmptyState icon={<ReceiptText size={28} />} title="No payment confirmations" body="Upload the confirmation for each transfer you make." />}
    </section>

    {canUploadPayment && <div className="mobile-payment-action"><Button icon={<FileUp size={18} />} onClick={() => setOpen(true)}>Upload payment confirmation</Button></div>}
    {open && canUploadPayment && <Modal title="Upload payment confirmation" onClose={() => setOpen(false)}>
      <PaymentSubmissionForm enrollment={enrollment} account={account} outstandingKobo={outstanding} onCancel={() => setOpen(false)} onSubmit={async (payment) => { await submitPayment(payment); setOpen(false); }} />
    </Modal>}
  </div>;
}
