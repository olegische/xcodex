use std::future::Future;

#[cfg(target_arch = "wasm32")]
use tokio::sync::oneshot;

#[cfg(not(target_arch = "wasm32"))]
use tokio::task::AbortHandle;
#[cfg(not(target_arch = "wasm32"))]
use tokio::task::JoinHandle;

#[derive(Clone, Debug, Default)]
pub(crate) enum TaskAbortHandle {
    #[cfg(not(target_arch = "wasm32"))]
    Native(AbortHandle),
    #[default]
    Noop,
}

impl TaskAbortHandle {
    pub(crate) fn abort(&self) {
        #[cfg(not(target_arch = "wasm32"))]
        if let Self::Native(handle) = self {
            handle.abort();
        }
    }
}

pub(crate) enum SpawnedTask<T> {
    #[cfg(not(target_arch = "wasm32"))]
    Native(JoinHandle<T>),
    #[cfg(target_arch = "wasm32")]
    Wasm(oneshot::Receiver<T>),
}

impl<T> SpawnedTask<T> {
    pub(crate) fn abort_handle(&self) -> TaskAbortHandle {
        match self {
            #[cfg(not(target_arch = "wasm32"))]
            Self::Native(handle) => TaskAbortHandle::Native(handle.abort_handle()),
            #[cfg(target_arch = "wasm32")]
            Self::Wasm(_) => TaskAbortHandle::Noop,
        }
    }

    pub(crate) async fn join(self) -> Result<T, String> {
        match self {
            #[cfg(not(target_arch = "wasm32"))]
            Self::Native(handle) => handle.await.map_err(|err| err.to_string()),
            #[cfg(target_arch = "wasm32")]
            Self::Wasm(receiver) => receiver.await.map_err(|err| err.to_string()),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn spawn_task<F, T>(future: F) -> SpawnedTask<T>
where
    F: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    SpawnedTask::Native(tokio::spawn(future))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn spawn_task<F, T>(future: F) -> SpawnedTask<T>
where
    F: Future<Output = T> + 'static,
    T: 'static,
{
    let (sender, receiver) = oneshot::channel();
    wasm_bindgen_futures::spawn_local(async move {
        let result = future.await;
        let _ = sender.send(result);
    });
    SpawnedTask::Wasm(receiver)
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn spawn_detached<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    let _ = spawn_task(future);
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn spawn_detached<F>(future: F)
where
    F: Future<Output = ()> + 'static,
{
    let _ = spawn_task(future);
}
