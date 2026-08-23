import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

import { Button } from './Button.tsx';
import { FormField } from './FormField.tsx';
import { TextInput, type TextInputHandle } from './TextInput.tsx';

export type ModalProps = {
  title: string;
  description?: string;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  onClose: () => void;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  className?: string;
};

/**
 * Small, application-owned dialog primitive. Keeping this outside the
 * automation view makes prompts and confirmations behave consistently across
 * the editor and the rest of the WebView UI.
 */
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel = 'Close',
  closeOnBackdrop = true,
  className = '',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    const firstField = dialogRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not(.ui-modal__close):not([disabled])',
    );
    (firstField ?? dialogRef.current)?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`ui-modal-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ui-modal-card__header">
          <h2 id="ui-modal-title" className="ui-modal-card__title">{title}</h2>
          <button
            type="button"
            className="ui-modal__close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {description ? <p className="ui-modal-card__description">{description}</p> : null}
        {children ? <div className="ui-modal-card__body">{children}</div> : null}
        {footer ? <footer className="ui-modal-card__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export type TextPromptModalProps = {
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  requiredMessage: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
};

export function TextPromptModal({
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  requiredMessage,
  onConfirm,
  onClose,
}: TextPromptModalProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const inputRef = useRef<TextInputHandle | null>(null);

  const confirm = (): void => {
    const nextValue = value.trim();
    if (!nextValue) {
      setError(requiredMessage);
      inputRef.current?.focus();
      return;
    }
    onConfirm(nextValue);
  };

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div className="ui-modal-card__actions">
          <Button variant="soft" onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" onClick={confirm}>{confirmLabel}</Button>
        </div>
      }
    >
      <FormField label={label} error={error} required>
        <TextInput
          ref={inputRef}
          value={value}
          onValueChange={(nextValue) => {
            setValue(nextValue);
            if (error) setError('');
          }}
          placeholder={placeholder}
          required
          onEnter={confirm}
          spellCheck={false}
        />
      </FormField>
    </Modal>
  );
}

export type ConfirmModalProps = {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
};

export function ConfirmModal({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  danger = false,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div className="ui-modal-card__actions">
          <Button variant="soft" onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      }
    />
  );
}
