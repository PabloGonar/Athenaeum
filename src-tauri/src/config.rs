use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_time_format() -> String {
    "12h".to_string()
}

fn default_day_rollover_hour() -> u32 {
    3
}

fn default_vault_path() -> String {
    crate::vault::default_vault_path()
}

fn default_books_folder_path() -> String {
    crate::library::default_books_folder_path()
}

fn default_ha_reading_light_entity() -> String {
    String::new()
}

fn default_ha_base_url() -> String {
    String::new()
}

fn default_ha_entity_id() -> String {
    String::new()
}

fn default_ha_auto_light() -> bool {
    false
}

fn default_preferred_music_player() -> String {
    "none".to_string()
}

fn default_daily_reading_target_pages() -> i64 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaLightPreset {
    pub name: String,
    pub mode: String, // "rgb" | "kelvin"
    pub rgb_color: [u8; 3],
    pub kelvin: u32,
    pub brightness_pct: u8, // 1..=100
}

fn default_ha_focus_preset() -> HaLightPreset {
    HaLightPreset {
        name: "Lock In".to_string(),
        mode: "rgb".to_string(),
        rgb_color: [128, 0, 255],
        kelvin: 2700,
        brightness_pct: 45,
    }
}

fn default_ha_non_focus_preset() -> HaLightPreset {
    HaLightPreset {
        name: "Warm White".to_string(),
        mode: "kelvin".to_string(),
        rgb_color: [255, 200, 140],
        kelvin: 2700,
        brightness_pct: 45,
    }
}

