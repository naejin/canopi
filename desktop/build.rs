#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a build script fails the build loudly by design"
)]
fn main() {
    println!("cargo:rerun-if-env-changed=CANOPI_SKIP_BUNDLED_DB");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed=capabilities-dev");

    let release = std::env::var("PROFILE").as_deref() == Ok("release");
    let mut patch = serde_json::Map::new();

    if std::env::var("CANOPI_SKIP_BUNDLED_DB").as_deref() == Ok("1") {
        // Allow CI lint/test jobs to compile the desktop crate without a locally
        // generated bundled plant DB. The runtime degrades gracefully when the
        // DB is missing; release packaging still requires the real DB. The
        // third-party notices ship regardless.
        if release {
            println!(
                "cargo:warning=CANOPI_SKIP_BUNDLED_DB=1 in a release build: the plant DB is not bundled"
            );
        }
        patch.insert(
            "bundle".into(),
            serde_json::json!({ "resources": ["THIRD_PARTY_NOTICES.md"] }),
        );
    }

    // The MCP bridge drives the dev webview through `window.__TAURI__` and its
    // own permissions. Neither exists in a release build: the global API stays
    // off and the dev capability is never parsed or granted.
    let dev_bridge = !release && std::env::var_os("CARGO_FEATURE_MCP_BRIDGE").is_some();
    let capabilities_pattern = if dev_bridge {
        patch.insert(
            "app".into(),
            serde_json::json!({
                "withGlobalTauri": true,
                "security": { "capabilities": ["main-window", "mcp-bridge-dev"] }
            }),
        );
        "./capabilities*/**/*"
    } else {
        "./capabilities/**/*"
    };

    if !patch.is_empty() {
        // Merge over any configuration the Tauri CLI passed in, then hand the
        // result to both tauri-build (this process) and `generate_context!`
        // (the crate's rustc invocations).
        let mut config = std::env::var("TAURI_CONFIG")
            .ok()
            .and_then(|inline| serde_json::from_str::<serde_json::Value>(&inline).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        merge(&mut config, serde_json::Value::Object(patch));
        let config = config.to_string();
        println!("cargo:rustc-env=TAURI_CONFIG={config}");
        unsafe {
            std::env::set_var("TAURI_CONFIG", config);
        }
    }

    tauri_build::try_build(
        tauri_build::Attributes::new().capabilities_path_pattern(capabilities_pattern),
    )
    .expect("tauri build configuration");
}

/// JSON merge patch (RFC 7386) as tauri-build applies `TAURI_CONFIG`.
fn merge(target: &mut serde_json::Value, patch: serde_json::Value) {
    match patch {
        serde_json::Value::Object(patch) => {
            if !target.is_object() {
                *target = serde_json::json!({});
            }
            let target = target.as_object_mut().expect("object");
            for (key, value) in patch {
                if value.is_null() {
                    target.remove(&key);
                } else {
                    merge(target.entry(key).or_insert(serde_json::Value::Null), value);
                }
            }
        }
        value => *target = value,
    }
}
