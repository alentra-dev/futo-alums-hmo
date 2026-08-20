import { useMemo, useState } from 'react';
import { Check, ChevronRight, Globe2, Info, Users } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../context/AppContext';
import { formatNaira, planTotalKobo } from '../lib/money';
import { subscriberEnrollment } from '../lib/enrollmentAccess';
import type { PlanCategory, PlanOffering } from '../lib/types';
import { Button, Modal, PageHeader } from '../components/ui';

export function PlansPage() {
  const { snapshot, selectPlan } = useApp();
  const enrollment = subscriberEnrollment(snapshot!);
  const [category, setCategory] = useState<PlanCategory>(enrollment.category);
  const [selected, setSelected] = useState<PlanOffering | null>(null);
  const [busy, setBusy] = useState('');
  const plans = useMemo(() => snapshot!.plans.filter((plan) => plan.active), [snapshot]);

  const choose = async (plan: PlanOffering) => {
    setBusy(plan.id);
    try { await selectPlan(enrollment.id, plan.id, category); }
    finally { setBusy(''); }
  };

  return <>
    <PageHeader eyebrow={`${snapshot!.period.year} offerings`} title="Choose your health plan" description="Compare annual coverage and select the option that fits your household." actions={<div className="segmented" role="group" aria-label="Plan category"><button className={clsx(category === 'individual' && 'active')} onClick={() => setCategory('individual')}>Individual</button><button className={clsx(category === 'family' && 'active')} onClick={() => setCategory('family')}>Family</button></div>} />
    {category === 'family' && <div className="info-banner"><Users size={19} /><span>Family pricing covers a principal, spouse, and up to four biological or legally adopted children under 21.</span></div>}
    <div className="plan-grid">
      {plans.map((plan) => {
        const premium = category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
        const total = planTotalKobo(premium);
        const current = enrollment.planId === plan.id && enrollment.category === category;
        return <article className={clsx('plan-card', current && 'plan-card--selected')} key={plan.id}>
          <div className="plan-card__top"><span className="plan-code">{plan.code.replaceAll('_', ' ')}</span>{current && <span className="selected-label"><Check size={14} />Current plan</span>}</div>
          <h2>{plan.name}</h2><p>{plan.description}</p>
          <div className="plan-price"><strong>{formatNaira(total)}</strong><span>annual total · includes 3% fee</span></div>
          <div className="plan-region"><Globe2 size={16} />{plan.region}</div>
          <ul>{plan.highlights.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
          <div className="plan-card__actions"><Button variant={current ? 'secondary' : 'primary'} disabled={current || busy === plan.id} onClick={() => void choose(plan)}>{current ? 'Selected' : busy === plan.id ? 'Saving…' : 'Select plan'}</Button><button className="text-button" onClick={() => setSelected(plan)}>View benefits <ChevronRight size={16} /></button></div>
        </article>;
      })}
    </div>
    <div className="disclosure"><Info size={17} /><p>Displayed totals include the program’s 3% fee. Benefits and limits apply under AVON’s terms for the {snapshot!.period.year} coverage year.</p></div>

    {selected && <Modal title={selected.name} onClose={() => setSelected(null)}>
      <div className="benefit-list">{selected.benefits.map((benefit) => <div key={benefit.label}><span>{benefit.label}</span><strong>{benefit.value}</strong></div>)}</div>
      <div className="modal__actions"><Button variant="secondary" onClick={() => setSelected(null)}>Close</Button></div>
    </Modal>}
  </>;
}
