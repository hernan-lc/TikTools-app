import type { AutomationEvent } from '../../../automation/types.ts';
import { Badge } from '../ui/Card.tsx';
import { t, type Locale } from '../../i18n.ts';
import { getTemplateSuggestions } from './template-suggestions.ts';

type EventContextPreviewProps = {
  locale: Locale;
  event?: AutomationEvent;
  capturedAt?: number;
};

export function EventContextPreview({ locale, event, capturedAt }: EventContextPreviewProps) {
  if (!event) {
    return (
      <div className="node-editor-live-context is-empty">
        <strong>{t(locale, 'lastEventContext')}</strong>
        <span>{t(locale, 'noLastEventContext')}</span>
      </div>
    );
  }

  const fields = getTemplateSuggestions(event.type, locale, event)
    .filter((suggestion) => suggestion.preview !== undefined && suggestion.value !== 'event.data')
    .slice(0, 9);
  const time = capturedAt ? new Date(capturedAt).toLocaleTimeString(locale) : new Date(event.timestamp).toLocaleTimeString(locale);

  return (
    <div className="node-editor-live-context">
      <div className="node-editor-live-context__header">
        <div>
          <strong>{t(locale, 'lastEventContext')}</strong>
          <small>{t(locale, 'capturedAt', { time })}</small>
        </div>
        <Badge tone="cyan">{event.type}</Badge>
      </div>
      <span className="node-editor-live-context__fields-label">{t(locale, 'eventFields')}</span>
      <div className="node-editor-live-context__fields">
        {fields.map((field) => (
          <div key={field.value} className="node-editor-live-context__field">
            <code>{field.value}</code>
            <span>{field.preview}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
