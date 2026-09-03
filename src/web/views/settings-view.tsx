import { IconSettings } from '../components/icons.tsx';
import { Card } from '../components/ui/Card.tsx';
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
        <Select
          id="settings-language"
          value={locale}
          label={t(locale, 'language')}
          onValueChange={(v) => onLocaleChange(v as Locale)}
          options={[
            { value: 'en', label: t(locale, 'english') },
            { value: 'es', label: t(locale, 'spanish') },
          ]}
        />

        <Select
          id="settings-theme-select"
          value={theme}
          label={t(locale, 'theme')}
          onValueChange={(v) => onThemeChange(v as Theme)}
          options={[
            { value: 'dark', label: t(locale, 'dark') },
            { value: 'light', label: t(locale, 'light') },
          ]}
        />
      </Card>
    </Page>
  );
}
