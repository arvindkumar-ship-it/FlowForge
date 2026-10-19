import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Loader2, X, AlertCircle } from "lucide-react";
export function Button({
  children,
  variant = "secondary",
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${variant} ${props.className ?? ""}`}
      disabled={props.disabled || loading}
    >
      {loading && <Loader2 className="spin" size={16} />} {children}
    </button>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Alert({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="alert" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && <Button onClick={retry}>Retry</Button>}
    </div>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Button aria-label="Close dialog" variant="tertiary" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Skeleton() {
  return (
    <div aria-label="Loading" className="skeletons">
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="skeleton" />
      ))}
    </div>
  );
}
