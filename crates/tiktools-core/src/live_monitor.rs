//! Native, cancellable creator monitoring. No UI timers or external server.
use crate::{control::OperationError, AppCore};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::Duration;
#[cfg(any(test, feature = "native-tiktok"))]
use std::time::{SystemTime, UNIX_EPOCH};
use tiktools_plugin_api::sync::{recover_rwlock_read, recover_rwlock_write};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LiveMonitorStatus {
    pub enabled: bool,
    pub unique_id: String,
    pub phase: String,
    pub poll_interval_seconds: u64,
    pub checks: u64,
    pub failures: u32,
    pub last_checked_at: Option<u64>,
    pub next_check_at: Option<u64>,
    pub last_error: Option<String>,
}

pub(crate) struct LiveMonitor {
    status: Arc<RwLock<LiveMonitorStatus>>,
    pub(crate) operation: Mutex<()>,
    task: Mutex<Option<MonitorTask>>,
}
struct MonitorTask {
    stop: CancellationToken,
    join: tokio::task::JoinHandle<()>,
}
impl Default for LiveMonitor {
    fn default() -> Self {
        Self {
            operation: Mutex::new(()),
            status: Arc::new(RwLock::new(LiveMonitorStatus {
                phase: "stopped".into(),
                ..Default::default()
            })),
            task: Mutex::new(None),
        }
    }
}
impl Drop for LiveMonitor {
    fn drop(&mut self) {
        if let Some(task) = self.task.get_mut().as_ref() {
            task.stop.cancel();
        }
    }
}
impl AppCore {
    pub fn live_monitor_status(&self) -> LiveMonitorStatus {
        recover_rwlock_read(&self.live_monitor.status, "LIVE monitor").clone()
    }

    /// Serialize stop/replacement and join the owned supervisor before a new
    /// manual operation can use the native connection owner.
    pub(crate) async fn stop_live_monitor(&self) {
        let mut task = self.live_monitor.task.lock().await;
        if let Some(mut running) = task.take() {
            running.stop.cancel();
            if tokio::time::timeout(Duration::from_secs(3), &mut running.join)
                .await
                .is_err()
            {
                running.join.abort();
                let _ = running.join.await;
            }
        }
        let mut status = self.live_monitor_status();
        status.enabled = false;
        status.phase = "stopped".into();
        status.next_check_at = None;
        *recover_rwlock_write(&self.live_monitor.status, "LIVE monitor") = status.clone();
        self.events
            .publish_domain(crate::events::DomainEvent::LiveMonitorChanged { status });
    }

    pub async fn live_monitor_stop(self: &Arc<Self>) -> LiveMonitorStatus {
        let _operation = self.live_monitor.operation.lock().await;
        self.stop_live_monitor().await;
        self.live.disconnect().await;
        self.live_monitor_status()
    }

    #[cfg(feature = "native-tiktok")]
    pub async fn live_monitor_start(
        self: &Arc<Self>,
        unique_id: String,
        session_cookie: String,
        interval: Option<u64>,
    ) -> Result<LiveMonitorStatus, OperationError> {
        let _operation = self.live_monitor.operation.lock().await;
        let unique_id = crate::helpers::clean_unique_id(&unique_id)
            .ok_or_else(|| OperationError::invalid("uniqueId must not be empty"))?;
        super::control::check_session_cookie_len(&session_cookie)?;
        let interval = interval.unwrap_or(30);
        if !(10..=3600).contains(&interval) {
            return Err(OperationError::invalid(
                "pollIntervalSeconds must be between 10 and 3600",
            ));
        }
        if self
            .shutdown_started
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(OperationError::unavailable("host is shutting down"));
        }
        self.stop_live_monitor().await;
        let mut task = self.live_monitor.task.lock().await;
        self.live.disconnect().await;
        let status = LiveMonitorStatus {
            enabled: true,
            unique_id,
            phase: "waiting".into(),
            poll_interval_seconds: interval,
            ..Default::default()
        };
        *recover_rwlock_write(&self.live_monitor.status, "LIVE monitor") = status.clone();
        self.events
            .publish_domain(crate::events::DomainEvent::LiveMonitorChanged {
                status: status.clone(),
            });
        let backend = Arc::new(CoreBackend {
            core: Arc::downgrade(self),
            session_cookie,
        });
        let state = self.live_monitor.status.clone();
        let stop = CancellationToken::new();
        let token = stop.clone();
        let join = tokio::spawn(async move {
            run_monitor(backend, state, token).await;
        });
        *task = Some(MonitorTask { stop, join });
        Ok(status)
    }

    #[cfg(not(feature = "native-tiktok"))]
    pub async fn live_monitor_start(
        self: &Arc<Self>,
        _: String,
        _: String,
        _: Option<u64>,
    ) -> Result<LiveMonitorStatus, OperationError> {
        Err(OperationError::unavailable(
            "the native TikTok client is disabled in this build",
        ))
    }
}

