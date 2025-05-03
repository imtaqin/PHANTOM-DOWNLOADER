
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod download;

use download::{download_video, list_formats, DownloadProgress, DownloadState};
use std::sync::Mutex;
use tauri::State;

fn main() {
    let download_state = DownloadState {
        progress: Mutex::new(DownloadProgress {
            percentage: 0.0,
            speed: String::new(),
            eta: String::new(),
            filename: String::new(),
        }),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(download_state)
        .invoke_handler(tauri::generate_handler![
            download_video,
            list_formats,
            get_download_progress,
            cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_download_progress(state: State<DownloadState>) -> DownloadProgress {
    state.progress.lock().unwrap().clone()
}

#[tauri::command]
fn cancel_download() -> Result<(), String> {
  
    Ok(())
}