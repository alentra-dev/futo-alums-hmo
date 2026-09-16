import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, ClipboardCheck, Copy, FileUp, Info, ReceiptText } from 'lucide-react';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { PaymentSubmissionForm } from '../components/PaymentSubmissionForm';
import { Button, EmptyState, Modal, PageHeader, ProgressBar, StatusBadge } from '../components/ui';
import { useApp } from '../context/AppContext';
import { workspaceEnrollment } from '../lib/enrollmentAccess';
import { assessmentForEnrollment, enrollmentFinancialPosition } from '../lib/financialPosition';
import { formatDate, formatDateTime } from '../lib/format';
import { formatNaira } from '../lib/money';
import { paymentInstruction } from '../lib/paymentInstruction';
import { surchargeRates } from '../lib/surchargeRates';

export function PaymentsPage() {
  const { snapshot, activeEnrollmentId, actingEnrollmentId, submitPayment } = useApp();
  const navigate = useNavigate();
  const enrollment = workspaceEnrollment(snapshot!, activeEnrollmentId, actingEnrollmentId);
  const account = snapshot!.paymentAccount;
  const { assessment, adjustment } = assessmentForEnrollment(enrollment.id, snapshot!.assessments, snapshot!.assessmentAdjustments);
  const financial = enrollmentFinancialPosition(enrollment, snapshot!.payments, assessment, adjustment);
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === enrollment.planId);
  const premiumKobo = selectedPlan ? (enrollment.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo) : 0;
  const payments = useMemo(() => snapshot!.payments.filter((item) => item.enrollmentId === enrollment.id), [snapshot, enrollment.id]);
  const verified = financial.premiumPaidKobo;
  const pending = payments.filter((item) => item.status === 'pending' && !item.assessmentId).reduce((sum, item) => sum + item.amountKobo, 0);
  const assessmentPending = payments.filter((item) => item.status === 'pending' && item.assessmentId === assessment?.id).reduce((sum, item) => sum + item.amountKobo, 0);
  const position = financial.premium;
  const canUploadPayment = Boolean(enrollment.planId) && ['submitted', 'closed'].includes(enrollment.status) && enrollment.totalKobo > 0;
  const canUploadAssessment = Boolean(assessment?.active);
  const [open, setOpen] = useState<'premium' | 'assessment' | null>(null);
  // One account collects everything; the transfer reference is what separates an HMO
  // premium from a program assessment, so each obligation must be uploaded under its own.
  const premiumOutstanding = canUploadPayment && position.status === 'underpaid';
  const primaryPurpose: 'premium' | 'assessment' = premiumOutstanding || !canUploadAssessment ? 'premium' : 'assessment';
  const primaryLabel = primaryPurpose === 'premium' ? 'Upload HMO payment confirmation' : `Pay ${assessment!.name}`;
  const premiumInstruction = paymentInstruction(account);
  const assessmentInstruction = paymentInstruction(account, assessment);
  const displayInstruction = primaryPurpose === 'assessment' ? assessmentInstruction : premiumInstruction;

  return <div className="payments-page">
    <PageHeader
      eyebrow={`${snapshot!.period.year} payments`}
      title="Payments and confirmations"
      description="Upload the transaction confirmation after every full or partial transfer."
      actions={canUploadAssessment || canUploadPayment
        ? <Button icon={<FileUp size={18} />} onClick={() => setOpen(primaryPurpose)}>{primaryLabel}</Button>
        : <Button icon={<ClipboardCheck size={18} />} onClick={() => navigate('/enrollment')}>Complete enrollment first</Button>}
    />
    <div className="payment-summary-grid">
      <article className="panel amount-due">
        <p className="eyebrow">Total payable</p><strong>{formatNaira(enrollment.totalKobo)}</strong>
        <span>Includes the configured AVON NHIS and program administrative fees</span>
        {premiumKobo > 0 && <FeeBreakdown premiumKobo={premiumKobo} rates={surchargeRates(snapshot!.period)} compact />}
        <ProgressBar value={enrollment.totalKobo ? (verified / enrollment.totalKobo) * 100 : 0} />
        <div><span>Verified {formatNaira(verified)}</span><span>{position.status === 'overpaid' ? `Overpayment ${formatNaira(position.overpaymentKobo)}` : position.status === 'underpaid' ? `Underpayment ${formatNaira(position.underpaymentKobo)}` : 'Paid in full'}</span></div>
        <StatusBadge status={position.status} />
        {pending > 0 && <p className="pending-note"><Info size={16} />{formatNaira(pending)} is awaiting administrator review.</p>}
        {canUploadPayment && <div className="panel__actions"><Button variant={canUploadAssessment ? 'secondary' : 'primary'} icon={<FileUp size={17} />} onClick={() => setOpen('premium')}>Upload HMO payment</Button></div>}
      </article>
    {assessment && <section className="panel assessment-panel">
      <div className="panel__heading"><div><p className="eyebrow">Current program assessment</p><h2>{assessment.name}</h2></div><StatusBadge status={financial.assessmentOwnDueKobo > 0 ? 'Underpaid' : 'Paid in full'} /></div>
      <p>{assessment.description}</p>
      <div className="assessment-figures">
        <span><small>Base contribution</small><strong>{formatNaira(assessment.amountKobo)}</strong></span>
        {financial.adjustmentKobo !== 0 && <span><small>Admin adjustment</small><strong>{formatNaira(financial.adjustmentKobo)}</strong></span>}
        <span><small>Assessment payments verified</small><strong>{formatNaira(financial.assessmentPaidKobo)}</strong></span>
        <span><small>To pay now</small><strong>{formatNaira(financial.assessmentOwnDueKobo)}</strong></span>
        <span><small>{assessment.creditYear} enrollment credit</small><strong>{formatNaira(assessment.futureCreditKobo)}</strong></span>
      </div>
      <p className="pending-note"><Info size={16} />Use the reference <b>{assessmentInstruction.referencePrefix}</b> for this transfer so it is not reconciled as an HMO premium payment.</p>
      {financial.premiumVarianceKobo !== 0 && <p className="pending-note"><Info size={16} />{financial.premiumVarianceKobo > 0
        ? <>Your HMO premium is short by {formatNaira(financial.premiumVarianceKobo)}. Send that as a separate transfer using the <b>{premiumInstruction.referencePrefix}</b> reference — it is reconciled against this assessment, so your combined outstanding position is {formatNaira(financial.assessmentDueKobo)}.</>
        : <>Your HMO overpayment of {formatNaira(-financial.premiumVarianceKobo)} is reconciled against this assessment, leaving a combined position of {formatNaira(financial.assessmentDueKobo)}.</>}</p>}
      {assessmentPending > 0 && <p className="pending-note"><Info size={16} />{formatNaira(assessmentPending)} is awaiting administrator review.</p>}
      {canUploadAssessment && <div className="panel__actions"><Button variant={primaryPurpose === 'assessment' ? 'primary' : 'secondary'} icon={<FileUp size={17} />} onClick={() => setOpen('assessment')}>Pay {assessment.name}</Button></div>}
    </section>}
      <article className="panel bank-card">
        <div className="bank-card__head"><Banknote size={22} /><span>Program payment account</span></div>
        <small>Bank</small><strong>{displayInstruction.bank}</strong><small>Account name</small><strong>{displayInstruction.beneficiary}</strong><small>Account number</small>
        <div className="account-number"><strong>{displayInstruction.accountNumber}</strong><button aria-label="Copy account number" title="Copy account number" onClick={() => void navigator.clipboard.writeText(displayInstruction.accountNumber)}><Copy size={18} /></button></div>
        <p>Every program payment uses this one account. The reference is what tells them apart.</p>
        <dl className="transfer-references">
          <div><dt>HMO premium</dt><dd>{premiumInstruction.referencePrefix} - {enrollment.principal.firstName} {enrollment.principal.surname}</dd></div>
          {assessment && <div><dt>{assessment.name}</dt><dd>{assessmentInstruction.referencePrefix} - {enrollment.principal.firstName} {enrollment.principal.surname}</dd></div>}
        </dl>
      </article>
    </div>
    <section className="table-section">
      <div className="section-title"><h2>Payment history</h2><span>{payments.length} confirmations</span></div>
      {payments.length ? <div className="data-table">
        <div className="data-table__head"><span>Date paid</span><span>Amount</span><span>Confirmation</span><span>Uploaded</span><span>Status</span></div>
        {payments.map((payment) => <div className="data-table__row" key={payment.id}>
          <span data-label="Date paid">{formatDate(payment.paidAt, snapshot!.program.timezone)}</span>
          <strong data-label="Amount">{formatNaira(payment.amountKobo)}</strong>
          <span data-label="Confirmation"><ReceiptText size={16} /><span>{payment.proofName}<small>{payment.assessmentId ? assessment?.name ?? 'Program assessment' : 'HMO premium'}</small></span></span>
          <span data-label="Uploaded">{formatDateTime(payment.submittedAt, snapshot!.program.timezone)}</span>
          <span data-label="Status"><StatusBadge status={payment.status} /></span>
        </div>)}
      </div> : <EmptyState icon={<ReceiptText size={28} />} title="No payment confirmations" body="Upload the confirmation for each transfer you make." />}
    </section>

    {(canUploadAssessment || canUploadPayment) && <div className="mobile-payment-action"><Button icon={<FileUp size={18} />} onClick={() => setOpen(primaryPurpose)}>{primaryLabel}</Button></div>}
    {open && <Modal title={open === 'assessment' ? `Pay ${assessment?.name}` : 'Upload HMO payment confirmation'} onClose={() => setOpen(null)}>
      <PaymentSubmissionForm enrollment={enrollment} account={open === 'assessment' ? assessmentInstruction : premiumInstruction} outstandingKobo={open === 'assessment' ? financial.assessmentOwnDueKobo : position.underpaymentKobo} timezone={snapshot!.program.timezone} onCancel={() => setOpen(null)} onSubmit={async (payment) => {
        await submitPayment({ ...payment, assessmentId: open === 'assessment' ? assessment!.id : undefined }); setOpen(null);
      }} />
    </Modal>}
  </div>;
}
