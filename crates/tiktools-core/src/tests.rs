use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;
use tiktools_plugin_api::{
    AudioPlayOptions, AudioPlaybackResult, MediaFileRef, MediaPickerOptions,
};

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

#[derive(Default)]
struct RecordingMediaHost {
    selected: Mutex<Option<PathBuf>>,
    played: Mutex<Vec<MediaFileRef>>,
}

impl MediaHost for RecordingMediaHost {
    fn open_picker(&self, _options: MediaPickerOptions) -> MediaHostFuture<Option<PathBuf>> {
        let selected = self
            .selected
            .lock()
            .expect("media selection lock poisoned")
            .clone();
        Box::pin(async move { Ok(selected) })
    }

    fn play_audio(
        &self,
        file: MediaFileRef,
        _options: AudioPlayOptions,
    ) -> MediaHostFuture<AudioPlaybackResult> {
        self.played
            .lock()
            .expect("media playback lock poisoned")
            .push(file);
        Box::pin(async {
            Ok(AudioPlaybackResult {
                played: true,
                reason: None,
                active_players: 1,
            })
        })
    }
}

fn media_fixture() -> (PathBuf, PathBuf) {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("tiktools-core-media-{suffix}"));
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("alert.wav");
    std::fs::write(&file, b"fixture").unwrap();
    (root, file)
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

#[tokio::test]
async fn public_media_api_returns_a_reference_and_revalidates_playback() {
    let (root, file) = media_fixture();
    let emitter = Arc::new(RecordingEmitter::default());
    let media = Arc::new(RecordingMediaHost::default());
    *media
        .selected
        .lock()
        .expect("media selection lock poisoned") = Some(file.clone());
    let core = Arc::new(AppCore::with_media_host(emitter, media.clone()));

    let selection = core
        .open_media_picker(MediaPickerOptions::default())
        .await
        .unwrap()
        .expect("fixture should be selected");
    let file_ref = match selection {
        tiktools_plugin_api::MediaSelection::File { file } => file,
        tiktools_plugin_api::MediaSelection::Directory { .. } => {
            panic!("expected a file selection")
        }
    };
    assert_eq!(
        file_ref.path,
        std::fs::canonicalize(&file).unwrap().to_string_lossy()
    );
    assert_eq!(file_ref.size_bytes, 7);

    core.play_audio(
        MediaFileRef::from_path(file.to_string_lossy()),
        AudioPlayOptions::default(),
    )
    .await
    .unwrap();
    let played = media.played.lock().expect("media playback lock poisoned");
    assert_eq!(played.len(), 1);
    assert_eq!(played[0].path, file_ref.path);
    drop(played);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn napi_vm_audio_intent_uses_the_same_validated_media_api() {
    let (root, file) = media_fixture();
    let emitter = Arc::new(RecordingEmitter::default());
    let media = Arc::new(RecordingMediaHost::default());
    let core = Arc::new(AppCore::with_media_host(emitter, media.clone()));

    let run = core
        .test_action(
            &json!({
                "id": "vm-audio",
                "name": "VM audio",
                "typeId": "core.code",
                "config": {
                    "source": format!(
                        "return {{ playAudio: {{ fileRef: {{ path: {:?} }}, volume: 0.5 }} }};",
                        file.to_string_lossy()
                    )
                }
            }),
            None,
        )
        .await;

    assert_eq!(run["status"], "ok");
    let played = media.played.lock().expect("media playback lock poisoned");
    assert_eq!(played.len(), 1);
    assert_eq!(
        played[0].path,
        std::fs::canonicalize(&file).unwrap().to_string_lossy()
    );
    drop(played);
    let _ = std::fs::remove_dir_all(root);
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
