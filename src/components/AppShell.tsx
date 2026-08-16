import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Banknote, Bell, ClipboardCheck, FileClock, HeartPulse, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../context/AppContext';
import { initials } from '../lib/format';
import { IconButton } from './ui';

const subscriberNav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/enrollment', label: 'Enrollment', icon: ClipboardCheck },
  { to: '/plans', label: 'Plans', icon: HeartPulse },
  { to: '/payments', label: 'Payments', icon: Banknote },
  { to: '/history', label: 'History', icon: FileClock },
];

const adminNav = [
  { to: '/admin', label: 'Admin overview', icon: Activity },
  { to: '/admin/enrollees', label: 'Enrollees', icon: Users },
  { to: '/admin/payments', label: 'Payment review', icon: ShieldCheck },
  { to: '/admin/audit', label: 'Audit history', icon: FileClock },
  { to: '/admin/settings', label: 'Program settings', icon: Settings },
];

export function AppShell() {
  const { snapshot, signOut, demoMode, setDemoRole, notice, dismissNotice } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const profile = snapshot!.profile;
  const canAdmin = profile.role === 'admin' || profile.role === 'owner';
  const nav = useMemo(() => canAdmin && location.pathname.startsWith('/admin') ? adminNav : subscriberNav, [canAdmin, location.pathname]);

  const swapWorkspace = () => {
    const next = location.pathname.startsWith('/admin') ? '/' : '/admin';
    navigate(next);
    setMenuOpen(false);
  };

  return <div className="app-shell">
    <aside className={clsx('sidebar', menuOpen && 'sidebar--open')}>
      <div className="brand"><span className="brand__mark">F</span><span><strong>FUTO Alums</strong><small>HMO Program</small></span></div>
      <IconButton label="Close navigation" className="sidebar__close" onClick={() => setMenuOpen(false)}><X size={20} /></IconButton>
      <nav aria-label="Primary navigation">
        <p className="nav-label">{location.pathname.startsWith('/admin') ? 'Administration' : 'My account'}</p>
        {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/' || to === '/admin'} onClick={() => setMenuOpen(false)}><Icon size={19} />{label}</NavLink>)}
      </nav>
      <div className="sidebar__footer">
        {canAdmin && <button className="workspace-switch" onClick={swapWorkspace}><ShieldCheck size={18} /><span>{location.pathname.startsWith('/admin') ? 'Subscriber view' : 'Admin workspace'}</span></button>}
        <div className="profile-mini"><span className="avatar">{initials(profile.displayName)}</span><span><strong>{profile.displayName}</strong><small>{profile.role}</small></span></div>
        <button className="signout" onClick={() => void signOut()}><LogOut size={17} />Sign out</button>
      </div>
    </aside>

    {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

    <div className="app-main">
      <header className="topbar">
        <IconButton label="Open navigation" className="menu-button" onClick={() => setMenuOpen(true)}><Menu size={22} /></IconButton>
        <div className="topbar__period"><span className="live-dot" />{snapshot!.period.year} enrollment <strong>{snapshot!.period.status}</strong></div>
        <div className="topbar__actions">
          {demoMode && <select aria-label="Preview role" value={profile.role} onChange={(event) => setDemoRole(event.target.value as 'subscriber' | 'admin' | 'owner')}>
            <option value="subscriber">Subscriber preview</option><option value="admin">Admin preview</option><option value="owner">Owner preview</option>
          </select>}
          <IconButton label="Notifications"><Bell size={20} /></IconButton>
        </div>
      </header>
      {demoMode && <div className="demo-banner">Preview environment · Synthetic records only</div>}
      {notice && <div className="toast" role="status"><span>{notice}</span><IconButton label="Dismiss" onClick={dismissNotice}><X size={18} /></IconButton></div>}
      <main className="page-content"><Outlet /></main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/' || to === '/admin'}><Icon size={20} /><span>{label.replace('Admin ', '')}</span></NavLink>)}
      </nav>
    </div>
  </div>;
}
