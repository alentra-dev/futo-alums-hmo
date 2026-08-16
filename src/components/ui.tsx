import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Clock3, XCircle } from 'lucide-react';
import clsx from 'clsx';

export function Button({ className, variant = 'primary', icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode }) {
  return <button className={clsx('button', `button--${variant}`, className)} {...props}>{icon}{children}</button>;
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={clsx('icon-button', className)} aria-label={label} title={label} {...props}>{children}</button>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const icon = normalized === 'verified' || normalized === 'submitted' || normalized === 'open'
    ? <CheckCircle2 size={14} />
    : normalized === 'rejected' || normalized === 'closed'
      ? <XCircle size={14} />
      : normalized === 'pending' || normalized === 'scheduled'
        ? <Clock3 size={14} />
        : <CircleAlert size={14} />;
  return <span className={clsx('status', `status--${normalized.replace(/\s/g, '-')}`)}>{icon}{status}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return <div className="progress-wrap">
    {label && <div className="progress-label"><span>{label}</span><strong>{Math.round(value)}%</strong></div>}
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  </div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal__header"><h2 id="modal-title">{title}</h2><IconButton label="Close" onClick={onClose}><XCircle size={21} /></IconButton></div>
      {children}
    </section>
  </div>;
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <div className="empty-state">{icon}<h3>{title}</h3><p>{body}</p></div>;
}
