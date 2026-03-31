fn main() {
    println!("cargo:rerun-if-env-changed=CANOPI_SKIP_BUNDLED_DB");

    if std::env::var("CANOPI_SKIP_BUNDLED_DB").as_deref() == Ok("1") {
        // Allow CI lint/test jobs to compile the desktop crate without a locally
        // generated bundled plant DB. The runtime already degrades gracefully
        // when the DB is missing; release packaging still requires the real DB.
        unsafe {
            std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
        }
    }

    tauri_build::build();
}
