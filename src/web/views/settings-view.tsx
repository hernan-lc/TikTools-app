import { IconSettings } from '../components/icons.tsx';
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
    <div className="view-container">
      <div className="connect-pane">
        <div className="connect-card">
          <h2>
            <IconSettings /> {t(locale, 'preferences')}
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {t(locale, 'preferencesLead')}
          </p>

          <div className="form-group">
            <label htmlFor="settings-language">{t(locale, 'language')}</label>
            <select
              id="settings-language"
              value={locale}
              onChange={(e) => onLocaleChange(e.currentTarget.value as Locale)}
            >
              <option value="en">{t(locale, 'english')}</option>
              <option value="es">{t(locale, 'spanish')}</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="settings-theme-select">{t(locale, 'theme')}</label>
            <select
              id="settings-theme-select"
              value={theme}
              onChange={(e) => onThemeChange(e.currentTarget.value as Theme)}
            >
              <option value="dark">{t(locale, 'dark')}</option>
              <option value="light">{t(locale, 'light')}</option>
            </select>
          </div>

          <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            ℹ️ {t(locale, 'cookiesMemory')}
          </div>
        </div>
      </div>
    </div>
  );
}
