import { ref } from 'vue';
import { defineVueComponent } from '../../vue/component.ts';

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

export const WorkflowWizardModal = defineVueComponent<WorkflowWizardModalProps>(
  ['locale', 'onClose', 'onCreate'],
  (props) => {
  const step = ref<1 | 2>(1);
  const name = ref('');
  const eventType = ref<AutomationEventType>('tiktok.chat');
  const error = ref('');

  const next = (): void => {
    if (!name.value.trim()) {
      error.value = t(props.locale, 'workflowNameRequired');
      return;
    }
    error.value = '';
    step.value = 2;
  };

  const create = (): void => {
    if (!name.value.trim()) {
      step.value = 1;
      error.value = t(props.locale, 'workflowNameRequired');
      return;
    }
    props.onCreate(name.value.trim(), eventType.value);
  };

  return () => {
    const { locale, onClose } = props;
    const selected = WORKFLOW_EVENT_CHOICES.find((choice) => choice.value === eventType.value) ?? WORKFLOW_EVENT_CHOICES[0];
    return (
    <Modal
      title={t(locale, 'workflowWizardTitle')}
      description={step.value === 1 ? t(locale, 'workflowWizardNameHint') : t(locale, 'workflowWizardEventHint')}
      onClose={onClose}
      footer={
        <div class="node-editor-modal-actions">
          <Button variant="soft" onClick={step.value === 1 ? onClose : () => (step.value = 1)}>
            {step.value === 1 ? t(locale, 'cancel') : t(locale, 'back')}
          </Button>
          <Button variant="primary" onClick={step.value === 1 ? next : create}>
            {step.value === 1 ? t(locale, 'continue') : t(locale, 'createWorkflow')}
          </Button>
        </div>
      }
    >
      <div class="node-editor-wizard-steps" aria-label={t(locale, 'workflowWizardStep', { step: step.value })}>
        <span class={step.value === 1 ? 'is-active' : 'is-complete'}>1</span>
        <i />
        <span class={step.value === 2 ? 'is-active' : ''}>2</span>
      </div>

      {step.value === 1 ? (
        <FormField label={t(locale, 'workflowName')} error={error.value} required>
          <TextInput
            value={name.value}
            onValueChange={(value) => {
              name.value = value;
              if (error.value) error.value = '';
            }}
            placeholder={t(locale, 'workflowNamePlaceholder')}
            onEnter={next}
            required
          />
        </FormField>
      ) : (
        <div class="node-editor-event-picker">
          <div class="node-editor-event-picker__selected">
            <span class="node-editor-event-picker__selected-icon">{selected?.icon}</span>
            <div>
              <strong>{i18nText(locale, selected?.label)}</strong>
              <small>{name.value}</small>
            </div>
          </div>
          <div class="node-editor-event-grid">
            {WORKFLOW_EVENT_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                class={`node-editor-event-choice ${eventType.value === choice.value ? 'is-selected' : ''}`}
                onClick={() => (eventType.value = choice.value)}
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
  };
  },
);
