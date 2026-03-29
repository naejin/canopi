use std::path::Path;
use tracing_appender::rolling;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

pub fn init(log_dir: &Path) {
    let file_appender = rolling::daily(log_dir, "canopi");

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(
            fmt::layer()
                .with_writer(file_appender)
                .with_ansi(false)
                .with_target(true),
        )
        .init();
}
