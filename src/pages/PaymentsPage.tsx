import { useMemo, useState, type FormEvent } from 'react';
import { Banknote, CheckCircle2, Copy, FileUp, Info, ReceiptText } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDate, formatDateTime } from '../lib/format';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { formatNaira, nairaToKobo } from '../lib/money';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { Button, EmptyState, Modal, PageHeader, ProgressBar, StatusBadge } from '../components/ui';

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await submitPayment({ enrollmentId: enrollment.id, amountKobo: nairaToKobo(data.get('amount') as string), paidAt: data.get('paidAt') as string, reference: data.get('reference') as string, proof: (data.get('proof') as File).size ? data.get('proof') as File : undefined });
      setOpen(false);
    } finally { setBusy(false); }
  };

  return <>
    <PageHeader eyebrow={`${snapshot!.period.year} payments`} title="Payments" description="Notify administrators after every transfer, including partial payments." actions={<Button icon={<FileUp size={18} />} onClick={() => setOpen(true)}>Notify payment</Button>} />
    <div className="payment-summary-grid">
      <article className="panel amount-due"><p className="eyebrow">Total payable</p><strong>{formatNaira(enrollment.totalKobo)}</strong><span>Includes the 3% program fee and separate 15% banking transaction tax</span>{premiumKobo > 0 && <FeeBreakdown premiumKobo={premiumKobo} compact />}<ProgressBar value={enrollment.totalKobo ? (verified / enrollment.totalKobo) * 100 : 0} /><div><span>Verified {formatNaira(verified)}</span><span>Outstanding {formatNaira(outstanding)}</span></div>{pending > 0 && <p className="pending-note"><Info size={16} />{formatNaira(pending)} is awaiting administrator review.</p>}</article>
      <article className="panel bank-card"><div className="bank-card__head"><Banknote size={22} /><span>Program payment account</span></div><small>Bank</small><strong>{account.bank}</strong><small>Account name</small><strong>{account.beneficiary}</strong><small>Account number</small><div className="account-number"><strong>{account.accountNumber}</strong><button aria-label="Copy account number" title="Copy account number" onClick={() => void navigator.clipboard.writeText(account.accountNumber)}><Copy size={18} /></button></div><p>Use <b>{account.referencePrefix} - {enrollment.principal.firstName} {enrollment.principal.surname}</b> as your transfer reference.</p></article>
    </div>
    <section className="table-section"><div className="section-title"><h2>Payment history</h2><span>{payments.length} notifications</span></div>
      {payments.length ? <div className="data-table"><div className="data-table__head"><span>Date paid</span><span>Amount</span><span>Proof</span><span>Submitted</span><span>Status</span></div>{payments.map((payment) => <div className="data-table__row" key={payment.id}><span data-label="Date paid">{formatDate(payment.paidAt, snapshot!.program.timezone)}</span><strong data-label="Amount">{formatNaira(payment.amountKobo)}</strong><span data-label="Proof"><ReceiptText size={16} />{payment.proofName}</span><span data-label="Submitted">{formatDateTime(payment.submittedAt, snapshot!.program.timezone)}</span><span data-label="Status"><StatusBadge status={payment.status} /></span></div>)}</div> : <EmptyState icon={<ReceiptText size={28} />} title="No payment notifications" body="Payment notifications will appear here after submission." />}
    </section>

    {open && <Modal title="Notify a payment" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={submit}><div className="partial-warning"><Info size={18} /><span>Full payment is strongly encouraged. Partial payments are accepted and remain due until the verified total covers the full amount.</span></div><label>Amount paid (₦)<input name="amount" type="number" min="0.01" max={outstanding / 100} step="0.01" required placeholder="0.00" /></label><label>Date paid<input name="paidAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Transfer reference<input name="reference" required defaultValue={`${account.referencePrefix} - ${enrollment.principal.firstName} ${enrollment.principal.surname}`} /></label><label className="file-field"><span>Proof of payment</span><input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required /><small>PDF, JPG, or PNG. Maximum 10 MB.</small></label><div className="modal__actions"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy} icon={<CheckCircle2 size={17} />}>{busy ? 'Submitting…' : 'Submit for verification'}</Button></div></form></Modal>}
  </>;
}
