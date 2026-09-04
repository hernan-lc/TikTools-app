//! Application event bus independent of the desktop event loop.

use tokio::sync::broadcast;

use crate::ipc::messages::PageMessage;

#[derive(Debug, Clone)]
pub enum AppEvent {
    Ui(PageMessage),
    TikTok(serde_json::Value),
    Plugin(serde_json::Value),
    Shutdown,
}

#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn publish(&self, event: AppEvent) {
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}
