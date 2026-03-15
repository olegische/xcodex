use std::fmt;
use std::io;
use std::time::Duration;

use codex_async_utils::CancelErr;
use codex_protocol::ThreadId;
use codex_protocol::protocol::CodexErrorInfo;
use codex_protocol::protocol::ErrorEvent;
use codex_protocol::protocol::RateLimitSnapshot;

pub type Result<T> = std::result::Result<T, CodexErr>;

#[derive(Debug, Clone)]
pub struct UsageLimitReachedError {
    pub rate_limits: Option<Box<RateLimitSnapshot>>,
}

impl fmt::Display for UsageLimitReachedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "usage limit reached")
    }
}

#[derive(Debug, Clone)]
pub struct UnexpectedResponseError {
    pub status: u16,
    pub message: String,
}

impl fmt::Display for UnexpectedResponseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "unexpected status {}", self.status)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct RetryLimitReachedError {
    pub status: u16,
    pub message: String,
}

impl fmt::Display for RetryLimitReachedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "retry limit reached")
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectionFailedError {
    pub status: Option<u16>,
    pub message: String,
}

impl fmt::Display for ConnectionFailedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "connection failed")
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResponseStreamFailed {
    pub status: Option<u16>,
    pub message: String,
    pub request_id: Option<String>,
}

impl fmt::Display for ResponseStreamFailed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "response stream failed")
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct RefreshTokenFailedError {
    pub message: String,
}

impl fmt::Display for RefreshTokenFailedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.message.is_empty() {
            write!(f, "refresh token failed")
        } else {
            write!(f, "{}", self.message)
        }
    }
}

#[derive(Debug, Clone)]
pub struct EnvVarError {
    pub var: String,
    pub instructions: Option<String>,
}

