use std::sync::Arc;

use thiserror::Error;

use crate::{
    ipc::messages::{IpcMessageError, PageMessage},
    AppCore,
};

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("could not parse page message: {0}")]
    Message(#[from] IpcMessageError),
}

#[derive(Clone)]
pub struct IpcRouter {
    core: Arc<AppCore>,
}

impl IpcRouter {
    pub fn new(core: Arc<AppCore>) -> Self {
        Self { core }
    }

    pub async fn dispatch(&self, raw: &str) -> Result<(), IpcError> {
        let message = PageMessage::parse(raw)?;
        self.core.handle_page_message(message).await;
        Ok(())
    }
}
