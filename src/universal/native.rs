//! Schema-backed Rust consumer. The data files are vendored from the SDK;
//! changes to the contract do not require hand-maintained model copies.
use serde_json::Value;
pub fn validate(schema: &Value, value: &Value, root: &Value, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    if let Some(v) = schema.as_bool() {
        return v;
    }
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        return reference
            .strip_prefix('#')
            .and_then(|p| root.pointer(p))
            .is_some_and(|target| validate(target, value, root, depth + 1));
    }
    let kind = schema.get("type").and_then(Value::as_str);
    let matches = match kind {
        Some("object") => value.is_object(),
        Some("array") => value.is_array(),
        Some("string") => value.is_string(),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        Some("number") => value.is_number(),
        Some("integer") => value.as_f64().is_some_and(|n| n.fract() == 0.0),
        None => true,
        _ => false,
    };
    if !matches {
        return false;
    }
    if schema.get("const").is_some_and(|v| v != value) {
        return false;
    }
    if schema
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|a| !a.contains(value))
    {
        return false;
    }
    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        if length < schema.get("minLength").and_then(Value::as_u64).unwrap_or(0)
            || length
                > schema
                    .get("maxLength")
                    .and_then(Value::as_u64)
                    .unwrap_or(u64::MAX)
        {
            return false;
        }
        if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
            if !regex::Regex::new(pattern).is_ok_and(|r| r.is_match(text)) {
                return false;
            }
        }
    }
    if let Some(n) = value.as_f64() {
        if schema
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|min| n < min)
            || schema
                .get("maximum")
                .and_then(Value::as_f64)
                .is_some_and(|max| n > max)
        {
            return false;
        }
    }
    if let Some(items) = value.as_array() {
        if items.len() as u64
            > schema
                .get("maxItems")
                .and_then(Value::as_u64)
                .unwrap_or(u64::MAX)
            || (items.len() as u64) < schema.get("minItems").and_then(Value::as_u64).unwrap_or(0)
        {
            return false;
        }
        for (i, item) in items.iter().enumerate() {
            if schema
                .get("items")
                .is_some_and(|s| !validate(s, item, root, depth + 1))
            {
                return false;
            }
            if schema.get("uniqueItems").and_then(Value::as_bool) == Some(true)
                && items[..i].contains(item)
            {
                return false;
            }
        }
    }
    if let Some(object) = value.as_object() {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            if required
                .iter()
                .any(|key| !object.contains_key(key.as_str().unwrap_or("")))
            {
                return false;
            }
        }
        for (key, v) in object {
            if ["__proto__", "constructor", "prototype"].contains(&key.as_str()) {
                return false;
            }
            if let Some(rule) = schema
                .get("properties")
                .and_then(|p| p.get(key))
                .or_else(|| schema.get("additionalProperties"))
            {
                if !validate(rule, v, root, depth + 1) {
                    return false;
                }
            }
        }
    }
    true
}
pub fn valid_event(value: &Value) -> bool {
    let schema: Value =
        serde_json::from_str(include_str!("schemas/event.schema.json")).expect("bundled schema");
    if !validate(&schema, value, &schema, 0) {
        return false;
    }
    if !valid_timestamp(value["timestamp"].as_str().unwrap_or("")) {
        return false;
    }
    let schemas: Value = serde_json::from_str(include_str!("schemas/payloads.schema.json"))
        .expect("bundled payload schemas");
    if let Some(schema) = schemas["definitions"].get(value["type"].as_str().unwrap_or("")) {
        return validate(schema, &value["data"], schema, 0);
    }
    true
}
fn valid_timestamp(value: &str) -> bool {
    let read = |start, end| {
        value
            .get(start..end)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(u32::MAX)
    };
    let year = read(0, 4);
    let month = read(5, 7);
    let day = read(8, 10);
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    (1..=9999).contains(&year)
        && day >= 1
        && day <= max
        && read(11, 13) < 24
        && read(14, 16) < 60
        && read(17, 19) < 60
}
fn normalize_fields(mapping: &Value, input: &Value, index: usize) -> Value {
    let mut result = serde_json::Map::new();
    for (key, rule) in mapping.as_object().into_iter().flatten() {
        let value = input.get(rule[index].as_str().unwrap_or(""));
        let normalized = match rule[2].as_str() {
            Some("boolean") => value.filter(|v| v.is_boolean()).cloned(),
            Some("counter") => value.and_then(|v| {
                if let Some(text) = v.as_str() {
                    if !text.is_empty()
                        && text.len() <= 20
                        && text.bytes().all(|c| c.is_ascii_digit())
                    {
                        return Some(Value::String(text.to_owned()));
                    }
                }
                v.as_u64()
                    .filter(|n| *n <= 9_007_199_254_740_991)
                    .map(|n| Value::String(n.to_string()))
            }),
            _ => value.filter(|v| v.is_string()).cloned(),
        }
        .unwrap_or_else(|| rule[3].clone());
        result.insert(key.clone(), normalized);
    }
    Value::Object(result)
}
pub fn normalize_data(kind: &str, data: &Value, user: &Value, index: usize) -> Value {
    let mappings: Value = serde_json::from_str(include_str!("schemas/mappings.schema.json"))
        .expect("bundled mapping");
    let Some(mapping) = mappings["definitions"].get(kind) else {
        return data.clone();
    };
    let mut result = normalize_fields(mapping, data, index);
    result["user"] = normalize_fields(&mappings["user"], user, index);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn golden_fixture() {
        let e: Value = serde_json::from_str(include_str!("fixtures/custom.alert.json")).unwrap();
        assert!(valid_event(&e));
        let mut bad = e.clone();
        bad["version"] = serde_json::json!(2);
        assert!(!valid_event(&bad));
        bad = e;
        bad["data"]["command"] = serde_json::json!("obs.shutdown");
        assert!(!valid_event(&bad));
    }
    #[test]
    fn conformance() {
        let fixtures: Value =
            serde_json::from_str(include_str!("fixtures/conformance.json")).unwrap();
        for case in fixtures.as_array().unwrap() {
            assert_eq!(
                valid_event(&case["event"]),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
}
