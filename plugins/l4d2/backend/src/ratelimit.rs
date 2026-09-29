//! Global sliding-window rate limiter.
//!
//! The host already serializes action calls per plugin (one worker, one
//! call at a time), so there is no internal queue to bound: this limiter
//! caps how many RCON executions may start per rolling minute, and the
//! adapter enforces its own per-command and tank cooldowns on top.
//! In-memory state resets on plugin restart by design — the adapter-side
//! ConVar cooldowns are the authoritative, restart-proof layer.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub struct RateLimiter {
    max_per_minute: u64,
    starts: VecDeque<Instant>,
}

impl RateLimiter {
    pub fn new(max_per_minute: u64) -> Self {
        Self {
            max_per_minute: max_per_minute.max(1),
            starts: VecDeque::new(),
        }
    }

    /// Current bound, so callers can rebuild when settings change.
    pub fn max_per_minute(&self) -> u64 {
        self.max_per_minute
    }

    /// Records a start if the window allows it, else reports how long to
    /// wait before the oldest start falls out of the window.
    pub fn check(&mut self, now: Instant) -> Result<(), Duration> {
        while self
            .starts
            .front()
            .is_some_and(|first| now.duration_since(*first) >= WINDOW)
        {
            self.starts.pop_front();
        }
        if self.starts.len() as u64 >= self.max_per_minute {
            let retry_after = self
                .starts
                .front()
                .map(|first| WINDOW.saturating_sub(now.duration_since(*first)))
                .unwrap_or(Duration::from_secs(1));
            return Err(retry_after);
        }
        self.starts.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_burst_then_reports_retry_after() {
        let mut limiter = RateLimiter::new(2);
        let start = Instant::now();
        assert!(limiter.check(start).is_ok());
        assert!(limiter.check(start).is_ok());
        let wait = limiter.check(start).expect_err("third is limited");
        assert!(wait <= WINDOW && !wait.is_zero());
    }

    #[test]
    fn window_expiry_frees_capacity() {
        let mut limiter = RateLimiter::new(1);
        let start = Instant::now();
        assert!(limiter.check(start).is_ok());
        assert!(limiter.check(start).is_err());
        assert!(limiter.check(start + WINDOW).is_ok());
    }
}
