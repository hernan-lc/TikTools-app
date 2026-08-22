import { useEffect, useRef, useState } from 'preact/hooks';
import { render } from 'preact';

import type { HostMessage, PageMessage } from '../shared/messages.ts';
import {
  AnalyticsView,
  ConnectView,
  LiveFeed,
  NavigationRail,
  SettingsView,
  TopNav,
  type AppTab,
  type ConnectionStatus,
  type DisplayEvent,
  type EventFilter,
  type StreamTelemetry,
} from './components.tsx';
import { t, type Locale } from './i18n.ts';
import {
  addRecentUsername,
  applyTheme,
  getInitialLocale,
  getInitialTheme,
  getRecentUsernames,
  getSavedUsername,
  saveLocale,
  saveTheme,
  saveUsername,
  type Theme,
} from './preferences.ts';
import './styles.css';

declare global {
  interface Window {
    ipc?: { postMessage: (message: string) => void };
    __webview_on_message__?: (message: string) => void;
  }
}

function send(message: PageMessage): void {
  window.ipc?.postMessage(JSON.stringify(message));
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

const initialLocale = getInitialLocale();
const initialTheme = getInitialTheme();
const initialUsername = getSavedUsername();
applyTheme(initialTheme);
document.documentElement.lang = initialLocale;

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('feed');
  const [uniqueId, setUniqueId] = useState(initialUsername);
  const [cookie, setCookie] = useState('');
  const [activeCreator, setActiveCreator] = useState(initialUsername);
  const [recents, setRecents] = useState<string[]>(getRecentUsernames());
  
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState('');
  
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [telemetry, setTelemetry] = useState<StreamTelemetry>({
    chats: 0,
    gifts: 0,
    likes: 0,
    members: 0,
  });
  
  const [autoScroll, setAutoScroll] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const nextEventId = useRef(0);
  const activeCreatorRef = useRef(initialUsername);
  const streamContainerRef = useRef<HTMLDivElement | null>(null);

  const resetEvents = (): void => {
    nextEventId.current = 0;
    setEvents([]);
    setUnreadCount(0);
    setTelemetry({ chats: 0, gifts: 0, likes: 0, members: 0 });
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    saveLocale(locale);
  }, [locale]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  // Handle messages from the native runtime
  useEffect(() => {
    const receive = (raw: string): void => {
      let message: HostMessage;
      try {
        message = JSON.parse(raw) as HostMessage;
      } catch {
        return;
      }

      if (message.type === 'connection') {
        if (message.status === 'connecting') setStatus('connecting');
        if (message.status === 'connected') {
          setStatus('connected');
          if (message.uniqueId) {
            const clean = normalizeUsername(message.uniqueId);
            setActiveCreator(clean);
            activeCreatorRef.current = clean;
            setRecents(addRecentUsername(clean));
          }
        }
        if (message.status === 'disconnected') setStatus('disconnected');
      }

      if (message.type === 'reconnecting') setStatus('retrying');

      if (message.type === 'live-event') {
        const ev = message.event;
        setTelemetry((prev) => ({
          chats: prev.chats + (ev.kind === 'chat' ? 1 : 0),
          gifts: prev.gifts + (ev.kind === 'gift' ? 1 : 0),
          likes: prev.likes + (ev.kind === 'like' ? 1 : 0),
          members: prev.members + (ev.kind === 'member' || ev.kind === 'social' ? 1 : 0),
        }));

        setEvents((current) => [
          ...current,
          { ...ev, id: nextEventId.current++, receivedAt: Date.now() },
        ].slice(-300));

        if (!autoScroll) {
          setUnreadCount((c) => c + 1);
        }
      }

      if (message.type === 'error') {
        setStatus('error');
        setError(message.message);
        setEvents((current) => [
          ...current,
          {
            kind: 'member' as const,
            author: t(locale, 'system'),
            text: message.message,
            id: nextEventId.current++,
            receivedAt: Date.now(),
          },
        ].slice(-300));
      }
    };

    window.__webview_on_message__ = receive;
    return () => {
      if (window.__webview_on_message__ === receive) window.__webview_on_message__ = undefined;
    };
  }, [locale, autoScroll]);

  // Smooth scroll when new events arrive and autoScroll is active
  useEffect(() => {
    if (activeTab === 'feed' && autoScroll && streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [events, autoScroll, activeTab]);

  const handleConnect = (userToConnect?: string): void => {
    const target = normalizeUsername(userToConnect || uniqueId);
    if (!target) {
      setError(t(locale, 'handleRequired'));
      return;
    }

    setError('');
    resetEvents();
    setStatus('connecting');
    setActiveCreator(target);
    activeCreatorRef.current = target;
    saveUsername(target);
    setRecents(addRecentUsername(target));
    setActiveTab('feed');

    send({
      type: 'connect',
      uniqueId: target,
      sessionCookie: cookie.trim(),
    });
  };

  const handlePickLive = (): void => {
    setError('');
    resetEvents();
    setStatus('connecting');
    setActiveCreator('🎲 ' + t(locale, 'searchingRooms'));
    setActiveTab('feed');
    send({
      type: 'pick-live',
      sessionCookie: cookie.trim(),
    });
  };

  const handleDisconnect = (): void => {
    send({ type: 'disconnect' });
    setStatus('disconnected');
  };

  const handleReconnect = (): void => {
    if (activeCreatorRef.current) {
      handleConnect(activeCreatorRef.current);
    }
  };

  const handleSelectRecent = (username: string): void => {
    setUniqueId(username);
    handleConnect(username);
  };

  const handleToggleAutoScroll = (): void => {
    const nextState = !autoScroll;
    setAutoScroll(nextState);
    if (nextState) {
      setUnreadCount(0);
      if (streamContainerRef.current) {
        streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
      }
    }
  };

  const handleThemeToggle = (): void => {
    setTheme((cur) => (cur === 'dark' ? 'light' : 'dark'));
  };

  const handleLocaleToggle = (): void => {
    setLocale((cur) => (cur === 'en' ? 'es' : 'en'));
  };

  // Connect automatically on initial startup if a handle is saved
  useEffect(() => {
    if (initialUsername) {
      handleConnect(initialUsername);
    }
  }, []);

  return (
    <div className="app-shell">
      <TopNav
        locale={locale}
        theme={theme}
        status={status}
        activeCreator={activeCreator}
        onThemeToggle={handleThemeToggle}
        onLocaleToggle={handleLocaleToggle}
        onReconnect={handleReconnect}
        onDisconnect={handleDisconnect}
      />

      <div className="workspace-body">
        <NavigationRail
          locale={locale}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {activeTab === 'feed' && (
          <LiveFeed
            locale={locale}
            events={events}
            filter={filter}
            searchQuery={searchQuery}
            autoScroll={autoScroll}
            unreadCount={unreadCount}
            onFilterChange={setFilter}
            onSearchChange={setSearchQuery}
            onToggleAutoScroll={handleToggleAutoScroll}
            onClearFeed={resetEvents}
            streamContainerRef={(el) => (streamContainerRef.current = el)}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            locale={locale}
            telemetry={telemetry}
            events={events}
          />
        )}

        {activeTab === 'connect' && (
          <ConnectView
            locale={locale}
            uniqueId={uniqueId}
            cookie={cookie}
            status={status}
            recents={recents}
            error={error}
            onUniqueIdChange={setUniqueId}
            onCookieChange={setCookie}
            onConnect={() => handleConnect()}
            onPickLive={handlePickLive}
            onSelectRecent={handleSelectRecent}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            locale={locale}
            theme={theme}
            onLocaleChange={setLocale}
            onThemeChange={setTheme}
          />
        )}
      </div>
    </div>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Web UI root element was not found.');
render(<App />, root);
