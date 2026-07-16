use crate::{
    native_operation::{NativeOperationClass, NativeOperationExecutor},
    platform,
};
use tauri::State;

/// Write `data` (UTF-8 text) to `path`. Used for SVG and CSV export.
#[tauri::command]
pub async fn export_file(
    executor: State<'_, NativeOperationExecutor>,
    data: String,
    path: String,
) -> Result<String, String> {
    export_file_with_executor(executor.inner(), data, path).await
}

async fn export_file_with_executor(
    executor: &NativeOperationExecutor,
    data: String,
    path: String,
) -> Result<String, String> {
    executor
        .run(NativeOperationClass::Local, "text export", move || {
            crate::services::export::export_file(data, path)
        })
        .await
}

// ---------------------------------------------------------------------------
// Native platform export commands (PNG at DPI, PDF with layout)
// ---------------------------------------------------------------------------

/// Export a canvas snapshot as PNG at the specified DPI.
///
/// `snapshot_base64`: base64-encoded PNG data captured by the frontend renderer
/// `width`, `height`: logical canvas dimensions in pixels
/// `dpi`: target DPI (72 = 1x, 150, 300)
/// `path`: destination file path (chosen by frontend dialog)
#[tauri::command]
pub async fn export_native_png(
    executor: State<'_, NativeOperationExecutor>,
    snapshot_base64: String,
    width: u32,
    height: u32,
    dpi: u32,
    path: String,
) -> Result<String, String> {
    export_native_png_with_executor(executor.inner(), snapshot_base64, width, height, dpi, path)
        .await
}

async fn export_native_png_with_executor(
    executor: &NativeOperationExecutor,
    snapshot_base64: String,
    width: u32,
    height: u32,
    dpi: u32,
    path: String,
) -> Result<String, String> {
    executor
        .run(
            NativeOperationClass::Local,
            "native PNG export",
            move || {
                let platform = platform::native_platform();
                crate::services::export::export_native_png(
                    &platform,
                    snapshot_base64,
                    width,
                    height,
                    dpi,
                    path,
                )
            },
        )
        .await
}

/// Export a canvas snapshot as PDF with the given layout.
///
/// `snapshot_base64`: base64-encoded PNG data captured by the frontend renderer
/// `width`, `height`: logical canvas dimensions in pixels
/// Layout fields: page dimensions in mm, margins, title, etc.
/// `path`: destination file path (chosen by frontend dialog)
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC currently exposes PDF export as flat named arguments"
)]
#[tauri::command]
pub async fn export_native_pdf(
    executor: State<'_, NativeOperationExecutor>,
    snapshot_base64: String,
    width: u32,
    height: u32,
    page_width_mm: f32,
    page_height_mm: f32,
    margin_mm: f32,
    title: String,
    scale_text: String,
    include_legend: bool,
    include_plant_schedule: bool,
    path: String,
) -> Result<String, String> {
    export_native_pdf_with_executor(
        executor.inner(),
        snapshot_base64,
        width,
        height,
        page_width_mm,
        page_height_mm,
        margin_mm,
        title,
        scale_text,
        include_legend,
        include_plant_schedule,
        path,
    )
    .await
}

