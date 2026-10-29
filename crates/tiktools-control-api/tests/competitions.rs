#![cfg(feature = "persistence")]
use serde_json::{json, Value};
use std::sync::Arc;
use tiktools_control_api::{ControlApi, RpcId, RpcRequest};
use tiktools_core::{ipc::messages::HostMessage, AppCore, HostEmitter};
struct NullEmitter;
impl HostEmitter for NullEmitter {
    fn emit(&self, _: HostMessage) {}
}
async fn call(api: &ControlApi, method: &str, params: Value) -> Value {
    let response = api
        .execute(RpcRequest::new(RpcId::Number(1), method, params))
        .await;
    assert!(response.is_ok(), "{method}: {response:?}");
    response.result.unwrap()
}
#[tokio::test]
async fn competition_definitions_survive_restart_and_protect_ranking() {
    let root =
        std::env::temp_dir().join(format!("tiktools-competition-test-{}", std::process::id()));
    std::env::set_var("TIKTOOLS_HOME", &root);
    std::env::set_var("TIKTOOLS_BUILTIN_PLUGINS_DIR", root.join("builtin"));
    let core = Arc::new(AppCore::new(Arc::new(NullEmitter)));
    let api = ControlApi::new(core.clone());
    let metrics = call(&api, "rankings.metrics", json!({})).await;
    assert!(metrics["metrics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|metric| metric["source"] == "tiktok.gift" && metric["metric"] == "gift.diamonds"));
    let invalid = api.execute(RpcRequest::new(RpcId::Number(5), "rankings.create", json!({"schemaVersion":1,"id":"invalid","creatorId":"creator","roomId":"room","sources":[{"source":"tiktok.like","metric":"like.count","weight":-1,"enabled":true}],"limit":10,"capacity":10}))).await;
    assert!(!invalid.is_ok());
    call(&api, "rankings.create", json!({"schemaVersion":1,"id":"rank","creatorId":"creator","roomId":"room","groupBy":"option","sources":[{"source":"tiktok.chat","metric":"event.count","weight":1,"enabled":true}],"limit":10,"capacity":100})).await;
    let definition = json!({"schemaVersion":1,"id":"poll","name":"Poll","kind":"poll","rankingId":"rank","options":[{"id":"a","label":"A","commands":["!a"],"giftIds":[],"imageUrl":null,"onWin":null}],"selectionMode":"highest_score","tiePolicy":"stable","durationMs":60000,"voteLimit":1,"allowSwitch":false,"minimumParticipants":1});
    call(&api, "competitions.create", definition.clone()).await;
    assert_eq!(
        call(
            &api,
            "competitions.action",
            json!({"id":"poll", "generation":1})
        )
        .await,
        json!({"action":null})
    );
    let denied = api
        .execute(RpcRequest::new(
            RpcId::Number(7),
            "competitions.resolveAction",
            json!({"id":"poll","generation":1,"resolution":"completed"}),
        ))
        .await;
    assert!(!denied.is_ok());
    assert_eq!(
        call(&api, "competitions.results", json!({"id":"poll"})).await,
        json!({"results":[],"nextBeforeGeneration":null})
    );
    let invalid_page = api
        .execute(RpcRequest::new(
            RpcId::Number(6),
            "competitions.results",
            json!({"id":"poll","limit":21}),
        ))
        .await;
    assert!(!invalid_page.is_ok());
    call(&api, "rankings.pause", json!({"id":"rank"})).await;
    let refused_start = api
        .execute(RpcRequest::new(
            RpcId::Number(3),
            "competitions.start",
            json!({"id":"poll"}),
        ))
        .await;
    assert!(!refused_start.is_ok());
    call(&api, "rankings.resume", json!({"id":"rank"})).await;
    let started = call(&api, "competitions.start", json!({"id":"poll"})).await;
    assert_eq!(started["lifecycle"], "active");
    for method in ["rankings.reset", "rankings.pause"] {
        let denied = api
            .execute(RpcRequest::new(
                RpcId::Number(4),
                method,
                json!({"id":"rank"}),
            ))
            .await;
        assert!(
            !denied.is_ok(),
            "{method} must not disrupt an active competition"
        );
    }
    let paused = call(&api, "competitions.pause", json!({"id":"poll"})).await;
    assert_eq!(paused["lifecycle"], "paused");
    let denied = api
        .execute(RpcRequest::new(
            RpcId::Number(2),
            "rankings.delete",
            json!({"id":"rank"}),
        ))
        .await;
    assert!(!denied.is_ok());
    core.shutdown().await;
    drop(api);
    drop(core);
    let restarted = Arc::new(AppCore::new(Arc::new(NullEmitter)));
    let api = ControlApi::new(restarted.clone());
    assert_eq!(
        call(&api, "competitions.get", json!({"id":"poll"})).await,
        definition
    );
    let state = call(&api, "competitions.state", json!({"id":"poll"})).await;
    assert_eq!(state["lifecycle"], "paused");
    call(&api, "competitions.resume", json!({"id":"poll"})).await;
    call(&api, "competitions.cancel", json!({"id":"poll"})).await;
    call(&api, "competitions.delete", json!({"id":"poll"})).await;
    let mut timed = definition.clone();
    timed["id"] = json!("timed");
    timed["durationMs"] = json!(10);
    call(&api, "competitions.create", timed).await;
    call(&api, "competitions.start", json!({"id":"timed"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let state = call(&api, "competitions.state", json!({"id":"timed"})).await;
    assert_eq!(state["lifecycle"], "finalizing");
    restarted.shutdown().await;
    drop(api);
    drop(restarted);
    let _ = std::fs::remove_dir_all(root);
}
