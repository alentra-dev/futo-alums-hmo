import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Search, ShieldAlert, UserCheck, UserPlus, X } from 'lucide-react';
import { Button, EmptyState, PageHeader, StatusBadge } from '../../components/ui';
import { demoSnapshot } from '../../data/demo';
import { whatsappVerificationUrl } from '../../lib/duplicateMatching';
import { fullName } from '../../lib/format';
import { isDemoMode, supabase } from '../../lib/supabase';
import type { AdminSubscriberApplication, Person } from '../../lib/types';

function personName(person: Person) {
  return fullName(person);
}

const demoApplication: AdminSubscriberApplication = {
  id: 'demo-application', periodId: demoSnapshot.period.id, year: demoSnapshot.period.year, status: 'pending_review', graduationYear: 1996, principal: { ...demoSnapshot.enrollments[0].principal, id: 'demo-applicant', firstName: 'Emeka', surname: 'Nwosu', email: 'emeka.nwosu@example.com', mobile: '08012345678' }, dependents: [], planId: demoSnapshot.plans[0].id, planName: demoSnapshot.plans[0].name, category: 'individual', hospital: '', consentedAt: new Date().toISOString(), duplicateStatus: 'clear', adminNote: null, enrollmentId: null, submittedAt: new Date().toISOString(), createdAt: new Date().toISOString(), accountEmail: 'emeka.nwosu@example.com', candidates: [],
};

export function AdminApplicationsPage() {
  const [applications, setApplications] = useState<AdminSubscriberApplication[]>(isDemoMode ? [demoApplication] : []);
  const [filter, setFilter] = useState('pending_review');
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!supabase || isDemoMode) return;
    const { data, error: loadError } = await supabase.rpc('get_admin_subscriber_applications');
    if (loadError) throw loadError;
    setApplications((data ?? []) as AdminSubscriberApplication[]);
  };

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load applications.'));
  }, []);

  const visible = useMemo(() => applications.filter((application) => {
    const matchesStatus = filter === 'all' || application.status === filter;
    const searchable = `${personName(application.principal)} ${application.accountEmail} ${application.principal.mobile}`.toLowerCase();
    return matchesStatus && searchable.includes(query.toLowerCase());
  }), [applications, filter, query]);

  const review = async (application: AdminSubscriberApplication, action: 'approve' | 'request_changes' | 'mark_duplicate') => {
    if (action === 'approve' && !window.confirm(`Approve ${personName(application.principal)} as a new subscriber?`)) return;
    if (action === 'mark_duplicate' && !window.confirm('Mark this as a duplicate and close the application?')) return;
    if (isDemoMode) {
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: action === 'approve' ? 'approved' : action === 'request_changes' ? 'request_changes' : 'rejected', adminNote: notes[item.id]?.trim() || null } : item));
      return;
    }
    if (!supabase) return;
    setBusy(application.id);
    setError('');
    try {
      const { error: reviewError } = await supabase.rpc('review_subscriber_application', {
        p_application_id: application.id,
        p_action: action,
        p_note: notes[application.id]?.trim() || null,
      });
      if (reviewError) throw reviewError;
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review the application.');
    } finally {
      setBusy('');
    }
  };

  return <>
    <PageHeader eyebrow="Subscriber growth" title="New subscribers" description="Verify applicants through the alumni group and activate complete enrollments." actions={<StatusBadge status={`${applications.filter((item) => item.status === 'pending_review').length} pending`} />} />
    <div className="filter-bar">
      <div className="input-icon"><Search size={18} /><input aria-label="Search applications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or phone" /></div>
      <select aria-label="Filter application status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="pending_review">Pending review</option><option value="request_changes">Changes requested</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All applications</option></select>
      <span>{visible.length} applications</span>
    </div>
    {error && <p className="form-error admin-page-error" role="alert">{error}</p>}

    {visible.length ? <div className="application-review-list">{visible.map((application) => {
      const openCandidates = application.candidates.filter((candidate) => candidate.status === 'open');
      return <article className="application-review" key={application.id}>
        <header>
          <span className="person-dot"><UserPlus size={16} /></span>
          <div><h2>{personName(application.principal)}</h2><p>{application.accountEmail} · {application.principal.mobile}</p></div>
          <StatusBadge status={application.status.replace('_', ' ')} />
        </header>

        <div className="application-facts">
          <div><small>Class</small><strong>{application.graduationYear}</strong></div>
          <div><small>Plan</small><strong>{application.planName}</strong></div>
          <div><small>Plan type</small><strong>{application.category}</strong></div>
          <div><small>People</small><strong>{application.dependents.length + 1}</strong></div>
          <div><small>Hospital</small><strong>{application.hospital || 'Not entered'}</strong></div>
          <div><small>Duplicate review</small><strong>{application.duplicateStatus.replace('_', ' ')}</strong></div>
        </div>

        {openCandidates.length > 0 && <section className="duplicate-review">
          <div className="duplicate-review__title"><ShieldAlert size={19} /><div><strong>Possible existing subscriber</strong><span>Compare the records or confirm through WhatsApp.</span></div></div>
          <div className="duplicate-new-record"><span>Applicant</span><strong>{personName(application.principal)}</strong><small>{application.principal.dateOfBirth} · {application.principal.mobile} · {application.principal.email}</small></div>
          {openCandidates.map((candidate) => <div className="duplicate-candidate" key={candidate.id}>
            <div><span><StatusBadge status={candidate.confidence} /> Existing record</span><strong>{candidate.name}</strong><small>{candidate.dateOfBirth} · {candidate.mobile} · {candidate.email}</small><small>Managed by {candidate.managedBy}</small></div>
            <div className="match-signals">{candidate.signals.filter(Boolean).map((signal) => <span key={signal}>{signal}</span>)}</div>
          </div>)}
        </section>}

        {application.adminNote && application.status !== 'pending_review' && <div className="admin-note"><strong>Admin note</strong><span>{application.adminNote}</span></div>}

        {application.status === 'pending_review' && <footer>
          <label>Note to applicant<textarea rows={2} value={notes[application.id] ?? ''} onChange={(event) => setNotes({ ...notes, [application.id]: event.target.value })} placeholder="Optional for approval; required when requesting changes" /></label>
          <div className="application-review__actions">
            <a className="button button--secondary" href={whatsappVerificationUrl(application.principal.mobile)} target="_blank" rel="noreferrer"><MessageCircle size={17} />WhatsApp</a>
            <Button variant="danger" disabled={busy === application.id} icon={<X size={17} />} onClick={() => void review(application, 'mark_duplicate')}>Mark duplicate</Button>
            <Button variant="secondary" disabled={busy === application.id || !(notes[application.id]?.trim())} icon={<ShieldAlert size={17} />} onClick={() => void review(application, 'request_changes')}>Request changes</Button>
            <Button disabled={busy === application.id} icon={<UserCheck size={17} />} onClick={() => void review(application, 'approve')}>{busy === application.id ? 'Working...' : 'Approve subscriber'}</Button>
          </div>
        </footer>}
      </article>;
    })}</div> : <EmptyState icon={<UserCheck size={30} />} title="No matching applications" body="New verified applications will appear here for review." />}
  </>;
}
