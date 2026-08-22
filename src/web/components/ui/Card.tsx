import type { ComponentChildren } from 'preact';

type CardProps = {
  children: ComponentChildren;
  title?: string;
  subtitle?: string;
  icon?: ComponentChildren;
  action?: ComponentChildren;
  variant?: 'default' | 'elevated' | 'ghost';
  padding?: 'sm' | 'md' | 'lg' | 'none';
  className?: string;
};

export function Card({ children, title, subtitle, icon, action, variant = 'default', padding = 'md', className = '' }: CardProps) {
  return (
    <div className={`ui-card ui-card--${variant} ui-card--pad-${padding} ${className}`}>
      {title || icon || subtitle || action ? (
        <header className="ui-card__header">
          <div className="ui-card__title-wrap">
            {icon ? <span className="ui-card__icon">{icon}</span> : null}
            <div>
              {title ? <h2 className="ui-card__title">{title}</h2> : null}
              {subtitle ? <p className="ui-card__subtitle">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="ui-card__action">{action}</div> : null}
        </header>
      ) : null}
      <div className="ui-card__body">{children}</div>
    </div>
  );
}

export function CardFooter({ children }: { children: ComponentChildren }) {
  return <div className="ui-card__footer">{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ComponentChildren; tone?: 'neutral' | 'pink' | 'cyan' | 'success' }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Alert({ children, variant = 'info' }: { children: ComponentChildren; variant?: 'info' | 'success' | 'danger' | 'warning' }) {
  return <div className={`ui-alert ui-alert--${variant}`}>{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ComponentChildren }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__title">{title}</div>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}

export function Chip({ children, onClick, active }: { children: ComponentChildren; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className={`ui-chip ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
export function ChipGroup({ children }: { children: ComponentChildren }) {
  return <div className="ui-chip-group">{children}</div>;
}
