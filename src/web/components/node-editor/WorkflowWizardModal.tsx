import { useState } from 'preact/hooks';

import type { AutomationEventType } from '../../../automation/types.ts';
import type { I18nText } from '../../../automation/behavior/types.ts';
import { Button } from '../ui/Button.tsx';
import { FormField } from '../ui/FormField.tsx';
import { Modal } from '../ui/Modal.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { i18nText, t, type Locale } from '../../i18n.ts';

type EventChoice = {
  value: AutomationEventType;
  label: I18nText;
  icon: string;
};

export const WORKFLOW_EVENT_CHOICES: EventChoice[] = [
  { value: "tiktok.chat", label: { default: "Chat message", i18key: "workflow.event.tiktok.chat" }, icon: "💬" },
  { value: "tiktok.gift", label: { default: "Gift received", i18key: "workflow.event.tiktok.gift" }, icon: "🎁" },
  { value: "tiktok.like", label: { default: "Likes", i18key: "workflow.event.tiktok.like" }, icon: "❤️" },
  { value: "tiktok.follow", label: { default: "New follower", i18key: "workflow.event.tiktok.follow" }, icon: "⭐" },
  { value: "tiktok.share", label: { default: "Live shared", i18key: "workflow.event.tiktok.share" }, icon: "↗" },
  { value: "tiktok.join", label: { default: "Viewer joined", i18key: "workflow.event.tiktok.join" }, icon: "👋" },
  { value: "tiktok.social", label: { default: "Social action", i18key: "workflow.event.tiktok.social" }, icon: "👥" },
  { value: "tiktok.room_stats", label: { default: "Room statistics", i18key: "workflow.event.tiktok.room_stats" }, icon: "📊" },
  { value: "tiktok.connected", label: { default: "LIVE connected", i18key: "workflow.event.tiktok.connected" }, icon: "🔌" },
  { value: "tiktok.disconnected", label: { default: "LIVE disconnected", i18key: "workflow.event.tiktok.disconnected" }, icon: "⏹" },
  { value: "points.awarded", label: { default: "Points awarded", i18key: "workflow.event.points.awarded" }, icon: "🏆" },
];

type WorkflowWizardModalProps = {
  locale: Locale;
  onClose: () => void;
  onCreate: (name: string, eventType: AutomationEventType) => void;
};

export function WorkflowWizardModal({ locale, onClose, onCreate }: WorkflowWizardModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState<AutomationEventType>('tiktok.chat');
  const [error, setError] = useState('');

  const next = (): void => {
    if (!name.trim()) {
      setError(t(locale, 'workflowNameRequired'));
      return;
    }
    setError('');
    setStep(2);
  };

  const create = (): void => {
    if (!name.trim()) {
      setStep(1);
      setError(t(locale, 'workflowNameRequired'));
      return;
    }
    onCreate(name.trim(), eventType);
  };

  const selected = WORKFLOW_EVENT_CHOICES.find((choice) => choice.value === eventType) ?? WORKFLOW_EVENT_CHOICES[0];

  return (
    <Modal
      title={t(locale, 'workflowWizardTitle')}
      description={step === 1 ? t(locale, 'workflowWizardNameHint') : t(locale, 'workflowWizardEventHint')}
      onClose={onClose}
      footer={
        <div className="node-editor-modal-actions">
          <Button variant="soft" onClick={step === 1 ? onClose : () => setStep(1)}>
            {step === 1 ? t(locale, 'cancel') : t(locale, 'back')}
          </Button>
          <Button variant="primary" onClick={step === 1 ? next : create}>
            {step === 1 ? t(locale, 'continue') : t(locale, 'createWorkflow')}
          </Button>
        </div>
      }
    >
      <div className="node-editor-wizard-steps" aria-label={t(locale, 'workflowWizardStep', { step })}>
        <span className={step === 1 ? 'is-active' : 'is-complete'}>1</span>
        <i />
        <span className={step === 2 ? 'is-active' : ''}>2</span>
      </div>

      {step === 1 ? (
        <FormField label={t(locale, 'workflowName')} error={error} required>
          <TextInput
            value={name}
            onValueChange={(value) => {
              setName(value);
              if (error) setError('');
            }}
            placeholder={t(locale, 'workflowNamePlaceholder')}
            onEnter={next}
            required
          />
        </FormField>
      ) : (
        <div className="node-editor-event-picker">
          <div className="node-editor-event-picker__selected">
            <span className="node-editor-event-picker__selected-icon">{selected?.icon}</span>
            <div>
              <strong>{i18nText(locale, selected?.label)}</strong>
              <small>{name}</small>
            </div>
          </div>
          <div className="node-editor-event-grid">
            {WORKFLOW_EVENT_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={`node-editor-event-choice ${eventType === choice.value ? 'is-selected' : ''}`}
                onClick={() => setEventType(choice.value)}
              >
                <span>{choice.icon}</span>
                <span>{i18nText(locale, choice.label)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
