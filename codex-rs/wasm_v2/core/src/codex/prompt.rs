use super::*;

pub(super) fn build_prompt(
    input: Vec<ResponseItem>,
    router: &ToolRouter,
    turn_context: &TurnContext,
    base_instructions: BaseInstructions,
) -> Prompt {
    Prompt {
        input,
        tools: router.specs(),
        parallel_tool_calls: turn_context.model_info.supports_parallel_tool_calls,
        base_instructions,
        personality: turn_context.personality,
        output_schema: turn_context.final_output_json_schema.clone(),
    }
}
