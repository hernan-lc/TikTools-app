import type { ComponentChildren } from 'preact';

type PageProps = { children: ComponentChildren; narrow?: boolean; className?: string };
export function Page({ children, narrow, className = '' }: PageProps) {
  return <div className={`ui-page ${narrow ? 'is-narrow' : ''} ${className}`}>{children}</div>;
}

type PageHeaderProps = { title: string; subtitle?: string; icon?: ComponentChildren; meta?: ComponentChildren; action?: ComponentChildren };
export function PageHeader({ title, subtitle, icon, meta, action }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__main">
        <h2 className="ui-page-header__title">
          {icon ? <span className="ui-page-header__icon">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <p className="ui-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {meta ? <div className="ui-page-header__meta">{meta}</div> : null}
      {action ? <div className="ui-page-header__action">{action}</div> : null}
    </header>
  );
}

export function PageGrid({ children }: { children: ComponentChildren }) {
  return <div className="ui-page-grid">{children}</div>;
}

type SplitLayoutProps = { left: ComponentChildren; right: ComponentChildren };
export function SplitLayout({ left, right }: SplitLayoutProps) {
  return (
    <div className="ui-split">
      <div className="ui-split__left">{left}</div>
      <div className="ui-split__right">{right}</div>
    </div>
  );
}

type StatCardProps = { icon: ComponentChildren; value: string | number; label: string; tone?: 'cyan' | 'pink' | 'yellow' | 'green' };
export function StatCard({ icon, value, label, tone = 'cyan' }: StatCardProps) {
  return (
    <div className="ui-stat">
      <div className={`ui-stat__icon is-${tone}`}>{icon}</div>
      <div>
        <div className="ui-stat__value">{value}</div>
        <div className="ui-stat__label">{label}</div>
      </div>
    </div>
  );
}
export function StatGrid({ children }: { children: ComponentChildren }) {
  return <div className="ui-stat-grid">{children}</div>;
}
