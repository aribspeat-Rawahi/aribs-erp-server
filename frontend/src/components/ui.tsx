import { ReactNode } from 'react';
import { ActionLevel, useCan } from './Permission';

// `requires` on a button hides it from users without that level for the
// page's module ('edit' = add/change, 'full' = delete); `requiresModule`
// checks another module instead (e.g. 'approvals').
type PermissionProps = { requires?: ActionLevel; requiresModule?: string };

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="sm:shrink-0">{action}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  icon: Icon,
  className = '',
  disabled,
  requires,
  requiresModule,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  icon?: any;
  className?: string;
  disabled?: boolean;
} & PermissionProps) {
  const can = useCan();
  if (requires && !can(requires, requiresModule)) return null;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-ink text-sm font-medium px-4 py-2 rounded-lg transition-colors ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  icon: Icon,
  className = '',
  disabled = false,
  requires,
  requiresModule,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: any;
  className?: string;
  disabled?: boolean;
} & PermissionProps) {
  const can = useCan();
  if (requires && !can(requires, requiresModule)) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap bg-white border border-black/10 hover:bg-black/5 disabled:opacity-50 text-ink text-sm font-medium px-4 py-2 rounded-lg transition-colors ${className}`}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function IconButton({
  onClick,
  icon: Icon,
  tone = 'default',
  title,
  requires,
  requiresModule,
}: {
  onClick?: () => void;
  icon: any;
  tone?: 'default' | 'danger' | 'success';
  title?: string;
} & PermissionProps) {
  const can = useCan();
  if (requires && !can(requires, requiresModule)) return null;
  const tones: Record<string, string> = {
    default: 'text-ink/70 border-black/10 hover:bg-black/5',
    danger: 'text-red-600 border-red-200 hover:bg-red-50',
    success: 'text-brand-600 border-brand-100 hover:bg-brand-50',
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border bg-white ${tones[tone]}`}
    >
      <Icon size={15} />
    </button>
  );
}

export function Pill({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    // On a phone the row scrolls sideways instead of squeezing the labels
    // onto two lines and pushing the whole page wider than the screen.
    <div className="inline-flex max-w-full gap-2 overflow-x-auto no-scrollbar">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            value === opt.value
              ? 'bg-brand-500 text-ink'
              : 'bg-white border border-black/10 text-ink/70 hover:bg-black/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-black/10 shadow-sm ${className}`}>{children}</div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card className="p-10 text-center text-sm text-muted">{children}</Card>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <Card className={`p-3 sm:p-4 min-w-0 ${tone === 'warn' ? 'border-amber-300/70 bg-amber-50/40' : ''}`}>
      <div className={`flex items-start gap-1.5 text-xs font-medium mb-2 leading-snug ${tone === 'warn' ? 'text-amber-700' : 'text-muted'}`}>
        <Icon size={14} className="shrink-0 mt-px" />
        <span className="min-w-0">{label}</span>
      </div>
      <div className="text-lg sm:text-2xl font-semibold text-ink leading-tight break-words">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </Card>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-black/15 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-500';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 sm:p-6 overflow-y-auto">
      <div
        className={`bg-white shadow-lg w-full min-h-screen sm:min-h-0 rounded-none sm:rounded-xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        } sm:mt-8`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 sticky top-0 bg-white sm:static">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none px-2 -mr-2">
            &times;
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
