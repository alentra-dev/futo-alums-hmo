import { useState, type FormEvent } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { errorMessage } from '../lib/errorMessage';
import { nairaToKobo } from '../lib/money';
import type { Enrollment, PaymentAccount, PaymentInput } from '../lib/types';
import { Button } from './ui';

interface PaymentSubmissionFormProps {
  enrollment: Enrollment;
  account: PaymentAccount;
  outstandingKobo: number;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (payment: PaymentInput) => Promise<void>;
}

function lagosDateValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function PaymentSubmissionForm({ enrollment, account, outstandingKobo, submitLabel = 'Upload confirmation', onCancel, onSubmit }: PaymentSubmissionFormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const proof = data.get('proof') as File;
    if (proof.size > 10 * 1024 * 1024) { setError('The payment confirmation must be 10 MB or smaller.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(proof.type)) { setError('Use a JPG, PNG, or PDF payment confirmation.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        enrollmentId: enrollment.id,
        amountKobo: nairaToKobo(data.get('amount') as string),
        paidAt: data.get('paidAt') as string,
        reference: data.get('reference') as string,
        proof: proof.size ? proof : undefined,
      });
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to upload the payment confirmation.'));
    } finally {
      setBusy(false);
    }
  };

  return <form className="modal-form" onSubmit={submit}>
    <div className="partial-warning"><Info size={18} /><span>{outstandingKobo === 0 ? 'Verified payments currently cover the total payable. You can still upload a confirmation that is missing from the payment history.' : 'Full payment is strongly encouraged. Partial payments are accepted, and every transfer needs its own confirmation.'}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <label>Amount shown on confirmation (₦)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" inputMode="decimal" /></label>
    <label>Date paid<input name="paidAt" type="date" required defaultValue={lagosDateValue()} /></label>
    <label>Transfer reference<input name="reference" required defaultValue={`${account.referencePrefix} - ${enrollment.principal.firstName} ${enrollment.principal.surname}`} /></label>
    <label className="file-field"><span>Payment confirmation</span><input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required /><small>Upload a clear PDF, JPG, or PNG file, up to 10 MB.</small></label>
    <div className="modal__actions"><Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy} icon={<CheckCircle2 size={17} />}>{busy ? 'Uploading...' : submitLabel}</Button></div>
  </form>;
}
