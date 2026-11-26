use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionState {
    pub active: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub source_app: String,
    pub is_playing: bool,
    pub is_shuffle: bool,
    pub repeat_mode: String, // "none" | "track" | "list"
    pub position_seconds: f64,
    pub duration_seconds: f64,
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn keybd_event(bVk: u8, bScan: u8, dwFlags: u32, dwExtraInfo: usize);
}

#[cfg(target_os = "windows")]
const VK_MEDIA_NEXT_TRACK: u8 = 0xB0;
#[cfg(target_os = "windows")]
const VK_MEDIA_PREV_TRACK: u8 = 0xB1;
#[cfg(target_os = "windows")]
const VK_MEDIA_PLAY_PAUSE: u8 = 0xB3;
#[cfg(target_os = "windows")]
const KEYEVENTF_KEYUP: u32 = 0x0002;

#[cfg(target_os = "windows")]
fn find_preferred_session(
    manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
) -> Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    if let Ok(sessions) = manager.GetSessions() {
        let count = sessions.Size().unwrap_or(0);
        // Prefer Apple Music desktop session when present
        for i in 0..count {
            if let Ok(session) = sessions.GetAt(i) {
                let app_id = session
                    .SourceAppUserModelId()
                    .map(|s| s.to_string().to_lowercase())
                    .unwrap_or_default();
                if app_id.contains("applemusic")
                    || app_id.contains("appleinc")
                    || app_id.contains("itunes")
                {
                    return Some(session);
                }
            }
        }
        // Next prefer whichever session is currently playing
        for i in 0..count {
            if let Ok(session) = sessions.GetAt(i) {
                if let Ok(info) = session.GetPlaybackInfo() {
                    if let Ok(status) = info.PlaybackStatus() {
                        if status == windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                            return Some(session);
                        }
                    }
                }
            }
        }
    }
    manager.GetCurrentSession().ok()
}

pub fn get_windows_media_state() -> MediaSessionState {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };

        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .and_then(|op| op.join())
        {
            Ok(m) => m,
            Err(_) => return MediaSessionState::default(),
        };

        let Some(session) = find_preferred_session(&manager) else {
            return MediaSessionState::default();
        };

        let source_app = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();

        let playback_info = session.GetPlaybackInfo().ok();
        let is_playing = playback_info
            .as_ref()
            .and_then(|info| info.PlaybackStatus().ok())
            .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
            .unwrap_or(false);

        let is_shuffle = playback_info
            .as_ref()
            .and_then(|info| info.IsShuffleActive().ok())
            .and_then(|v| v.Value().ok())
            .unwrap_or(false);

        let repeat_mode = playback_info
            .as_ref()
            .and_then(|info| info.AutoRepeatMode().ok())
            .and_then(|v| v.Value().ok())
            .map(|mode| {
                use windows::Media::MediaPlaybackAutoRepeatMode;
                if mode == MediaPlaybackAutoRepeatMode::Track {
                    "track".to_string()
                } else if mode == MediaPlaybackAutoRepeatMode::List {
                    "list".to_string()
                } else {
                    "none".to_string()
                }
            })
            .unwrap_or_else(|| "none".to_string());

        let (title, artist, album) = match session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.join())
        {
            Ok(props) => (
                props.Title().map(|s| s.to_string()).unwrap_or_default(),
                props.Artist().map(|s| s.to_string()).unwrap_or_default(),
                props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
            ),
            Err(_) => (String::new(), String::new(), String::new()),
        };

        if title.trim().is_empty() && artist.trim().is_empty() {
            return MediaSessionState::default();
        }

        let (position_seconds, duration_seconds) = match session.GetTimelineProperties() {
            Ok(tl) => {
                // WinRT TimeSpan Duration is in 100-nanosecond ticks
                let pos = tl
                    .Position()
                    .map(|ts| (ts.Duration as f64) / 10_000_000.0)
                    .unwrap_or(0.0);
                let end = tl
                    .EndTime()
                    .map(|ts| (ts.Duration as f64) / 10_000_000.0)
                    .unwrap_or(0.0);
                (pos.max(0.0), end.max(0.0))
            }
            Err(_) => (0.0, 0.0),
        };

        MediaSessionState {
            active: true,
            title,
            artist,
            album,
            source_app,
            is_playing,
            is_shuffle,
            repeat_mode,
            position_seconds,
            duration_seconds,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        MediaSessionState::default()
    }
}

