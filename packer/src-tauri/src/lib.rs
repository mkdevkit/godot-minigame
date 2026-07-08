mod adapt;

use adapt::{adapt, AdaptOptions, AdaptReport};

/// Tauri command: run the mini-game adaptation pipeline.
#[tauri::command]
fn run_adapt(options: AdaptOptions) -> AdaptReport {
    adapt(options)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_adapt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
