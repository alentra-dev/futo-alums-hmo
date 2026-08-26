import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Hospital, Info, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { fullName } from '../lib/format';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../components/ui';
import { householdValidationMessage, isEnrollmentEditable, MAX_FAMILY_DEPENDENTS } from '../lib/subscriberWorkflow';
import type { Person } from '../lib/types';

function PersonFields({ person, onChange }: { person: Person; onChange: (person: Person) => void }) {
  const field = (key: keyof Person, value: string) => onChange({ ...person, [key]: value });
  return <div className="form-grid">
    <label>Surname<input required value={person.surname} onChange={(e) => field('surname', e.target.value)} /></label>
    <label>First name<input required value={person.firstName} onChange={(e) => field('firstName', e.target.value)} /></label>
    <label>Middle name<input required value={person.middleName} onChange={(e) => field('middleName', e.target.value)} /></label>
    <label>Date of birth<input required type="date" value={person.dateOfBirth} onChange={(e) => field('dateOfBirth', e.target.value)} /></label>
    <label>Gender<select value={person.gender} onChange={(e) => field('gender', e.target.value)}><option>Female</option><option>Male</option></select></label>
    <label>Relationship<input required value={person.relation} onChange={(e) => field('relation', e.target.value)} /></label>
    <label>Nationality<input required value={person.nationality} onChange={(e) => field('nationality', e.target.value)} /></label>
    <label>Mobile number<input required inputMode="tel" value={person.mobile} onChange={(e) => field('mobile', e.target.value)} /></label>
    <label className="span-2">Email<input required type="email" value={person.email} onChange={(e) => field('email', e.target.value)} /></label>
    <label className="span-2">Residential address<textarea required rows={2} value={person.address} onChange={(e) => field('address', e.target.value)} /></label>
    <label>Country<input required value={person.country} onChange={(e) => field('country', e.target.value)} /></label>
    <label>State<input required value={person.state} onChange={(e) => field('state', e.target.value)} /></label>
    <label>Town<input required value={person.town} onChange={(e) => field('town', e.target.value)} /></label>
    <label>LGA<input required value={person.lga} onChange={(e) => field('lga', e.target.value)} /></label>
  </div>;
}

