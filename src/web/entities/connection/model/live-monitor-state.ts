import { ref } from 'vue';
import type { ControlClient } from '@/shared/api/control-client.ts';
import { errorMessage } from '@/shared/api/control-client.ts';

export interface LiveMonitorStatus {
  enabled: boolean;
  uniqueId: string;
  phase: string;
  pollIntervalSeconds: number;
  checks: number;
  failures: number;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  lastError: string | null;
}
export function createLiveMonitorState(control: ControlClient) {
  const monitorStatus = ref<LiveMonitorStatus | null>(null);
  const monitorBusy = ref(false);
  const monitorError = ref('');
  let revision = 0;
  let disposed = false;
  const apply = (status: LiveMonitorStatus): void => {
    if (!disposed && typeof status?.enabled === 'boolean') monitorStatus.value = status;
  };
  const off = control.onTopic<{ status: LiveMonitorStatus }>('live.monitor', ({ status }) => {
    revision += 1;
    apply(status);
  });
  const refreshMonitor = async (): Promise<void> => {
    const started = revision;
    try {
      const status = await control.call<LiveMonitorStatus>('live.monitor.status', {});
      if (started === revision) apply(status);
    } catch { /* Older hosts can operate normally without monitoring. */ }
  };
  const update = async (method: string, params: Record<string, string | number>): Promise<void> => {
    if (monitorBusy.value || disposed) return;
    monitorBusy.value = true;
    monitorError.value = '';
    const started = ++revision;
    try {
      const status = await control.call<LiveMonitorStatus>(method, params);
      if (started === revision) apply(status);
    } catch (failure) {
      if (!disposed && started === revision) monitorError.value = errorMessage(failure);
    } finally { monitorBusy.value = false; }
  };
  return {
    monitorStatus, monitorBusy, monitorError, refreshMonitor,
    startMonitor: (uniqueId: string, sessionCookie: string, pollIntervalSeconds = 30) => update('live.monitor.start', { uniqueId, sessionCookie, pollIntervalSeconds }),
    stopMonitor: () => update('live.monitor.stop', {}),
    disposeMonitor: () => { disposed = true; revision += 1; off(); },
  };
}
