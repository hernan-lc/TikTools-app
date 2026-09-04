import type { VNodeChild } from 'vue';
import { defineVueFunctional } from '../../vue/component.ts';

type PageProps = { children: VNodeChild; narrow?: boolean; className?: string };
export const Page = defineVueFunctional<PageProps>((props) => {
  const { children, narrow, className = '' } = props;
  return <div class={`ui-page ${narrow ? 'is-narrow' : ''} ${className}`}>{children}</div>;
});

type PageHeaderProps = { title: string; subtitle?: string; icon?: VNodeChild; meta?: VNodeChild; action?: VNodeChild };
export const PageHeader = defineVueFunctional<PageHeaderProps>((props) => {
  const { title, subtitle, icon, meta, action } = props;
  return (
    <header class="ui-page-header">
      <div class="ui-page-header__main">
        <h2 class="ui-page-header__title">
          {icon ? <span class="ui-page-header__icon">{icon}</span> : null}
          {title}
        </h2>
        {subtitle ? <p class="ui-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {meta ? <div class="ui-page-header__meta">{meta}</div> : null}
      {action ? <div class="ui-page-header__action">{action}</div> : null}
    </header>
  );
});

export const PageGrid = defineVueFunctional<{ children?: VNodeChild }>((props) => <div class="ui-page-grid">{props.children}</div>);

type SplitLayoutProps = { left: VNodeChild; right: VNodeChild };
export const SplitLayout = defineVueFunctional<SplitLayoutProps>((props) => {
  const { left, right } = props;
  return (
    <div class="ui-split">
      <div class="ui-split__left">{left}</div>
      <div class="ui-split__right">{right}</div>
    </div>
  );
});

type StatCardProps = { icon: VNodeChild; value: string | number; label: string; tone?: 'cyan' | 'pink' | 'yellow' | 'green' };
export const StatCard = defineVueFunctional<StatCardProps>((props) => {
  const { icon, value, label, tone = 'cyan' } = props;
  return (
    <div class="ui-stat">
      <div class={`ui-stat__icon is-${tone}`}>{icon}</div>
      <div>
        <div class="ui-stat__value">{value}</div>
        <div class="ui-stat__label">{label}</div>
      </div>
    </div>
  );
});
export const StatGrid = defineVueFunctional<{ children?: VNodeChild }>((props) => <div class="ui-stat-grid">{props.children}</div>);
