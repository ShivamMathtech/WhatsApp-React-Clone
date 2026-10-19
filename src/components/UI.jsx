import { useEffect, useRef, useId } from 'react';
import {
  MessageCircle,
  Users,
  X,
  Check,
  CheckCheck,
  LoaderCircle,
  ChevronLeft,
} from 'lucide-react';

export function Brand({ small = false }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-icon">
        <MessageCircle size={small ? 25 : 31} strokeWidth={2.2} />
        <span className="brand-dot" />
      </span>
      <span>
        WhatsApp<span className="brand-label"> CLONE</span>
      </span>
    </div>
  );
}
export function Avatar({ user, size = 46, group = false, online = false, ring = false }) {
  const name = user?.name || '?';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={`avatar ${ring ? 'status-ring' : ''}`}
      style={{
        width: size,
        height: size,
        '--avatar-color': user?.color || '#008069',
        fontSize: size * 0.31,
      }}
      aria-label={name}
    >
      {user?.avatar ? (
        <img src={user.avatar} alt="" />
      ) : group ? (
        <Users size={size * 0.46} />
      ) : (
        <span>{initials}</span>
      )}
      {online && <i className="online-dot" />}
    </span>
  );
}
export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={21} />
    </button>
  );
}
export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function Receipt({ status }) {
  const Icon = status === 'sent' ? Check : CheckCheck;
  return (
    <Icon
      size={16}
      className={status === 'read' ? 'receipt read' : 'receipt'}
      aria-label={status}
    />
  );
}
export function Empty({ icon: Icon = MessageCircle, title, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={35} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SectionHeader({ title, onBack, children }) {
  return (
    <header className="section-header">
      {onBack && <IconButton icon={ChevronLeft} label="Back" onClick={onBack} />}
      <h2>{title}</h2>
      {children}
    </header>
  );
}
export function Modal({ title, onClose, children, wide = false, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const root = ref.current;
    const items = () => [
      ...root.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
      ),
    ];
    (items().find((el) => el.tagName === 'INPUT') || items()[0])?.focus();
    const handler = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const elements = items(),
        first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    root.addEventListener('keydown', handler);
    return () => {
      root.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal ${wide ? 'wide' : ''} ${className}`}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
export function ErrorNote({ error }) {
  return error ? (
    <div role="alert" className="error-note">
      {error}
    </div>
  ) : null;
}
