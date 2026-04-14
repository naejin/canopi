use common_types::settings::UpdateChannel;
use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;
use url::Url;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_for_updates<R: Runtime>(
    webview: Webview<R>,
    channel: UpdateChannel,
    endpoints: Vec<String>,
) -> Result<Option<UpdateMetadata>, String> {
    let pubkey = option_env!("CANOPI_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if pubkey.is_none() {
        return Err("Updater is not configured for this build.".into());
    }

    if endpoints.is_empty() {
        return Err(format!("No updater endpoints configured for {channel:?} channel."));
    }

    let parsed_endpoints = endpoints
        .into_iter()
        .map(|endpoint| Url::parse(&endpoint).map_err(|e| format!("Invalid updater endpoint: {e}")))
        .collect::<Result<Vec<_>, _>>()?;

    let updater = webview
        .updater_builder()
        .endpoints(parsed_endpoints)
        .map_err(|e| format!("Failed to configure updater endpoints: {e}"))?
        .build()
        .map_err(|e| format!("Failed to initialize updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    let Some(update) = update else {
        return Ok(None);
    };

    let formatted_date = update
        .date
        .map(|date| date.format(&Rfc3339).map_err(|_| "Failed to format updater publish date.".to_string()))
        .transpose()?;

    Ok(Some(UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: formatted_date,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}
