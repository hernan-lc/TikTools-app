import { ref } from 'vue';
import { defineVueComponent } from '../vue/component.ts';

import { IconDice, IconRadio, IconUsers } from '../components/icons.tsx';
import { Alert, Badge, Card, Chip, ChipGroup, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { TextInput } from '../components/ui/TextInput.tsx';
import { Page } from '../components/ui/Page.tsx';
import { t, type Locale } from '../i18n.ts';
import type { ConnectionStatus } from '../types.ts';

type ConnectViewProps = {
  locale: Locale;
  uniqueId: string;
  cookie: string;
  status: ConnectionStatus;
  recents: string[];
  error: string;
  onUniqueIdChange: (val: string) => void;
  onCookieChange: (val: string) => void;
  onConnect: () => void;
  onPickLive: () => void;
  onSelectRecent: (username: string) => void;
};

export const ConnectView = defineVueComponent<ConnectViewProps>(
  ['locale', 'uniqueId', 'cookie', 'status', 'recents', 'error', 'onUniqueIdChange', 'onCookieChange', 'onConnect', 'onPickLive', 'onSelectRecent'],
  (props) => {
  const showCookie = ref(Boolean(props.cookie));

  return () => {
    const { locale, uniqueId, cookie, status, recents, error, onUniqueIdChange, onCookieChange, onConnect, onPickLive, onSelectRecent } = props;
    const isBusy = status === 'connecting' || status === 'retrying';
    const isLive = status === 'connected';
    const handleSubmit = (e: SubmitEvent) => {
      e.preventDefault();
      onConnect();
    };

    return (
      <Page narrow>
        <Card title={t(locale, 'connectToLive')} subtitle={t(locale, 'setupLead')} icon={<IconRadio />}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {isLive ? <Alert variant="info">{t(locale, 'live')} — {t(locale, 'disconnectToChangeCreator')}</Alert> : null}
            <TextInput
              id="connect-creator"
              value={uniqueId}
              onValueChange={onUniqueIdChange}
              label={t(locale, 'creatorHandle')}
              hint={t(locale, 'leadingAtOptional')}
              prefix="@"
              required
              disabled={isLive || isBusy}
              onEnter={onConnect}
            />

            {showCookie.value ? (
              <TextInput
                id="connect-cookie"
                type="password"
                value={cookie}
                onValueChange={onCookieChange}
                label={`${t(locale, 'authenticatedCookie')} ${t(locale, 'optional')}`}
                hint={t(locale, 'guestCookieHint')}
                disabled={isLive || isBusy}
              />
            ) : (
              <div style={{ marginBottom: 4 }}>
                <Button variant="soft" size="sm" onClick={() => (showCookie.value = true)} disabled={isLive || isBusy}>
                  + {t(locale, 'authenticatedCookie')}
                </Button>
              </div>
            )}

            {error ? <Alert variant="danger">{error}</Alert> : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button type="submit" variant="primary" block loading={isBusy} disabled={isLive || !uniqueId.trim()}>
                {isBusy ? t(locale, 'connecting') : isLive ? t(locale, 'live') : t(locale, 'connect')}
              </Button>
              <Button variant="cyan" tooltip={t(locale, 'pickLive')} disabled={isLive || isBusy} onClick={onPickLive} icon={<IconDice />} iconOnly />
            </div>
          </form>
        </Card>

        <Card title={t(locale, 'recentStreamers')} icon={<IconUsers />} action={recents.length ? <Badge>{recents.length}</Badge> : null}>
          {recents.length > 0 ? (
            <ChipGroup>
              {recents.map((creator) => (
                <Chip key={creator} onClick={() => onSelectRecent(creator)}>
                  @{creator}
                </Chip>
              ))}
            </ChipGroup>
          ) : (
            <EmptyState title={t(locale, 'noRecents')} description="" />
          )}
        </Card>
      </Page>
    );
  };
  },
);
