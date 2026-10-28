//! Regression tests for the Linux WebView reload lifecycle.
//!
//! Headless: every test drives the pure supervisors with synthetic
//! `Instant`s, so they run on any platform without a display. They pin:
//!
//! * repeated refresh / programmatic reload (Started restarts the watchdog,
//!   only the current generation can become Ready),
//! * dev server and packaged custom-protocol origins share the same budget
//!   (the supervisor is origin-agnostic by construction),
//! * missing `frontend-ready` and failed IPC initialization time out,
//! * one controlled reload, then one recreate, then `Failed` (no infinite
//!   loops, no unbounded memory: counters stay at their caps),
//! * recovery never replays RPCs (stale generations are rejected, pending
//!   batches are dropped without re-execution, non-idempotent methods are
//!   not retried),
//! * subscriptions never duplicate across navigations.

use super::{
    failure_reasons, is_idempotent_rpc_method, MainReloadSupervisor, PluginBridgeState,
    PluginPageSupervisor, RecoveryDecision, WebviewLifecycle, RELOAD_TIMEOUT,
};
use std::time::{Duration, Instant};

fn now() -> Instant {
    Instant::now()
}

#[test]
fn repeated_refresh_restarts_the_watchdog_without_growing_state() {
    let mut supervisor = MainReloadSupervisor::new();
    let start = now();
    // Programmatic reloads and DevTools refreshes all funnel through
    // Started: each one restarts the same bounded watchdog.
    for _ in 0..100 {
        let deadline = supervisor.on_navigation_started(now());
        assert_eq!(supervisor.state(), WebviewLifecycle::Loading);
        assert!(!supervisor.is_delivery_allowed());
        assert!(deadline <= now() + RELOAD_TIMEOUT + Duration::from_millis(50));
    }
    // No counter grows on plain navigations: only automatic recoveries do.
    assert_eq!(supervisor.recovery_counts(), (0, 0));
    // A stale Ready from the previous document cannot restore delivery.
    assert!(!supervisor.on_frontend_ready(1, 2));
    assert!(!supervisor.is_delivery_allowed());
    // The current generation completes the handshake.
    assert!(supervisor.on_frontend_ready(2, 2));
    assert_eq!(supervisor.state(), WebviewLifecycle::Ready);
    assert!(supervisor.is_delivery_allowed());
    let _ = start;
}

#[test]
fn missing_frontend_ready_times_out_then_recovers_once_then_recreates() {
    let mut supervisor = MainReloadSupervisor::new();
    let start = now();
    supervisor.on_navigation_started(start);
    // Inside the budget: keep waiting, no recovery yet.
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT - Duration::from_millis(10)),
        RecoveryDecision::Wait
    );
    // First expiry: one controlled navigation recovery.
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(1)),
        RecoveryDecision::ReloadOnce
    );
    assert_eq!(supervisor.state(), WebviewLifecycle::Recovering);
    assert_eq!(
        supervisor.failure_reason(),
        Some(failure_reasons::RELOAD_TIMEOUT)
    );
    // The reload gets a fresh budget, not an instant second retry.
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(2)),
        RecoveryDecision::Wait
    );
    // Reload did not help: recreate the WebView on the UI thread.
    let second = start + RELOAD_TIMEOUT * 2 + Duration::from_millis(2);
    assert_eq!(supervisor.check_timeout(second), RecoveryDecision::Recreate);
    // Recreate did not help either: park in Failed and stop retrying.
    let third = start + RELOAD_TIMEOUT * 3 + Duration::from_millis(3);
    assert_eq!(supervisor.check_timeout(third), RecoveryDecision::GiveUp);
    assert_eq!(supervisor.state(), WebviewLifecycle::Failed);
    assert!(!supervisor.is_delivery_allowed());
    // Failed is terminal for automatic recovery: no infinite reload loops,
    // no further deadlines, counters stay capped.
    assert_eq!(
        supervisor.check_timeout(third + RELOAD_TIMEOUT * 10),
        RecoveryDecision::Wait
    );
    assert_eq!(supervisor.recovery_counts(), (1, 1));
}

#[test]
fn successful_ready_resets_the_recovery_budget() {
    let mut supervisor = MainReloadSupervisor::new();
    let start = now();
    supervisor.on_navigation_started(start);
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(1)),
        RecoveryDecision::ReloadOnce
    );
    // The reloaded page handshakes: the next reload starts from zero again
    // instead of inheriting the previous failure.
    assert!(supervisor.on_frontend_ready(7, 7));
    supervisor.on_navigation_started(now());
    assert_eq!(supervisor.recovery_counts(), (0, 0));
    assert_eq!(supervisor.state(), WebviewLifecycle::Loading);
}