impl fmt::Display for EnvVarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Missing environment variable: `{}`.", self.var)?;
        if let Some(instructions) = &self.instructions {
            write!(f, " {instructions}")?;
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum CodexErr {
    TurnAborted,
    Stream(String, Option<Duration>),
    ContextWindowExceeded,
    ThreadNotFound(ThreadId),
    AgentLimitReached { max_threads: usize },
    SessionConfiguredNotFirstEvent,
    Timeout,
    Spawn,
    Interrupted,
    UnexpectedStatus(UnexpectedResponseError),
    InvalidRequest(String),
    InvalidImageRequest(),
    UsageLimitReached(UsageLimitReachedError),
    ServerOverloaded,
    ResponseStreamFailed(ResponseStreamFailed),
    ConnectionFailed(ConnectionFailedError),
    QuotaExceeded,
    UsageNotIncluded,
    InternalServerError,
    RetryLimit(RetryLimitReachedError),
    InternalAgentDied,
    UnsupportedOperation(String),
    RefreshTokenFailed(RefreshTokenFailedError),
    Fatal(String),
    Io(io::Error),
    Json(serde_json::Error),
    EnvVar(EnvVarError),
}

impl From<CancelErr> for CodexErr {
    fn from(_: CancelErr) -> Self {
        Self::TurnAborted
    }
}

impl From<io::Error> for CodexErr {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for CodexErr {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl fmt::Display for CodexErr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TurnAborted => write!(f, "turn aborted"),
            Self::Stream(message, _) => {
                write!(f, "stream disconnected before completion: {message}")
            }
            Self::ContextWindowExceeded => write!(f, "context window exceeded"),
            Self::ThreadNotFound(id) => write!(f, "no thread with id: {id}"),
            Self::AgentLimitReached { max_threads } => {
                write!(f, "agent thread limit reached (max {max_threads})")
            }
            Self::SessionConfiguredNotFirstEvent => {
                write!(
                    f,
                    "session configured event was not the first event in the stream"
                )
            }
            Self::Timeout => write!(f, "timeout waiting for child process to exit"),
            Self::Spawn => write!(f, "spawn failed"),
            Self::Interrupted => write!(f, "interrupted"),
            Self::UnexpectedStatus(err) => write!(f, "{err}"),
            Self::InvalidRequest(message) => write!(f, "{message}"),
            Self::InvalidImageRequest() => write!(f, "Image poisoning"),
            Self::UsageLimitReached(err) => write!(f, "{err}"),
            Self::ServerOverloaded => write!(f, "selected model is at capacity"),
            Self::ResponseStreamFailed(err) => write!(f, "{err}"),
            Self::ConnectionFailed(err) => write!(f, "{err}"),
            Self::QuotaExceeded => write!(f, "quota exceeded"),
            Self::UsageNotIncluded => write!(f, "usage not included"),
            Self::InternalServerError => write!(f, "internal server error"),
            Self::RetryLimit(err) => write!(f, "{err}"),
            Self::InternalAgentDied => write!(f, "internal error; agent loop died unexpectedly"),
            Self::UnsupportedOperation(message) => write!(f, "unsupported operation: {message}"),
            Self::RefreshTokenFailed(err) => write!(f, "{err}"),
            Self::Fatal(message) => write!(f, "Fatal error: {message}"),
            Self::Io(err) => write!(f, "{err}"),
            Self::Json(err) => write!(f, "{err}"),
            Self::EnvVar(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for CodexErr {}

impl CodexErr {
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::TurnAborted
            | Self::Interrupted
            | Self::EnvVar(_)
            | Self::Fatal(_)
            | Self::UsageNotIncluded
            | Self::QuotaExceeded
            | Self::InvalidImageRequest()
            | Self::InvalidRequest(_)
            | Self::RefreshTokenFailed(_)
            | Self::UnsupportedOperation(_)
            | Self::RetryLimit(_)
            | Self::ContextWindowExceeded
            | Self::ThreadNotFound(_)
            | Self::AgentLimitReached { .. }
            | Self::Spawn
            | Self::SessionConfiguredNotFirstEvent
            | Self::UsageLimitReached(_)
            | Self::ServerOverloaded => false,
            Self::Stream(..)
            | Self::Timeout
            | Self::UnexpectedStatus(_)
            | Self::ResponseStreamFailed(_)
            | Self::ConnectionFailed(_)
            | Self::InternalServerError
            | Self::InternalAgentDied
            | Self::Io(_)
            | Self::Json(_) => true,
        }
    }

    pub fn to_codex_protocol_error(&self) -> CodexErrorInfo {
        match self {
            Self::ContextWindowExceeded => CodexErrorInfo::ContextWindowExceeded,
            Self::UsageLimitReached(_) | Self::QuotaExceeded | Self::UsageNotIncluded => {
                CodexErrorInfo::UsageLimitExceeded
            }
            Self::ServerOverloaded => CodexErrorInfo::ServerOverloaded,
            Self::RetryLimit(_) => CodexErrorInfo::ResponseTooManyFailedAttempts {
                http_status_code: self.http_status_code_value(),
            },
            Self::ConnectionFailed(_) => CodexErrorInfo::HttpConnectionFailed {
                http_status_code: self.http_status_code_value(),
            },
            Self::ResponseStreamFailed(_) => CodexErrorInfo::ResponseStreamConnectionFailed {
                http_status_code: self.http_status_code_value(),
            },
            Self::RefreshTokenFailed(_) => CodexErrorInfo::Unauthorized,
            Self::SessionConfiguredNotFirstEvent
            | Self::InternalServerError
            | Self::InternalAgentDied => CodexErrorInfo::InternalServerError,
            Self::UnsupportedOperation(_)
            | Self::ThreadNotFound(_)
            | Self::AgentLimitReached { .. } => CodexErrorInfo::BadRequest,
            _ => CodexErrorInfo::Other,
        }
    }

    pub fn to_error_event(&self, message_prefix: Option<String>) -> ErrorEvent {
        let error_message = self.to_string();
        let message = match message_prefix {
            Some(prefix) => format!("{prefix}: {error_message}"),
            None => error_message,
        };
        ErrorEvent {
            message,
            codex_error_info: Some(self.to_codex_protocol_error()),
        }
    }

    pub fn http_status_code_value(&self) -> Option<u16> {
        match self {
            Self::RetryLimit(err) => Some(err.status),
            Self::UnexpectedStatus(err) => Some(err.status),
            Self::ConnectionFailed(err) => err.status,
            Self::ResponseStreamFailed(err) => err.status,
            _ => None,
        }
    }
}
