import { useState } from 'preact/hooks';

import type { AutomationEventType } from '../../../automation/types.ts';
import { Button } from '../ui/Button.tsx';
import { FormField } from '../ui/FormField.tsx';
import { Modal } from '../ui/Modal.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import { t, type Locale } from '../../i18n.ts';

type EventChoice = {
  value: AutomationEventType;
  en: string;
  es: string;
  icon: string;
};

export const WORKFLOW_EVENT_CHOICES: EventChoice[] = [
  { value: 'tiktok.chat', en: 'Chat message', es: 'Mensaje de chat', icon: '💬' },
  { value: 'tiktok.gift', en: 'Gift received', es: 'Regalo recibido', icon: '🎁' },
  { value: 'tiktok.like', en: 'Likes', es: 'Likes', icon: '❤️' },
  { value: 'tiktok.follow', en: 'New follower', es: 'Nuevo seguidor', icon: '⭐' },
  { value: 'tiktok.share', en: 'Live shared', es: 'LIVE compartido', icon: '↗' },
  { value: 'tiktok.join', en: 'Viewer joined', es: 'Espectador entra', icon: '👋' },
  { value: 'tiktok.social', en: 'Social action', es: 'Acción social', icon: '👥' },
  { value: 'tiktok.room_stats', en: 'Room statistics', es: 'Estadísticas de sala', icon: '📊' },
  { value: 'tiktok.connected', en: 'LIVE connected', es: 'LIVE conectado', icon: '🔌' },
  { value: 'tiktok.disconnected', en: 'LIVE disconnected', es: 'LIVE desconectado', icon: '⏹' },
  { value: 'points.awarded', en: 'Points awarded', es: 'Puntos otorgados', icon: '🏆' },
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
              <strong>{locale === 'es' ? selected?.es : selected?.en}</strong>
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
                <span>{locale === 'es' ? choice.es : choice.en}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
