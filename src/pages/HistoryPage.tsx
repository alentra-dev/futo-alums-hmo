import { useEffect, useState } from 'react';
import { CalendarCheck, FileClock, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isDemoMode, supabase } from '../lib/supabase';
import { formatNaira } from '../lib/money';
import { EmptyState, PageHeader, StatusBadge } from '../components/ui';

interface HistoryItem { id: string; year: number; principalName: string; planName: string; category: string; peopleCount: number; hospital: string; totalKobo: number; status: string }

export function HistoryPage() {
  const { snapshot } = useApp();
  const [items, setItems] = useState<HistoryItem[]>(isDemoMode ? [{ id: 'history-2025', year: 2025, principalName: 'Ada Nneka Okafor', planName: 'Plus Plan', category: 'family', peopleCount: 3, hospital: 'Federal Medical Centre Owerri', totalKobo: 280_165_65, status: 'closed' }] : []);
  const [loading, setLoading] = useState(!isDemoMode);
  useEffect(() => { if (!supabase || isDemoMode) return; supabase.rpc('get_enrollment_history').then(({ data }) => { setItems((data ?? []) as HistoryItem[]); setLoading(false); }); }, []);
  return <><PageHeader eyebrow="Account records" title="Enrollment history" description="Closed enrollment years remain available as read-only records." />{loading ? <div className="empty-state"><div className="spinner" /></div> : items.length ? <div className="plan-grid">{items.map((item) => <article className="panel" key={item.id}><div><span className="history-year"><CalendarCheck size={18} />{item.year}</span><StatusBadge status={item.status} /></div><h2>{item.planName}</h2><p>{item.principalName}</p><dl><div><dt>Coverage</dt><dd>{item.category}</dd></div><div><dt>Covered people</dt><dd><Users size={15} />{item.peopleCount}</dd></div><div><dt>Hospital</dt><dd>{item.hospital}</dd></div><div><dt>Historical total</dt><dd>{formatNaira(item.totalKobo)}</dd></div></dl></article>)}</div> : <EmptyState icon={<FileClock size={28} />} title="No historical enrollments" body={`Closed enrollment records before ${snapshot!.period.year} will appear here.`} />}</>;
}
