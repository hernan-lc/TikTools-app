import type { ComponentChildren } from 'preact';

type ButtonProps = {
  children?: ComponentChildren;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger' | 'cyan';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentChildren;
  iconOnly?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  tooltip?: string;
};

export function Button({
  children,
  variant = 'soft',
  size = 'md',
  block,
  loading,
  disabled,
  icon,
  iconOnly,
  type = 'button',
  onClick,
  tooltip,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      data-tooltip={tooltip}
      data-tooltip-pos="top"
      onClick={onClick}
      className={`ui-btn ui-btn--${variant} ui-btn--${size} ${block ? 'is-block' : ''} ${iconOnly ? 'is-icon-only' : ''} ${loading ? 'is-loading' : ''}`}
    >
      {icon ? <span className="ui-btn__icon">{icon}</span> : null}
      {!iconOnly ? <span className="ui-btn__label">{loading ? '…' : children}</span> : null}
    </button>
  );
}
