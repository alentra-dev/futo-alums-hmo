import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { KeyRound, MailCheck, Pencil, Search, Users } from 'lucide-react';
import { Button, EmptyState, Modal, PageHeader } from '../../components/ui';
import { isDemoMode, supabase } from '../../lib/supabase';

interface SubscriberAccount {
  userId: string;
  displayName: string;
  accountEmail: string;
  householdCount: number;
  principalNames: string[];
}

interface ChangeResult {
  changed: boolean;
  loginLinkSent: boolean;
  loginLinkWarning: string | null;
}

async function invocationErrorMessage(error: unknown) {
  const context = (error as { context?: Response } | null)?.context;
  if (context) {
    const body = await context.clone().json().catch(() => null) as { error?: string } | null;
    if (body?.error) return body.error;
  }
  return error instanceof Error ? error.message : 'Unable to change the account email.';
}

export function AdminSubscriberAccessPage() {
  const [accounts, setAccounts] = useState<SubscriberAccount[]>(isDemoMode ? [{ userId: 'subscriber-demo', displayName: 'Ada Okafor', accountEmail: 'ada.okafor@example.com', householdCount: 2, principalNames: ['Ada Okafor', 'Chidi Okafor'] }] : []);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SubscriberAccount | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [sendLoginLink, setSendLoginLink] = useState(true);
  const [loading, setLoading] = useState(!isDemoMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    if (!supabase || isDemoMode) return;
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_admin_subscriber_accounts');
    setLoading(false);
    if (loadError) throw loadError;
    setAccounts((data ?? []) as SubscriberAccount[]);
  };

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load subscriber accounts.')); }, []);

  const visible = useMemo(() => accounts.filter((account) => `${account.displayName} ${account.accountEmail} ${account.principalNames.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())), [accounts, query]);
  const openEditor = (account: SubscriberAccount) => {
    setSelected(account);
    setNewEmail('');
    setConfirmationEmail('');
    setSendLoginLink(true);
    setError('');
  };
  const closeEditor = () => { if (!busy) setSelected(null); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const normalized = newEmail.trim().toLowerCase();
    if (normalized !== confirmationEmail.trim().toLowerCase()) { setError('The two replacement email entries do not match.'); return; }
    if (normalized === selected.accountEmail.toLowerCase()) { setError('Enter a different email address.'); return; }
    if (!window.confirm(`Change portal access for ${selected.principalNames.join(', ')} from ${selected.accountEmail} to ${normalized}?`)) return;

    setBusy(true);
    setError('');
    try {
      if (isDemoMode) {
        setAccounts((current) => current.map((account) => account.userId === selected.userId ? { ...account, accountEmail: normalized } : account));
        setNotice(`Account access updated to ${normalized}.`);
      } else {
        if (!supabase) throw new Error('Supabase is unavailable.');
        const { data, error: invokeError } = await supabase.functions.invoke<ChangeResult>('change-subscriber-access-email', { body: { userId: selected.userId, currentEmail: selected.accountEmail, newEmail: normalized, sendLoginLink } });
        if (invokeError) throw new Error(await invocationErrorMessage(invokeError));
        await load();
        setNotice(data?.loginLinkSent ? `Account access updated to ${normalized}. A one-time sign-in link was sent.` : data?.loginLinkWarning ?? `Account access updated to ${normalized}.`);
      }
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the account email.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <PageHeader eyebrow="Administration" title="Subscriber account access" description="Change the email used to sign in without altering enrollment records or creating a duplicate account." actions={<span className="secure-label"><KeyRound size={17} />Admins only</span>} />
    <div className="filter-bar"><div className="input-icon"><Search size={18} /><input aria-label="Search subscriber accounts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search principal or account email" /></div><span>{loading ? 'Loading...' : `${visible.length} accounts`}</span></div>
    {notice && <div className="admin-notice" role="status"><MailCheck size={18} /><span>{notice}</span></div>}
    {error && !selected && <p className="form-error admin-page-error" role="alert">{error}</p>}
    {!loading && (visible.length ? <div className="subscriber-access-list">{visible.map((account) => <article className="panel" key={account.userId}><span className="person-dot"><KeyRound size={16} /></span><div className="subscriber-access-list__identity"><strong>{account.displayName || account.principalNames[0]}</strong><small>{account.accountEmail}</small></div><div className="subscriber-access-list__principals"><small>Managed principal{account.principalNames.length === 1 ? '' : 's'}</small><strong>{account.principalNames.join(', ')}</strong><span>{account.householdCount} linked household{account.householdCount === 1 ? '' : 's'}</span></div><Button variant="secondary" icon={<Pencil size={17} />} onClick={() => openEditor(account)}>Change email</Button></article>)}</div> : <EmptyState icon={<Users size={29} />} title="No matching subscriber accounts" body="Only active subscriber accounts linked to at least one household appear here." />)}

    {selected && <Modal title="Change subscriber access email" onClose={closeEditor}><form className="modal-form" onSubmit={submit}><div className="account-change-summary"><small>Current account</small><strong>{selected.accountEmail}</strong><span>This login manages {selected.principalNames.join(', ')}.</span></div><label>New access email<input required type="email" autoComplete="off" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="subscriber@example.com" /></label><label>Confirm new access email<input required type="email" autoComplete="off" value={confirmationEmail} onChange={(event) => setConfirmationEmail(event.target.value)} placeholder="Re-enter the email" /></label><label className="consent-box account-link-option"><input type="checkbox" checked={sendLoginLink} onChange={(event) => setSendLoginLink(event.target.checked)} /><span>Send a fresh one-time portal sign-in link to the new address.</span></label><div className="account-change-note">This changes portal login access for every principal managed by this account. It does not modify email fields stored in current or historical AVON enrollment records.</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal__actions"><Button type="button" variant="secondary" disabled={busy} onClick={closeEditor}>Cancel</Button><Button disabled={busy} icon={<Pencil size={17} />}>{busy ? 'Changing...' : 'Change access email'}</Button></div></form></Modal>}
  </>;
}
