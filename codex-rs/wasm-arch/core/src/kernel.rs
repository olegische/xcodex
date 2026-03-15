use crate::bridge::BridgeEnvelope;
use crate::bridge::BridgeMessage;
use crate::bridge::BridgeResponse;
use crate::bridge_runtime::BridgeDispatchOutcome;
use crate::bridge_runtime::BridgeRuntime;
use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostResult;
use futures::StreamExt;

#[derive(Debug)]
pub struct KernelDispatch {
    pub response: BridgeEnvelope,
    pub events: Vec<BridgeEnvelope>,
}

pub struct WasmKernel<'a> {
    bridge_runtime: BridgeRuntime<'a>,
}

impl<'a> WasmKernel<'a> {
    pub fn new(bridge_runtime: BridgeRuntime<'a>) -> Self {
        Self { bridge_runtime }
    }

    pub async fn handle_envelope(&self, envelope: BridgeEnvelope) -> HostResult<KernelDispatch> {
        let request = match envelope.payload {
            BridgeMessage::Request(request) => request,
            BridgeMessage::Response(_) | BridgeMessage::Event(_) => {
                return Err(HostError {
                    code: HostErrorCode::InvalidInput,
                    message: "kernel expects a request envelope".to_string(),
                    retryable: false,
                    data: None,
                });
            }
        };

        let message_id = envelope.id;
        let outcome = self.bridge_runtime.dispatch(request).await?;

        match outcome {
            BridgeDispatchOutcome::Response(response) => Ok(KernelDispatch {
                response: response_envelope(message_id, response),
                events: Vec::new(),
            }),
            BridgeDispatchOutcome::ResponseWithEvents { response, events } => {
                let events = events
                    .enumerate()
                    .map(|(index, event)| BridgeEnvelope {
                        id: format!("{message_id}:event:{index}"),
                        payload: BridgeMessage::Event(event),
                    })
                    .collect::<Vec<_>>()
                    .await;

                Ok(KernelDispatch {
                    response: response_envelope(message_id, response),
                    events,
                })
            }
        }
    }
}

fn response_envelope(id: String, response: BridgeResponse) -> BridgeEnvelope {
    BridgeEnvelope {
        id,
        payload: BridgeMessage::Response(response),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::BridgeEvent;
    use crate::bridge::BridgeRequest;
    use crate::bridge::FsReadFileParams;
    use crate::bridge::ModelStartParams;
    use crate::bridge::ModelStartedEvent;
    use crate::bridge_runtime::tests::MockFs;
    use crate::bridge_runtime::tests::MockModelTransport;
    use crate::bridge_runtime::tests::MockSessionStore;
    use crate::bridge_runtime::tests::MockToolExecutor;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[tokio::test(flavor = "current_thread")]
    async fn kernel_wraps_response_in_envelope() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        );
        let kernel = WasmKernel::new(runtime);

        let result = kernel
            .handle_envelope(BridgeEnvelope {
                id: "msg-1".to_string(),
                payload: BridgeMessage::Request(BridgeRequest::FsReadFile(FsReadFileParams {
                    path: "/repo/README.md".to_string(),
                })),
            })
            .await
            .expect("kernel dispatch should succeed");

        assert_eq!(result.response.id, "msg-1");
        assert!(matches!(
            result.response.payload,
            BridgeMessage::Response(BridgeResponse::FsReadFile(_))
        ));
        assert!(result.events.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn kernel_collects_streamed_events() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        );
        let kernel = WasmKernel::new(runtime);

        let result = kernel
            .handle_envelope(BridgeEnvelope {
                id: "msg-2".to_string(),
                payload: BridgeMessage::Request(BridgeRequest::ModelStart(ModelStartParams {
                    request_id: "req-1".to_string(),
                    payload: json!({ "input": [] }),
                })),
            })
            .await
            .expect("kernel dispatch should succeed");

        assert_eq!(result.response.id, "msg-2");
        assert_eq!(result.events.len(), 3);
        assert_eq!(result.events[0].id, "msg-2:event:0");
        assert_eq!(
            result.events[0].payload,
            BridgeMessage::Event(BridgeEvent::ModelStarted(ModelStartedEvent {
                request_id: "req-1".to_string(),
            }))
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn kernel_rejects_non_request_envelopes() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        );
        let kernel = WasmKernel::new(runtime);

        let error = kernel
            .handle_envelope(BridgeEnvelope {
                id: "msg-3".to_string(),
                payload: BridgeMessage::Event(BridgeEvent::ModelStarted(ModelStartedEvent {
                    request_id: "req-1".to_string(),
                })),
            })
            .await
            .expect_err("kernel should reject non-request input");

        assert_eq!(error.code, HostErrorCode::InvalidInput);
        assert_eq!(error.message, "kernel expects a request envelope");
    }
}
