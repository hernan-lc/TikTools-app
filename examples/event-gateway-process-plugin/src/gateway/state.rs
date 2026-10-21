//! Shared server state and event broadcast.

use super::config::GatewayConfig;
use std::sync::Arc;
use tiktools_plugin_sdk::DomainEventEnvelope;
use tokio::sync::{broadcast, Notify, Semaphore};

const EVENT_CHANNEL_CAPACITY: usize = 256;

/// Upper bound on concurrent client connections. Accepted sockets beyond
/// this limit are dropped instead of spawning unbounded tasks.
const MAX_CONCURRENT_CONNECTIONS: usize = 64;

#[derive(Clone)]
pub(crate) struct GatewayState {
    pub(crate) config: Arc<GatewayConfig>,
    pub(crate) events: broadcast::Sender<DomainEventEnvelope>,
    pub(crate) server_shutdown: Arc<Notify>,
    pub(crate) clients_shutdown: Arc<Notify>,
    pub(crate) connection_permits: Arc<Semaphore>,
    pub(crate) obs_bridge: Option<Arc<super::obs_bridge::Bridge>>,
    pub(crate) bridge_receiver:
        Arc<std::sync::Mutex<Option<tokio::sync::mpsc::Receiver<serde_json::Value>>>>,
}

impl GatewayState {
    pub(crate) fn new(config: GatewayConfig) -> Arc<Self> {
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let (obs_bridge, bridge_receiver) = match config.obs_bridge.clone() {
            Some(config) => {
                let (bridge, receiver) = super::obs_bridge::Bridge::new(config);
                (Some(Arc::new(bridge)), Some(receiver))
            }
            None => (None, None),
        };
        Arc::new(Self {
            obs_bridge,
            bridge_receiver: Arc::new(std::sync::Mutex::new(bridge_receiver)),
            config: Arc::new(config),
            events,
            server_shutdown: Arc::new(Notify::new()),
            clients_shutdown: Arc::new(Notify::new()),
            connection_permits: Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS)),
        })
    }

    pub(crate) fn publish(&self, event: DomainEventEnvelope) {
        if let Some(bridge) = &self.obs_bridge {
            bridge.publish(&event);
        }
        let _ = self.events.send(event);
    }
}
