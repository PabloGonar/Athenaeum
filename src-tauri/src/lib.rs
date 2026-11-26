mod commands;
mod config;
mod db;
mod ics;
mod importer;
mod ingest;
mod library;
mod logical_date;
mod media;
mod recall;
mod vault;
mod weekly;

use commands::AppState;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

fn toggle_quick_capture_window(app: &tauri::AppHandle) {
    if let Some(qc) = app.get_webview_window("quick-capture") {
        if qc.is_visible().unwrap_or(false) {
            let _ = qc.hide();
        } else {
            let _ = qc.center();
            let _ = qc.show();
            let _ = qc.set_focus();
            let _ = qc.emit("athenaeum:quick-capture-opened", ());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_athenaeum_core_tables",
        sql: "
            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                title TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 30,
                completed INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL DEFAULT 'medium',
                due_date TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sticky_notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                collapsed INTEGER NOT NULL DEFAULT 0,
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS focus_sessions (
                id TEXT PRIMARY KEY,
                mode TEXT NOT NULL,
                target_minutes INTEGER,
                elapsed_seconds INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT 'Deep Work'
            );
            CREATE TABLE IF NOT EXISTS daily_activity (
                date TEXT PRIMARY KEY,
                focus_minutes INTEGER NOT NULL DEFAULT 0,
                goals_completed INTEGER NOT NULL DEFAULT 0
            );
        ",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_capture_window(app);
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:athenaeum_plugin.db", migrations)
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Unable to resolve app_data_dir: {e}"))?;
            let app_config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("Unable to resolve app_config_dir: {e}"))?;

            let db_path = app_data_dir.join("athenaeum.db");
            let config_path = app_config_dir.join("config.json");

            let cfg = config::load_or_init_config(&config_path)?;
            let conn = db::init_database(&db_path)?;
            importer::backfill_historical_completions_if_needed(&conn, &cfg.activity_tracker_path);
            let shared_db = Arc::new(Mutex::new(conn));

            let ingest_handle = if cfg.ingest_enabled {
                let notify_app = app.handle().clone();
                let on_update: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                    let _ = notify_app.emit("athenaeum:data-updated", ());
                });
                ingest::start_ingest_server(
                    Arc::clone(&shared_db),
                    config_path.clone(),
                    Some(on_update),
                    cfg.ingest_bind_lan,
                )
            } else {
                ingest::IngestServerHandle::inactive(cfg.ingest_bind_lan)
            };

            app.manage(AppState {
                db: shared_db,
                config_path,
                ingest_server: Mutex::new(ingest_handle),
            });

            // Register global Quick-Capture shortcuts (configured default Alt+Space + Ctrl+Shift+A fallback)
            let primary_shortcut = if cfg.quick_capture_shortcut.trim().is_empty() {
                "Alt+Space".to_string()
            } else {
                cfg.quick_capture_shortcut.trim().to_string()
            };
            let _ = app.global_shortcut().register(primary_shortcut.as_str());
            if !primary_shortcut.eq_ignore_ascii_case("Ctrl+Shift+A") {
                let _ = app.global_shortcut().register("Ctrl+Shift+A");
            }

            // System tray setup for Windows 11 quick show/hide
            let show_i = MenuItem::with_id(app, "show", "Show Athenaeum", true, None::<&str>)?;
            let qc_i = MenuItem::with_id(app, "quick_capture", "Quick Capture (Alt+Space)", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Athenaeum", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &qc_i, &hide_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Athenaeum")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quick_capture" => {
                        toggle_quick_capture_window(app);
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_briefing_dismissed_date,
            commands::set_briefing_dismissed_date,
            commands::list_goals,
            commands::upsert_goal,
            commands::delete_goal,
            commands::reorder_goals,
            commands::list_goal_milestones,
            commands::upsert_goal_milestone,
            commands::delete_goal_milestone,
            commands::reorder_goal_milestones,
            commands::list_goal_completions,
            commands::list_completed_tasks_by_date,
            commands::list_notes,
            commands::upsert_note,
            commands::delete_note,
            commands::log_focus_session,
            commands::list_focus_sessions,
            commands::get_heatmap_60_days,
            commands::get_analytics_dataset,
            commands::regenerate_ingest_token,
            commands::get_ingest_server_status,
            commands::send_n8n_event,
            commands::list_device_telemetry,
            commands::upsert_device_telemetry,
            commands::get_recall_deck,
            commands::review_recall_card,
            commands::open_vault_file,
            commands::list_schedule_blocks,
            commands::upsert_schedule_block,
            commands::delete_schedule_block,
            commands::list_recurring_focus_blocks,
            commands::upsert_recurring_focus_block,
            commands::delete_recurring_focus_block,
            commands::list_recurring_block_overrides,
            commands::upsert_recurring_block_override,
            commands::delete_recurring_block_override,
            commands::list_journal_entries,
            commands::upsert_journal_entry,
            commands::list_library_books,
            commands::upsert_library_book,
            commands::save_book_cover_thumbnail,
            commands::scan_books_folder,
            commands::pick_books_folder,
            commands::pick_and_add_book,
            commands::read_book_file,
            commands::read_book_file_base64,
            commands::read_book_bytes,
            commands::update_book_progress,
            commands::get_daily_reading_progress,
            commands::record_reading_page,
            commands::list_book_highlights,
            commands::add_book_highlight,
            commands::delete_book_highlight,
            commands::trigger_reading_light_webhook,
            commands::list_toc_nodes,
            commands::upsert_toc_node,
            commands::list_toc_trees,
            commands::upsert_toc_tree,
            commands::delete_toc_tree,
            commands::trigger_ha_webhook,
            commands::set_ha_light_state,
            commands::open_external_url,
            commands::media_control,
            commands::get_media_state,
            commands::launch_apple_music,
            commands::launch_spotify,
            commands::get_default_local_notes_path,
            commands::list_activity_blocks_hourly,
            commands::upsert_activity_block_hourly,
            commands::delete_activity_block_hourly,
            commands::list_external_calendar_events,
            commands::sync_ics_calendars,
            commands::generate_weekly_synthesis,
            commands::check_auto_weekly_synthesis,
            commands::execute_quick_capture,
            commands::hide_quick_capture,
            commands::get_detected_activity_tracker_path,
            commands::import_activity_tracker,
            commands::pick_vault_folder,
            commands::promote_note_to_vault,
            commands::ensure_daily_debrief_goal,
            commands::get_daily_debrief,
            commands::save_daily_debrief_draft,
            commands::publish_daily_debrief,
            commands::list_daily_debrief_archive,
            commands::read_daily_debrief_file,
            commands::list_reflections,
            commands::save_reflection,
            commands::delete_reflection,
            commands::list_vault_index,
            commands::search_vault_notes,
            commands::find_vault_backlinks,
            commands::save_vault_note_body
        ])
        .run(tauri::generate_context!())
        .expect("error while running Athenaeum");
}
