//! Deterministic integer scoring. Arithmetic is checked at every step;
//! overflow rejects the whole contribution for that ranking.
use crate::{
    model::{Contribution, SourceRule},
    Error,
};

pub(crate) fn score(rules: &[SourceRule], contribution: &Contribution<'_>) -> Result<u64, Error> {
    let mut total = 0u64;
    for rule in rules
        .iter()
        .filter(|rule| rule.enabled && rule.weight > 0 && rule.source == contribution.source)
    {
        if !contribution
            .metrics
            .iter()
            .any(|(metric, delta)| *metric == rule.metric && *delta > 0)
        {
            continue;
        }
        if contribution.source == "tiktok.gift"
            && contribution.gift.is_none()
            && !rule.gift_multipliers.is_empty()
        {
            return Err(Error::InvalidKey);
        }
        let multiplier = contribution
            .gift
            .and_then(|gift| rule.gift_multipliers.get(gift))
            .copied()
            .unwrap_or(1);
        if multiplier == 0 {
            continue;
        }
        for (_, delta) in contribution
            .metrics
            .iter()
            .filter(|(metric, _)| *metric == rule.metric)
        {
            let value = delta
                .checked_mul(rule.weight)
                .and_then(|value| value.checked_mul(multiplier))
                .ok_or(Error::Overflow)?;
            total = total.checked_add(value).ok_or(Error::Overflow)?;
        }
    }
    Ok(total)
}