pub fn send_windows_media_action(action: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

        // Try direct SMTC session control first (works cleanly with Apple Music desktop app)
        if let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .and_then(|op| op.join())
        {
            if let Some(session) = find_preferred_session(&manager) {
                if let Some(secs_str) = action.strip_prefix("seek:") {
                    if let Ok(secs) = secs_str.parse::<f64>() {
                        let ticks = (secs.max(0.0) * 10_000_000.0) as i64;
                        let _ = session
                            .TryChangePlaybackPositionAsync(ticks)
                            .and_then(|op| op.join());
                        return Ok(format!("Seeked playback to {secs:.1}s"));
                    }
                }

                let res = match action {
                    "play_pause" => session.TryTogglePlayPauseAsync().and_then(|op| op.join()),
                    "next" => session.TrySkipNextAsync().and_then(|op| op.join()),
                    "previous" => session.TrySkipPreviousAsync().and_then(|op| op.join()),
                    "toggle_shuffle" => {
                        let currently_shuffle = session
                            .GetPlaybackInfo()
                            .ok()
                            .and_then(|info| info.IsShuffleActive().ok())
                            .and_then(|v| v.Value().ok())
                            .unwrap_or(false);
                        session
                            .TryChangeShuffleActiveAsync(!currently_shuffle)
                            .and_then(|op| op.join())
                    }
                    "cycle_repeat" => {
                        use windows::Media::MediaPlaybackAutoRepeatMode;
                        let current = session
                            .GetPlaybackInfo()
                            .ok()
                            .and_then(|info| info.AutoRepeatMode().ok())
                            .and_then(|v| v.Value().ok())
                            .unwrap_or(MediaPlaybackAutoRepeatMode::None);
                        let next_mode = if current == MediaPlaybackAutoRepeatMode::None {
                            MediaPlaybackAutoRepeatMode::List
                        } else if current == MediaPlaybackAutoRepeatMode::List {
                            MediaPlaybackAutoRepeatMode::Track
                        } else {
                            MediaPlaybackAutoRepeatMode::None
                        };
                        session
                            .TryChangeAutoRepeatModeAsync(next_mode)
                            .and_then(|op| op.join())
                    }
                    _ => return Err(format!("Unsupported media action: {action}")),
                };
                if res.is_ok() {
                    return Ok(format!("Dispatched SMTC action: {action}"));
                }
            }
        }

        if action == "toggle_shuffle" || action == "cycle_repeat" || action.starts_with("seek:") {
            return Ok(format!("No active SMTC session for {action}"));
        }

        // Fallback to global Windows media virtual keys
        let vk = match action {
            "play_pause" => VK_MEDIA_PLAY_PAUSE,
            "next" => VK_MEDIA_NEXT_TRACK,
            "previous" => VK_MEDIA_PREV_TRACK,
            _ => return Err(format!("Unsupported media action: {action}")),
        };
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }
        Ok(format!("Dispatched Windows media key: {action}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(format!("Simulated media action on non-Windows host: {action}"))
    }
}

pub fn launch_apple_music_app() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Check if Apple Music Store package is installed before launching UWP app
        let installed = Command::new("powershell")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "if (Get-AppxPackage -Name 'AppleInc.AppleMusicWin' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if installed {
            if Command::new("explorer.exe")
                .arg(r"shell:AppsFolder\AppleInc.AppleMusicWin_nzyj5cx40ttqa!App")
                .spawn()
                .is_ok()
            {
                return Ok("Launched Apple Music".to_string());
            }
        }

        // Graceful fallback to web player when desktop app isn't installed
        open_external_url_native("https://music.apple.com")?;
        Ok("Opened Apple Music in browser".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_external_url_native("https://music.apple.com")
    }
}

pub fn launch_spotify_app() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::path::PathBuf;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 1. Standard desktop installer path
        if let Ok(appdata) = std::env::var("APPDATA") {
            let exe = PathBuf::from(appdata).join("Spotify").join("Spotify.exe");
            if exe.exists() && Command::new(&exe).spawn().is_ok() {
                return Ok("Launched Spotify".to_string());
            }
        }

        // 2. Microsoft Store Spotify package
        let store_installed = Command::new("powershell")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "if (Get-AppxPackage -Name 'SpotifyAB.SpotifyMusic' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if store_installed {
            if Command::new("explorer.exe")
                .arg(r"shell:AppsFolder\SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")
                .spawn()
                .is_ok()
            {
                return Ok("Launched Spotify".to_string());
            }
        }

        // 3. Graceful fallback to Spotify Web Player when desktop app isn't installed
        open_external_url_native("https://open.spotify.com")?;
        Ok("Opened Spotify in browser".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        open_external_url_native("https://open.spotify.com")
    }
}

pub fn open_external_url_native(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let lower = trimmed.to_lowercase();
    if !(lower.starts_with("music://")
        || lower.starts_with("applemusic://")
        || lower.starts_with("spotify:")
        || lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:"))
    {
        return Err("Unsupported external URL scheme (use https://, http://, music://, spotify:, or mailto:)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Use rundll32 url.dll,FileProtocolHandler so URLs with query params (&, ?) open cleanly
        // in the user's default system browser without cmd.exe metacharacter parsing.
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|e| format!("Failed opening external URL: {e}"))?;
        Ok(format!("Launched {trimmed}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(format!("Simulated external URL launch: {trimmed}"))
    }
}