export function EnrollmentPage() {
  const { snapshot, activeEnrollmentId, updateEnrollment } = useApp();
  const original = subscriberEnrollment(snapshot!, activeEnrollmentId);
  const [draft, setDraft] = useState(original);
  const [expanded, setExpanded] = useState<string>(original.principal.id);
  const [consent, setConsent] = useState(Boolean(original.consentedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = isEnrollmentEditable(snapshot!.period);
  const householdIssue = householdValidationMessage(draft.category, draft.dependents.length);
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === draft.planId);
  const people = useMemo(() => [draft.principal, ...draft.dependents], [draft]);

  useEffect(() => {
    setDraft(original);
    setExpanded(original.principal.id);
    setConsent(Boolean(original.consentedAt));
    setError('');
  }, [original]);

  const replacePerson = (person: Person) => {
    if (person.id === draft.principal.id) setDraft({ ...draft, principal: person });
    else setDraft({ ...draft, dependents: draft.dependents.map((item) => item.id === person.id ? person : item) });
  };

  const removeDependent = (person: Person) => {
    if (!window.confirm(`Remove ${fullName(person)} from the ${draft.year} enrollment? Historical enrollment years will not be changed.`)) return;
    setDraft({ ...draft, dependents: draft.dependents.filter((item) => item.id !== person.id) });
    setExpanded(draft.principal.id);
    setError('');
  };


  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editable) return;
    if (householdIssue) {
      setError(householdIssue);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateEnrollment(draft.id, { ...draft, consentedAt: consent ? new Date().toISOString() : null, status: consent ? 'submitted' : 'draft', completeness: consent ? 100 : draft.completeness });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save enrollment changes.');
    } finally { setBusy(false); }
  };

  return <>
    <PageHeader eyebrow={`${draft.year} enrollment · Step 2 of 3`} title="Confirm who is covered" description="Review one person at a time. Saved details remain editable until enrollment closes." actions={<StatusBadge status={draft.status} />} />
    {!editable && <div className="info-banner"><Info size={18} /><span>This enrollment period is closed. Details remain available as read-only records.</span></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="enrollment-layout">
      <form className="enrollment-form" onSubmit={save}>
        <section className="panel progress-panel"><div className="panel__heading"><div><p className="eyebrow">Enrollment readiness</p><h2>{draft.completeness === 100 ? 'Ready for submission' : 'Details need attention'}</h2></div><strong>{draft.completeness}%</strong></div><ProgressBar value={draft.completeness} /></section>

        <section className="form-section"><div className="section-heading"><span><UserRound size={20} /></span><div><h2>Covered people</h2><p>Review the principal and any dependents included this year.</p></div></div>
          <div className="accordion-list">
            {people.map((person, index) => <article className="accordion" key={person.id}>
              <button type="button" className="accordion__trigger" onClick={() => setExpanded(expanded === person.id ? '' : person.id)}><span className="person-dot">{person.firstName[0]}</span><span><strong>{fullName(person)}</strong><small>{index === 0 ? 'Principal member' : person.relation.toLowerCase()}</small></span><Check size={17} />{expanded === person.id ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>
              {expanded === person.id && <div className="accordion__content"><fieldset disabled={!editable}><PersonFields person={person} onChange={replacePerson} /></fieldset>{index > 0 && editable && <Button type="button" variant="danger" icon={<Trash2 size={17} />} onClick={() => removeDependent(person)}>Remove dependent</Button>}</div>}
            </article>)}
          </div>
          {draft.category === 'family' && editable && <Button type="button" variant="secondary" icon={<Plus size={18} />} disabled={draft.dependents.length >= MAX_FAMILY_DEPENDENTS} onClick={() => setDraft({ ...draft, dependents: [...draft.dependents, { ...draft.principal, id: crypto.randomUUID(), memberType: 'Dependent', firstName: '', middleName: '', relation: '', dateOfBirth: '', email: draft.principal.email }] })}>{draft.dependents.length >= MAX_FAMILY_DEPENDENTS ? 'Dependent limit reached' : 'Add dependent'}</Button>}
        </section>

        <section className="form-section"><div className="section-heading"><span><Hospital size={20} /></span><div><h2>Care preference</h2><p>Confirm the selected plan and enter the preferred hospital.</p></div></div>
          <div className="selection-summary"><div><small>Selected plan</small><strong>{selectedPlan?.name ?? 'No plan selected'}</strong><span>{draft.category} coverage</span></div>{editable && <a href={`${import.meta.env.BASE_URL}plans`}>Change plan</a>}</div>
          <label>Preferred hospital<input required disabled={!editable} list="hospitals" value={draft.hospital} onChange={(e) => setDraft({ ...draft, hospital: e.target.value })} placeholder="Start typing a hospital name" /></label>
          <datalist id="hospitals">{snapshot!.hospitalSuggestions.map((hospital) => <option key={hospital} value={hospital} />)}</datalist>
        </section>

        <section className="form-section"><div className="section-heading"><span><ShieldCheck size={20} /></span><div><h2>Review and submit</h2><p>This final confirmation sends the enrollment to administrators.</p></div></div>
          <label className="consent-box"><input type="checkbox" disabled={!editable} checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>I authorize the FUTO Alums HMO Program to process and share the information in this enrollment with AVON and necessary service providers. I confirm that I am authorized to provide information for each listed family member and have informed adult family members. Records may be retained for seven years. <a href={`${import.meta.env.BASE_URL}privacy`}>Read the privacy notice</a>.</span></label>
        </section>
        <div className="sticky-actions"><span>{editable ? 'Next: notify payment after submission.' : 'This enrollment is read only.'}</span><Button type="submit" disabled={busy || !editable}>{busy ? 'Saving…' : editable ? 'Submit enrollment' : 'Enrollment closed'}</Button></div>
      </form>
      <aside className="enrollment-summary panel"><p className="eyebrow">At a glance</p><h2>{selectedPlan?.name}</h2><dl><div><dt>Coverage</dt><dd>{draft.category}</dd></div><div><dt>People</dt><dd>{people.length}</dd></div><div><dt>Hospital</dt><dd>{draft.hospital || 'Not selected'}</dd></div><div><dt>Status</dt><dd><StatusBadge status={draft.status} /></dd></div></dl>{selectedPlan && <FeeBreakdown premiumKobo={draft.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo} compact />}</aside>
    </div>
  </>;
}
