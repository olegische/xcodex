use std::collections::HashMap;
use std::sync::Arc;

use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use async_trait::async_trait;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Function,
}

#[async_trait]
pub trait ToolHandler: Send + Sync {
    type Output: ToolOutput + 'static;

    fn kind(&self) -> ToolKind;

    fn matches_kind(&self, payload: &ToolPayload) -> bool {
        matches!(
            (self.kind(), payload),
            (ToolKind::Function, ToolPayload::Function { .. })
        )
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError>;
}

#[async_trait]
pub(crate) trait AnyToolHandler: Send + Sync {
    async fn handle_any(
        &self,
        invocation: ToolInvocation,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError>;
}

#[async_trait]
impl<T> AnyToolHandler for T
where
    T: ToolHandler,
{
    async fn handle_any(
        &self,
        invocation: ToolInvocation,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError> {
        let output = self.handle(invocation).await?;
        Ok(Box::new(output))
    }
}

#[derive(Default)]
pub struct ToolRegistry {
    handlers: HashMap<String, Arc<dyn AnyToolHandler>>,
}

impl ToolRegistry {
    pub async fn dispatch(
        &self,
        invocation: ToolInvocation,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError> {
        let handler = self.handlers.get(&invocation.tool_name).ok_or_else(|| {
            FunctionCallError::RespondToModel(format!("unsupported tool: {}", invocation.tool_name))
        })?;
        handler.handle_any(invocation).await
    }
}
