'use client';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { buttonClass, cx, type ButtonVariant } from './ui';

export type ActionState = { ok: boolean; error?: string; message?: string; data?: any } | null;
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action. Shows pending state, success and error messages,
 * optionally resets or navigates after success.
 */
export function ActionForm({
  action, children, className, resetOnSuccess = false, redirectTo, confirm, showMessage = true, onSuccess,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  redirectTo?: string | ((data: any) => string);
  confirm?: string;
  showMessage?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    onSuccess?.(state);
    // Server components pass a string; "{id}" is replaced with the id the action returned.
    if (redirectTo) router.push(typeof redirectTo === 'function' ? redirectTo(state.data) : redirectTo.replace('{id}', String(state.data?.id ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
      {showMessage && <FormMessage state={state} />}
    </form>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.ok && !state.message) return null;
  return (
    <div role="status" className={cx('mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
      state.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
      {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
      <span>{state.ok ? state.message : state.error}</span>
    </div>
  );
}

export function SubmitButton({ children, variant = 'primary', size = 'md', className, pendingText, name, value, disabled }: {
  children: ReactNode; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; className?: string; pendingText?: string; name?: string; value?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={buttonClass(variant, size, className)}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** One-click action button (approve, delete, mark read…) bound to a server action with hidden fields. */
export function ActionButton({ action, fields, children, variant = 'secondary', size = 'sm', confirm, className }: {
  action: ServerAction; fields: Record<string, string | number | boolean | null | undefined>; children: ReactNode;
  variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; confirm?: string; className?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className={cx('inline-block', className)}>
      {Object.entries(fields).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={String(v)} />)}
      <SubmitButton variant={variant} size={size}>{children}</SubmitButton>
    </ActionForm>
  );
}
