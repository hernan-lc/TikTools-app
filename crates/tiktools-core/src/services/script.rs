//! Bounded JavaScript execution for automation scripts.
//!
//! This is deliberately a small host surface around the pure-Rust part of
//! `napi-vm`. It exposes JSON values only; there is no Node API, filesystem,
//! network, process, or WebView handle available to guest code.

use napi_vm::{format, Interpreter, Lexer, Parser, Value as VmValue};
use serde_json::Value;

const MAX_SOURCE_BYTES: usize = 128 * 1024;
const MAX_JSON_BYTES: usize = 2 * 1024 * 1024;
const LOOP_BUDGET: u64 = 1_000_000;

#[derive(Default)]
pub struct ScriptService;

impl ScriptService {
    pub fn validate(&self, source: &str) -> Result<(), String> {
        let program = wrapped_source(source)?;
        let mut lexer = Lexer::new(&program);
        let tokens = lexer.tokenize_with_spans();
        Parser::new_with_spans(tokens)
            .parse_program()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn evaluate(&self, source: &str, event: &Value, inputs: &Value) -> Result<Value, String> {
        let program = wrapped_source(source)?;
        let event = to_vm_value(event)?;
        let inputs = to_vm_value(inputs)?;
        let mut lexer = Lexer::new(&program);
        let tokens = lexer.tokenize_with_spans();
        let statements = Parser::new_with_spans(tokens)
            .parse_program()
            .map_err(|error| error.to_string())?;

        let mut interpreter = Interpreter::with_builtins();
        interpreter.set_loop_budget(LOOP_BUDGET);
        interpreter.set_source(&program);
        let data = event_data(&event);
        {
            let mut globals = interpreter.global.borrow_mut();
            globals.set("event", event);
            globals.set("inputs", inputs.clone());
            // `data` is the event payload shorthand used by the automation
            // contract. `inputs` remains a separate host-provided object.
            globals.set("data", data);
        }
        interpreter.begin_execution();
        let result = interpreter
            .run_program_body(&statements)
            .map_err(|error| error.to_string())?;
        interpreter
            .drain_jobs()
            .map_err(|error| error.to_string())?;
        vm_json_value(&result)
    }
}

fn event_data(event: &VmValue) -> VmValue {
    event.get_prop("data").unwrap_or(VmValue::Null)
}

fn wrapped_source(source: &str) -> Result<String, String> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err("automation script is larger than the 128 KiB limit".to_owned());
    }
    // A function body gives scripts a useful `return` statement while keeping
    // declarations local to one invocation. The result is serialized inside
    // the VM, so no Rust object or host callback crosses the boundary.
    Ok(format!(
        "JSON.stringify((function () {{\nfunction log(value) {{ console.log(value); }}\n{}\n}})())",
        source
    ))
}

fn to_vm_value(value: &Value) -> Result<VmValue, String> {
    match value {
        Value::Null => Ok(VmValue::Null),
        Value::Bool(value) => Ok(VmValue::Bool(*value)),
        Value::Number(value) => value
            .as_f64()
            .map(VmValue::Number)
            .ok_or_else(|| "JSON number cannot be represented by the VM".to_owned()),
        Value::String(value) => Ok(VmValue::String(value.clone())),
        Value::Array(values) => values
            .iter()
            .map(to_vm_value)
            .collect::<Result<Vec<_>, _>>()
            .map(VmValue::array),
        Value::Object(values) => values
            .iter()
            .map(|(key, value)| Ok((key.clone(), to_vm_value(value)?)))
            .collect::<Result<Vec<(String, VmValue)>, String>>()
            .map(VmValue::object),
    }
}

fn vm_json_value(value: &VmValue) -> Result<Value, String> {
    let rendered = format::try_to_string(value).map_err(|error| error.to_string())?;
    if rendered == "undefined" {
        return Ok(Value::Null);
    }
    if rendered.len() > MAX_JSON_BYTES {
        return Err("automation script result is larger than the 2 MiB limit".to_owned());
    }
    serde_json::from_str(&rendered)
        .map_err(|error| format!("automation script returned invalid JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn evaluates_json_with_event_and_inputs() {
        let result = ScriptService
            .evaluate(
                "return { user: event.user.uniqueId, value: inputs.amount + 1, comment: data.comment };",
                &json!({"user": {"uniqueId": "viewer"}, "data": {"comment": "hello"}}),
                &json!({"amount": 4}),
            )
            .unwrap();
        assert_eq!(
            result,
            json!({"user": "viewer", "value": 5, "comment": "hello"})
        );
    }

    #[test]
    fn rejects_infinite_loops() {
        let error = ScriptService
            .evaluate("while (true) {}", &Value::Null, &Value::Null)
            .unwrap_err();
        assert!(error.contains("Maximum loop iterations"), "{error}");
    }

    #[test]
    fn reports_syntax_errors_without_running_partial_code() {
        let error = ScriptService.validate("return {").unwrap_err();
        assert!(error.contains("SyntaxError"), "{error}");
    }
}
