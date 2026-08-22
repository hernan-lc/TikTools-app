import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { IconDice, IconRadio, IconUsers } from '../components/icons.tsx';
import { Alert, Badge, Card, Chip, ChipGroup, EmptyState } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { FormField } from '../components/ui/FormField.tsx';
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

export function ConnectView({
  locale,
  uniqueId,
  cookie,
  status,
  recents,
  error,
  onUniqueIdChange,
  onCookieChange,
  onConnect,
  onPickLive,
  onSelectRecent,
}: ConnectViewProps) {
  const isBusy = status === 'connecting' || status === 'retrying';
  const [showCookie, setShowCookie] = useState(Boolean(cookie));

  const handleSubmit = (e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    onConnect();
  };

  return (
    <Page narrow>
      <Card title={t(locale, 'connectToLive')} subtitle={t(locale, 'setupLead')} icon={<IconRadio />}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <FormField label={t(locale, 'creatorHandle')} hint={t(locale, 'leadingAtOptional')} required htmlFor="connect-creator">
            <TextInput
              id="connect-creator"
              value={uniqueId}
              onValueChange={onUniqueIdChange}
              prefix="@"
              placeholder="creator_handle"
              required
              onEnter={onConnect}
            />
          </FormField>

          {showCookie ? (
            <FormField label={`${t(locale, 'authenticatedCookie')} (${t(locale, 'optional')})`} htmlFor="connect-cookie">
              <TextInput
                id="connect-cookie"
                type="password"
                value={cookie}
                onValueChange={onCookieChange}
                placeholder="sessionid=..."
              />
            </FormField>
          ) : (
            <div style={{ marginBottom: 4 }}>
              <Button variant="soft" size="sm" onClick={() => setShowCookie(true)}>
                + {t(locale, 'authenticatedCookie')}
              </Button>
            </div>
          )}

          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button type="submit" variant="primary" block loading={isBusy} disabled={!uniqueId.trim()}>
              {isBusy ? t(locale, 'connecting') : t(locale, 'connect')}
            </Button>
            <Button variant="cyan" tooltip={t(locale, 'pickLive')} disabled={isBusy} onClick={onPickLive} icon={<IconDice />} iconOnly />
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
}