#[cfg(any(test, feature = "native-tiktok"))]
type MonitorFuture<'a, T> =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>>;
#[cfg(any(test, feature = "native-tiktok"))]
trait MonitorBackend: Send + Sync {
    fn lookup<'a>(&'a self, creator: &'a str) -> MonitorFuture<'a, Option<String>>;
    fn connect<'a>(&'a self, creator: &'a str, room: String) -> MonitorFuture<'a, ()>;
    fn active(&self) -> bool;
    fn changed(&self, status: LiveMonitorStatus);
    fn wait(&self, delay: Duration) -> MonitorFuture<'_, ()> {
        Box::pin(async move {
            tokio::time::sleep(delay).await;
            Ok(())
        })
    }
}
#[cfg(feature = "native-tiktok")]
struct CoreBackend {
    core: std::sync::Weak<AppCore>,
    session_cookie: String,
}
#[cfg(feature = "native-tiktok")]
impl MonitorBackend for CoreBackend {
    fn lookup<'a>(&'a self, creator: &'a str) -> MonitorFuture<'a, Option<String>> {
        Box::pin(async move {
            let core = self.core.upgrade().ok_or("host stopped")?;
            core.live
                .creator_live_room(creator)
                .await
                .map_err(|error| error.to_string())
        })
    }
    fn connect<'a>(&'a self, creator: &'a str, room: String) -> MonitorFuture<'a, ()> {
        Box::pin(async move {
            let core = self.core.upgrade().ok_or("host stopped")?;
            core.live_connect_monitored(creator.into(), self.session_cookie.clone(), Some(room))
                .await
                .map(|_| ())
                .map_err(|error| error.message)
        })
    }
    fn active(&self) -> bool {
        self.core.upgrade().is_some_and(|core| {
            matches!(
                core.live.connection_snapshot().state,
                tiktools_tiktok::ConnectionState::Connected
                    | tiktools_tiktok::ConnectionState::Connecting
                    | tiktools_tiktok::ConnectionState::Reconnecting
            )
        })
    }
    fn changed(&self, status: LiveMonitorStatus) {
        if let Some(core) = self.core.upgrade() {
            core.events
                .publish_domain(crate::events::DomainEvent::LiveMonitorChanged { status });
        }
    }
}
#[cfg(any(test, feature = "native-tiktok"))]
fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[cfg(any(test, feature = "native-tiktok"))]
async fn run_monitor(
    backend: Arc<dyn MonitorBackend>,
    state: Arc<RwLock<LiveMonitorStatus>>,
    stop: CancellationToken,
) {
    let mut status = recover_rwlock_read(&state, "LIVE monitor").clone();
    loop {
        if stop.is_cancelled() {
            return;
        }
        status.next_check_at = None;
        if backend.active() {
            status.phase = "live".into();
        } else {
            status.phase = "checking".into();
            *recover_rwlock_write(&state, "LIVE monitor") = status.clone();
            backend.changed(status.clone());
            status.checks += 1;
            status.last_checked_at = Some(epoch_ms());
            let result = tokio::select! {
                biased;
                _ = stop.cancelled() => return,
                result = tokio::time::timeout(Duration::from_secs(30), backend.lookup(&status.unique_id)) => result.unwrap_or_else(|_| Err("creator lookup timed out".into())),
            };
            let result = match result {
                Ok(Some(room)) => {
                    status.phase = "connecting".into();
                    *recover_rwlock_write(&state, "LIVE monitor") = status.clone();
                    backend.changed(status.clone());
                    tokio::select! {
                        biased;
                        _ = stop.cancelled() => return,
                        result = backend.connect(&status.unique_id, room) => result,
                    }
                }
                Ok(None) => Ok(()),
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => {
                    status.failures = 0;
                    status.last_error = None;
                    status.phase = if backend.active() { "live" } else { "waiting" }.into();
                }
                Err(error) => {
                    status.failures = status.failures.saturating_add(1);
                    status.last_error = Some(error);
                    status.phase = "error".into();
                }
            }
        }
        let delay = monitor_delay(status.poll_interval_seconds, status.failures);
        status.next_check_at = Some(epoch_ms().saturating_add(delay.as_millis() as u64));
        *recover_rwlock_write(&state, "LIVE monitor") = status.clone();
        backend.changed(status.clone());
        tokio::select! { biased; _ = stop.cancelled() => return, _ = backend.wait(delay) => {} }
    }
}
#[cfg(any(test, feature = "native-tiktok"))]
fn monitor_delay(interval: u64, failures: u32) -> Duration {
    Duration::from_secs(
        interval
            .saturating_mul(1u64 << failures.min(4))
            .min(interval.max(300)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    struct Backend {
        responses: std::sync::Mutex<VecDeque<Result<Option<String>, String>>>,
        active: AtomicBool,
        connects: AtomicUsize,
        tick: tokio::sync::Semaphore,
        changes: tokio::sync::mpsc::UnboundedSender<LiveMonitorStatus>,
    }
    impl MonitorBackend for Backend {
        fn lookup<'a>(&'a self, _: &'a str) -> MonitorFuture<'a, Option<String>> {
            let result = self.responses.lock().unwrap().pop_front();
            Box::pin(async move {
                match result {
                    Some(result) => result,
                    None => std::future::pending().await,
                }
            })
        }
        fn connect<'a>(&'a self, _: &'a str, room: String) -> MonitorFuture<'a, ()> {
            self.connects.fetch_add(1, Ordering::Relaxed);
            if room == "pending" {
                return Box::pin(std::future::pending());
            }
            self.active.store(true, Ordering::Relaxed);
            Box::pin(async { Ok(()) })
        }
        fn active(&self) -> bool {
            self.active.load(Ordering::Relaxed)
        }
        fn changed(&self, status: LiveMonitorStatus) {
            let _ = self.changes.send(status);
        }
        fn wait(&self, _: Duration) -> MonitorFuture<'_, ()> {
            Box::pin(async {
                self.tick.acquire().await.unwrap().forget();
                Ok(())
            })
        }
    }
    async fn phase(
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<LiveMonitorStatus>,
        expected: &str,
    ) -> LiveMonitorStatus {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let status = rx.recv().await.unwrap();
                if status.phase == expected {
                    return status;
                }
            }
        })
        .await
        .expect("monitor phase deadline")
    }
    #[tokio::test]
    async fn offline_online_end_and_restart_reuse_one_monitor() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let backend = Arc::new(Backend {
            responses: std::sync::Mutex::new(VecDeque::from([
                Ok(None),
                Ok(Some("room1".into())),
                Ok(None),
                Ok(Some("room2".into())),
            ])),
            active: AtomicBool::new(false),
            connects: AtomicUsize::new(0),
            tick: tokio::sync::Semaphore::new(0),
            changes: tx,
        });
        let state = Arc::new(RwLock::new(LiveMonitorStatus {
            enabled: true,
            unique_id: "alice".into(),
            poll_interval_seconds: 30,
            ..Default::default()
        }));
        let stop = CancellationToken::new();
        let task = tokio::spawn(run_monitor(backend.clone(), state, stop.clone()));
        assert_eq!(phase(&mut rx, "waiting").await.checks, 1);
        backend.tick.add_permits(1);
        phase(&mut rx, "live").await;
        assert_eq!(backend.connects.load(Ordering::Relaxed), 1);
        backend.active.store(false, Ordering::Relaxed); // broadcast ended
        backend.tick.add_permits(1);
        phase(&mut rx, "waiting").await;
        backend.tick.add_permits(1);
        phase(&mut rx, "live").await;
        assert_eq!(backend.connects.load(Ordering::Relaxed), 2);
        stop.cancel();
        task.await.unwrap();
    }
    #[tokio::test]
    async fn transport_errors_are_not_offline_and_pending_lookup_is_cancellable() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let backend = Arc::new(Backend {
            responses: std::sync::Mutex::new(VecDeque::from([Err("rate limited".into())])),
            active: AtomicBool::new(false),
            connects: AtomicUsize::new(0),
            tick: tokio::sync::Semaphore::new(0),
            changes: tx,
        });
        let state = Arc::new(RwLock::new(LiveMonitorStatus {
            enabled: true,
            unique_id: "alice".into(),
            poll_interval_seconds: 30,
            ..Default::default()
        }));
        let stop = CancellationToken::new();
        let task = tokio::spawn(run_monitor(backend.clone(), state, stop.clone()));
        let error = phase(&mut rx, "error").await;
        assert_eq!(error.failures, 1);
        assert_eq!(error.last_error.as_deref(), Some("rate limited"));
        backend.tick.add_permits(1);
        phase(&mut rx, "checking").await;
        stop.cancel();
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(backend.connects.load(Ordering::Relaxed), 0);
    }
    #[tokio::test]
    async fn connecting_monitor_is_cancellable() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let backend = Arc::new(Backend {
            responses: std::sync::Mutex::new(VecDeque::from([Ok(Some("pending".into()))])),
            active: AtomicBool::new(false),
            connects: AtomicUsize::new(0),
            tick: tokio::sync::Semaphore::new(0),
            changes: tx,
        });
        let state = Arc::new(RwLock::new(LiveMonitorStatus {
            enabled: true,
            unique_id: "alice".into(),
            poll_interval_seconds: 30,
            ..Default::default()
        }));
        let stop = CancellationToken::new();
        let task = tokio::spawn(run_monitor(backend, state, stop.clone()));
        phase(&mut rx, "connecting").await;
        stop.cancel();
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
    }

    struct Emitter;
    impl crate::HostEmitter for Emitter {
        fn emit(&self, _: crate::HostMessage) {}
    }
    #[tokio::test]
    async fn explicit_disconnect_joins_the_supervisor_and_disables_monitoring() {
        let core = Arc::new(AppCore::new(Arc::new(Emitter)));
        let stop = CancellationToken::new();
        let token = stop.clone();
        let join = tokio::spawn(async move {
            token.cancelled().await;
        });
        *core.live_monitor.task.lock().await = Some(MonitorTask {
            stop: stop.clone(),
            join,
        });
        recover_rwlock_write(&core.live_monitor.status, "test monitor").enabled = true;
        core.live_disconnect().await;
        assert!(stop.is_cancelled());
        assert!(core.live_monitor.task.lock().await.is_none());
        assert!(!core.live_monitor_status().enabled);
        assert_eq!(core.live_monitor_status().phase, "stopped");
        core.points.shutdown();
    }

    #[test]
    fn retry_backoff_is_bounded() {
        assert_eq!(monitor_delay(30, 0), Duration::from_secs(30));
        assert_eq!(monitor_delay(30, 1), Duration::from_secs(60));
        assert_eq!(monitor_delay(30, 100), Duration::from_secs(300));
        assert_eq!(monitor_delay(3600, 100), Duration::from_secs(3600));
    }
}
