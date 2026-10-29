//! Competition definition commands.
use super::{
    args::{one_arg, required_record, split_first},
    result_value, typed_params, CommandError,
};
use serde_json::Value;
use tiktools_client::{ClientError, TikToolsClient};
use tiktools_control_api::modules::competitions::{
    CompetitionActionId, CompetitionId, CompetitionResultsRequest, Definition,
    ResolveCompetitionAction, SelectWinner,
};
pub enum Command {
    List,
    Get(String),
    Create(Definition),
    Update(Definition),
    Delete(String),
    State(String),
    Results(String),
    Action(CompetitionActionId),
    ResolveAction(ResolveCompetitionAction),
    MarkActionUncertain(CompetitionActionId),
    Start(String),
    Finish(String),
    Candidates(String),
    SelectWinner(SelectWinner),
    Pause(String),
    Resume(String),
    Cancel(String),
}
pub fn parse(args: &[String]) -> Result<Command, CommandError> {
    let (verb, rest) = split_first(
        args,
        "competition <list|get|create|update|delete|state|results|action|mark-action-uncertain|resolve-action|start|finish|candidates|select-winner|pause|resume|cancel>",
    )?;
    Ok(match verb {
        "list" if rest.is_empty() => Command::List,
        "get" => Command::Get(one_arg(rest, "competition get <id>")?),
        "mark-action-uncertain" => Command::MarkActionUncertain(typed_params(required_record(
            rest,
            "competition mark-action-uncertain --record <json|@file>",
        )?)?),
        "action" => Command::Action(typed_params(required_record(
            rest,
            "competition action --record <json|@file>",
        )?)?),
        "resolve-action" => Command::ResolveAction(typed_params(required_record(
            rest,
            "competition resolve-action --record <json|@file>",
        )?)?),
        "results" => Command::Results(one_arg(rest, "competition results <id>")?),
        "state" => Command::State(one_arg(rest, "competition state <id>")?),
        "candidates" => Command::Candidates(one_arg(rest, "competition candidates <id>")?),
        "select-winner" => Command::SelectWinner(typed_params(required_record(
            rest,
            "competition select-winner --record <json|@file>",
        )?)?),
        "finish" => Command::Finish(one_arg(rest, "competition finish <id>")?),
        "start" => Command::Start(one_arg(rest, "competition start <id>")?),
        "pause" => Command::Pause(one_arg(rest, "competition pause <id>")?),
        "resume" => Command::Resume(one_arg(rest, "competition resume <id>")?),
        "cancel" => Command::Cancel(one_arg(rest, "competition cancel <id>")?),
        "delete" => Command::Delete(one_arg(rest, "competition delete <id>")?),
        "update" => Command::Update(typed_params(required_record(
            rest,
            "competition update --record <json|@file>",
        )?)?),
        "create" => Command::Create(typed_params(required_record(
            rest,
            "competition create --record <json|@file>",
        )?)?),
        _ => return Err(format!("invalid competition command `{verb}`").into()),
    })
}
pub async fn execute(client: &TikToolsClient, command: Command) -> Result<Value, ClientError> {
    match command {
        Command::List => result_value(client.competitions_list().await?),
        Command::Get(id) => result_value(client.competitions_get(CompetitionId { id }).await?),
        Command::MarkActionUncertain(params) => {
            result_value(client.competitions_mark_action_uncertain(params).await?)
        }
        Command::Action(params) => result_value(client.competitions_action(params).await?),
        Command::ResolveAction(params) => {
            result_value(client.competitions_resolve_action(params).await?)
        }
        Command::Results(id) => result_value(
            client
                .competitions_results(CompetitionResultsRequest {
                    id,
                    before_generation: None,
                    limit: None,
                })
                .await?,
        ),
        Command::State(id) => result_value(client.competitions_state(CompetitionId { id }).await?),
        Command::Candidates(id) => {
            result_value(client.competitions_candidates(CompetitionId { id }).await?)
        }
        Command::SelectWinner(params) => {
            result_value(client.competitions_select_winner(params).await?)
        }
        Command::Finish(id) => {
            result_value(client.competitions_finish(CompetitionId { id }).await?)
        }
        Command::Start(id) => result_value(client.competitions_start(CompetitionId { id }).await?),
        Command::Pause(id) => result_value(client.competitions_pause(CompetitionId { id }).await?),
        Command::Resume(id) => {
            result_value(client.competitions_resume(CompetitionId { id }).await?)
        }
        Command::Cancel(id) => {
            result_value(client.competitions_cancel(CompetitionId { id }).await?)
        }
        Command::Update(definition) => result_value(client.competitions_update(definition).await?),
        Command::Delete(id) => {
            result_value(client.competitions_delete(CompetitionId { id }).await?)
        }
        Command::Create(definition) => result_value(client.competitions_create(definition).await?),
    }
}
