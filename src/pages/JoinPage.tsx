import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, HeartPulse, LogOut, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { Button } from '../components/ui';
import { useApp } from '../context/AppContext';
import { formatBasisPoints, formatNaira, planTotalKobo } from '../lib/money';
import { isDemoMode, supabase } from '../lib/supabase';
import type { JoinConfig, JoinWorkspace, Person, PlanCategory, SubscriberApplication } from '../lib/types';
import { LoadingPage } from './LoadingPage';
import { loadSurchargeRates, surchargeRates, withSurchargeRates } from '../lib/surchargeRates';

function PersonFields({ person, onChange }: { person: Person; onChange: (person: Person) => void }) {
  const field = (key: keyof Person, value: string) => onChange({ ...person, [key]: value });
  return <div className="form-grid">
    <label>Surname<input required autoComplete="family-name" value={person.surname} onChange={(event) => field('surname', event.target.value)} /></label>
    <label>First name<input required autoComplete="given-name" value={person.firstName} onChange={(event) => field('firstName', event.target.value)} /></label>
    <label>Middle name<input required value={person.middleName} onChange={(event) => field('middleName', event.target.value)} placeholder="Enter N/A if none" /></label>
    <label>Date of birth<input required type="date" value={person.dateOfBirth} onChange={(event) => field('dateOfBirth', event.target.value)} /></label>
    <label>Gender<select value={person.gender} onChange={(event) => field('gender', event.target.value)}><option>Female</option><option>Male</option></select></label>
    <label>Relationship<input required value={person.relation} onChange={(event) => field('relation', event.target.value)} /></label>
    <label>Nationality<input required value={person.nationality} onChange={(event) => field('nationality', event.target.value)} /></label>
    <label>Mobile number<input required inputMode="tel" autoComplete="tel" value={person.mobile} onChange={(event) => field('mobile', event.target.value)} /></label>
    <label className="span-2">Email<input required type="email" autoComplete="email" value={person.email} onChange={(event) => field('email', event.target.value)} /></label>
    <label className="span-2">Residential address<textarea required rows={2} value={person.address} onChange={(event) => field('address', event.target.value)} /></label>
    <label>Country<input required value={person.country} onChange={(event) => field('country', event.target.value)} /></label>
    <label>State<input required value={person.state} onChange={(event) => field('state', event.target.value)} /></label>
    <label>Town<input required value={person.town} onChange={(event) => field('town', event.target.value)} /></label>
    <label>LGA<input required value={person.lga} onChange={(event) => field('lga', event.target.value)} /></label>
  </div>;
}

function planPremium(plan: JoinConfig['plans'][number], category: PlanCategory) {
  return category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
}

function planAmount(plan: JoinConfig['plans'][number], category: PlanCategory, period: JoinConfig['period']) {
  return planTotalKobo(planPremium(plan, category), surchargeRates(period));
}

