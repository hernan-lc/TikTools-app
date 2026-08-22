import { IconSettings } from '../components/icons.tsx';
import { Alert, Card } from '../components/ui/Card.tsx';
import { FormField } from '../components/ui/FormField.tsx';
import { Select } from '../components/ui/Select.tsx';
import { Page } from '../components/ui/Page.tsx';
import { t, type Locale } from '../i18n.ts';
import type { Theme } from '../preferences.ts';

type SettingsViewProps = {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (l: Locale) => void;
  onThemeChange: (t: Theme) => void;
};

export function SettingsView({ locale, theme, onLocaleChange, onThemeChange }: SettingsViewProps) {
  return (
    <Page narrow>
      <Card title={t(locale, 'preferences')} subtitle={t(locale, 'preferencesLead')} icon={<IconSettings />}>
        <FormField label={t(locale, 'language')} htmlFor="settings-language">
          <Select
            id="settings-language"
            value={locale}
            onValueChange={(v) => onLocaleChange(v as Locale)}
            options={[
              { value: 'en', label: t(locale, 'english') },
              { value: 'es', label: t(locale, 'spanish') },
            ]}
          />
        </FormField>

        <FormField label={t(locale, 'theme')} htmlFor="settings-theme-select">
          <Select
            id="settings-theme-select"
            value={theme}
            onValueChange={(v) => onThemeChange(v as Theme)}
            options={[
              { value: 'dark', label: t(locale, 'dark') },
              { value: 'light', label: t(locale, 'light') },
            ]}
          />
        </FormField>

        <Alert variant="info">ℹ️ {t(locale, 'cookiesMemory')}</Alert>
      </Card>
    </Page>
  );
}
