import { useMemo, useState } from 'react';
import { Check, Eye, FileUp, ReceiptText, Search, X } from 'lucide-react';
import { PaymentSubmissionForm } from '../../components/PaymentSubmissionForm';
import { Button, EmptyState, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { formatDateTime, fullName } from '../../lib/format';
import { formatNaira } from '../../lib/money';
import { isDemoMode, supabase } from '../../lib/supabase';

export function AdminPaymentsPage() {
  const { snapshot, reviewPayment, submitPayment } = useApp();
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const payments = useMemo(() => snapshot!.payments.filter((item) => (filter === 'all' || item.status === filter) && item.principalName.toLowerCase().includes(query.toLowerCase())), [snapshot, filter, query]);
  const eligibleEnrollments = useMemo(() => snapshot!.enrollments
    .filter((enrollment) => enrollment.planId && enrollment.totalKobo > 0 && ['submitted', 'closed'].includes(enrollment.status))
    .sort((a, b) => fullName(a.principal).localeCompare(fullName(b.principal))), [snapshot]);
  const selectedEnrollment = eligibleEnrollments.find((enrollment) => enrollment.id === selectedEnrollmentId) ?? null;
  const selectedVerified = selectedEnrollment ? snapshot!.payments.filter((payment) => payment.enrollmentId === selectedEnrollment.id && payment.status === 'verified').reduce((sum, payment) => sum + payment.amountKobo, 0) : 0;
  const selectedOutstanding = selectedEnrollment ? Math.max(0, selectedEnrollment.totalKobo - selectedVerified) : 0;

  const review = async (id: string, status: 'verified' | 'rejected') => {
    setBusy(id);
    try { await reviewPayment(id, status); } finally { setBusy(''); }
  };
  const openUpload = () => {
    setSelectedEnrollmentId(eligibleEnrollments[0]?.id ?? '');
    setUploadOpen(true);
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
      <div className="payment-review-card__amount"><small>Amount notified</small><strong>{formatNaira(payment.amountKobo)}</strong></div>
      <dl><div><dt>Date paid</dt><dd>{payment.paidAt}</dd></div><div><dt>Reference</dt><dd>{payment.reference}</dd></div><div><dt>Confirmation</dt><dd><ReceiptText size={15} />{payment.proofName}</dd></div></dl>
      <div className="payment-review-card__actions"><Button variant="secondary" icon={<Eye size={17} />} disabled={isDemoMode} onClick={() => void openProof(payment.id)}>View confirmation</Button>{payment.status === 'pending' && <><Button variant="danger" icon={<X size={17} />} disabled={busy === payment.id} onClick={() => void review(payment.id, 'rejected')}>Reject</Button><Button icon={<Check size={17} />} disabled={busy === payment.id} onClick={() => void review(payment.id, 'verified')}>Verify</Button></>}</div>
    </article>)}</div> : <EmptyState icon={<ReceiptText size={29} />} title="No payments in this queue" body="Payment confirmations matching this filter will appear here." />}

    {uploadOpen && <Modal title="Upload for a subscriber" onClose={() => setUploadOpen(false)}>
      <div className="admin-payment-subscriber">
        <label>Subscriber<select aria-label="Subscriber" value={selectedEnrollmentId} onChange={(event) => setSelectedEnrollmentId(event.target.value)}>{eligibleEnrollments.map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{fullName(enrollment.principal)} - {enrollment.category}</option>)}</select></label>
        {selectedEnrollment && <div><span>Total {formatNaira(selectedEnrollment.totalKobo)}</span><strong>{formatNaira(selectedOutstanding)} outstanding</strong></div>}
      </div>
      {selectedEnrollment && <PaymentSubmissionForm key={selectedEnrollment.id} enrollment={selectedEnrollment} account={snapshot!.paymentAccount} outstandingKobo={selectedOutstanding} submitLabel="Upload for review" onCancel={() => setUploadOpen(false)} onSubmit={async (payment) => { await submitPayment(payment); setUploadOpen(false); }} />}
    </Modal>}
  </>;
}