export function JoinPage() {
  const { authenticated, snapshot, register, signOut, notice, authError } = useApp();
  const [config, setConfig] = useState<JoinConfig | null>(isDemoMode ? {
    timezone: 'Africa/Lagos',
    acceptingApplications: true,
    period: snapshot?.period ?? null,
    plans: snapshot?.plans ?? [],
  } : null);
  const [workspace, setWorkspace] = useState<JoinWorkspace | null>(null);
  const [email, setEmail] = useState('');
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState<SubscriberApplication | null>(null);
  const [step, setStep] = useState(1);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadConfig = async () => {
    if (!supabase || isDemoMode) return;
    const { data, error: configError } = await supabase.rpc('get_public_join_config');
    if (configError) throw configError;
    const next = data as JoinConfig;
    if (!next.period) return setConfig(next);
    const rates = await loadSurchargeRates(next.period.id);
    setConfig({ ...next, period: withSurchargeRates(next.period, rates) });
  };

  const loadWorkspace = async () => {
    if (!supabase || isDemoMode) return;
    const { data, error: workspaceError } = await supabase.rpc('get_join_workspace');
    if (workspaceError) throw workspaceError;
    const next = data as JoinWorkspace;
    setWorkspace(next);
    setActiveId((current) => current || next.applications[0]?.id || '');
  };

  useEffect(() => {
    void loadConfig().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load enrollment plans.'));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    if (isDemoMode) {
      setWorkspace({ email: snapshot?.profile.email ?? 'preview@example.com', accountHasMembership: Boolean(snapshot), applications: [] });
      return;
    }
    void loadWorkspace().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load your application.'));
  }, [authenticated, snapshot]);

  useEffect(() => {
    const selected = workspace?.applications.find((application) => application.id === activeId) ?? null;
    setDraft(selected);
    setConsent(Boolean(selected?.consentedAt));
    setStep(1);
  }, [activeId, workspace]);

  const activePlan = useMemo(() => config?.plans.find((plan) => plan.id === draft?.planId) ?? null, [config, draft?.planId]);

  const requestLink = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('email');
    setError('');
    try {
      await register(email.trim().toLowerCase());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send a secure link.');
    } finally {
      setBusy('');
    }
  };

  const createApplication = async () => {
    if (!supabase || isDemoMode) return;
    setBusy('create');
    setError('');
    try {
      const { data, error: createError } = await supabase.rpc('create_subscriber_application');
      if (createError) throw createError;
      await loadWorkspace();
      setActiveId(data as string);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start an application.');
    } finally {
      setBusy('');
    }
  };

  const save = async (submit: boolean) => {
    if (!supabase || !draft) return;
    setBusy(submit ? 'submit' : 'save');
    setError('');
    try {
      const { data, error: saveError } = await supabase.rpc('save_subscriber_application', {
        p_application_id: draft.id,
        p_payload: {
          graduationYear: draft.graduationYear,
          principal: draft.principal,
          dependents: draft.dependents,
          planId: draft.planId,
          category: draft.category,
          hospital: draft.hospital,
          consented: consent,
        },
        p_submit: submit,
      });
      if (saveError) throw saveError;
      setWorkspace(data as JoinWorkspace);
      if (!submit) setStep((current) => Math.min(4, current + 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the application.');
    } finally {
      setBusy('');
    }
  };

  const updatePerson = (person: Person) => {
    if (!draft) return;
    setDraft({ ...draft, principal: person });
  };

  const updateDependent = (person: Person) => {
    if (!draft) return;
    setDraft({ ...draft, dependents: draft.dependents.map((item) => item.id === person.id ? person : item) });
  };

  const addDependent = () => {
    if (!draft || draft.dependents.length >= 5) return;
    setDraft({
      ...draft,
      dependents: [...draft.dependents, {
        ...draft.principal,
        id: crypto.randomUUID(),
        memberType: 'Dependent',
        firstName: '',
        middleName: '',
        surname: '',
        relation: '',
        dateOfBirth: '',
      }],
    });
  };

  if (!config) return <LoadingPage />;

  if (!authenticated) return <main className="join-public">
    <header className="join-public__header">
      <div className="brand"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>HMO Program</small></span></div>
      <Link to="/login"><ArrowLeft size={16} />Member sign in</Link>
    </header>
    <section className="join-intro">
      <div>
        <p className="eyebrow">New subscriber enrollment</p>
        <h1>Join the {config.period?.year ?? 'next'} FUTO alumni health program</h1>
        <p>Verify your email, choose a plan, and provide your enrollment details privately.</p>
      </div>
      <form onSubmit={requestLink}>
        <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <Button disabled={busy === 'email'} icon={<ArrowRight size={18} />}>{busy === 'email' ? 'Sending...' : 'Continue securely'}</Button>
        {(error || authError || notice) && <p className={(error || authError) ? 'form-error' : 'form-success'}>{error || authError || notice}</p>}
        <small>Existing emails return to their current account. A new account is created only after email verification.</small>
      </form>
    </section>
    <section className="join-plans">
      <div className="join-section-title"><p className="eyebrow">{config.period?.year ?? 'Upcoming'} plans</p><h2>Compare subscriber totals</h2><p>Every displayed amount includes {formatBasisPoints(config.period?.nhisFeeBasisPoints ?? 100)}% AVON NHIS, {formatBasisPoints(config.period?.programFeeBasisPoints ?? 1500)}% program administrative fee.</p></div>
      {config.acceptingApplications ? <div className="plan-grid">{config.plans.map((plan) => <article className="plan-card" key={plan.id}><span className="plan-code">{plan.code.replaceAll('_', ' ')}</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="join-plan-prices"><span><small>Individual</small><strong>{formatNaira(planAmount(plan, 'individual', config.period))}</strong></span><span><small>Family</small><strong>{formatNaira(planAmount(plan, 'family', config.period))}</strong></span></div><ul>{plan.highlights.map((highlight) => <li key={highlight}><Check size={15} />{highlight}</li>)}</ul></article>)}</div> : <div className="info-banner"><ShieldCheck size={19} /><span>New applications are currently closed. The next enrollment period will appear here when administrators open it.</span></div>}
    </section>
    <footer className="join-footer"><Link to="/privacy">Privacy notice</Link><span>Privacy contact: Jude Oruoghor</span></footer>
  </main>;

  if (!workspace) return <LoadingPage />;

  const unresolved = workspace.applications.some((application) => ['draft', 'pending_review', 'request_changes'].includes(application.status));
  const resolvedDraft = draft && ['approved', 'rejected', 'pending_review'].includes(draft.status);

  return <main className="join-workspace">
    <header className="join-workspace__header">
      <div className="brand"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>New subscriber application</small></span></div>
      <div><span>{workspace.email}</span><button onClick={() => void signOut()}><LogOut size={16} />Sign out</button></div>
    </header>
    <div className="join-workspace__body">
      <aside className="application-list">
        <p className="eyebrow">Applications</p>
        {workspace.applications.map((application) => <button key={application.id} className={clsx(application.id === activeId && 'active')} onClick={() => setActiveId(application.id)}><span>{application.principal.firstName || 'New'} {application.principal.surname || 'subscriber'}</span><small>{application.year} · {application.status.replace('_', ' ')}</small></button>)}
        {workspace.accountHasMembership && !unresolved && <Button variant="secondary" icon={<Plus size={17} />} disabled={busy === 'create'} onClick={() => void createApplication()}>Add principal</Button>}
      </aside>

      <section className="join-application">
        {!draft && <div className="join-empty">
          <UserPlus size={34} />
          <h1>Start a subscriber application</h1>
          <p>Your verified email will manage this principal member's private enrollment records.</p>
          <Button disabled={!config.acceptingApplications || busy === 'create'} icon={<ArrowRight size={18} />} onClick={() => void createApplication()}>{busy === 'create' ? 'Starting...' : 'Begin application'}</Button>
        </div>}

        {draft && resolvedDraft && <div className={clsx('application-result', `application-result--${draft.status}`)}>
          {draft.status === 'approved' ? <><Check size={30} /><p className="eyebrow">Approved</p><h1>Your subscriber account is ready</h1><p>Enrollment and payment tools are now available in your private portal.</p><Button icon={<ArrowRight size={18} />} onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Open subscriber portal</Button></> : draft.status === 'pending_review' ? <><ShieldCheck size={30} /><p className="eyebrow">Admin review</p><h1>Application received</h1><p>{draft.duplicateStatus === 'review_required' ? 'An administrator will confirm a possible match with an existing record through the alumni group.' : 'An administrator will confirm your membership and activate payment access.'}</p><dl><div><dt>Principal</dt><dd>{draft.principal.firstName} {draft.principal.surname}</dd></div><div><dt>Plan</dt><dd>{activePlan?.name}</dd></div><div><dt>Plan type</dt><dd>{draft.category}</dd></div></dl><Button variant="secondary" onClick={() => void loadWorkspace().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to refresh status.'))}>Check status</Button></> : <><ShieldCheck size={30} /><p className="eyebrow">Application closed</p><h1>Contact a program administrator</h1><p>{draft.adminNote || 'This application matched an existing subscriber record and was not approved as a new subscriber.'}</p></>}
        </div>}

        {draft && !resolvedDraft && <>
          <div className="join-progress" aria-label="Application progress">{['Principal', 'Plan', 'Family', 'Review'].map((label, index) => <span key={label} className={clsx(index + 1 === step && 'active', index + 1 < step && 'complete')}><b>{index + 1 < step ? <Check size={14} /> : index + 1}</b>{label}</span>)}</div>
          {draft.status === 'request_changes' && <div className="info-banner"><ShieldCheck size={18} /><span><strong>Changes requested:</strong> {draft.adminNote || 'Review the application and submit it again.'}</span></div>}
          {error && <p className="form-error join-error" role="alert">{error}</p>}

          {step === 1 && <form className="form-section join-step" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
            <div className="section-heading"><span><UserPlus size={20} /></span><div><h2>Principal member</h2><p>Use the details that should appear in the AVON enrollment.</p></div></div>
            <label className="join-graduation">FUTO graduation year<input required type="number" min="1960" max={new Date().getFullYear()} value={draft.graduationYear} onChange={(event) => setDraft({ ...draft, graduationYear: Number(event.target.value) })} /></label>
            <PersonFields person={draft.principal} onChange={updatePerson} />
            <div className="join-step__actions"><Button disabled={busy === 'save'} icon={<ArrowRight size={17} />}>{busy === 'save' ? 'Saving...' : 'Save and continue'}</Button></div>
          </form>}

          {step === 2 && <form className="form-section join-step" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
            <div className="section-heading"><span><HeartPulse size={20} /></span><div><h2>Plan and hospital</h2><p>Select annual cover for this principal or household.</p></div></div>
            <div className="segmented join-category" role="group" aria-label="Plan type"><button type="button" className={clsx(draft.category === 'individual' && 'active')} onClick={() => setDraft({ ...draft, category: 'individual', dependents: [] })}>Individual</button><button type="button" className={clsx(draft.category === 'family' && 'active')} onClick={() => setDraft({ ...draft, category: 'family' })}>Family</button></div>
            {draft.category === 'family' && <div className="info-banner"><Users size={18} /><span>Family pricing covers a principal, spouse, and up to four biological or legally adopted children under 21.</span></div>}
            <div className="join-plan-options">{config.plans.map((plan) => <label key={plan.id} className={clsx(draft.planId === plan.id && 'selected')}><input required type="radio" name="plan" checked={draft.planId === plan.id} onChange={() => setDraft({ ...draft, planId: plan.id })} /><span><strong>{plan.name}</strong><small>{plan.region}</small></span><b>{formatNaira(planAmount(plan, draft.category, config.period))}</b></label>)}</div>
            {activePlan && <FeeBreakdown premiumKobo={planPremium(activePlan, draft.category)} rates={surchargeRates(config.period)} />}
            <label>Preferred hospital<input required value={draft.hospital} onChange={(event) => setDraft({ ...draft, hospital: event.target.value })} placeholder="Start typing a hospital name" /></label>
            <div className="join-step__actions"><Button type="button" variant="secondary" onClick={() => setStep(1)}>Back</Button><Button disabled={busy === 'save'} icon={<ArrowRight size={17} />}>{busy === 'save' ? 'Saving...' : 'Save and continue'}</Button></div>
          </form>}

          {step === 3 && <form className="form-section join-step" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
            <div className="section-heading"><span><Users size={20} /></span><div><h2>{draft.category === 'family' ? 'Family members' : 'Individual coverage'}</h2><p>{draft.category === 'family' ? 'All dependent fields are required for AVON.' : 'No dependent information is needed.'}</p></div></div>
            {draft.category === 'family' ? <div className="join-dependents">{draft.dependents.map((dependent, index) => <section key={dependent.id}><header><strong>Dependent {index + 1}</strong><button type="button" title="Remove dependent" aria-label="Remove dependent" onClick={() => setDraft({ ...draft, dependents: draft.dependents.filter((item) => item.id !== dependent.id) })}><Trash2 size={17} /></button></header><PersonFields person={dependent} onChange={updateDependent} /></section>)}<Button type="button" variant="secondary" icon={<Plus size={17} />} disabled={draft.dependents.length >= 5} onClick={addDependent}>Add dependent</Button></div> : <div className="join-individual-note"><UserPlus size={26} /><span><strong>{draft.principal.firstName} {draft.principal.surname}</strong><small>Principal member only</small></span></div>}
            <div className="join-step__actions"><Button type="button" variant="secondary" onClick={() => setStep(2)}>Back</Button><Button disabled={busy === 'save'} icon={<ArrowRight size={17} />}>{busy === 'save' ? 'Saving...' : 'Save and continue'}</Button></div>
          </form>}

          {step === 4 && <form className="form-section join-step" onSubmit={(event) => { event.preventDefault(); void save(true); }}>
            <div className="section-heading"><span><ShieldCheck size={20} /></span><div><h2>Review and submit</h2><p>Payment becomes available after a quick administrator review.</p></div></div>
            <div className="application-review"><dl><div><dt>Principal</dt><dd>{draft.principal.firstName} {draft.principal.middleName} {draft.principal.surname}</dd></div><div><dt>Graduation year</dt><dd>{draft.graduationYear}</dd></div><div><dt>Plan</dt><dd>{activePlan?.name ?? 'Not selected'}</dd></div><div><dt>Plan type</dt><dd>{draft.category}</dd></div><div><dt>People covered</dt><dd>{draft.dependents.length + 1}</dd></div><div><dt>Subscriber total</dt><dd>{activePlan ? formatNaira(planAmount(activePlan, draft.category, config.period)) : 'Not selected'}</dd></div><div><dt>Hospital</dt><dd>{draft.hospital || 'Not entered'}</dd></div></dl></div>
            {activePlan && <FeeBreakdown premiumKobo={planPremium(activePlan, draft.category)} rates={surchargeRates(config.period)} />}
            <label className="consent-box"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I authorize the FUTO Alums HMO Program to process and share this enrollment information with AVON and necessary service providers. I confirm that I am authorized to provide information for each family member and have informed adult family members. Records may be retained for seven years. <Link to="/privacy">Read the privacy notice</Link>.</span></label>
            <div className="join-step__actions"><Button type="button" variant="secondary" onClick={() => setStep(3)}>Back</Button><Button disabled={busy === 'submit'} icon={<ShieldCheck size={17} />}>{busy === 'submit' ? 'Submitting...' : 'Submit for approval'}</Button></div>
          </form>}
        </>}
      </section>
    </div>
  </main>;
}