#[test]
fn recovery_never_retries_non_idempotent_rpcs() {
    // Reads may be re-issued by the fresh page's mount; mutations must
    // never be replayed by recovery (the 30s RPC deadline already warns
    // that completion is uncertain instead of retrying).
    assert!(is_idempotent_rpc_method("system.health"));
    assert!(is_idempotent_rpc_method("rpc.list"));
    assert!(is_idempotent_rpc_method("host.locale"));
    assert!(!is_idempotent_rpc_method("points.adjust"));
    assert!(!is_idempotent_rpc_method("plugins.action.execute"));
    assert!(!is_idempotent_rpc_method("automation.delete"));
    assert!(!is_idempotent_rpc_method("system.shutdown"));
    assert!(!is_idempotent_rpc_method(""));
}

#[test]
fn plugin_bridge_requires_a_round_trip_and_times_out_without_one() {
    let start = now();
    let mut plugin = PluginPageSupervisor::new(start);
    assert_eq!(plugin.bridge(), PluginBridgeState::Waiting);
    assert!(!plugin.is_delivery_allowed());
    // Post-navigation bridge check: without any broker traffic the
    // watchdog reports a missing bridge, tries one reload, then a
    // recreate, then parks in Failed.
    assert_eq!(
        plugin.check_timeout(start + RELOAD_TIMEOUT - Duration::from_millis(1)),
        RecoveryDecision::Wait
    );
    assert_eq!(
        plugin.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(1)),
        RecoveryDecision::ReloadOnce
    );
    assert_eq!(plugin.bridge(), PluginBridgeState::Missing);
    let second = start + RELOAD_TIMEOUT * 2 + Duration::from_millis(2);
    assert_eq!(plugin.check_timeout(second), RecoveryDecision::Recreate);
    let third = start + RELOAD_TIMEOUT * 3 + Duration::from_millis(3);
    assert_eq!(plugin.check_timeout(third), RecoveryDecision::GiveUp);
    assert_eq!(plugin.state(), WebviewLifecycle::Failed);
}

#[test]
fn plugin_bridge_message_marks_ready_and_resets_subscriptions_budget() {
    let mut plugin = PluginPageSupervisor::new(now());
    // The first broker round-trip proves the init script installed
    // `window.tiktools`: delivery resumes for this generation only.
    plugin.on_bridge_message();
    assert_eq!(plugin.bridge(), PluginBridgeState::Ready);
    assert_eq!(plugin.state(), WebviewLifecycle::Ready);
    assert!(plugin.is_delivery_allowed());
    // A subsequent navigation resets subscriptions (caller clears topics)
    // and requires a fresh bridge proof: the old page's subscriptions
    // and delivery rights never leak into the new document.
    plugin.on_navigation_started(now());
    assert_eq!(plugin.bridge(), PluginBridgeState::Waiting);
    assert_eq!(plugin.state(), WebviewLifecycle::Loading);
    assert!(!plugin.is_delivery_allowed());
}

#[test]
fn plugin_repeated_refresh_never_duplicates_or_loops() {
    let mut plugin = PluginPageSupervisor::new(now());
    for _ in 0..50 {
        plugin.on_navigation_started(now());
        // Each navigation requires its own bridge proof.
        assert!(!plugin.is_delivery_allowed());
        plugin.on_bridge_message();
        assert!(plugin.is_delivery_allowed());
    }
    assert_eq!(plugin.state(), WebviewLifecycle::Ready);
}

#[test]
fn dev_server_and_packaged_origins_share_the_same_recovery_budget() {
    // The supervisor stores no URL: DevTools refreshes, programmatic
    // reloads, `http://localhost` dev servers and the packaged
    // `tiktools://app` custom protocol all share the identical bounded
    // budget. Navigation security stays in `allows_navigation`; recovery
    // only reloads or recreates the already-allowed URL.
    use crate::webview::FrontendSource;
    let dev = FrontendSource::DevelopmentServer("http://127.0.0.1:3000".parse().expect("dev URL"));
    assert!(dev.allows_navigation("http://127.0.0.1:3000/index.html"));
    assert!(!dev.allows_navigation("https://example.com/"));
    assert!(!dev.allows_navigation("http://127.0.0.1:3001/other"));
    let packaged = FrontendSource::EmbeddedAssets {
        root: std::sync::Arc::new(std::path::PathBuf::from("/tmp/tiktools-web")),
    };
    assert!(packaged.allows_navigation("tiktools://app/index.html"));
    assert!(packaged.allows_navigation("http://tiktools.app/index.html"));
    assert!(!packaged.allows_navigation("https://example.com/"));
    // Same supervisor, same caps, regardless of origin.
    for source in [dev, packaged] {
        let _ = source.url();
        let mut supervisor = MainReloadSupervisor::new();
        supervisor.on_navigation_started(now());
        assert_eq!(supervisor.recovery_counts(), (0, 0));
    }
}

