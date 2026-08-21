import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, CircleDollarSign, HeartPulse, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { useApp } from '../context/AppContext';
import { formatNaira, planTotalKobo } from '../lib/money';
import { isDemoMode, supabase } from '../lib/supabase';
import type { JoinConfig } from '../lib/types';

function formatDate(value?: string) {
  if (!value) return 'Dates to be announced';
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function HomePage() {
  const { signIn, notice, authError } = useApp();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<JoinConfig | null>(null);

  useEffect(() => {
    if (!supabase || isDemoMode) return;
    void supabase.rpc('get_public_join_config').then(({ data }) => setConfig(data as JoinConfig));
  }, []);

  const startingTotal = useMemo(() => {
    const premiums = config?.plans.map((plan) => planTotalKobo(plan.individualPremiumKobo)) ?? [];
    return premiums.length ? formatNaira(Math.min(...premiums)) : null;
  }, [config]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim().toLowerCase());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send a secure sign-in link.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="public-home">
    <header className="home-header">
      <Link className="brand" to="/" aria-label="FUTO Alums HMO Program home"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>HMO Program</small></span></Link>
      <nav aria-label="Public navigation"><a href="#program">Program</a><a href="#member-sign-in">Member sign in</a><Link to="/privacy">Privacy</Link></nav>
    </header>

    <section className="home-hero">
      <img src={`${import.meta.env.BASE_URL}assets/enrollment-workspace.webp`} alt="Healthcare enrollment workspace" />
      <div className="home-hero__content">
        <p className="eyebrow">2026 enrollment · FUTO Class of 1996</p>
        <h1>FUTO Alums HMO Program</h1>
        <p>Private, coordinated access to annual AVON health coverage for alumni and their households.</p>
        <div className="home-hero__actions"><Link className="home-action home-action--primary" to="/join"><Users size={18} />Enroll as a new subscriber</Link><a className="home-action home-action--secondary" href="#member-sign-in"><LockKeyhole size={18} />Member sign in</a></div>
      </div>
      <div className="home-hero__status"><span className={config?.acceptingApplications ? 'open' : ''}></span><strong>{config?.acceptingApplications ? 'Enrollment open' : 'Enrollment information'}</strong><small>{config?.period ? `Closes ${formatDate(config.period.endsAt)}` : 'Current dates are loading'}</small></div>
    </section>

    <section className="home-access" id="member-sign-in">
      <div><p className="eyebrow">Returning subscribers</p><h2>Open your private member portal</h2><p>Use the email connected to your subscriber account. We will send a secure, one-time sign-in link.</p></div>
      <form onSubmit={submit}><label htmlFor="home-email">Account email</label><div className="home-signin-row"><input id="home-email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><Button disabled={busy} icon={<ArrowRight size={18} />}>{busy ? 'Sending...' : 'Send sign-in link'}</Button></div>{(error || authError || notice) && <p className={(error || authError) ? 'form-error' : 'form-success'} role="status">{error || authError || notice}</p>}<small>Only records associated with your verified email are available after sign-in.</small></form>
    </section>

    <section className="home-program" id="program">
      <div className="home-section-heading"><p className="eyebrow">How the program works</p><h2>One annual enrollment, managed privately</h2><p>The platform keeps personal records out of group chats and gives administrators a structured process for AVON submission.</p></div>
      <div className="home-program-grid">
        <article><HeartPulse size={24} /><h3>Choose your cover</h3><p>Compare current individual and family offerings, benefits, and total subscriber costs.</p></article>
        <article><ShieldCheck size={24} /><h3>Submit privately</h3><p>Provide AVON enrollment details through your verified account and update them before enrollment closes.</p></article>
        <article><CircleDollarSign size={24} /><h3>Track payment</h3><p>Approved subscribers receive payment instructions and can submit evidence for administrator review.</p></article>
      </div>
    </section>

    <section className="home-enrollment">
      <div><p className="eyebrow">Current enrollment</p><h2>{config?.period ? `${config.period.year} applications` : 'Annual applications'}</h2><p>{config?.acceptingApplications ? `Applications are open through ${formatDate(config.period?.endsAt)}. Administrators may extend or close the period when needed.` : 'Enrollment dates and offerings are managed annually by the program administrators.'}</p></div>
      <dl><div><dt><CalendarDays size={18} />Enrollment window</dt><dd>{config?.period ? `${formatDate(config.period.startsAt)} – ${formatDate(config.period.endsAt)}` : 'June through August'}</dd></div><div><dt><CircleDollarSign size={18} />Subscriber totals</dt><dd>{startingTotal ? `Individual cover from ${startingTotal}` : 'All totals include the disclosed 3% program fee'}</dd></div></dl>
      <Link className="home-action home-action--primary" to="/join">View plans and enroll<ArrowRight size={18} /></Link>
    </section>

    <footer className="home-footer"><div className="brand"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>HMO Program</small></span></div><p>Program privacy contact: Jude Oruoghor · Records retained for seven years.</p><div><Link to="/privacy">Privacy notice</Link><a href="#member-sign-in">Member sign in</a></div></footer>
  </main>;
}
