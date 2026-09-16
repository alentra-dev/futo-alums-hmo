import { useMemo, useState } from 'react';
import { Check, Eye, FileUp, ReceiptText, Search, X } from 'lucide-react';
import { PaymentSubmissionForm } from '../../components/PaymentSubmissionForm';
import { Button, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { formatDate, formatDateTime, fullName } from '../../lib/format';
import { assessmentForEnrollment, enrollmentFinancialPosition } from '../../lib/financialPosition';
import { formatNaira } from '../../lib/money';
import { paymentInstruction } from '../../lib/paymentInstruction';
import { isDemoMode, supabase } from '../../lib/supabase';
import type { Payment } from '../../lib/types';

export function AdminPaymentsPage() {
  const { snapshot, reviewPayment, submitPayment } = useApp();
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPurpose, setUploadPurpose] = useState<'premium' | 'assessment'>('premium');
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const payments = useMemo(() => snapshot!.payments.filter((item) => (filter === 'all' || item.status === filter) && item.principalName.toLowerCase().includes(query.toLowerCase())), [snapshot, filter, query]);
  const eligibleEnrollments = useMemo(() => snapshot!.enrollments
    .filter((enrollment) => enrollment.planId && enrollment.totalKobo > 0 && ['submitted', 'closed'].includes(enrollment.status))
    .sort((a, b) => fullName(a.principal).localeCompare(fullName(b.principal))), [snapshot]);
  const selectedEnrollment = eligibleEnrollments.find((enrollment) => enrollment.id === selectedEnrollmentId) ?? null;
  const selectedAssignment = selectedEnrollment ? assessmentForEnrollment(selectedEnrollment.id, snapshot!.assessments, snapshot!.assessmentAdjustments) : { assessment: undefined, adjustment: undefined };
  const selectedFinancial = selectedEnrollment ? enrollmentFinancialPosition(selectedEnrollment, snapshot!.payments, selectedAssignment.assessment, selectedAssignment.adjustment) : null;
  const selectedOutstanding = uploadPurpose === 'assessment' ? selectedFinancial?.assessmentOwnDueKobo ?? 0 : selectedFinancial?.premium.underpaymentKobo ?? 0;
  // One program account collects everything; only the transfer reference distinguishes them.
  const selectedAccount = uploadPurpose === 'assessment' && !selectedAssignment.assessment
    ? undefined
    : paymentInstruction(snapshot!.paymentAccount, uploadPurpose === 'assessment' ? selectedAssignment.assessment : undefined);

  const review = async (payment: Payment, status: 'verified' | 'rejected') => {
    // Both outcomes move real money positions, and rejection is not self-service reversible.
    const verb = status === 'verified' ? 'Verify' : 'Reject';
    if (!window.confirm(`${verb} the ${formatNaira(payment.amountKobo)} ${payment.assessmentId ? 'program assessment' : 'HMO premium'} confirmation from ${payment.principalName}?`)) return;
    setBusy(payment.id);
    try { await reviewPayment(payment.id, status); } finally { setBusy(''); }
  };
  const openUpload = () => {
    setSelectedEnrollmentId(eligibleEnrollments[0]?.id ?? '');
    setUploadPurpose('premium');
    setUploadOpen(true);
  };
  const chooseSubscriber = (enrollmentId: string) => {
    setSelectedEnrollmentId(enrollmentId);
    // A subscriber who is not assigned to the assessment has no assessment account to pay into.
    const assigned = assessmentForEnrollment(enrollmentId, snapshot!.assessments, snapshot!.assessmentAdjustments);
    if (!assigned.assessment) setUploadPurpose('premium');
  };
  const openProof = async (id: string) => {
    if (!supabase) return;
    const path = await supabase.rpc('get_payment_proof_path', { p_payment_id: id });
    if (path.error || !path.data) { window.alert(path.error?.message ?? 'Payment confirmation is unavailable.'); return; }
    const signed = await supabase.storage.from('payment-proofs').createSignedUrl(path.data, 60);
    if (signed.error) window.alert(signed.error.message);
    else window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return <>
    <PageHeader eyebrow="Administration" title="Payment review" description="Upload confirmations received outside the portal and verify every payment against the custodian's bank records." actions={<Button icon={<FileUp size={18} />} disabled={!eligibleEnrollments.length} onClick={openUpload}>Upload for subscriber</Button>} />
    <div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search payments" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subscriber" /></div><select aria-label="Filter payment status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="pending">Pending review</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All payments</option></select><span>{payments.length} payments</span></div>
    {payments.length ? <div className="payment-review-grid">{payments.map((payment) => <article className="payment-review-card" key={payment.id}>
      <div className="payment-review-card__head"><span className="person-dot">{payment.principalName[0]}</span><div><strong>{payment.principalName}</strong><small>{formatDateTime(payment.submittedAt, snapshot!.program.timezone)}</small></div><StatusBadge status={payment.status} /></div>
      <div className="payment-review-card__amount"><small>{payment.assessmentId ? 'Program assessment' : 'HMO premium'}</small><strong>{formatNaira(payment.amountKobo)}</strong></div>
      <dl><div><dt>Date paid</dt><dd>{formatDate(payment.paidAt, snapshot!.program.timezone)}</dd></div><div><dt>Reference</dt><dd>{payment.reference}</dd></div><div><dt>Confirmation</dt><dd><ReceiptText size={15} />{payment.proofName}</dd></div></dl>
      <div className="payment-review-card__actions">{payment.proofName !== 'No proof' && <Button variant="secondary" icon={<Eye size={17} />} disabled={isDemoMode} onClick={() => void openProof(payment.id)}>View confirmation</Button>}{payment.status === 'pending' && <><Button variant="danger" icon={<X size={17} />} disabled={busy === payment.id} onClick={() => void review(payment, 'rejected')}>Reject</Button><Button icon={<Check size={17} />} disabled={busy === payment.id} onClick={() => void review(payment, 'verified')}>Verify</Button></>}</div>
    </article>)}</div> : <EmptyState icon={<ReceiptText size={29} />} title="No payments in this queue" body="Payment confirmations matching this filter will appear here." />}

    {uploadOpen && <Modal title="Upload for a subscriber" onClose={() => setUploadOpen(false)}>
      <div className="admin-payment-subscriber">
        <label>Subscriber<select aria-label="Subscriber" value={selectedEnrollmentId} onChange={(event) => chooseSubscriber(event.target.value)}>{eligibleEnrollments.map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{fullName(enrollment.principal)} - {enrollment.category}</option>)}</select></label>
        {selectedEnrollment && <div><span>{uploadPurpose === 'assessment' ? 'Assessment' : 'HMO'} balance</span><strong>{formatNaira(selectedOutstanding)} due</strong></div>}
        <label>Payment purpose<select aria-label="Payment purpose" value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value as typeof uploadPurpose)}><option value="premium">HMO premium</option>{selectedAssignment.assessment && <option value="assessment">{selectedAssignment.assessment.name}</option>}</select></label>
      </div>
      {selectedEnrollment && selectedAccount && <PaymentSubmissionForm key={`${selectedEnrollment.id}-${uploadPurpose}`} enrollment={selectedEnrollment} account={selectedAccount} outstandingKobo={selectedOutstanding} timezone={snapshot!.program.timezone} submitLabel="Upload for review" onCancel={() => setUploadOpen(false)} onSubmit={async (payment) => { await submitPayment({ ...payment, assessmentId: uploadPurpose === 'assessment' ? selectedAssignment.assessment?.id : undefined }); setUploadOpen(false); }} />}
    </Modal>}
  </>;
}
