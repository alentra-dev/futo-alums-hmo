import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Globe2, Info, Users } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../context/AppContext';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import { householdValidationMessage, isEnrollmentEditable } from '../lib/subscriberWorkflow';
import type { PlanCategory, PlanOffering } from '../lib/types';
import { Button, Modal, PageHeader } from '../components/ui';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { surchargeRates } from '../lib/surchargeRates';
import { formatBasisPoints } from '../lib/money';

export function PlansPage() {
  const { snapshot, activeEnrollmentId, selectPlan } = useApp();
  const enrollment = subscriberEnrollment(snapshot!, activeEnrollmentId);
  const [category, setCategory] = useState<PlanCategory>(enrollment.category);
  const [selected, setSelected] = useState<PlanOffering | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const editable = isEnrollmentEditable(snapshot!.period);
  const categoryIssue = category === 'individual' && enrollment.dependents.length > 0
    ? 'Remove dependents before selecting individual coverage.'
    : enrollment.dependents.length > 5 ? householdValidationMessage(category, enrollment.dependents.length) : null;
  const plans = useMemo(() => snapshot!.plans.filter((plan) => plan.active), [snapshot]);

  useEffect(() => { setCategory(enrollment.category); setError(''); }, [enrollment.id, enrollment.category]);

  const choose = async (plan: PlanOffering) => {
    if (!editable) return;
    if (categoryIssue) {
      setError(categoryIssue);
      return;
    }
    setBusy(plan.id);
    setError('');
    try {
      await selectPlan(enrollment.id, plan.id, category);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to select this plan.');
    } finally { setBusy(''); }
  };

  return <>
    <PageHeader eyebrow={`${snapshot!.period.year} offerings`} title="Choose your health plan" description="Compare annual coverage and select the option that fits your household." actions={<div className="segmented" role="group" aria-label="Plan category"><button disabled={!editable} className={clsx(category === 'individual' && 'active')} onClick={() => setCategory('individual')}>Individual</button><button disabled={!editable} className={clsx(category === 'family' && 'active')} onClick={() => setCategory('family')}>Family</button></div>} />
    {category === 'family' && <div className="info-banner"><Users size={19} /><span>Family pricing covers a principal, spouse, and up to four biological or legally adopted children under 21.</span></div>}
    {categoryIssue && <div className="info-banner"><Info size={19} /><span>{categoryIssue}</span></div>}
    {!editable && <div className="info-banner"><Info size={19} /><span>The enrollment period is closed. Plan offerings remain available for reference.</span></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="plan-grid">
      {plans.map((plan) => {
        const premium = category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
        const current = enrollment.planId === plan.id && enrollment.category === category;
        return <article className={clsx('plan-card', current && 'plan-card--selected')} key={plan.id}>
          <div className="plan-card__top"><span className="plan-code">{plan.code.replaceAll('_', ' ')}</span>{current && <span className="selected-label"><Check size={14} />Current plan</span>}</div>
          <h2>{plan.name}</h2><p>{plan.description}</p>
          <FeeBreakdown premiumKobo={premium} rates={surchargeRates(snapshot!.period)} compact />
          <div className="plan-region"><Globe2 size={16} />{plan.region}</div>
          <ul>{plan.highlights.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
          <div className="plan-card__actions"><Button variant={current ? 'secondary' : 'primary'} disabled={current || busy === plan.id || !editable || Boolean(categoryIssue)} onClick={() => void choose(plan)}>{current ? 'Selected' : busy === plan.id ? 'Saving…' : !editable ? 'Enrollment closed' : 'Select plan'}</Button><button className="text-button" onClick={() => setSelected(plan)}>View benefits <ChevronRight size={16} /></button></div>
        </article>;
      })}
    </div>
    <div className="disclosure"><Info size={17} /><p>Displayed totals include the configured AVON NHIS ({formatBasisPoints(snapshot!.period.nhisFeeBasisPoints)}%) and program administrative ({formatBasisPoints(snapshot!.period.programFeeBasisPoints)}%) fees. Benefits and limits apply under AVON’s terms for the {snapshot!.period.year} coverage year.</p></div>

    {selected && <Modal title={selected.name} onClose={() => setSelected(null)}>
      <div className="benefit-list">{selected.benefits.map((benefit) => <div key={benefit.label}><span>{benefit.label}</span><strong>{benefit.value}</strong></div>)}</div>
      <div className="modal__actions"><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button></div>
    </Modal>}
  </>;
}
