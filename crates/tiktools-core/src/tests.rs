use std::sync::Mutex;

use super::*;

#[derive(Default)]
struct RecordingEmitter {
    messages: Mutex<Vec<HostMessage>>,
}

impl HostEmitter for RecordingEmitter {
    fn emit(&self, message: HostMessage) {
        self.messages
            .lock()
            .expect("test emitter poisoned")
            .push(message);
    }
}

#[tokio::test]
async fn native_event_runner_executes_saved_behavior() {
    let emitter = Arc::new(RecordingEmitter::default());
    let core = Arc::new(AppCore::new(emitter.clone()));
    core.automation.replace_snapshot(&json!({
        "actions": [{
            "id": "say-hello",
            "name": "Say hello",
            "typeId": "core.log",
            "enabled": true,
            "config": {"message": "hello {{ event.user.uniqueId }}"}
        }],
        "events": [{
            "id": "chat-event",
            "name": "Chat event",
            "enabled": true,
            "trigger": "tiktok.chat",
            "filters": [],
            "cooldownMs": 0,
            "cooldownScope": "user",
            "actionIds": ["say-hello"],
            "runMode": "all"
        }]
    }));

    core.publish_automation_event(json!({
        "id": "chat-1",
        "type": "tiktok.chat",
        "timestamp": 1,
        "user": {"uniqueId": "alice"},
        "data": {"comment": "hello"}
    }))
    .await;

    let runs = core.automation.recent_runs();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["status"], "ok");
    assert_eq!(runs[0]["eventId"], "chat-event");
    assert_eq!(runs[0]["summary"], "hello alice");
    assert!(emitter
        .messages
        .lock()
        .expect("test emitter poisoned")
        .iter()
        .any(|message| matches!(message, HostMessage::BehaviorRuns { .. })));
}

#[cfg(feature = "native-tiktok")]
#[tokio::test]
async fn native_live_event_reaches_the_host_message_boundary() {
    let emitter = Arc::new(RecordingEmitter::default());
    let core = Arc::new(AppCore::new(emitter.clone()));
    core.handle_native_event(ClientEvent::Event(NativeLiveEvent::Chat {
        user: tiktools_tiktok::events::EventUser {
            user_id: Some("42".to_owned()),
            unique_id: "alice".to_owned(),
            nickname: "Alice".to_owned(),
            sec_uid: String::new(),
        },
        comment: "hello".to_owned(),
        method: "WebcastChatMessage".to_owned(),
        msg_id: 1,
        is_history: false,
    }))
    .await;

    let messages = emitter.messages.lock().expect("test emitter poisoned");
    assert!(messages.iter().any(|message| {
        matches!(
            message,
            HostMessage::LiveEvent { event }
                if event.get("kind").and_then(Value::as_str) == Some("chat")
        )
    }));
    assert!(messages
        .iter()
        .any(|message| matches!(message, HostMessage::Leaderboard { .. })));
}
