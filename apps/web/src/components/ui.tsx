/**
 * The handful of building blocks the screens share. Kept in the repository in
 * the shadcn/ui manner — plain components the library owns and can change
 * (NFR-12) — rather than a dependency.
 */
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from 'react';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-800 text-white hover:bg-emerald-900 disabled:bg-emerald-800/50',
  secondary: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
  ghost: 'text-stone-700 hover:bg-stone-100',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700',
        'disabled:cursor-not-allowed',
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

const CONTROL =
  'block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 ' +
  'focus:border-emerald-700 focus:outline-2 focus:outline-emerald-700/30 aria-invalid:border-red-600';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(CONTROL, className)} {...props} />;
}

/** A labelled form control with an optional hint and error, wired for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {hint && (
        <div id={hintId} className="text-sm text-stone-600">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type Tone = 'error' | 'warning' | 'info' | 'success';
const ALERT: Record<Tone, string> = {
  error: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  info: 'border-sky-300 bg-sky-50 text-sky-950',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
};

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-md border px-4 py-3 text-sm', ALERT[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : undefined}>{children}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        'relative rounded-lg border border-stone-200 bg-white p-5 shadow-sm',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-stone-900">{children}</h1>
      {lead && <p className="mt-1 text-stone-600">{lead}</p>}
    </div>
  );
}
