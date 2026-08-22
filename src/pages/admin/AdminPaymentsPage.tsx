import { useMemo, useState } from 'react';
import { Check, Eye, ReceiptText, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { isDemoMode, supabase } from '../../lib/supabase';
import { formatDateTime } from '../../lib/format';
import { formatNaira } from '../../lib/money';
import { Button, EmptyState, PageHeader, StatusBadge } from '../../components/ui';

export function AdminPaymentsPage() {
  const { snapshot, reviewPayment } = useApp();
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const payments = useMemo(() => snapshot!.payments.filter((item) => (filter === 'all' || item.status === filter) && item.principalName.toLowerCase().includes(query.toLowerCase())), [snapshot, filter, query]);
  const review = async (id: string, status: 'verified' | 'rejected') => { setBusy(id); try { await reviewPayment(id, status); } finally { setBusy(''); } };
  const openProof = async (id: string) => { if (!supabase) return; const path = await supabase.rpc('get_payment_proof_path', { p_payment_id: id }); if (path.error || !path.data) { window.alert(path.error?.message ?? 'Payment proof is unavailable.'); return; } const signed = await supabase.storage.from('payment-proofs').createSignedUrl(path.data, 60); if (signed.error) window.alert(signed.error.message); else window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer'); };

  return <>
    <PageHeader eyebrow="Administration" title="Payment review" description="Verify every notification against the custodian’s bank records." />
    <div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search payments" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subscriber" /></div><select aria-label="Filter payment status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="pending">Pending review</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All payments</option></select><span>{payments.length} payments</span></div>
    {payments.length ? <div className="payment-review-grid">{payments.map((payment) => <article className="payment-review-card" key={payment.id}><div className="payment-review-card__head"><span className="person-dot">{payment.principalName[0]}</span><div><strong>{payment.principalName}</strong><small>{formatDateTime(payment.submittedAt, snapshot!.program.timezone)}</small></div><StatusBadge status={payment.status} /></div><div className="payment-review-card__amount"><small>Amount notified</small><strong>{formatNaira(payment.amountKobo)}</strong></div><dl><div><dt>Date paid</dt><dd>{payment.paidAt}</dd></div><div><dt>Reference</dt><dd>{payment.reference}</dd></div><div><dt>Proof</dt><dd><ReceiptText size={15} />{payment.proofName}</dd></div></dl><div className="payment-review-card__actions"><Button variant="secondary" icon={<Eye size={17} />} disabled={isDemoMode} onClick={() => void openProof(payment.id)}>View proof</Button>{payment.status === 'pending' && <><Button variant="danger" icon={<X size={17} />} disabled={busy === payment.id} onClick={() => void review(payment.id, 'rejected')}>Reject</Button><Button icon={<Check size={17} />} disabled={busy === payment.id} onClick={() => void review(payment.id, 'verified')}>Verify</Button></>}</div></article>)}</div> : <EmptyState icon={<ReceiptText size={29} />} title="No payments in this queue" body="Payment notifications matching this filter will appear here." />}
  </>;
}
