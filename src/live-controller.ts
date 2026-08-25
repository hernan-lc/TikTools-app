import {
  bootstrapGuestSession,
  Discovery,
  SOCIAL_ACTION,
  TikTokLive,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';
import type {
  ClientState,
  Gift,
  GiftEvent,
  LiveEvent,
} from '../vendor/tiktok-signer/packages/tiktok-live/src/index.ts';

import { AutomationEventBus } from './automation/event-bus.ts';
import {
  createConnectedEvent,
  createDisconnectedEvent,
  createPointsAwardedEvent,
  normalizeTikTokEvent,
} from './automation/events.ts';
import { assertValidWorkflowGraph } from './automation/graph.ts';
import { createBuiltInNodeRegistry } from './automation/nodes/builtins.ts';
import { AutomationRuntime } from './automation/runtime.ts';
import { BehaviorEngine, sampleEventFor } from './automation/behavior/engine.ts';
import { PLUGIN_DESCRIPTORS } from './automation/behavior/catalog.ts';
import type { BehaviorRun, BehaviorSnapshot, PluginStatus } from './automation/behavior/types.ts';
import { NativeAudioService } from './automation/services/audio-service.ts';
import { HttpService } from './automation/services/http-service.ts';
import { NapiVmService } from './automation/services/napi-vm-service.ts';
import { NapiVmLanguageService } from './automation/services/napi-vm-language-service.ts';
import { AutomationPluginLoader } from './automation/plugins/plugin-loader.ts';
import { PluginManager } from './automation/plugins/plugin-manager.ts';
import { SonicBoomProvider } from './automation/providers/sonicboom.ts';
import type { AutomationCapabilities } from './automation/capabilities.ts';
import type { AutomationConnectionContext, AutomationEvent } from './automation/types.ts';
import { AutomationDatabase } from './db/automation-db.ts';
import { PointsDatabase } from './db/points-db.ts';
import { ensureAppPaths } from './platform/app-paths.ts';
import {
  cleanUsername,
  hasUser,
  isChatEvent,
  isGiftEvent,
  isLikeEvent,
  isMemberEvent,
  isRoomUserEvent,
  isSocialEvent,
  roomTitle,
  toUiEvent,
} from './live-events.ts';
import type { HostMessage, PageMessage } from './shared/messages.ts';

type SendHostMessage = (message: HostMessage) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LiveController {
  #live: TikTokLive | null = null;
  #generation = 0;
  #automationContext: AutomationConnectionContext | undefined;
  #lastAutomationEvent: AutomationEvent | undefined;
  #lastAutomationEventCapturedAt: number | undefined;
  #lastAutomationContextSentAt = 0;
  #automationContextTimer: ReturnType<typeof setTimeout> | undefined;
  readonly pointsDb: PointsDatabase;
  readonly automationDb: AutomationDatabase;
  readonly automationBus: AutomationEventBus;
  readonly automationRuntime: AutomationRuntime;
  readonly behavior: BehaviorEngine;
  readonly pluginManager: PluginManager;
  readonly audioService: NativeAudioService;
  readonly sonicBoom: SonicBoomProvider;
  readonly napiVm: NapiVmService;
  readonly napiVmLanguage: NapiVmLanguageService;
  readonly automationCapabilities: AutomationCapabilities;
  readonly pluginLoader: AutomationPluginLoader;

  constructor(private readonly send: SendHostMessage) {
    this.pointsDb = new PointsDatabase();
    this.automationDb = new AutomationDatabase();
    this.automationBus = new AutomationEventBus();
    const nodeRegistry = createBuiltInNodeRegistry();
    this.pluginManager = new PluginManager(nodeRegistry);
    this.audioService = new NativeAudioService();
    this.sonicBoom = new SonicBoomProvider();
    this.napiVm = new NapiVmService();
    this.napiVmLanguage = new NapiVmLanguageService();
    this.automationCapabilities = {
      http: new HttpService(),
      audio: this.audioService,
      tts: this.sonicBoom,
      points: {
        adjust: (uniqueId, delta) => {
          const result = this.pointsDb.awardPoints(uniqueId, 'manual', { customAmount: delta });
          if (!result) throw new Error('Cannot adjust points for an empty viewer id.');
          this.send({
            type: 'points-awarded',
            uniqueId: result.uniqueId,
            delta: result.delta,
            totalPoints: result.totalPoints,
            level: result.level,
          });
          return {
            uniqueId: result.uniqueId,
            delta: result.delta,
            totalPoints: result.totalPoints,
            level: result.level,
            currencyName: result.currencyName,
          };
        },
      },
      vm: this.napiVm,
    };
    this.automationRuntime = new AutomationRuntime(nodeRegistry, {
      capabilities: this.automationCapabilities,
      capabilitiesForPlugin: (pluginId, available) => pluginId === 'core'
        ? available
        : this.pluginManager.capabilitiesFor(pluginId, available),
    });
    this.pluginLoader = new AutomationPluginLoader({
      rootDirectory: ensureAppPaths().plugins,
      manager: this.pluginManager,
      capabilities: this.automationCapabilities,
      log: (message) => console.warn(`[automation-plugins] ${message}`),
      onLoaded: (manifest) => {
        console.log(`[automation-plugins] loaded ${manifest.id}@${manifest.version}`);
        this.reloadAutomationWorkflows();
        this.send({ type: 'automation-node-catalog', nodes: this.automationRuntime.getNodeDefinitions() });
      },
    });
    void this.pluginLoader.loadAll().catch((error: unknown) => {
      console.error('[automation-plugins] discovery failed:', errorMessage(error));
    });
    this.behavior = new BehaviorEngine({
      capabilities: this.automationCapabilities,
      publish: (event) => this.automationBus.publish(event),
      onRun: (run) => this.#onBehaviorRun(run),
    });

    this.automationBus.subscribe('*', (event) => this.automationRuntime.handleEvent(event));
    this.automationBus.subscribe('*', (event) => this.behavior.handleEvent(event));
    this.automationBus.onError((error, event) => {
      console.error(`[automation-bus] ${event.type}:`, error);
    });

    this.reloadBehavior();

    for (const workflow of this.automationDb.listWorkflows()) {
      try {
        this.automationRuntime.registerWorkflow(workflow.graph);
      } catch (error) {
        console.warn(`[automation] workflow ${workflow.id} was not loaded:`, error);
      }
    }
  }

  stop(): void {
    this.publishDisconnectedIfActive();
    this.#generation += 1;
    this.#live?.disconnect();
    this.#live = null;
    this.automationRuntime.cancelAll();
    this.audioService.stopAll();
    void this.sonicBoom.stop();
    this.send({ type: 'connection', status: 'disconnected' });
  }

  async shutdown(): Promise<void> {
    this.stop();
    this.clearAutomationContextTimer();
    await this.pluginLoader.stopAll();
    this.napiVm.clearAll();
    this.napiVmLanguage.clearAll();
  }

  public handlePageMessage(message: PageMessage): void {
    switch (message.type) {
      case 'disconnect':
        this.stop();
        break;
      case 'connect':
        void this.connect(message);
        break;
      case 'pick-live':
        void this.pickAndConnect(message);
        break;
      case 'get-points-config':
        this.send({
          type: 'points-config',
          config: this.pointsDb.getConfig(),
        });
        break;
      case 'update-points-config': {
        const updated = this.pointsDb.updateConfig(message.config);
        this.send({
          type: 'points-config',
          config: updated,
        });
        break;
      }
      case 'get-leaderboard': {
        const viewers = this.pointsDb.getLeaderboard(message.limit || 100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
      case 'reset-points': {
        this.pointsDb.resetPoints(message.uniqueId);
        const viewers = this.pointsDb.getLeaderboard(100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
      case 'adjust-points': {
        const res = this.pointsDb.awardPoints(message.uniqueId, 'manual', {
          customAmount: message.delta,
        });
        if (res) {
          this.send({
            type: 'points-awarded',
            uniqueId: res.uniqueId,
            delta: res.delta,
            totalPoints: res.totalPoints,
            level: res.level,
          });
        }
        const viewers = this.pointsDb.getLeaderboard(100);
        this.send({
          type: 'leaderboard',
          viewers,
        });
        break;
      }
      case 'get-creator': {
        const creator = message.uniqueId
          ? this.pointsDb.getCreator(message.uniqueId)
          : this.pointsDb.getActiveCreator();
        this.send({ type: 'creator-state', creator });
        break;
      }
      case 'get-recent-creators': {
        const creators = this.pointsDb.getRecentCreators(message.limit ?? 10);
        this.send({ type: 'recent-creators', creators });
        break;
      }
      case 'get-app-state': {
        if (message.keys && message.keys.length > 0) {
          const state: Record<string, string> = {};
          for (const k of message.keys) {
            const v = this.pointsDb.getAppState(k);
            if (v !== null) state[k] = v;
          }
          this.send({ type: 'app-state', state });
        } else {
          this.send({ type: 'app-state', state: this.pointsDb.getAllAppState() });
        }
        break;
      }
      case 'set-app-state': {
        this.pointsDb.setAppState(message.key, message.value);
        this.send({ type: 'app-state', state: { [message.key]: message.value } });
        break;
      }
      case 'clear-creator-history': {
        this.pointsDb.clearCreatorHistory();
        this.send({ type: 'recent-creators', creators: [] });
        this.send({ type: 'creator-state', creator: null });
        break;
      }
      case 'debug-gift': {
        const giftId = message.giftId ?? '5655';
        // find gift in current live's map if connected — type-safe via public gifts Map
        const giftsMap: Map<string, Gift> | undefined = this.#live?.gifts;
        const gift: Gift | undefined = giftsMap?.get(String(giftId));
        this.send({
          type: 'gift-debug',
          giftId,
          iconUrl: gift?.iconUrl,
          hasIcon: Boolean(gift?.iconUrl),
          totalGifts: giftsMap?.size ?? 0,
        });
        console.log(`[debug-gift] giftId=${giftId} hasIcon=${Boolean(gift?.iconUrl)} iconUrl=${gift?.iconUrl?.slice(0,120) || 'MISSING'} totalGifts=${giftsMap?.size ?? 0}`);
        break;
      }
      case 'get-automation-workflows':
        this.send({
          type: 'automation-workflows',
          workflows: this.automationDb.listWorkflows(),
        });
        break;
      case 'get-automation-nodes':
        this.send({
          type: 'automation-node-catalog',
          nodes: this.automationRuntime.getNodeDefinitions(),
        });
        break;
      case 'get-automation-context':
        this.send({
          type: 'automation-context',
          event: this.#lastAutomationEvent ?? null,
          capturedAt: this.#lastAutomationEventCapturedAt,
        });
        break;
      case 'save-automation-workflow':
        try {
          assertValidWorkflowGraph(message.graph, this.automationRuntime.nodeRegistry);
          this.automationRuntime.registerWorkflow(message.graph);
          this.automationDb.saveWorkflow(message.graph);
          this.send({
            type: 'automation-workflows',
            workflows: this.automationDb.listWorkflows(),
          });
        } catch (error) {
          this.send({ type: 'automation-error', message: errorMessage(error) });
        }
        break;
      case 'delete-automation-workflow':
        if (!this.automationDb.deleteWorkflow(message.id)) {
          this.send({ type: 'automation-error', message: `Unknown workflow: ${message.id}` });
          break;
        }
        this.automationRuntime.removeWorkflow(message.id);
        this.send({
          type: 'automation-workflows',
          workflows: this.automationDb.listWorkflows(),
        });
        break;
      case 'set-automation-workflow-enabled':
        try {
          const workflow = this.automationDb.setWorkflowEnabled(message.id, message.enabled);
          this.automationRuntime.registerWorkflow(workflow.graph);
          this.send({
            type: 'automation-workflows',
            workflows: this.automationDb.listWorkflows(),
          });
        } catch (error) {
          this.send({ type: 'automation-error', message: errorMessage(error) });
        }
        break;
      case 'get-gift-catalog':
        this.sendGiftCatalog();
        void this.refreshGiftCatalog();
        break;
      case 'get-behavior':
        this.sendBehavior();
        this.send({ type: 'behavior-runs', runs: this.behavior.recentRuns(30) });
        break;
      case 'save-action':
        try {
          this.automationDb.saveAction(message.action);
          this.reloadBehavior();
          this.sendBehavior();
        } catch (error) {
          this.send({ type: 'behavior-error', message: errorMessage(error) });
        }
        break;
      case 'delete-action':
        if (!this.automationDb.deleteAction(message.id)) {
          this.send({ type: 'behavior-error', message: `Unknown action: ${message.id}` });
          break;
        }
        this.reloadBehavior();
        this.sendBehavior();
        break;
      case 'set-action-enabled':
        try {
          this.automationDb.setActionEnabled(message.id, message.enabled);
          this.reloadBehavior();
          this.sendBehavior();
        } catch (error) {
          this.send({ type: 'behavior-error', message: errorMessage(error) });
        }
        break;
      case 'save-event':
        try {
          this.automationDb.saveEvent(message.event);
          this.reloadBehavior();
          this.sendBehavior();
        } catch (error) {
          this.send({ type: 'behavior-error', message: errorMessage(error) });
        }
        break;
      case 'delete-event':
        if (!this.automationDb.deleteEvent(message.id)) {
          this.send({ type: 'behavior-error', message: `Unknown event: ${message.id}` });
          break;
        }
        this.reloadBehavior();
        this.sendBehavior();
        break;
      case 'set-event-enabled':
        try {
          this.automationDb.setEventEnabled(message.id, message.enabled);
          this.reloadBehavior();
          this.sendBehavior();
        } catch (error) {
          this.send({ type: 'behavior-error', message: errorMessage(error) });
        }
        break;
      case 'test-action': {
        // The editor tests against the last real event so the preview and the
        // run use the same values; a sample event covers the offline case.
        const trigger = message.trigger ?? this.#lastAutomationEvent?.type ?? 'tiktok.gift';
        const event = this.#lastAutomationEvent?.type === trigger
          ? this.#lastAutomationEvent
          : sampleEventFor(trigger);
        void this.behavior
          .testAction(message.action, event)
          .then((run) => this.send({ type: 'behavior-test-result', runs: [run] }))
          .catch((error: unknown) => this.send({ type: 'behavior-error', message: errorMessage(error) }));
        break;
      }
      case 'test-event': {
        const event = this.#lastAutomationEvent?.type === message.event.trigger
          ? this.#lastAutomationEvent
          : sampleEventFor(message.event.trigger);
        void this.behavior
          .testEvent(message.event, event)
          .then((runs) => this.send({ type: 'behavior-test-result', runs }))
          .catch((error: unknown) => this.send({ type: 'behavior-error', message: errorMessage(error) }));
        break;
      }
      case 'set-plugin-install': {
        const descriptor = PLUGIN_DESCRIPTORS.find((plugin) => plugin.id === message.id);
        if (!descriptor) {
          this.send({ type: 'behavior-error', message: `Unknown plugin: ${message.id}` });
          break;
        }
        this.automationDb.setPluginState(message.id, message.installed, true);
        this.reloadBehavior();
        this.sendBehavior();
        break;
      }
      case 'set-plugin-enabled': {
        const state = this.automationDb.listPluginStates().find((entry) => entry.id === message.id);
        if (!state?.installed) {
          this.send({ type: 'behavior-error', message: `Plugin is not installed: ${message.id}` });
          break;
        }
        this.automationDb.setPluginState(message.id, true, message.enabled);
        this.reloadBehavior();
        this.sendBehavior();
        break;
      }
      case 'analyze-automation-script':
        try {
          const analysis = this.napiVmLanguage.analyze(
            message.nodeId,
            message.source,
            message.offset,
            message.eventType,
            this.#lastAutomationEvent,
          );
          this.send({ type: 'automation-script-analysis', analysis });
        } catch (error) {
          this.send({ type: 'automation-error', message: errorMessage(error) });
        }
        break;
    }
  }

  /** The room's gift list, cached so the condition editor works offline. */
  private storeGiftCatalog(): void {
    const gifts = this.#live?.gifts;
    if (!gifts || gifts.size === 0) return;
    this.pointsDb.saveGiftCatalog(
      [...gifts.values()].map((gift) => ({
        id: String(gift.id),
        name: gift.name,
        diamondCount: gift.diamondCount,
        iconUrl: gift.iconUrl || undefined,
      })),
    );
    this.sendGiftCatalog();
  }

  /**
   * The gift list needs no signature and no session — `Discovery.giftList` is
   * a plain read — so the catalog can be filled from the last known room while
   * the app is disconnected, which is when events are usually configured.
   */
  private async refreshGiftCatalog(): Promise<void> {
    if (this.pointsDb.getGiftCatalog().length > 0) return;
    const roomId = this.pointsDb.getAppState('lastRoomId');
    if (!roomId) return;
    try {
      const gifts = await new Discovery({}).giftList(roomId);
      if (gifts.size === 0) return;
      this.pointsDb.saveGiftCatalog(
        [...gifts.values()].map((gift) => ({
          id: String(gift.id),
          name: gift.name,
          diamondCount: gift.diamondCount,
          iconUrl: gift.iconUrl || undefined,
        })),
      );
      this.sendGiftCatalog();
    } catch (error) {
      console.warn(`[gift-catalog] could not read the gift list for room ${roomId}: ${errorMessage(error)}`);
    }
  }

  private sendGiftCatalog(): void {
    this.send({ type: 'gift-catalog', gifts: this.pointsDb.getGiftCatalog() });
  }

  private sendBehavior(): void {
    this.send({ type: 'behavior', snapshot: this.behaviorSnapshot() });
  }

  private behaviorSnapshot(): BehaviorSnapshot {
    const states = this.automationDb.listPluginStates();
    const plugins: PluginStatus[] = PLUGIN_DESCRIPTORS.map((descriptor) => {
      const state = states.find((entry) => entry.id === descriptor.id);
      return {
        descriptor,
        installed: Boolean(state?.installed),
        enabled: state ? state.enabled : true,
        available: true,
      };
    });

    return {
      actions: this.automationDb.listActions(),
      events: this.automationDb.listEvents(),
      plugins,
    };
  }

  /** Reloads what the engine runs from the database, including plugin gating. */
  private reloadBehavior(): void {
    const snapshot = this.behaviorSnapshot();
    this.behavior.setActions(snapshot.actions);
    this.behavior.setEvents(snapshot.events);
    this.behavior.setPluginReadiness(snapshot.plugins.map((plugin) => ({
      id: plugin.descriptor.id,
      ready: plugin.installed && plugin.enabled && plugin.available,
    })));
  }

  #onBehaviorRun(run: BehaviorRun): void {
    if (run.status === 'skipped' && !run.test) return;
    this.send({ type: 'behavior-runs', runs: this.behavior.recentRuns(30) });
  }

  async connect(request: Extract<PageMessage, { type: 'connect' }>): Promise<void> {
    const uniqueId = request.uniqueId.trim();
    const sessionCookie = request.sessionCookie.trim();
    this.publishDisconnectedIfActive();
    this.clearLastAutomationEvent();
    const generation = ++this.#generation;

    this.#live?.disconnect();
    this.#live = null;

    if (!uniqueId) {
      this.send({ type: 'error', phase: 'connect', message: 'Enter a creator handle.' });
      return;
    }

    this.#automationContext = {
      uniqueId,
      connectionId: `connection-${generation}`,
    };

    const client = new TikTokLive(uniqueId, {
      sessionCookie,
      roomId: request.roomId,
      fetchGifts: true,
      fetchRoomInfo: true,
      reconnect: { attempts: 5, initialMs: 2_000, maxMs: 30_000 },
    });
    this.#live = client;
    this.send({ type: 'connection', status: 'connecting', uniqueId });

    client.on('connected', (state: ClientState) => {
      if (generation !== this.#generation) return;

      // Persist creator to SQLite (backend save)
      const owner = state.roomInfo?.owner;
      this.#automationContext = {
        uniqueId: state.uniqueId,
        roomId: state.roomId,
        connectionId: `connection-${generation}`,
      };
      const creatorRecord = this.pointsDb.saveCreator({
        uniqueId: state.uniqueId,
        roomId: state.roomId,
        nickname: owner?.nickname || state.uniqueId,
        avatarUrl: owner?.avatarUrl || null,
        title: state.roomInfo?.title || roomTitle(state),
        displayId: owner?.uniqueId || state.uniqueId,
      });
      console.log(`[creator] saved @${creatorRecord.uniqueId} roomId=${creatorRecord.roomId} title=${creatorRecord.title?.slice(0,40) || ''} connectCount=${creatorRecord.connectCount}`);

      this.send({
        type: 'connection',
        status: 'connected',
        uniqueId: state.uniqueId,
        title: roomTitle(state),
        roomId: state.roomId,
        avatarUrl: owner?.avatarUrl,
      });
      this.send({ type: 'creator-state', creator: creatorRecord });
      this.send({ type: 'recent-creators', creators: this.pointsDb.getRecentCreators(10) });
      this.send({ type: 'app-state', state: this.pointsDb.getAllAppState() });
      // Send initial points config and leaderboard upon connection
      this.send({
        type: 'points-config',
        config: this.pointsDb.getConfig(),
      });
      this.send({
        type: 'leaderboard',
        viewers: this.pointsDb.getLeaderboard(50),
      });
      this.storeGiftCatalog();
      this.publishAutomationEvent(createConnectedEvent(state, this.#automationContext.connectionId));
    });

    client.on('event', (event: LiveEvent) => {
      if (generation !== this.#generation) return;

      const automationEvent = normalizeTikTokEvent(event, this.#automationContext);

      // Handle native TikTok ranking (Contributor 0-5 view) — Espectadores top
      if (isRoomUserEvent(event)) {
        if (automationEvent) this.publishAutomationEvent(automationEvent);
        const topViewers = (event.topViewers ?? []).slice(0, 6).map((v) => ({
          rank: v.rank,
          score: v.score,
          delta: v.delta,
          uniqueId: cleanUsername(v.user),
          nickname: v.user.nickname || cleanUsername(v.user),
          avatarUrl: v.user.avatarUrl || undefined,
          userId: v.user.userId,
        }));
        this.send({
          type: 'room-stats',
          viewers: event.viewers,
          totalUsers: event.totalUser,
          topViewers,
        });
        return;
      }

      const uiEvent = toUiEvent(event);
      if (!uiEvent) return;

      // Debug: gift image missing — type-safe check for missing iconUrl
      if (isGiftEvent(event) && !uiEvent.giftDetails?.imageUrl) {
        const giftsMap: Map<string, Gift> | undefined = this.#live?.gifts;
        const lookupIcon: string | undefined = giftsMap?.get(String(event.giftId))?.iconUrl;
        const eventIcon: string | undefined = (event as GiftEvent).giftIconUrl;
        console.warn(`[gift-image-missing] giftId=${event.giftId} giftName=${event.giftName} iconUrl=${eventIcon || 'NONE'} totalGifts=${giftsMap?.size ?? 0} lookup=${lookupIcon?.slice(0,60) || 'lookup-miss'}`);
        this.send({
          type: 'gift-debug',
          giftId: event.giftId,
          iconUrl: eventIcon,
          hasIcon: Boolean(eventIcon),
          totalGifts: giftsMap?.size ?? 0,
        });
      }

      // Process points in SQLite — all branches use type-guard narrowing, no `any` casts.
      let pointsResult = null;
      let pointsReason: string | undefined;
      const baseOpts = {
        nickname: uiEvent.nickname,
        avatarUrl: uiEvent.avatarUrl,
        userId: hasUser(event) ? event.user.userId : undefined,
      };
      if (isChatEvent(event)) {
        pointsReason = 'chat';
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'chat', baseOpts);
      } else if (isGiftEvent(event)) {
        pointsReason = 'gift';
        // For streakable gifts, only award points on the final message to avoid double counting.
        if (event.streakable && !event.repeatEnd) {
          pointsResult = null;
        } else {
          const diamonds = event.diamondCount || 1;
          const repeat = Math.max(1, event.repeatCount || event.comboCount || 1);
          pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'gift', {
            ...baseOpts,
            diamondCount: diamonds * repeat,
          });
        }
      } else if (isLikeEvent(event)) {
        pointsReason = 'like';
        // event.count is `number` after narrowing
        const count = Math.max(1, event.count || 1);
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'like', {
          ...baseOpts,
          count,
        });
      } else if (isSocialEvent(event)) {
        // event.action is `number` after narrowing
        const isFollow = event.action === SOCIAL_ACTION.follow;
        pointsReason = isFollow ? 'follow' : 'share';
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, isFollow ? 'follow' : 'share', baseOpts);
      } else if (isMemberEvent(event)) {
        pointsReason = 'join';
        pointsResult = this.pointsDb.awardPoints(uiEvent.author, 'join', baseOpts);
      }

      if (pointsResult) {
        uiEvent.points = pointsResult.totalPoints;
        uiEvent.level = pointsResult.level;
        uiEvent.pointsDelta = pointsResult.delta;
      } else {
        const viewer = this.pointsDb.getViewer(uiEvent.author);
        if (viewer) {
          uiEvent.points = viewer.points;
          uiEvent.level = viewer.level;
        }
      }

      if (automationEvent) {
        const enrichedEvent = pointsResult
          ? {
              ...automationEvent,
              points: {
                delta: pointsResult.delta,
                total: pointsResult.totalPoints,
                level: pointsResult.level,
              },
            }
          : automationEvent;
        this.publishAutomationEvent(enrichedEvent);
        if (pointsResult && pointsResult.delta !== 0) {
          this.publishAutomationEvent(createPointsAwardedEvent(
            pointsResult,
            pointsReason ?? event.type,
            automationEvent.id,
            this.#automationContext,
          ), false);
        }
      }

      this.send({ type: 'live-event', event: uiEvent });
    });

    client.on('reconnecting', ({ attempt, delayMs }) => {
      if (generation === this.#generation) this.send({ type: 'reconnecting', attempt, delayMs });
    });

    client.on('disconnected', () => {
      if (generation === this.#generation) {
        this.publishDisconnectedIfActive();
        this.send({ type: 'connection', status: 'disconnected' });
      }
    });

    client.on('error', (error) => {
      if (generation === this.#generation && client.connected) {
        this.send({ type: 'error', phase: 'live', message: error.message });
      }
    });

    try {
      await client.connect();
    } catch (error) {
      if (generation === this.#generation) {
        this.send({ type: 'error', phase: 'connect', message: errorMessage(error) });
      }
      client.disconnect();
      if (this.#live === client) this.#live = null;
    }
  }

  async pickAndConnect(request: Extract<PageMessage, { type: 'pick-live' }>): Promise<void> {
    try {
      const sessionCookie = request.sessionCookie.trim() || (await bootstrapGuestSession()).cookie;
      const rooms = await new Discovery({ cookie: sessionCookie }).liveChannels('live');
      if (rooms.length === 0) throw new Error('No live rooms were returned by TikTok.');

      const room = rooms[Math.floor(Math.random() * rooms.length)];
      if (!room) throw new Error('TikTok returned an invalid live-room result.');

      this.send({
        type: 'connection',
        status: 'connecting',
        uniqueId: room.uniqueId,
        title: room.title || '@' + room.uniqueId,
      });
      await this.connect({
        type: 'connect',
        uniqueId: room.uniqueId,
        roomId: room.roomId,
        sessionCookie,
      });
    } catch (error) {
      this.send({ type: 'error', phase: 'connect', message: errorMessage(error) });
    }
  }

  private publishDisconnectedIfActive(): void {
    const context = this.#automationContext;
    this.#automationContext = undefined;
    if (context) this.publishAutomationEvent(createDisconnectedEvent(context));
  }

  private publishAutomationEvent(event: AutomationEvent, rememberForEditor = true): void {
    if (rememberForEditor) this.rememberAutomationEvent(event);
    this.automationBus.publish(event);
  }

  private rememberAutomationEvent(event: AutomationEvent): void {
    this.#lastAutomationEvent = event;
    this.#lastAutomationEventCapturedAt = Date.now();
    const now = Date.now();
    const elapsed = now - this.#lastAutomationContextSentAt;
    if (elapsed >= 250 || this.#lastAutomationContextSentAt === 0) {
      this.#lastAutomationContextSentAt = now;
      this.send({
        type: 'automation-context',
        event,
        capturedAt: this.#lastAutomationEventCapturedAt,
      });
      return;
    }
    if (this.#automationContextTimer) return;
    this.#automationContextTimer = setTimeout(() => {
      this.#automationContextTimer = undefined;
      this.#lastAutomationContextSentAt = Date.now();
      if (this.#lastAutomationEvent) {
        this.send({
          type: 'automation-context',
          event: this.#lastAutomationEvent,
          capturedAt: this.#lastAutomationEventCapturedAt,
        });
      }
    }, Math.max(1, 250 - elapsed));
  }

  private clearLastAutomationEvent(): void {
    this.#lastAutomationEvent = undefined;
    this.#lastAutomationEventCapturedAt = undefined;
    this.#lastAutomationContextSentAt = Date.now();
    this.clearAutomationContextTimer();
    this.send({ type: 'automation-context', event: null });
  }

  private clearAutomationContextTimer(): void {
    if (!this.#automationContextTimer) return;
    clearTimeout(this.#automationContextTimer);
    this.#automationContextTimer = undefined;
  }

  private reloadAutomationWorkflows(): void {
    this.reloadBehavior();

    for (const workflow of this.automationDb.listWorkflows()) {
      try {
        this.automationRuntime.registerWorkflow(workflow.graph);
      } catch (error) {
        console.warn(`[automation] workflow ${workflow.id} was not loaded:`, error);
      }
    }
  }
}
