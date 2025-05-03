use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::fs;
use tauri::{AppHandle, Emitter};
use dirs;

pub struct DownloadState {
    pub progress: Mutex<DownloadProgress>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub percentage: f32,
    pub speed: String,
    pub eta: String,
    pub filename: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub url: String,
    pub format: String,
    pub quality: Option<String>,
    pub output_dir: Option<String>,
}

async fn get_ytdlp_path() -> Result<String, String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("where")
            .arg("yt-dlp")
            .output()
    } else {
        Command::new("which")
            .arg("yt-dlp")
            .output()
    };
    
    match output {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                println!("Found existing yt-dlp at: {}", path);
                return Ok(path);
            }
        },
        _ => {
            println!("yt-dlp not found in system PATH, will use local copy");
        }
    }
    
    let app_data_dir = dirs::data_local_dir()
        .ok_or_else(|| "Could not find local data directory".to_string())?;
    let ytdlp_dir = app_data_dir.join("ytdlp");
    
    if !ytdlp_dir.exists() {
        println!("Creating ytdlp directory at: {:?}", ytdlp_dir);
        fs::create_dir_all(&ytdlp_dir)
            .map_err(|e| format!("Failed to create ytdlp directory: {}", e))?;
    }
    
    let ytdlp_path = ytdlp_dir.join(if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" });
    
    if !ytdlp_path.exists() {
        println!("yt-dlp not found at {:?}, downloading it now", ytdlp_path);
        download_ytdlp(&ytdlp_path).await?;
    } else {
        println!("Found existing local yt-dlp at: {:?}", ytdlp_path);
    }
    
    Ok(ytdlp_path.to_string_lossy().to_string())
}

async fn download_ytdlp(path: &Path) -> Result<(), String> {
    let url = match std::env::consts::OS {
        "windows" => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
        "macos" => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
        _ => "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };
    
    println!("Downloading yt-dlp from: {}", url);
    
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to download yt-dlp: HTTP status {}", response.status()));
    }
    
    let content = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response bytes: {}", e))?;
    
    println!("Downloaded {} bytes, saving to {:?}", content.len(), path);
    
    let mut file = fs::File::create(path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    file.write_all(&content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    if !cfg!(target_os = "windows") {
        println!("Setting executable permissions");
        Command::new("chmod")
            .args(&["+x", path.to_string_lossy().as_ref()])
            .output()
            .map_err(|e| format!("Failed to make yt-dlp executable: {}", e))?;
    }
    
    println!("yt-dlp successfully installed to {:?}", path);
    Ok(())
}

#[tauri::command]
pub async fn download_video(
    app_handle: AppHandle,
    state: tauri::State<'_, DownloadState>,
    options: DownloadOptions,
) -> Result<String, String> {
    println!("Starting download process");
    
    let ytdlp_path = get_ytdlp_path().await?;
    println!("Using yt-dlp from: {}", ytdlp_path);
    
    let output_dir = match &options.output_dir {
        Some(dir) => {
            println!("Using custom output directory: {}", dir);
            PathBuf::from(dir)
        },
        None => {
            println!("No output directory provided, using downloads directory");
            let downloads_dir = dirs::download_dir()
                .ok_or_else(|| "Could not find downloads directory".to_string())?;
            downloads_dir
        }
    };

    println!("Output directory: {:?}", output_dir);
    if !output_dir.exists() {
        println!("Creating output directory");
        std::fs::create_dir_all(&output_dir)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }
    
    let format_arg = match options.format.as_str() {
        "mp3" => {
            let quality = match options.quality.as_deref() {
                Some("best") => "0",
                Some("normal") => "5",
                Some("custom") => "3",
                _ => "5", 
            };
            
            format!("--extract-audio --audio-format mp3 --audio-quality {}", quality)
        },
        _ => {
            match options.quality.as_deref() {
                Some("best") => "-f \"bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]\"".to_string(),
                Some("normal") => "-f \"bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]\"".to_string(),
                Some("custom") => "-f \"bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]\"".to_string(),
                _ => "-f \"bv*+ba/b\"".to_string(),
            }
        }
    };

    let output_template = output_dir.join("%(title)s-%(upload_date)s.%(ext)s").to_string_lossy().to_string();
    println!("Output template: {}", output_template);

    let mut cmd_args = Vec::new();
    
    cmd_args.push(options.url.clone());

    for arg in format_arg.split_whitespace() {
        if arg.starts_with("\"") && arg.ends_with("\"") {
            cmd_args.push(arg[1..arg.len()-1].to_string());
        } else {
            cmd_args.push(arg.to_string());
        }
    }
    
    cmd_args.push("--output".to_string());
    cmd_args.push(output_template);

    cmd_args.push("--newline".to_string());
    cmd_args.push("--progress".to_string());
    cmd_args.push("--force-overwrites".to_string());
    
    println!("Executing: {} {}", ytdlp_path, cmd_args.join(" "));
    let mut yt_dlp_process = match Command::new(&ytdlp_path)
        .args(&cmd_args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn() {
            Ok(process) => process,
            Err(e) => return Err(format!("Failed to start yt-dlp: {}", e)),
        };

    let stdout = yt_dlp_process.stdout.take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    
    let reader = BufReader::new(stdout);
    
    for line in reader.lines() {
        if let Ok(line) = line {
            println!("yt-dlp output: {}", line);
            
            if line.contains("[download]") {
                parse_progress(&line, &state, &app_handle);
            } else if line.contains("Destination:") {
                parse_filename(&line, &state, &app_handle);
            }
        }
    }

    match yt_dlp_process.wait() {
        Ok(status) if status.success() => Ok("Download completed successfully!".to_string()),
        Ok(status) => Err(format!("yt-dlp process failed with status: {}", status)),
        Err(e) => Err(format!("Failed to wait for yt-dlp process: {}", e)),
    }
}

fn parse_progress(line: &str, state: &tauri::State<DownloadState>, app_handle: &AppHandle) {
    if let Some(percent_str) = line.find('%').and_then(|i| {
        if i > 1 {
            line[..i].rfind(' ').map(|j| &line[j+1..i])
        } else {
            None
        }
    }) {
        if let Ok(percentage) = percent_str.parse::<f32>() {
            let mut progress = state.progress.lock().unwrap();
            progress.percentage = percentage;
            
            if let Some(speed_str) = line.find("at ").and_then(|i| {
                line[i+3..].find('/').map(|j| &line[i+3..i+3+j])
            }) {
                progress.speed = speed_str.trim().to_string();
            }
            
            if let Some(eta_str) = line.find("ETA ").and_then(|i| {
                line[i+4..].find(']').map(|j| &line[i+4..i+4+j])
            }) {
                progress.eta = eta_str.trim().to_string();
            }

            let _ = app_handle.emit("download-progress", &*progress);
        }
    }
}

fn parse_filename(line: &str, state: &tauri::State<DownloadState>, app_handle: &AppHandle) {
    if let Some(filename_str) = line.find("Destination:").map(|i| &line[i+12..]) {
        let mut progress = state.progress.lock().unwrap();
        progress.filename = filename_str.trim().to_string();
        
        let _ = app_handle.emit("download-progress", &*progress);
    }
}

#[tauri::command]
pub async fn list_formats(url: String) -> Result<String, String> {
    let ytdlp_path = get_ytdlp_path().await?;
    println!("Listing formats using yt-dlp from: {}", ytdlp_path);
    
    let output = Command::new(&ytdlp_path)
        .args(&["--list-formats", &url])
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;
    
    if output.status.success() {
        let formats = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(formats)
    } else {
        Err(format!("yt-dlp exited with status: {}", output.status))
    }
}