fn default_ha_reading_preset() -> HaLightPreset {
    HaLightPreset {
        name: "Reading Warm".to_string(),
        mode: "kelvin".to_string(),
        rgb_color: [255, 198, 132],
        kelvin: 2700,
        brightness_pct: 45,
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFeedConfig {
    pub id: String,
    pub label: String,
    pub url: String,
}

/// Generates a cryptographically random 32-byte (64 hex char) API bearer token via OS CSPRNG.
pub fn generate_secure_ingest_token() -> String {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        // Fallback only if OS entropy fails (never expected on Windows/Unix)
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((nanos >> ((i % 16) * 8)) as u8) ^ ((i as u8).wrapping_mul(37));
        }
    }
    let mut hex = String::with_capacity(64);
    for b in buf {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistShortcut {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub url: String,
    #[serde(default)]
    pub platform: Option<String>, // "apple_music" | "youtube" | "spotify"
}

const LEGACY_BROKEN_URLS: &[&str] = &[
    "https://music.apple.com/us/station/lo-fi-chill/ra.1500918786",
    "https://music.apple.com/us/station/jazz/ra.985484166",
    "https://music.apple.com/us/station/salsa/ra.1128588743",
    "https://music.apple.com/us/station/italian-classics/ra.1489397731",
    "https://music.apple.com/us/station/holiday/ra.1059954614",
];

fn default_playlists() -> Vec<PlaylistShortcut> {
    Vec::new()
}

fn default_quick_capture_shortcut() -> String {
    "Alt+Space".to_string()
}

fn default_auto_weekly_synthesis() -> bool {
    true
}

fn default_activity_tracker_path() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteItem {
    pub text: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AthenaeumConfig {
    pub user_name: String,
    #[serde(default = "default_time_format")]
    pub time_format: String, // "12h" | "24h"
    #[serde(default = "default_day_rollover_hour")]
    pub day_rollover_hour: u32,
    #[serde(default = "default_vault_path")]
    pub vault_path: String,
    #[serde(default = "default_books_folder_path")]
    pub books_folder_path: String,
    pub upper_background_path: String,
    pub lower_background_path: String,
    pub quotes: Vec<QuoteItem>,
    pub home_assistant_webhook_url: String,
    pub home_assistant_token: String,
    pub home_assistant_focus_entity: String,
    #[serde(default = "default_ha_base_url")]
    pub ha_base_url: String,
    #[serde(default)]
    pub ha_token: String,
    #[serde(default = "default_ha_entity_id")]
    pub ha_entity_id: String,
    #[serde(default = "default_ha_focus_preset")]
    pub ha_focus_preset: HaLightPreset,
    #[serde(default = "default_ha_non_focus_preset")]
    pub ha_non_focus_preset: HaLightPreset,
    #[serde(default = "default_ha_reading_preset")]
    pub ha_reading_preset: HaLightPreset,
    #[serde(default = "default_ha_auto_light")]
    pub ha_auto_light: bool,
    #[serde(default = "default_playlists")]
    pub playlists: Vec<PlaylistShortcut>,
    #[serde(default)]
    pub ha_reading_webhook_url: String,
    #[serde(default = "default_ha_reading_light_entity")]
    pub ha_reading_light_entity: String,
    pub n8n_webhook_url: String,
    #[serde(default = "default_true")]
    pub n8n_trigger_weekly_synthesis: bool,
    #[serde(default = "default_true")]
    pub n8n_trigger_daily_debrief: bool,
    #[serde(default)]
    pub n8n_trigger_goal_completed: bool,
    #[serde(default = "default_true")]
    pub ingest_enabled: bool,
    #[serde(default)]
    pub ingest_bind_lan: bool,
    #[serde(default)]
    pub ingest_api_token: String,
    pub audio_bridge_url: String,
    #[serde(default = "default_activity_tracker_path")]
    pub activity_tracker_path: String,
    #[serde(default)]
    pub calendar_ics_urls: Vec<String>,
    #[serde(default)]
    pub calendar_feeds: Vec<CalendarFeedConfig>,
    #[serde(default)]
    pub calendar_last_synced_at: Option<String>,
    #[serde(default = "default_quick_capture_shortcut")]
    pub quick_capture_shortcut: String,
    #[serde(default = "default_auto_weekly_synthesis")]
    pub auto_weekly_synthesis: bool,
    #[serde(default)]
    pub launch_on_startup: bool,
    pub focus_dim_opacity: f32,
    pub daily_focus_target_minutes: i64,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default = "default_preferred_music_player")]
    pub preferred_music_player: String, // "apple_music" | "spotify" | "none"
    #[serde(default)]
    pub daily_reading_habit_enabled: bool,
    #[serde(default = "default_daily_reading_target_pages")]
    pub daily_reading_target_pages: i64,
    #[serde(default)]
    pub external_db_url: String,
}

fn default_quotes() -> Vec<QuoteItem> {
    vec![
        QuoteItem {
            text: "We suffer more often in imagination than in reality.".to_string(),
            author: "Seneca".to_string(),
        },
        QuoteItem {
            text: "It is not the accumulation of knowledge that matters, but the ability to apply it to new and changing circumstances.".to_string(),
            author: "Lee Kuan Yew".to_string(),
        },
        QuoteItem {
            text: "How we spend our days is, of course, how we spend our lives.".to_string(),
            author: "Annie Dillard".to_string(),
        },
        QuoteItem {
            text: "Order and simplification are the first steps toward mastery of a subject.".to_string(),
            author: "Thomas Mann".to_string(),
        },
        QuoteItem {
            text: "First say to yourself what you would be; then do what you have to do.".to_string(),
            author: "Epictetus".to_string(),
        },
    ]
}

impl Default for AthenaeumConfig {
    fn default() -> Self {
        Self {
            user_name: String::new(),
            time_format: default_time_format(),
            day_rollover_hour: default_day_rollover_hour(),
            vault_path: default_vault_path(),
            books_folder_path: default_books_folder_path(),
            upper_background_path: "/backgrounds/top-main.webp".to_string(),
            lower_background_path: "/backgrounds/bottom.webp".to_string(),
            quotes: default_quotes(),
            home_assistant_webhook_url: String::new(),
            home_assistant_token: String::new(),
            home_assistant_focus_entity: String::new(),
            ha_base_url: String::new(),
            ha_token: String::new(),
            ha_entity_id: String::new(),
            ha_focus_preset: default_ha_focus_preset(),
            ha_non_focus_preset: default_ha_non_focus_preset(),
            ha_reading_preset: default_ha_reading_preset(),
            ha_auto_light: false,
            playlists: Vec::new(),
            ha_reading_webhook_url: String::new(),
            ha_reading_light_entity: String::new(),
            n8n_webhook_url: String::new(),
            n8n_trigger_weekly_synthesis: true,
            n8n_trigger_daily_debrief: true,
            n8n_trigger_goal_completed: false,
            ingest_enabled: false,
            ingest_bind_lan: false,
            ingest_api_token: generate_secure_ingest_token(),
            audio_bridge_url: String::new(),
            activity_tracker_path: String::new(),
            calendar_ics_urls: Vec::new(),
            calendar_feeds: Vec::new(),
            calendar_last_synced_at: None,
            quick_capture_shortcut: default_quick_capture_shortcut(),
            auto_weekly_synthesis: default_auto_weekly_synthesis(),
            launch_on_startup: false,
            focus_dim_opacity: 0.35,
            daily_focus_target_minutes: 240,
            onboarding_completed: false,
            preferred_music_player: default_preferred_music_player(),
            daily_reading_habit_enabled: false,
            daily_reading_target_pages: default_daily_reading_target_pages(),
            external_db_url: String::new(),
        }
    }
}

pub fn load_or_init_config(config_path: &PathBuf) -> Result<AthenaeumConfig, String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating config dir: {e}"))?;
    }

    if !config_path.exists() {
        let defaults = AthenaeumConfig::default();
        save_config_file(config_path, &defaults)?;
        return Ok(defaults);
    }

    let raw = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed reading config.json: {e}"))?;
    match serde_json::from_str::<AthenaeumConfig>(&raw) {
        Ok(mut cfg) => {
            if cfg.time_format != "12h" && cfg.time_format != "24h" {
                cfg.time_format = default_time_format();
            }
            if cfg.day_rollover_hour > 12 {
                cfg.day_rollover_hour = default_day_rollover_hour();
            }
            if cfg.vault_path.trim().is_empty() {
                cfg.vault_path = default_vault_path();
            }
            if cfg.preferred_music_player != "apple_music"
                && cfg.preferred_music_player != "spotify"
                && cfg.preferred_music_player != "none"
            {
                cfg.preferred_music_player = default_preferred_music_player();
            }
            cfg.daily_reading_target_pages = cfg.daily_reading_target_pages.clamp(1, 500);
            cfg.ha_focus_preset.brightness_pct = cfg.ha_focus_preset.brightness_pct.clamp(1, 100);
            cfg.ha_non_focus_preset.brightness_pct =
                cfg.ha_non_focus_preset.brightness_pct.clamp(1, 100);
            cfg.ha_reading_preset.brightness_pct =
                cfg.ha_reading_preset.brightness_pct.clamp(1, 100);
            let mut needs_persist = false;
            for q in &mut cfg.quotes {
                if q.author.trim().eq_ignore_ascii_case("Athenaeum Notebook")
                    || q.text
                        .trim()
                        .eq_ignore_ascii_case("Stillness is where clarity gathers before action begins.")
                {
                    q.text = "It is not the accumulation of knowledge that matters, but the ability to apply it to new and changing circumstances.".to_string();
                    q.author = "Lee Kuan Yew".to_string();
                    needs_persist = true;
                }
            }
            for pl in &mut cfg.playlists {
                if LEGACY_BROKEN_URLS.iter().any(|u| u.eq_ignore_ascii_case(pl.url.trim())) {
                    pl.url.clear();
                    needs_persist = true;
                }
            }
            if cfg.ingest_api_token.trim().is_empty() {
                cfg.ingest_api_token = generate_secure_ingest_token();
                needs_persist = true;
            }
            if cfg.calendar_feeds.is_empty() && !cfg.calendar_ics_urls.is_empty() {
                cfg.calendar_feeds = cfg
                    .calendar_ics_urls
                    .iter()
                    .enumerate()
                    .map(|(idx, url)| CalendarFeedConfig {
                        id: format!("cal-{}", idx + 1),
                        label: format!("Calendar {}", idx + 1),
                        url: url.clone(),
                    })
                    .collect();
                needs_persist = true;
            }
            let _ = crate::vault::ensure_vault_structure(&cfg.vault_path);
            if needs_persist {
                let _ = save_config_file(config_path, &cfg);
            }
            Ok(cfg)
        }
        Err(_) => {
            let defaults = AthenaeumConfig::default();
            save_config_file(config_path, &defaults)?;
            Ok(defaults)
        }
    }
}

pub fn save_config_file(config_path: &PathBuf, config: &AthenaeumConfig) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating config dir: {e}"))?;
    }
    let formatted = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed serializing config.json: {e}"))?;
    fs::write(config_path, formatted).map_err(|e| format!("Failed writing config.json: {e}"))
}
