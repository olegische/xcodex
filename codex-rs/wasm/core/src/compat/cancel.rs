use std::future::Future;

use codex_async_utils::CancelErr;
use tokio_util::sync::CancellationToken;

pub(crate) async fn or_cancel<F>(
    future: F,
    token: &CancellationToken,
) -> Result<F::Output, CancelErr>
where
    F: Future,
{
    tokio::pin!(future);

    tokio::select! {
        _ = token.cancelled() => Err(CancelErr::Cancelled),
        result = &mut future => Ok(result),
    }
}
