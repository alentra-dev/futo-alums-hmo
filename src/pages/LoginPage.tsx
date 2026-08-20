import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LockKeyhole, Mail, UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui';

export function LoginPage() {
  const { signIn, demoMode, notice, authError } = useApp();
  const [email, setEmail] = useState(demoMode ? 'ada.okafor@example.com' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await signIn(email.trim().toLowerCase()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  };

  return <main className="login-page">
    <img src={`${import.meta.env.BASE_URL}assets/enrollment-workspace.webp`} alt="Organized healthcare enrollment workspace" />
    <section className="login-panel">
      <div className="brand brand--login"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>HMO Program</small></span></div>
      <div className="login-copy"><p className="eyebrow">Private member portal</p><h1>Your healthcare enrollment, in one place.</h1><p>Review your household details, choose a plan, and keep payments on track.</p></div>
      <form onSubmit={submit}>
        <label htmlFor="email">Email address</label>
        <div className="input-icon"><Mail size={19} /><input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div>
        <Button type="submit" disabled={busy} icon={<ArrowRight size={18} />}>{busy ? 'Sending link…' : demoMode ? 'Open preview' : 'Send secure sign-in link'}</Button>
        {(error || authError || notice) && <p className={(error || authError) ? 'form-error' : 'form-success'}>{error || authError || notice}</p>}
      </form>
      <Link className="join-link" to="/join"><UserPlus size={17} />New subscriber enrollment</Link>
      <div className="security-note"><LockKeyhole size={18} /><span>Your account is restricted to records associated with your verified email.</span></div>
      <a href={`${import.meta.env.BASE_URL}privacy`}>Privacy notice</a>
    </section>
  </main>;
}
