<script lang="tsx">
import { IconSettings } from '../components/icons.vue';
import { Card } from '../components/ui/Card.vue';
import { Select } from '../components/ui/Select.vue';
import { Page } from '../components/ui/Page.vue';
import { defineVueComponent } from '../vue/component.ts';
import { t, type Locale } from '../i18n.ts';
import type { Theme } from '../preferences.ts';

type SettingsViewProps = {
  locale: Locale;
  theme: Theme;
  onLocaleChange: (l: Locale) => void;
  onThemeChange: (t: Theme) => void;
};

function renderSettingsView({ locale, theme, onLocaleChange, onThemeChange }: SettingsViewProps) {
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

export const SettingsView = defineVueComponent<SettingsViewProps>(
  ['locale', 'theme', 'onLocaleChange', 'onThemeChange'],
  (props) => () => renderSettingsView(props),
);

export default SettingsView;
</script>
