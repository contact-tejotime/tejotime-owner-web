import type { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";

/**
 * Native button + a `loading` flag. When loading, the button is disabled (so a
 * pending action can't be fired twice) and shows an inline spinner before its
 * label. Callers keep passing the existing `.btn-*` classes via `className`, so
 * this is a drop-in for `<button className="btn-primary">`.
 */
export default function Button({
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={className} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner className="btn-spinner" />}
      {children}
    </button>
  );
}
