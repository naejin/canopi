use crate::native_operation::{NativeOperationClass, NativeOperationExecutor};
use tauri::State;

#[tauri::command]
pub async fn save_canvas_pdf(
    executor: State<'_, NativeOperationExecutor>,
    data: Vec<u8>,
    path: String,
) -> Result<(), String> {
    executor
        .run(
            NativeOperationClass::Local,
            "Canvas PDF delivery",
            move || crate::services::export::save_canvas_pdf(data, path),
        )
        .await
}

/// Write `data` (UTF-8 text) to `path`: the budget CSV and GeoJSON exports.
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

/// Read a user-chosen GeoJSON file as text for the shared frontend codec.
#[tauri::command]
pub async fn read_geojson_file(
    executor: State<'_, NativeOperationExecutor>,
    path: String,
) -> Result<String, String> {
    executor
        .run(NativeOperationClass::Local, "GeoJSON import", move || {
            crate::services::export::read_geojson_file(path)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::export_file_with_executor;
    use crate::native_operation::{
        NativeOperationClass, NativeOperationClassLimits, NativeOperationExecutor,
        NativeOperationLimits,
    };
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    };
    use std::task::{Context, Poll, Waker};
    use std::time::Duration;
    use std::{future::Future, path::PathBuf};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    const WAIT_TIMEOUT: Duration = Duration::from_secs(2);

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
            let text_path = temp_dir.file("queued.csv");
            let mut export = Box::pin(export_file_with_executor(
                &executor,
                "hello".to_owned(),
                text_path.display().to_string(),
            ));
            {
                let mut context = Context::from_waker(Waker::noop());
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
            let text_path = temp_dir.file("rejected.csv");
            let error = export_file_with_executor(
                &executor,
                "must not be written".to_owned(),
                text_path.display().to_string(),
            )
            .await
            .unwrap_err();

            assert_eq!(error, "Native local operations are busy; try again");
            assert!(!text_path.exists());

            release_tx.send(()).unwrap();
            blocker.await.unwrap().unwrap();
        });
    }

    #[test]
    fn executor_backed_text_export_writes_through_service_boundary() {
        let temp_dir = TempTestDir::new("files");
        let text_path = temp_dir.file("export.csv");
        let executor = local_test_executor(1, 1);

        tauri::async_runtime::block_on(export_file_with_executor(
            &executor,
            "hello".to_string(),
            text_path.display().to_string(),
        ))
        .unwrap();

        assert_eq!(std::fs::read(text_path).unwrap(), b"hello");
    }
}
