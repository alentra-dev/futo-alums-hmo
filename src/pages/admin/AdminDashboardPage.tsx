import { Link } from 'react-router-dom';
import { Banknote, CalendarClock, CheckCircle2, Download, FileSpreadsheet, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../../context/AppContext';
import { downloadSummaryWorkbook } from '../../lib/export';
import { formatNaira } from '../../lib/money';
import { formatDate } from '../../lib/format';
import { Button, PageHeader, ProgressBar, StatusBadge } from '../../components/ui';

export function AdminDashboardPage() {
  const { snapshot } = useApp();
  const { enrollments, payments, plans, period } = snapshot!;
  const submitted = enrollments.filter((item) => item.status === 'submitted').length;
  const verified = payments.filter((item) => item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
  const pending = payments.filter((item) => item.status === 'pending');
  const expected = enrollments.reduce((sum, item) => sum + item.totalKobo, 0);
  const chartData = plans.map((plan) => ({ name: plan.name.replace(' Plan', ''), members: enrollments.filter((item) => item.planId === plan.id).length })).filter((item) => item.members > 0);

  return <>
    <PageHeader eyebrow="Administration" title={`${period.year} enrollment overview`} description="Operational status across enrollment and payment collection." actions={<Button icon={<Download size={18} />} onClick={() => void downloadSummaryWorkbook(snapshot!)}>Download summary</Button>} />
    <section className="metric-grid admin-metrics">
      <article className="metric metric--accent"><span className="metric__icon"><Users size={21} /></span><div><small>Principal members</small><strong>{enrollments.length}</strong><span>{enrollments.reduce((sum, item) => sum + item.dependents.length, 0)} dependents</span></div></article>
      <article className="metric"><span className="metric__icon"><CheckCircle2 size={21} /></span><div><small>Submitted</small><strong>{submitted}</strong><span>{enrollments.length - submitted} need attention</span></div></article>
      <article className="metric"><span className="metric__icon"><Banknote size={21} /></span><div><small>Verified collections</small><strong>{formatNaira(verified)}</strong><span>of {formatNaira(expected)} expected</span></div></article>
      <article className="metric"><span className="metric__icon"><CalendarClock size={21} /></span><div><small>Pending review</small><strong>{pending.length}</strong><span>{formatNaira(pending.reduce((sum, item) => sum + item.amountKobo, 0))}</span></div></article>
    </section>
    <section className="admin-dashboard-grid">
      <article className="panel chart-panel"><div className="panel__heading"><div><p className="eyebrow">Plan distribution</p><h2>Selected offerings</h2></div><FileSpreadsheet size={21} /></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e6e3" /><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} /><Tooltip cursor={{ fill: '#f1f5f2' }} /><Bar dataKey="members" fill="#1c6b4a" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
      <article className="panel deadline-panel"><div className="panel__heading"><div><p className="eyebrow">Enrollment window</p><h2>Period is {period.status}</h2></div><StatusBadge status={period.status} /></div><ProgressBar value={enrollments.length ? (submitted / enrollments.length) * 100 : 0} label="Enrollment submissions" /><dl><div><dt>Opens</dt><dd>{formatDate(period.startsAt, snapshot!.program.timezone)}</dd></div><div><dt>Closes</dt><dd>{formatDate(period.endsAt, snapshot!.program.timezone)}</dd></div></dl><Link className="button button--secondary" to="/admin/settings">Manage period</Link></article>
    </section>
    <section className="table-section"><div className="section-title"><h2>Payments awaiting review</h2><Link to="/admin/payments">Open queue</Link></div><div className="review-list">{pending.slice(0, 4).map((payment) => <Link to="/admin/payments" key={payment.id}><span className="person-dot">{payment.principalName[0]}</span><span><strong>{payment.principalName}</strong><small>{payment.reference}</small></span><strong>{formatNaira(payment.amountKobo)}</strong><StatusBadge status={payment.status} /></Link>)}</div></section>
  </>;
}
