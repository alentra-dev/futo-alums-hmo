import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChartNoAxesColumn, RefreshCw, RotateCcw, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, PageHeader } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { formatDateTime } from '../../lib/format';
import { isDemoMode, supabase } from '../../lib/supabase';
import type { PortalActivityReport } from '../../lib/types';

const ranges = [7, 30, 90] as const;

const emptyReport = (timezone: string): PortalActivityReport => ({
  timezone,
  today: new Date().toISOString().slice(0, 10),
  todayUnique: 0,
  last7DaysUnique: 0,
  last30DaysUnique: 0,
  returningAccounts: 0,
  daily: [],
  recentAccounts: [],
});

function dayLabel(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', days === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }).format(date);
}

function accessLabel(accessType: string) {
  if (accessType === 'subscriber_linked') return 'Subscriber-linked';
  if (accessType === 'admin_only') return 'Admin/owner only';
  return 'Applicant';
}

export function AdminActivityPage() {
  const { snapshot } = useApp();
  const [days, setDays] = useState<(typeof ranges)[number]>(30);
  const [report, setReport] = useState<PortalActivityReport>(() => emptyReport(snapshot!.program.timezone));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (isDemoMode || !supabase) {
      setReport(emptyReport(snapshot!.program.timezone));
      setLoading(false);
      return;
    }
    const { data, error: loadError } = await supabase.rpc('get_admin_portal_activity', { p_days: days });
    if (loadError) setError(loadError.message);
    else setReport(data as PortalActivityReport);
    setLoading(false);
  }, [days, snapshot]);

  useEffect(() => { void load(); }, [load]);

  const chartData = report.daily.map((item) => ({ ...item, label: dayLabel(item.date, days) }));

  return <>
    <PageHeader eyebrow="Administration" title="Portal activity" description="Daily unique authenticated accounts using the application." actions={
      <button className="icon-command" type="button" title="Refresh activity" aria-label="Refresh activity" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></button>
    } />

    <div className="activity-context"><CalendarDays size={16} /><span>Each account is counted once per day. Daily cut-off: midnight in <strong>{report.timezone}</strong>.</span></div>
    {error && <p className="form-error admin-page-error" role="alert">{error}</p>}

    <section className="metric-grid activity-metrics">
      <article className="metric metric--accent"><span className="metric__icon"><ChartNoAxesColumn size={21} /></span><div><small>Today</small><strong>{report.todayUnique}</strong><span>unique accounts</span></div></article>
      <article className="metric"><span className="metric__icon"><CalendarDays size={21} /></span><div><small>Last 7 days</small><strong>{report.last7DaysUnique}</strong><span>unique accounts</span></div></article>
      <article className="metric"><span className="metric__icon"><Users size={21} /></span><div><small>Last 30 days</small><strong>{report.last30DaysUnique}</strong><span>unique accounts</span></div></article>
      <article className="metric"><span className="metric__icon"><RotateCcw size={21} /></span><div><small>Returning</small><strong>{report.returningAccounts}</strong><span>active on 2+ days in 30 days</span></div></article>
    </section>

    <section className="panel activity-chart-panel">
      <div className="panel__heading"><div><p className="eyebrow">Daily trend</p><h2>Unique sign-ins</h2></div><div className="segmented activity-range" aria-label="Activity date range">{ranges.map((range) => <button type="button" className={days === range ? 'active' : ''} key={range} onClick={() => setDays(range)}>{range} days</button>)}</div></div>
      <div className="activity-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e6e3" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval={days === 90 ? 9 : days === 30 ? 4 : 0} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} /><Tooltip cursor={{ fill: '#f1f5f2' }} /><Legend iconType="square" /><Bar name="Subscriber-linked" dataKey="subscriberLinked" stackId="accounts" fill="#1c6b4a" /><Bar name="Applicants" dataKey="applicants" stackId="accounts" fill="#6b8fa3" /><Bar name="Admin/owner only" dataKey="adminOnly" stackId="accounts" fill="#d5a52e" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
      <div className="activity-legend">Subscriber-linked includes administrators who also manage a subscriber household. Admin/owner only means no subscriber household is connected.</div>
    </section>

    <section className="table-section"><div className="section-title"><h2>Recently active accounts</h2><span>Selected {days}-day period</span></div>
      {loading ? <div className="empty-state"><p>Loading activity...</p></div> : report.recentAccounts.length ? <div className="data-table activity-table"><div className="data-table__head"><span>Account</span><span>Access</span><span>Active days</span><span>Last active</span></div>{report.recentAccounts.map((account) => <div className="data-table__row" key={account.userId}><span data-label="Account"><strong>{account.displayName || account.email}</strong><small>{account.email}</small></span><span data-label="Access"><span className={`activity-access activity-access--${account.accessType}`}>{accessLabel(account.accessType)}</span></span><strong data-label="Active days">{account.activeDays}</strong><span data-label="Last active">{formatDateTime(account.lastSeenAt, report.timezone)}</span></div>)}</div> : <EmptyState icon={<ChartNoAxesColumn size={28} />} title="No tracked activity yet" body="Activity will appear after authenticated accounts use the portal." />}
    </section>
  </>;
}
