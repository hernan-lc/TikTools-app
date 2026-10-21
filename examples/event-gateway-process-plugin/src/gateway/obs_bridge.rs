//! Optional outbound adapter on the existing gateway event fanout. No listener.
//! Pairing credentials are read from a named process environment variable;
//! never persisted to plugin settings, URLs, browser state or logs.
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;
use tiktools_plugin_sdk::DomainEventEnvelope;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
#[path = "../../../../src/universal/native.rs"]
mod contracts;

#[derive(Clone, Debug)]
pub(crate) struct BridgeConfig {
    pub address: SocketAddr,
    pub token_env: String,
    pub instance: String,
}
impl BridgeConfig {
    pub fn parse(settings: &Value) -> Result<Option<Self>, String> {
        let Some(value) = settings.get("obsBridge") else {
            return Ok(None);
        };
        if !value
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(None);
        }
        let address = value
            .get("address")
            .and_then(Value::as_str)
            .unwrap_or("127.0.0.1:17453")
            .parse::<SocketAddr>()
            .map_err(|_| "OBS bridge requires a numeric loopback address:port")?;
        if !address.ip().is_loopback() || address.port() == 0 {
            return Err("OBS bridge requires loopback".into());
        }
        let token_env = value
            .get("tokenEnv")
            .and_then(Value::as_str)
            .unwrap_or("OBS_EVENT_TOKEN")
            .to_owned();
        if token_env.is_empty()
            || token_env.len() > 128
            || !token_env
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_')
        {
            return Err("Invalid bridge credential environment name".into());
        }
        let instance = value
            .get("instance")
            .and_then(Value::as_str)
            .unwrap_or("tiktools.local")
            .to_owned();
        if instance.is_empty() || instance.len() > 128 || instance.starts_with("obs.") {
            return Err("Invalid bridge instance".into());
        }
        Ok(Some(Self {
            address,
            token_env,
            instance,
        }))
    }
}
#[derive(Default)]
pub(crate) struct BridgeMetrics {
    pub delivered: AtomicU64,
    pub rejected: AtomicU64,
    pub dropped: AtomicU64,
    pub duplicates: AtomicU64,
    pub reconnects: AtomicU64,
    pub queued: AtomicU64,
}
impl BridgeMetrics {
    pub fn snapshot(&self) -> Value {
        json!({"delivered":self.delivered.load(Ordering::Relaxed),"rejected":self.rejected.load(Ordering::Relaxed),
            "dropped":self.dropped.load(Ordering::Relaxed),"duplicates":self.duplicates.load(Ordering::Relaxed),
            "reconnects":self.reconnects.load(Ordering::Relaxed),"queueDepth":self.queued.load(Ordering::Relaxed)})
    }
}
pub(crate) struct Bridge {
    config: BridgeConfig,
    sender: mpsc::Sender<Value>,
    pub metrics: Arc<BridgeMetrics>,
}
impl Bridge {
    pub fn new(config: BridgeConfig) -> (Self, mpsc::Receiver<Value>) {
        let (sender, receiver) = mpsc::channel(256);
        (
            Self {
                config,
                sender,
                metrics: Arc::new(BridgeMetrics::default()),
            },
            receiver,
        )
    }
    pub fn publish(&self, event: &DomainEventEnvelope) {
        let Ok(value) = serde_json::to_value(event) else {
            return;
        };
        let Some(envelope) = normalize(&value, &self.config.instance) else {
            return;
        };
        if envelope.to_string().len() > 65536 {
            self.metrics.rejected.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if self.sender.try_send(envelope).is_err() {
            self.metrics.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
    pub fn snapshot(&self) -> Value {
        let mut value = self.metrics.snapshot();
        value["queueDepth"] = json!(
            256 - self.sender.capacity() + self.metrics.queued.load(Ordering::Relaxed) as usize
        );
        value
    }
    pub async fn run(&self, mut receiver: mpsc::Receiver<Value>) {
        self.run_inner(&mut receiver).await;
        receiver.close();
        self.metrics
            .dropped
            .fetch_add(receiver.len() as u64, Ordering::Relaxed);
    }
    async fn run_inner(&self, receiver: &mut mpsc::Receiver<Value>) {
        let Ok(token) = std::env::var(&self.config.token_env) else {
            eprintln!("obs-bridge: pairing credential unavailable");
            return;
        };
        if token.len() < 32 || token.contains(['\r', '\n']) {
            eprintln!("obs-bridge: invalid pairing credential");
            return;
        }
        // Negotiate with bounded retry while retaining the bounded input queue.
        let mut retry = 0u32;
        let types = loop {
            match request(&self.config, &token, "GET", "/v1/events/types", None).await {
                Ok((200, body))
                    if body.get("version") == Some(&json!(1))
                        && body.get("types").is_some_and(Value::is_array) =>
                {
                    break body["types"].as_array().unwrap().clone()
                }
                Ok((200, _)) => {
                    self.metrics.rejected.fetch_add(1, Ordering::Relaxed);
                    eprintln!("obs-bridge: incompatible protocol");
                    return;
                }
                Ok((401 | 403, _)) => {
                    eprintln!("obs-bridge: pairing rejected");
                    return;
                }
                _ => {
                    self.metrics.reconnects.fetch_add(1, Ordering::Relaxed);
                    tokio::time::sleep(backoff(retry)).await;
                    retry = retry.saturating_add(1);
                }
            }
        };
        while let Some(event) = receiver.recv().await {
            if !types.contains(&event["type"]) {
                self.metrics.rejected.fetch_add(1, Ordering::Relaxed);
                continue;
            }
            struct Inflight<'a>(&'a AtomicU64);
            impl Drop for Inflight<'_> {
                fn drop(&mut self) {
                    self.0.store(0, Ordering::Relaxed);
                }
            }
            self.metrics.queued.store(1, Ordering::Relaxed);
            let _inflight = Inflight(&self.metrics.queued);
            retry = 0;
            loop {
                match request(&self.config, &token, "POST", "/v1/events", Some(&event)).await {
                    Ok((200..=299, body)) => {
                        if body.get("result").and_then(Value::as_str) == Some("duplicate") {
                            self.metrics.duplicates.fetch_add(1, Ordering::Relaxed);
                        } else {
                            self.metrics.delivered.fetch_add(1, Ordering::Relaxed);
                        }
                        break;
                    }
                    Ok((401 | 403, _)) => {
                        self.metrics.rejected.fetch_add(1, Ordering::Relaxed);
                        eprintln!(
                            "obs-bridge: credential or namespace rejected; restart after pairing"
                        );
                        return;
                    }
                    Ok((status, _)) if status != 429 && status < 500 => {
                        self.metrics.rejected.fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                    _ => {
                        self.metrics.reconnects.fetch_add(1, Ordering::Relaxed);
                        tokio::time::sleep(backoff(retry)).await;
                        retry = retry.saturating_add(1);
                    }
                }
            }
        }
    }
}
fn backoff(attempt: u32) -> Duration {
    Duration::from_millis((250u64 << attempt.min(7)).min(30_000))
}
pub(crate) fn normalize(envelope: &Value, instance: &str) -> Option<Value> {
    if envelope.get("topic")?.as_str()? != "live.event" {
        return None;
    }
    let event = envelope.get("data")?.get("event")?;
    if event
        .get("source")
        .and_then(Value::as_str)
        .is_some_and(|source| source.starts_with("obs."))
    {
        return None;
    }
    let hops = event
        .pointer("/metadata/hopCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if hops >= 3 {
        return None;
    }
    let origin = event
        .pointer("/metadata/originInstance")
        .and_then(Value::as_str)
        .unwrap_or(instance);
    let kind = event.get("type")?.as_str()?;
    if !kind.starts_with("tiktok.") && !kind.starts_with("custom.") {
        return None;
    }
    if event
        .pointer("/metadata/originInstance")
        .and_then(Value::as_str)
        .is_some_and(|v| v.starts_with("obs."))
    {
        return None;
    }
    let data = event.get("data")?.as_object()?;
    let message = data
        .get("msgId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && *s != "0");
    let room = event
        .pointer("/creator/roomId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let id = message
        .map(|msg| format!("{room}:{msg}"))
        .or_else(|| event.get("id")?.as_str().map(str::to_owned))?;
    // Millisecond UTC conversion without platform clock or floating point IDs.
    let ms = event.get("timestamp")?.as_i64()?;
    let timestamp = utc_timestamp(ms)?;
    let result = json!({"version":1,"id":id,"source":"tiktools.bridge","type":kind,"timestamp":timestamp,"data":contracts::normalize_data(kind,&Value::Object(data.clone()),&event["user"],1),
        "metadata":{"originInstance":origin,"hopCount":hops+1,"room":room,"legacy":event}});
    contracts::valid_event(&result).then_some(result)
}
fn utc_timestamp(ms: i64) -> Option<String> {
    if ms < 0 {
        return None;
    }
    let days = ms / 86_400_000;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    if year > 9999 {
        return None;
    }
    let seconds = ms / 1000;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60,
        ms % 1000
    ))
}
async fn request(
    config: &BridgeConfig,
    token: &str,
    method: &str,
    route: &str,
    event: Option<&Value>,
) -> Result<(u16, Value), ()> {
    tokio::time::timeout(Duration::from_secs(3),async {
        let mut stream=TcpStream::connect(config.address).await.map_err(|_|())?;
        let body=event.map(Value::to_string).unwrap_or_default();
        if body.len()>65536 {return Err(())}
        let host=match config.address.ip(){IpAddr::V6(ip)=>format!("[{ip}]:{}",config.address.port()),ip=>format!("{ip}:{}",config.address.port())};
        let headers=format!("{method} {route} HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        stream.write_all(headers.as_bytes()).await.map_err(|_|())?;
        let mut response=Vec::new();stream.take(65537).read_to_end(&mut response).await.map_err(|_|())?;
        if response.len()>65536 {return Err(())}
        let response=std::str::from_utf8(&response).map_err(|_|())?;
        let status=response.split_whitespace().nth(1).ok_or(())?.parse().map_err(|_|())?;
        let body=response.split_once("\r\n\r\n").ok_or(())?.1;
        Ok((status,serde_json::from_str(body).map_err(|_|())?))
    }).await.map_err(|_|())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_remote() {
        assert!(BridgeConfig::parse(
            &json!({"obsBridge":{"enabled":true,"address":"0.0.0.0:17453"}})
        )
        .is_err());
    }
    #[test]
    fn opt_in() {
        assert!(BridgeConfig::parse(&json!({})).unwrap().is_none());
    }
    #[test]
    fn timestamp() {
        assert_eq!(
            utc_timestamp(1_792_505_820_000).unwrap(),
            "2026-10-20T14:17:00.000Z"
        );
    }
    #[test]
    fn original_id() {
        let e = json!({"topic":"live.event","data":{"event":{"id":"new-id","type":"tiktok.gift","timestamp":0,"creator":{"roomId":"42"},"data":{"msgId":"9007199254740993"}}}});
        assert_eq!(
            normalize(&e, "tiktools.local").unwrap()["id"],
            "42:9007199254740993"
        );
    }
}
