//! Synthetic in-memory accounting baseline. This does not model upstream
//! loss, persistence, or competition finalization.
use std::time::Instant;
use tiktools_aggregation::{
    engine::Engine,
    model::{Contribution, Definition, SourceRule},
};

fn main() {
    for events in [10_000_u64, 100_000, 1_000_000] {
        let mut engine = Engine::default();
        engine
            .create(Definition {
                schema_version: 1,
                id: "mixed".into(),
                creator_id: "creator".into(),
                room_id: "room".into(),
                group_by: Default::default(),
                window: Default::default(),
                user_limits: None,
                capacity: 4096,
                limit: 10,
                sources: vec![
                    SourceRule {
                        source: "tiktok.like".into(),
                        metric: "like.count".into(),
                        weight: 1,
                        enabled: true,
                        gift_multipliers: Default::default(),
                    },
                    SourceRule {
                        source: "tiktok.gift".into(),
                        metric: "gift.diamonds".into(),
                        weight: 2,
                        enabled: true,
                        gift_multipliers: Default::default(),
                    },
                    SourceRule {
                        source: "tiktok.share".into(),
                        metric: "share.count".into(),
                        weight: 3,
                        enabled: true,
                        gift_multipliers: Default::default(),
                    },
                ],
            })
            .unwrap();
        let keys: Vec<_> = (0..4096).map(|id| format!("user-{id}")).collect();
        let start = Instant::now();
        let mut rejected = 0;
        for i in 0..events {
            let (source, metric) = match i % 10 {
                0 => ("tiktok.gift", "gift.diamonds"),
                1 => ("tiktok.share", "share.count"),
                _ => ("tiktok.like", "like.count"),
            };
            rejected += engine
                .apply_at(
                    &Contribution {
                        creator_id: "creator",
                        room_id: "room",
                        source,
                        user: Some(&keys[i as usize % keys.len()]),
                        gift: None,
                        option: None,
                        team: None,
                        custom_key: None,
                        metrics: &[(metric, 1)],
                    },
                    i,
                )
                .len();
        }
        let elapsed = start.elapsed();
        let snapshot_start = Instant::now();
        let snapshot = engine.snapshot("mixed").unwrap();
        let snapshot_time = snapshot_start.elapsed();
        println!("events={events} elapsed_ms={:.2} events_per_sec={:.0} snapshot_us={:.1} participants={} rejected={rejected}", elapsed.as_secs_f64()*1000.0, events as f64/elapsed.as_secs_f64(), snapshot_time.as_secs_f64()*1_000_000.0, snapshot.total_participants);
    }
}
