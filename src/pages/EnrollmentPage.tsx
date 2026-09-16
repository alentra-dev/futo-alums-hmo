import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Hospital, Info, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDate, fullName, programDateValue } from '../lib/format';
import { errorMessage } from '../lib/errorMessage';
import { canActForSubscribers, workspaceEnrollment } from '../lib/enrollmentAccess';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { PersonFields } from '../components/PersonFields';
import { surchargeRates } from '../lib/surchargeRates';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../components/ui';
import { incompletePersonMessage } from '../lib/personValidation';
import { syncDependentResidences } from '../lib/personDetails';
import { householdValidationMessage, isEnrollmentEditable, MAX_FAMILY_DEPENDENTS } from '../lib/subscriberWorkflow';
import type { Person } from '../lib/types';

export function EnrollmentPage() {
  const { snapshot, activeEnrollmentId, actingEnrollmentId, updateEnrollment, recordOfflineConsent } = useApp();
  const original = workspaceEnrollment(snapshot!, activeEnrollmentId, actingEnrollmentId);
  const [draft, setDraft] = useState(original);
  const [expanded, setExpanded] = useState<string>(original.principal.id);
  const [consent, setConsent] = useState(Boolean(original.consentedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const acting = Boolean(actingEnrollmentId) && canActForSubscribers(snapshot!);
  const consentRecord = snapshot!.consentRecords.find((item) => item.enrollmentId === original.id);
  const [consentNote, setConsentNote] = useState(consentRecord?.note ?? '');
  const [consentDate, setConsentDate] = useState(() => (consentRecord?.consentedAt ?? new Date().toISOString()).slice(0, 10));
  const editable = isEnrollmentEditable(snapshot!.period);
  const householdIssue = householdValidationMessage(draft.category, draft.dependents.length);
  const selectedPlan = snapshot!.plans.find((plan) => plan.id === draft.planId);
  const people = useMemo(() => [draft.principal, ...draft.dependents], [draft]);

  useEffect(() => {
    setDraft(original);
    setExpanded(original.principal.id);
    setConsent(Boolean(original.consentedAt));
    setConsentNote(consentRecord?.note ?? '');
    setConsentDate((consentRecord?.consentedAt ?? new Date().toISOString()).slice(0, 10));
    setError('');
  }, [original, consentRecord]);

  const replacePerson = (person: Person) => {
    if (person.id === draft.principal.id) setDraft({ ...draft, principal: person, dependents: syncDependentResidences(draft.principal, person, draft.dependents) });
    else setDraft({ ...draft, dependents: draft.dependents.map((item) => item.id === person.id ? person : item) });
  };

  const removeDependent = (person: Person) => {
    if (!window.confirm(`Remove ${fullName(person)} from the ${draft.year} enrollment? Historical enrollment years will not be changed.`)) return;
    setDraft({ ...draft, dependents: draft.dependents.filter((item) => item.id !== person.id) });
    setExpanded(draft.principal.id);
    setError('');
  };


  const saveOfflineConsent = async () => {
    setBusy(true);
    setError('');
    try {
      await recordOfflineConsent(original.id, consentNote.trim(), new Date(`${consentDate}T12:00:00Z`).toISOString());
      setConsent(true);
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to record the offline consent.'));
    } finally { setBusy(false); }
  };

  const save = async (submit: boolean) => {
    if (!editable) return;
    if (householdIssue) {
      setError(householdIssue);
      return;
    }
    const invalidPerson = people.map((person, index) => ({ person, message: incompletePersonMessage(person, index === 0 ? 'Principal member' : 'Dependent ' + index) })).find((item) => item.message);
    if (invalidPerson) {
      setExpanded(invalidPerson.person.id);
      setError(invalidPerson.message!);
      return;
    }
    if (submit && !consent) {
      setError(acting
        ? 'Record the consent this subscriber gave before submitting their enrollment.'
        : 'Confirm the family-data consent before submitting the enrollment.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateEnrollment(draft.id, {
        ...draft,
        // Acting administrators never stamp consent themselves. Passing the stored value
        // through leaves consented_at unchanged, so its recorded provenance survives.
        consentedAt: acting ? original.consentedAt : submit ? new Date().toISOString() : null,
        status: submit ? 'submitted' : 'draft',
        completeness: submit ? 100 : draft.completeness,
      });
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to save enrollment changes.'));
    } finally { setBusy(false); }
  };

  return <>
    <PageHeader eyebrow={`${draft.year} enrollment · Step 2 of 3`} title="Confirm who is covered" description="Review one person at a time. Saved details remain editable until enrollment closes." actions={<StatusBadge status={draft.status} />} />
    {!editable && <div className="info-banner"><Info size={18} /><span>This enrollment period is closed. Details remain available as read-only records.</span></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="enrollment-layout">
      <form className="enrollment-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void save(true); }}>
        <section className="panel progress-panel"><div className="panel__heading"><div><p className="eyebrow">Enrollment readiness</p><h2>{draft.completeness === 100 ? 'Ready for submission' : 'Details need attention'}</h2></div><strong>{draft.completeness}%</strong></div><ProgressBar value={draft.completeness} /></section>

        <section className="form-section"><div className="section-heading"><span><UserRound size={20} /></span><div><h2>Covered people</h2><p>Review the principal and any dependents included this year.</p></div></div>
          <div className="accordion-list">
            {people.map((person, index) => <article className="accordion" key={person.id}>
              <button type="button" className="accordion__trigger" onClick={() => setExpanded(expanded === person.id ? '' : person.id)}><span className="person-dot">{person.firstName[0]}</span><span><strong>{fullName(person)}</strong><small>{index === 0 ? 'Principal member' : person.relation.toLowerCase()}</small></span><Check size={17} />{expanded === person.id ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>
              {expanded === person.id && <div className="accordion__content"><fieldset disabled={!editable}><PersonFields person={person} principal={index > 0 ? draft.principal : undefined} onChange={replacePerson} /></fieldset>{index > 0 && editable && <Button type="button" variant="danger" icon={<Trash2 size={17} />} onClick={() => removeDependent(person)}>Remove dependent</Button>}</div>}
            </article>)}
          </div>
          {draft.category === 'family' && editable && <Button type="button" variant="secondary" icon={<Plus size={18} />} disabled={draft.dependents.length >= MAX_FAMILY_DEPENDENTS} onClick={() => setDraft({ ...draft, dependents: [...draft.dependents, { ...draft.principal, id: crypto.randomUUID(), memberType: 'Dependent', firstName: '', middleName: '', relation: '', dateOfBirth: '', mobile: '', email: '' }] })}>{draft.dependents.length >= MAX_FAMILY_DEPENDENTS ? 'Dependent limit reached' : 'Add dependent'}</Button>}
        </section>

        <section className="form-section"><div className="section-heading"><span><Hospital size={20} /></span><div><h2>Care preference</h2><p>Confirm the selected plan and add a preferred hospital when known.</p></div></div>
          <div className="selection-summary"><div><small>Selected plan</small><strong>{selectedPlan?.name ?? 'No plan selected'}</strong><span>{draft.category} coverage</span></div>{editable && <Link to="/plans">Change plan</Link>}</div>
          <label>Preferred hospital (optional)<input disabled={!editable} list="hospitals" value={draft.hospital} onChange={(e) => setDraft({ ...draft, hospital: e.target.value })} placeholder="Start typing a hospital name" /></label>
          <datalist id="hospitals">{snapshot!.hospitalSuggestions.map((hospital) => <option key={hospital} value={hospital} />)}</datalist>
        </section>

        <section className="form-section"><div className="section-heading"><span><ShieldCheck size={20} /></span><div><h2>Review and submit</h2><p>This final confirmation sends the enrollment to administrators.</p></div></div>
          {acting
            // An administrator cannot give the subscriber's consent. They record consent the
            // subscriber already gave elsewhere, with evidence of how it was received.
            ? <div className="offline-consent">
              {consentRecord?.channel === 'offline'
                ? <p className="offline-consent__done"><ShieldCheck size={17} />Consent recorded on {formatDate(consentRecord.consentedAt, snapshot!.program.timezone)} by {consentRecord.recordedBy ?? 'an administrator'}: “{consentRecord.note}”</p>
                : consent
                  ? <p className="offline-consent__done"><ShieldCheck size={17} />This subscriber gave consent in the portal on {formatDate(draft.consentedAt!, snapshot!.program.timezone)}.</p>
                  : <p>Record the consent {fullName(draft.principal)} already gave outside the portal. This is stored against your administrator account, not theirs.</p>}
              {editable && <div className="form-grid">
                <label>Date consent was given<input type="date" max={programDateValue(snapshot!.program.timezone)} value={consentDate} onChange={(event) => setConsentDate(event.target.value)} /></label>
                <label className="span-2">How consent was received<textarea rows={2} required value={consentNote} onChange={(event) => setConsentNote(event.target.value)} placeholder="Signed form received by WhatsApp on 12 June and filed offline" /></label>
                <div className="span-2"><Button type="button" variant="secondary" disabled={busy || !consentNote.trim()} icon={<ShieldCheck size={17} />} onClick={() => void saveOfflineConsent()}>{consentRecord?.channel === 'offline' ? 'Update recorded consent' : 'Record consent'}</Button></div>
              </div>}
            </div>
            : <label className="consent-box"><input type="checkbox" disabled={!editable} checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>I authorize the FUTO Alums HMO Program to process and share the information in this enrollment with AVON and necessary service providers. I confirm that I am authorized to provide information for each listed family member and have informed adult family members. Records may be retained for seven years. <Link to="/privacy">Read the privacy notice</Link>.</span></label>}
        </section>
        <div className="sticky-actions"><span>{editable ? 'Next: notify payment after submission.' : 'This enrollment is read only.'}</span><div className="sticky-actions__buttons">{editable && <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(false)}>Save progress</Button>}<Button type="submit" disabled={busy || !editable}>{busy ? 'Saving…' : editable ? 'Submit enrollment' : 'Enrollment closed'}</Button></div></div>
      </form>
      <aside className="enrollment-summary panel"><p className="eyebrow">At a glance</p><h2>{selectedPlan?.name}</h2><dl><div><dt>Coverage</dt><dd>{draft.category}</dd></div><div><dt>People</dt><dd>{people.length}</dd></div><div><dt>Hospital</dt><dd>{draft.hospital || 'Not provided'}</dd></div><div><dt>Status</dt><dd><StatusBadge status={draft.status} /></dd></div></dl>{selectedPlan && <FeeBreakdown premiumKobo={draft.category === 'family' ? selectedPlan.familyPremiumKobo : selectedPlan.individualPremiumKobo} rates={surchargeRates(snapshot!.period)} compact />}</aside>
    </div>
  </>;
}
