use chrono::DateTime;
#[cfg(not(target_arch = "wasm32"))]
use chrono::Local;
use chrono::Utc;
use std::time::Duration;
#[cfg(target_arch = "wasm32")]
use tokio::sync::oneshot;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::closure::Closure;

#[cfg(target_arch = "wasm32")]
fn now_unix_millis() -> i64 {
    js_sys::Date::now() as i64
}

#[cfg(not(target_arch = "wasm32"))]
fn now_unix_millis() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn now_unix_seconds() -> i64 {
    now_unix_millis() / 1000
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy, Debug)]
pub struct Instant(i64);

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Copy, Debug)]
pub struct Instant(std::time::Instant);

impl Instant {
    pub fn now() -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            Self(now_unix_millis())
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            Self(std::time::Instant::now())
        }
    }

    pub fn elapsed(self) -> Duration {
        #[cfg(target_arch = "wasm32")]
        {
            Duration::from_millis(now_unix_millis().saturating_sub(self.0) as u64)
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            self.0.elapsed()
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub async fn sleep(duration: Duration) {
    let (sender, receiver) = oneshot::channel();
    if let Some(window) = web_sys::window() {
        {
            let mut sender = Some(sender);
            let callback = Closure::once(move || {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(());
                }
            });
            let timeout_ms = i32::try_from(duration.as_millis()).unwrap_or(i32::MAX);
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                callback.as_ref().unchecked_ref(),
                timeout_ms,
            );
            callback.forget();
        }
    } else {
        let _ = sender.send(());
        let _ = receiver.await;
        return;
    }

    let _ = receiver.await;
}

#[cfg(not(target_arch = "wasm32"))]
pub async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

pub fn now_utc() -> DateTime<Utc> {
    #[cfg(target_arch = "wasm32")]
    {
        DateTime::<Utc>::from_timestamp_millis(now_unix_millis()).unwrap_or_else(epoch_utc)
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        Utc::now()
    }
}

pub fn now_rfc3339() -> String {
    now_utc().to_rfc3339()
}

pub fn now_local_date() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        let date = js_sys::Date::new_0();
        format!(
            "{:04}-{:02}-{:02}",
            date.get_full_year(),
            date.get_month() + 1,
            date.get_date()
        )
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        Local::now().format("%Y-%m-%d").to_string()
    }
}

fn epoch_utc() -> DateTime<Utc> {
    DateTime::<Utc>::UNIX_EPOCH
}