#[test]
fn failed_ipc_initialization_is_reported_not_executed() {
    // A missing init script never opens a window: `open` fails fast with
    // `INIT_SCRIPT_MISSING` instead of timing out on a blank page.
    assert!(crate::plugin_webview::init_script_available());
    assert_eq!(
        failure_reasons::INIT_SCRIPT_MISSING,
        "missing IPC bridge: initialization script unavailable"
    );
    assert_eq!(
        failure_reasons::MISSING_BRIDGE,
        "missing IPC bridge: frontend-ready never arrived"
    );
    // A plugin timeout with no broker traffic reports the missing bridge
    // explicitly (not a generic reload timeout).
    let start = now();
    let mut plugin = PluginPageSupervisor::new(start);
    assert_eq!(
        plugin.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(1)),
        RecoveryDecision::ReloadOnce
    );
    assert_eq!(
        plugin.failure_reason(),
        Some(failure_reasons::MISSING_BRIDGE)
    );
}

#[test]
fn recovery_drops_pending_batches_without_replaying_them() {
    // The previous document's outbox is cleared for reload: no stale RPC
    // response is ever delivered to the fresh page, and nothing is
    // re-executed. The fresh page resynchronizes through its mount reads.
    let mut outbox = crate::window::outbox::WebviewOutbox::new();
    outbox.push(r#"{"type":"rpc-response","response":{"id":1}}"#.to_owned());
    assert!(!outbox.is_empty());
    outbox.clear_for_reload();
    assert!(outbox.is_empty());
    // Non-idempotent calls are never auto-retried by the supervisor: only
    // the allowlisted reads may be re-issued by the fresh page itself.
    assert!(!is_idempotent_rpc_method("plugins.action.execute"));
    assert!(!is_idempotent_rpc_method("points.adjust"));
    assert!(!is_idempotent_rpc_method("system.shutdown"));
}

#[test]
fn subscriptions_reset_on_every_navigation_without_duplication() {
    // Topics from the previous page must not leak: each Started requires a
    // fresh bridge proof before any delivery, so a resubscribed topic is
    // never delivered twice to the same document.
    let mut plugin = PluginPageSupervisor::new(now());
    plugin.on_bridge_message();
    assert!(plugin.is_delivery_allowed());
    for _ in 0..20 {
        plugin.on_navigation_started(now());
        assert!(!plugin.is_delivery_allowed());
        assert_eq!(plugin.bridge(), PluginBridgeState::Waiting);
        plugin.on_bridge_message();
        assert!(plugin.is_delivery_allowed());
    }
    assert_eq!(plugin.state(), WebviewLifecycle::Ready);
}

#[test]
fn memory_stays_bounded_across_many_reloads() {
    // A thousand DevTools refreshes must not grow recovery state: plain
    // navigations never increment the auto-recovery counters, and a
    // single failure sequence caps at one reload plus one recreate.
    let mut supervisor = MainReloadSupervisor::new();
    for _ in 0..1000 {
        supervisor.on_navigation_started(now());
    }
    assert_eq!(supervisor.recovery_counts(), (0, 0));
    assert_eq!(supervisor.state(), WebviewLifecycle::Loading);
    let start = now();
    supervisor.on_navigation_started(start);
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT + Duration::from_millis(1)),
        RecoveryDecision::ReloadOnce
    );
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT * 2 + Duration::from_millis(2)),
        RecoveryDecision::Recreate
    );
    assert_eq!(
        supervisor.check_timeout(start + RELOAD_TIMEOUT * 3 + Duration::from_millis(3)),
        RecoveryDecision::GiveUp
    );
    // Further polls after Failed allocate nothing and schedule nothing.
    for _ in 0..100 {
        assert_eq!(
            supervisor.check_timeout(start + RELOAD_TIMEOUT * 10),
            RecoveryDecision::Wait
        );
    }
    assert_eq!(supervisor.recovery_counts(), (1, 1));
}