#[allow(
    clippy::too_many_arguments,
    reason = "Helper keeps the same flat export shape as IPC"
)]
async fn export_native_pdf_with_executor(
    executor: &NativeOperationExecutor,
    snapshot_base64: String,
    width: u32,
    height: u32,
    page_width_mm: f32,
    page_height_mm: f32,
    margin_mm: f32,
    title: String,
    scale_text: String,
    include_legend: bool,
    include_plant_schedule: bool,
    path: String,
) -> Result<String, String> {
    executor
        .run(
            NativeOperationClass::Local,
            "native PDF export",
            move || {
                let platform = platform::native_platform();
                crate::services::export::export_native_pdf(
                    &platform,
                    snapshot_base64,
                    width,
                    height,
                    page_width_mm,
                    page_height_mm,
                    margin_mm,
                    title,
                    scale_text,
                    include_legend,
                    include_plant_schedule,
                    path,
                )
            },
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::{
        export_file_with_executor, export_native_pdf_with_executor, export_native_png_with_executor,
    };
    use crate::native_operation::{
        NativeOperationClass, NativeOperationClassLimits, NativeOperationExecutor,
        NativeOperationLimits,
    };
    use std::sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
        mpsc,
    };
    use std::task::{Context, Poll, Wake, Waker};
    use std::time::Duration;
    use std::{future::Future, path::PathBuf};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    const WAIT_TIMEOUT: Duration = Duration::from_secs(2);

    struct NoopWake;

    impl Wake for NoopWake {
        fn wake(self: Arc<Self>) {}
    }

    struct TempTestDir {
        root: PathBuf,
    }

    impl TempTestDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root =
                std::env::temp_dir().join(format!("canopi-export-command-{label}-{sequence}"));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn file(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn local_test_executor(admitted: usize, running: usize) -> NativeOperationExecutor {
        let limits = NativeOperationClassLimits::new(admitted, running);
        NativeOperationExecutor::new(NativeOperationLimits::new(limits, limits, limits, limits))
            .unwrap()
    }

    #[test]
    fn queued_text_export_yields_without_publishing_before_local_capacity() {
        tauri::async_runtime::block_on(async {
            let executor = local_test_executor(2, 1);
            let (started_tx, started_rx) = mpsc::sync_channel(1);
            let (release_tx, release_rx) = mpsc::sync_channel(1);
            let blocking_executor = executor.clone();
            let blocker = tauri::async_runtime::spawn(async move {
                blocking_executor
                    .run(
                        NativeOperationClass::Local,
                        "test export blocker",
                        move || {
                            started_tx.send(()).unwrap();
                            release_rx.recv().unwrap();
                            Ok(())
                        },
                    )
                    .await
            });
            started_rx.recv_timeout(WAIT_TIMEOUT).unwrap();

            let temp_dir = TempTestDir::new("queued-local");
            let text_path = temp_dir.file("queued.txt");
            let mut export = Box::pin(export_file_with_executor(
                &executor,
                "hello".to_owned(),
                text_path.display().to_string(),
            ));
            {
                let waker = Waker::from(Arc::new(NoopWake));
                let mut context = Context::from_waker(&waker);
                assert!(matches!(export.as_mut().poll(&mut context), Poll::Pending));
            }
            assert!(!text_path.exists());

            release_tx.send(()).unwrap();
            blocker.await.unwrap().unwrap();
            assert_eq!(export.await.unwrap(), text_path.display().to_string());
            assert_eq!(std::fs::read(text_path).unwrap(), b"hello");
        });
    }

    #[test]
    fn busy_exports_reject_before_validation_or_publication() {
        tauri::async_runtime::block_on(async {
            let executor = local_test_executor(1, 1);
            let (started_tx, started_rx) = mpsc::sync_channel(1);
            let (release_tx, release_rx) = mpsc::sync_channel(1);
            let blocking_executor = executor.clone();
            let blocker = tauri::async_runtime::spawn(async move {
                blocking_executor
                    .run(
                        NativeOperationClass::Local,
                        "test export blocker",
                        move || {
                            started_tx.send(()).unwrap();
                            release_rx.recv().unwrap();
                            Ok(())
                        },
                    )
                    .await
            });
            started_rx.recv_timeout(WAIT_TIMEOUT).unwrap();

            let temp_dir = TempTestDir::new("busy-local");
            let text_path = temp_dir.file("rejected.txt");
            let error = export_file_with_executor(
                &executor,
                "must not be written".to_owned(),
                text_path.display().to_string(),
            )
            .await
            .unwrap_err();

            assert_eq!(error, "Native local operations are busy; try again");
            assert!(!text_path.exists());

            let png_path = temp_dir.file("rejected.png");
            let png_error = export_native_png_with_executor(
                &executor,
                "invalid base64 must not be decoded".to_owned(),
                100,
                100,
                72,
                png_path.display().to_string(),
            )
            .await
            .unwrap_err();
            assert_eq!(png_error, "Native local operations are busy; try again");
            assert!(!png_path.exists());

            release_tx.send(()).unwrap();
            blocker.await.unwrap().unwrap();
        });
    }

    #[test]
    fn executor_backed_text_export_writes_through_service_boundary() {
        let temp_dir = TempTestDir::new("files");
        let text_path = temp_dir.file("export.txt");
        let executor = local_test_executor(1, 1);

        tauri::async_runtime::block_on(export_file_with_executor(
            &executor,
            "hello".to_string(),
            text_path.display().to_string(),
        ))
        .unwrap();

        assert_eq!(std::fs::read(text_path).unwrap(), b"hello");
    }

    #[test]
    fn executor_backed_native_exports_preserve_decode_errors() {
        let temp_dir = TempTestDir::new("native-errors");
        let executor = local_test_executor(2, 2);

        let png_err = tauri::async_runtime::block_on(export_native_png_with_executor(
            &executor,
            "***".to_string(),
            100,
            100,
            72,
            temp_dir.file("bad.png").display().to_string(),
        ))
        .unwrap_err();
        assert!(png_err.contains("Failed to decode base64 snapshot"));

        let pdf_err = tauri::async_runtime::block_on(export_native_pdf_with_executor(
            &executor,
            "***".to_string(),
            100,
            100,
            210.0,
            297.0,
            10.0,
            "Bad".to_string(),
            "1:1".to_string(),
            false,
            false,
            temp_dir.file("bad.pdf").display().to_string(),
        ))
        .unwrap_err();
        assert!(pdf_err.contains("Failed to decode base64 snapshot"));
    }
}
