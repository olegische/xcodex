use async_trait::async_trait;
use codex_protocol::models::PermissionProfile;
use codex_protocol::models::ShellToolCallParams;
use codex_protocol::protocol::AskForApproval;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

use crate::exec::ExecExpiration;
use crate::exec::ExecParams;
use crate::exec::ExecToolCallOutput;
use crate::exec::StreamOutput;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;

#[derive(Clone, Debug, Default)]
pub struct ShellHandler;

#[derive(Clone, Debug, Default)]
pub struct UnifiedExecHandler;

#[derive(Debug, Deserialize)]
struct ExecCommandArgs {
    cmd: String,
    #[serde(default)]
    workdir: Option<String>,
    #[serde(default)]
    sandbox_permissions: codex_protocol::models::SandboxPermissions,
    #[serde(default)]
    additional_permissions: Option<PermissionProfile>,
    #[serde(default)]
    justification: Option<String>,
    #[serde(default)]
    max_output_tokens: Option<usize>,
    #[serde(default)]
    yield_time_ms: Option<u64>,
}

fn parse_arguments<T>(arguments: &str) -> Result<T, FunctionCallError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str(arguments).map_err(|err| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
    })
}

fn normalize_and_validate_additional_permissions(
    request_permission_enabled: bool,
    approval_policy: AskForApproval,
    sandbox_permissions: codex_protocol::models::SandboxPermissions,
    additional_permissions: Option<PermissionProfile>,
    permissions_preapproved: bool,
    _cwd: &Path,
) -> Result<Option<PermissionProfile>, String> {
    let uses_additional_permissions = matches!(
        sandbox_permissions,
        codex_protocol::models::SandboxPermissions::WithAdditionalPermissions
    );

    if !request_permission_enabled
        && (uses_additional_permissions || additional_permissions.is_some())
    {
        return Err(
            "additional permissions are disabled; enable `features.request_permission` before using `with_additional_permissions`"
                .to_string(),
        );
    }

    if uses_additional_permissions {
        if !permissions_preapproved && !matches!(approval_policy, AskForApproval::OnRequest) {
            return Err(format!(
                "approval policy is {approval_policy:?}; reject command — you cannot request additional permissions unless the approval policy is OnRequest"
            ));
        }
        let Some(additional_permissions) = additional_permissions else {
            return Err(
                "missing `additional_permissions`; provide at least one of `network`, `file_system`, or `macos` when using `with_additional_permissions`"
                    .to_string(),
            );
        };
        return Ok(Some(additional_permissions));
    }

    if additional_permissions.is_some() {
        Err(
            "`additional_permissions` requires `sandbox_permissions` set to `with_additional_permissions`"
                .to_string(),
        )
    } else {
        Ok(None)
    }
}

fn mock_exec_output(command: &[String]) -> ExecToolCallOutput {
    let text = if command.iter().any(|part| part.contains("echo hi")) {
        "hi\n".to_string()
    } else {
        String::new()
    };
    ExecToolCallOutput {
        exit_code: 0,
        stdout: StreamOutput::new(text.clone()),
        stderr: StreamOutput::new(String::new()),
        aggregated_output: StreamOutput::new(text),
        duration: std::time::Duration::ZERO,
        timed_out: false,
    }
}

fn encode_exec_output(output: &ExecToolCallOutput) -> String {
    serde_json::json!({
        "output": output.aggregated_output.text,
        "metadata": {
            "exit_code": output.exit_code,
        }
    })
    .to_string()
}

#[async_trait]
impl ToolHandler for ShellHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolPayload::Function { arguments } = invocation.payload else {
            return Err(FunctionCallError::RespondToModel(format!(
                "unsupported payload for shell handler: {}",
                invocation.tool_name
            )));
        };
        let params: ShellToolCallParams = parse_arguments(&arguments)?;
        if matches!(
            params.sandbox_permissions.unwrap_or_default(),
            codex_protocol::models::SandboxPermissions::RequireEscalated
        ) && !matches!(
            invocation.turn.approval_policy.value(),
            AskForApproval::OnRequest
        ) {
            let approval_policy = invocation.turn.approval_policy.value();
            return Err(FunctionCallError::RespondToModel(format!(
                "approval policy is {approval_policy:?}; reject command — you should not ask for escalated permissions if the approval policy is {approval_policy:?}"
            )));
        }

        let output = mock_exec_output(&params.command);
        Ok(FunctionToolOutput::from_text(
            encode_exec_output(&output),
            Some(true),
        ))
    }
}

#[async_trait]
impl ToolHandler for UnifiedExecHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolPayload::Function { arguments } = invocation.payload else {
            return Err(FunctionCallError::RespondToModel(
                "unified_exec handler received unsupported payload".to_string(),
            ));
        };
        let args: ExecCommandArgs = parse_arguments(&arguments)?;
        if matches!(
            args.sandbox_permissions,
            codex_protocol::models::SandboxPermissions::RequireEscalated
        ) && !matches!(
            invocation.turn.approval_policy.value(),
            AskForApproval::OnRequest
        ) {
            let approval_policy = invocation.turn.approval_policy.value();
            return Err(FunctionCallError::RespondToModel(format!(
                "approval policy is {approval_policy:?}; reject command — you cannot ask for escalated permissions if the approval policy is {approval_policy:?}"
            )));
        }
        let cwd = args
            .workdir
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| invocation.turn.cwd.clone());
        let request_permission_enabled = invocation
            .session
            .features()
            .enabled(crate::features::Feature::RequestPermissions);
        let _normalized_additional_permissions = normalize_and_validate_additional_permissions(
            request_permission_enabled,
            invocation.turn.approval_policy.value(),
            args.sandbox_permissions,
            args.additional_permissions,
            false,
            &cwd,
        )
        .map_err(FunctionCallError::RespondToModel)?;

        let _params = ExecParams {
            command: vec!["/bin/sh".to_string(), "-c".to_string(), args.cmd.clone()],
            cwd,
            expiration: ExecExpiration::from(args.yield_time_ms.or(Some(10_000))),
            env: HashMap::new(),
            network: None,
            sandbox_permissions: args.sandbox_permissions,
            windows_sandbox_level: invocation.turn.windows_sandbox_level,
            justification: args.justification,
            arg0: None,
        };
        let _ = args.max_output_tokens;
        Err(FunctionCallError::RespondToModel(format!(
            "exec not implemented in wasm_v2: {}",
            invocation.tool_name
        )))
    }
}
