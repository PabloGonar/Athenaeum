use crate::config::{
    generate_secure_ingest_token, load_or_init_config, save_config_file, AthenaeumConfig,
};
use crate::db::{
    compute_heatmap_level, ActivityBlockHourly, BookHighlight, DailyDebriefRecord,
    DailyReadingProgress, DeviceTelemetryRecord, ExternalCalendarEvent, FocusSessionItem,
    GoalCompletionLog, GoalItem, GoalMilestone, HeatmapDay, JournalEntry, LibraryBook,
    RecallReviewLog, RecurringBlockOverride, RecurringFocusBlock, ScheduleBlock, StickyNoteItem,
    TocNode, TocTreeRecord,
};
use crate::ics::{fetch_feed_text, parse_ics_content, store_synced_events, sync_window_dates, IcsSyncReport};
use crate::importer::{detect_activity_tracker_path, import_from_path, ImportReport};
use crate::ingest::{start_ingest_server, IngestServerHandle, IngestServerStatus};
use crate::recall::{
    apply_sm2_review, get_recall_deck_state, open_vault_file_in_os, RecallDeckState,
    RecallReviewResult,
};
use crate::library::{
    get_daily_reading_progress as lib_get_daily_reading_progress, import_external_book,
    list_all_books, pick_book_file_dialog, record_reading_page as lib_record_reading_page,
    scan_books_directory,
};
use crate::logical_date::{
    current_logical_date, current_logical_naive_date, current_logical_week_start,
    logical_hour_slot_index_for,
};
use crate::media::{
    get_windows_media_state, launch_apple_music_app, launch_spotify_app, send_windows_media_action,
    MediaSessionState,
};
use crate::vault::{
    append_book_note_to_vault, delete_reflection as vault_delete_reflection,
    ensure_vault_structure, find_vault_backlinks as vault_find_backlinks, index_vault_notes,
    list_daily_debrief_dates, list_reflections as vault_list_reflections, pick_folder_dialog,
    promote_note_to_inbox, read_daily_debrief_markdown, save_reflection as vault_save_reflection,
    save_vault_note_body as vault_save_note_body, search_vault_notes as vault_search_notes,
    write_daily_debrief_markdown, write_toc_tree_markdown, BacklinkMention, DailyDebriefPayload,
    ReflectionSaveInput, VaultFileEntry, VaultIndexedNote, VaultSearchResult,
};
use crate::weekly::{
    build_weekly_synthesis_for_end_date_sync, build_weekly_synthesis_sync,
    dispatch_n8n_weekly_digest, WeeklySynthesisReport,
};
use chrono::{DateTime, Datelike, Duration, Local, Timelike, Weekday};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub config_path: PathBuf,
    pub ingest_server: Mutex<IngestServerHandle>,
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AthenaeumConfig, String> {
    load_or_init_config(&state.config_path)
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut config: AthenaeumConfig,
) -> Result<AthenaeumConfig, String> {
    let prev = load_or_init_config(&state.config_path).ok();
    config.ha_focus_preset.brightness_pct = config.ha_focus_preset.brightness_pct.clamp(1, 100);
    config.ha_non_focus_preset.brightness_pct =
        config.ha_non_focus_preset.brightness_pct.clamp(1, 100);
    config.ha_reading_preset.brightness_pct =
        config.ha_reading_preset.brightness_pct.clamp(1, 100);

    if config.ingest_api_token.trim().is_empty() {
        config.ingest_api_token = prev
            .as_ref()
            .map(|p| p.ingest_api_token.clone())
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(generate_secure_ingest_token);
    }

    // Keep calendar_ics_urls and calendar_feeds cleanly synchronized
    if !config.calendar_feeds.is_empty() {
        config.calendar_ics_urls = config
            .calendar_feeds
            .iter()
            .map(|f| f.url.trim().to_string())
            .filter(|u| !u.is_empty())
            .collect();
    }

    let _ = ensure_vault_structure(&config.vault_path);
    save_config_file(&state.config_path, &config)?;

    // Restart local ingest server live if enable/LAN binding changed
    let prev_enabled = prev.as_ref().map(|p| p.ingest_enabled).unwrap_or(true);
    let prev_lan = prev.as_ref().map(|p| p.ingest_bind_lan).unwrap_or(false);
    if prev_enabled != config.ingest_enabled || prev_lan != config.ingest_bind_lan {
        if let Ok(mut guard) = state.ingest_server.lock() {
            guard.stop();
            if config.ingest_enabled {
                let notify_app = app.clone();
                let on_update: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                    let _ = notify_app.emit("athenaeum:data-updated", ());
                });
                *guard = start_ingest_server(
                    Arc::clone(&state.db),
                    state.config_path.clone(),
                    Some(on_update),
                    config.ingest_bind_lan,
                );
            } else {
                *guard = IngestServerHandle::inactive(config.ingest_bind_lan);
            }
        }
    }

    Ok(config)
}

#[tauri::command]
pub fn get_briefing_dismissed_date(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let res: Result<String, _> = conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'briefing_dismissed_date'",
        [],
        |r| r.get(0),
    );
    Ok(res.ok())
}

#[tauri::command]
pub fn set_briefing_dismissed_date(state: State<'_, AppState>, date: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('briefing_dismissed_date', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![date],
    )
    .map_err(|e| format!("Failed saving briefing state: {e}"))?;
    Ok(())
}

#[tauri::command]
fn normalize_recurrence(recurrence: &str, scope: &str) -> String {
    match recurrence.trim() {
        "once" | "daily" | "weekly" | "specific_days" | "long_term" => recurrence.trim().to_string(),
        _ => match scope {
            "weekly" => "weekly".to_string(),
            "longTerm" => "long_term".to_string(),
            _ => "daily".to_string(),
        },
    }
}

fn scope_for_recurrence(recurrence: &str, fallback_scope: &str) -> String {
    match recurrence {
        "weekly" => "weekly".to_string(),
        "long_term" => "longTerm".to_string(),
        "once" | "daily" | "specific_days" => "daily".to_string(),
        _ => fallback_scope.to_string(),
    }
}

fn parse_specific_days_csv(raw: &str) -> Vec<i64> {
    raw.split(',')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .filter(|d| (0..=6).contains(d))
        .collect()
}

fn encode_specific_days_csv(days: &[i64]) -> String {
    let mut clean: Vec<i64> = days
        .iter()
        .copied()
        .filter(|d| (0..=6).contains(d))
        .collect();
    clean.sort();
    clean.dedup();
    clean
        .into_iter()
        .map(|d| d.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn period_key_for_goal(recurrence: &str, logical_today: &str, logical_week_start: &str) -> String {
    match recurrence {
        "weekly" => format!("week:{logical_week_start}"),
        "long_term" => "long_term".to_string(),
        _ => logical_today.to_string(),
    }
}

fn map_goal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GoalItem> {
    let scope: String = row.get(1)?;
    let completed = row.get::<_, i64>(4)? != 0;
    let raw_rec: String = row.get::<_, String>(11).unwrap_or_default();
    let recurrence = normalize_recurrence(&raw_rec, &scope);
    let raw_days: String = row.get::<_, String>(12).unwrap_or_default();
    let target_count = row.get::<_, i64>(13).unwrap_or(1).max(1);
    let raw_current = row.get::<_, i64>(14).unwrap_or(0).max(0);
    let current_count = if target_count == 1 && completed && raw_current == 0 {
        1
    } else {
        raw_current
    };

    Ok(GoalItem {
        id: row.get(0)?,
        scope,
        title: row.get(2)?,
        duration_minutes: row.get(3)?,
        completed,
        priority: row.get(5)?,
        due_date: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        description: row.get::<_, String>(9).unwrap_or_default(),
        category: row.get::<_, String>(10).unwrap_or_default(),
        recurrence,
        specific_days: parse_specific_days_csv(&raw_days),
        target_count,
        current_count,
        unit_label: row.get::<_, String>(15).unwrap_or_default(),
        last_reset_period: row.get::<_, String>(16).unwrap_or_default(),
    })
}

const GOAL_SELECT_COLS: &str = "id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at, description, category, recurrence, specific_days, target_count, current_count, unit_label, last_reset_period";

#[tauri::command]
pub fn list_goals(state: State<'_, AppState>) -> Result<Vec<GoalItem>, String> {
    let cutoff = load_or_init_config(&state.config_path)
        .map(|c| c.day_rollover_hour)
        .unwrap_or(3);
    let today_str = current_logical_date(cutoff);
    let week_start = current_logical_week_start(cutoff);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;

    // Automatic logical period rollover:
    // - Daily & Specific Days reset at 3:00 AM each new logical day
    // - Weekly goals reset every Monday at 3:00 AM
    // Legacy rows with empty last_reset_period are stamped without wiping today's state.
    let _ = conn.execute(
        "UPDATE goals
         SET completed = 0, current_count = 0, last_reset_period = ?1
         WHERE (recurrence IN ('daily', 'specific_days') OR (recurrence = '' AND scope = 'daily'))
           AND last_reset_period != ''
           AND last_reset_period != ?1",
        params![today_str],
    );
    let _ = conn.execute(
        "UPDATE goals
         SET last_reset_period = ?1
         WHERE (recurrence IN ('daily', 'specific_days') OR (recurrence = '' AND scope = 'daily'))
           AND last_reset_period = ''",
        params![today_str],
    );
    let _ = conn.execute(
        "UPDATE goals
         SET completed = 0, current_count = 0, last_reset_period = ?1
         WHERE (recurrence = 'weekly' OR (recurrence = '' AND scope = 'weekly'))
           AND last_reset_period != ''
           AND last_reset_period != ?1",
        params![week_start],
    );
    let _ = conn.execute(
        "UPDATE goals
         SET last_reset_period = ?1
         WHERE (recurrence = 'weekly' OR (recurrence = '' AND scope = 'weekly'))
           AND last_reset_period = ''",
        params![week_start],
    );

    let sql = format!(
        "SELECT {GOAL_SELECT_COLS} FROM goals ORDER BY scope ASC, sort_order ASC, created_at ASC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed querying goals: {e}"))?;

    let rows = stmt
        .query_map([], map_goal_row)
        .map_err(|e| format!("Failed mapping goals: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Row read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_goal(state: State<'_, AppState>, mut goal: GoalItem) -> Result<GoalItem, String> {
    let cutoff = load_or_init_config(&state.config_path)
        .map(|c| c.day_rollover_hour)
        .unwrap_or(3);
    let today_str = current_logical_date(cutoff);
    let week_start = current_logical_week_start(cutoff);
    let now_iso = Local::now().to_rfc3339();

    goal.recurrence = normalize_recurrence(&goal.recurrence, &goal.scope);
    goal.scope = scope_for_recurrence(&goal.recurrence, &goal.scope);
    goal.target_count = goal.target_count.max(1);
    goal.current_count = goal.current_count.max(0);

    if goal.target_count > 1 {
        goal.completed = goal.current_count >= goal.target_count;
    } else if goal.completed && goal.current_count == 0 {
        goal.current_count = 1;
    } else if !goal.completed {
        goal.current_count = 0;
    }

    if goal.last_reset_period.trim().is_empty() {
        goal.last_reset_period = match goal.recurrence.as_str() {
            "weekly" => week_start.clone(),
            "daily" | "specific_days" => today_str.clone(),
            _ => String::new(),
        };
    }

    let specific_days_csv = encode_specific_days_csv(&goal.specific_days);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO goals (
            id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at,
            description, category, recurrence, specific_days, target_count, current_count, unit_label, last_reset_period
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(id) DO UPDATE SET
            scope = excluded.scope,
            title = excluded.title,
            duration_minutes = excluded.duration_minutes,
            completed = excluded.completed,
            priority = excluded.priority,
            due_date = excluded.due_date,
            sort_order = excluded.sort_order,
            description = excluded.description,
            category = excluded.category,
            recurrence = excluded.recurrence,
            specific_days = excluded.specific_days,
            target_count = excluded.target_count,
            current_count = excluded.current_count,
            unit_label = excluded.unit_label,
            last_reset_period = excluded.last_reset_period",
        params![
            goal.id,
            goal.scope,
            goal.title,
            goal.duration_minutes,
            if goal.completed { 1 } else { 0 },
            goal.priority,
            goal.due_date,
            goal.sort_order,
            goal.created_at,
            goal.description,
            goal.category,
            goal.recurrence,
            specific_days_csv,
            goal.target_count,
            goal.current_count,
            goal.unit_label,
            goal.last_reset_period
        ],
    )
    .map_err(|e| format!("Failed upserting goal: {e}"))?;

    // Maintain timestamped goal_completions log cleanly for Analytics
    let period_key = period_key_for_goal(&goal.recurrence, &today_str, &week_start);
    if goal.completed {
        let log_id = format!("gc_{}_{}", goal.id, period_key);
        let logged_val = goal.current_count.max(1);
        let _ = conn.execute(
            "INSERT INTO goal_completions (id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                goal_title = excluded.goal_title,
                category = excluded.category,
                logged_value = excluded.logged_value,
                target_value = excluded.target_value,
                completed_at = excluded.completed_at",
            params![
                log_id,
                goal.id,
                goal.title,
                goal.category,
                today_str,
                period_key,
                logged_val,
                goal.target_count,
                now_iso
            ],
        );
    } else {
        let _ = conn.execute(
            "DELETE FROM goal_completions WHERE goal_id = ?1 AND period_key = ?2",
            params![goal.id, period_key],
        );
    }

    // Sync logical today's completed goals count in daily_activity
    let completed_daily: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE scope = 'daily' AND completed = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO daily_activity (date, focus_minutes, goals_completed) VALUES (?1, 0, ?2)
         ON CONFLICT(date) DO UPDATE SET goals_completed = ?2",
        params![today_str, completed_daily],
    )
    .map_err(|e| format!("Failed syncing daily activity goals: {e}"))?;

    Ok(goal)
}

#[tauri::command]
pub fn delete_goal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM goal_milestones WHERE goal_id = ?1", params![id])
        .map_err(|e| format!("Failed deleting child milestones: {e}"))?;
    conn.execute("DELETE FROM goals WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting goal: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn reorder_goals(state: State<'_, AppState>, ordered_ids: Vec<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE goals SET sort_order = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )
        .map_err(|e| format!("Failed reordering goals: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_goal_milestones(
    state: State<'_, AppState>,
    goal_id: Option<String>,
) -> Result<Vec<GoalMilestone>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut items = Vec::new();
    if let Some(gid) = goal_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, goal_id, title, completed, completed_at, sort_order, created_at
                 FROM goal_milestones WHERE goal_id = ?1 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|e| format!("Failed querying milestones: {e}"))?;
        let rows = stmt
            .query_map(params![gid], |row| {
                Ok(GoalMilestone {
                    id: row.get(0)?,
                    goal_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i64>(3)? != 0,
                    completed_at: row.get(4)?,
                    sort_order: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed mapping milestones: {e}"))?;
        for r in rows {
            items.push(r.map_err(|e| format!("Milestone read error: {e}"))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, goal_id, title, completed, completed_at, sort_order, created_at
                 FROM goal_milestones ORDER BY goal_id ASC, sort_order ASC, created_at ASC",
            )
            .map_err(|e| format!("Failed querying all milestones: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(GoalMilestone {
                    id: row.get(0)?,
                    goal_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i64>(3)? != 0,
                    completed_at: row.get(4)?,
                    sort_order: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed mapping all milestones: {e}"))?;
        for r in rows {
            items.push(r.map_err(|e| format!("Milestone read error: {e}"))?);
        }
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_goal_milestone(
    state: State<'_, AppState>,
    mut milestone: GoalMilestone,
) -> Result<GoalMilestone, String> {
    let cutoff = load_or_init_config(&state.config_path)
        .map(|c| c.day_rollover_hour)
        .unwrap_or(3);
    let today_str = current_logical_date(cutoff);
    let now_iso = Local::now().to_rfc3339();
    if milestone.completed && milestone.completed_at.is_none() {
        milestone.completed_at = Some(now_iso.clone());
    } else if !milestone.completed {
        milestone.completed_at = None;
    }

    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO goal_milestones (id, goal_id, title, completed, completed_at, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            completed = excluded.completed,
            completed_at = excluded.completed_at,
            sort_order = excluded.sort_order",
        params![
            milestone.id,
            milestone.goal_id,
            milestone.title,
            if milestone.completed { 1 } else { 0 },
            milestone.completed_at,
            milestone.sort_order,
            milestone.created_at
        ],
    )
    .map_err(|e| format!("Failed upserting milestone: {e}"))?;

    let period_key = format!("milestone:{}", milestone.id);
    if milestone.completed {
        let parent_cat: String = conn
            .query_row(
                "SELECT category FROM goals WHERE id = ?1",
                params![milestone.goal_id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        let log_id = format!("gc_ms_{}", milestone.id);
        let _ = conn.execute(
            "INSERT INTO goal_completions (id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7)
             ON CONFLICT(id) DO UPDATE SET
                goal_title = excluded.goal_title,
                completed_at = excluded.completed_at",
            params![
                log_id,
                milestone.goal_id,
                milestone.title,
                parent_cat,
                today_str,
                period_key,
                milestone.completed_at.clone().unwrap_or(now_iso)
            ],
        );
    } else {
        let _ = conn.execute(
            "DELETE FROM goal_completions WHERE goal_id = ?1 AND period_key = ?2",
            params![milestone.goal_id, period_key],
        );
    }

    Ok(milestone)
}

#[tauri::command]
pub fn delete_goal_milestone(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM goal_milestones WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting milestone: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn reorder_goal_milestones(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE goal_milestones SET sort_order = ?1 WHERE id = ?2",
            params![idx as i64, id],
        )
        .map_err(|e| format!("Failed reordering milestones: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_goal_completions(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<GoalCompletionLog>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let max_rows = limit.unwrap_or(120).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at
             FROM goal_completions ORDER BY completed_at DESC LIMIT ?1",
        )
        .map_err(|e| format!("Failed querying goal_completions: {e}"))?;

    let rows = stmt
        .query_map(params![max_rows], |row| {
            Ok(GoalCompletionLog {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                goal_title: row.get(2)?,
                category: row.get(3)?,
                logical_date: row.get(4)?,
                period_key: row.get(5)?,
                logged_value: row.get(6)?,
                target_value: row.get(7)?,
                completed_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed mapping goal_completions: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Completion log read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn list_completed_tasks_by_date(
    state: State<'_, AppState>,
    logical_date: String,
) -> Result<Vec<String>, String> {
    let target_date = logical_date.trim().to_string();
    if target_date.is_empty() {
        return Ok(Vec::new());
    }

    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut titles: Vec<String> = Vec::new();

    let mut push_unique = |raw: String| {
        let clean = raw.trim().to_string();
        if clean.is_empty() {
            return;
        }
        let key = clean.to_lowercase();
        if seen.insert(key) {
            titles.push(clean);
        }
    };

    // 1. Primary source: goal_completions joined with goals for the requested logical_date
    {
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(NULLIF(TRIM(g.title), ''), TRIM(gc.goal_title)) AS resolved_title
                 FROM goal_completions gc
                 LEFT JOIN goals g ON g.id = gc.goal_id
                 WHERE gc.logical_date = ?1
                 ORDER BY gc.completed_at ASC, gc.id ASC",
            )
            .map_err(|e| format!("Failed querying completed tasks by date: {e}"))?;

        let rows = stmt
            .query_map(params![&target_date], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed mapping completed tasks by date: {e}"))?;

        for row in rows.flatten() {
            push_unique(row);
        }
    }

    // 2. Direct goals fallback for currently completed daily goals tied to that logical_date
    {
        let mut stmt = conn
            .prepare(
                "SELECT title
                 FROM goals
                 WHERE completed = 1
                   AND scope = 'daily'
                   AND (
                     due_date = ?1
                     OR last_reset_period = ?1
                     OR substr(created_at, 1, 10) = ?1
                   )
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|e| format!("Failed querying completed daily goals by date: {e}"))?;

        let rows = stmt
            .query_map(params![&target_date], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed mapping completed daily goals by date: {e}"))?;

        for row in rows.flatten() {
            push_unique(row);
        }
    }

    // 3. Completed long-term milestones timestamped on that logical_date
    {
        let mut stmt = conn
            .prepare(
                "SELECT CASE
                    WHEN g.title IS NOT NULL AND TRIM(g.title) != ''
                    THEN TRIM(g.title) || ' · ' || TRIM(gm.title)
                    ELSE TRIM(gm.title)
                 END
                 FROM goal_milestones gm
                 LEFT JOIN goals g ON g.id = gm.goal_id
                 WHERE gm.completed = 1
                   AND substr(COALESCE(gm.completed_at, ''), 1, 10) = ?1
                 ORDER BY gm.completed_at ASC",
            )
            .map_err(|e| format!("Failed querying completed milestones by date: {e}"))?;

        let rows = stmt
            .query_map(params![&target_date], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed mapping completed milestones by date: {e}"))?;

        for row in rows.flatten() {
            push_unique(row);
        }
    }

    Ok(titles)
}

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> Result<Vec<StickyNoteItem>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, content, collapsed, x, y, updated_at FROM sticky_notes ORDER BY updated_at ASC")
        .map_err(|e| format!("Failed querying notes: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(StickyNoteItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                collapsed: row.get::<_, i64>(3)? != 0,
                x: row.get(4)?,
                y: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed mapping notes: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Note read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_note(state: State<'_, AppState>, note: StickyNoteItem) -> Result<StickyNoteItem, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO sticky_notes (id, title, content, collapsed, x, y, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            collapsed = excluded.collapsed,
            x = excluded.x,
            y = excluded.y,
            updated_at = excluded.updated_at",
        params![
            note.id,
            note.title,
            note.content,
            if note.collapsed { 1 } else { 0 },
            note.x,
            note.y,
            note.updated_at
        ],
    )
    .map_err(|e| format!("Failed upserting note: {e}"))?;
    Ok(note)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM sticky_notes WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting note: {e}"))?;
    Ok(())
}

fn map_goal_category_to_hourly_category(raw: &str) -> &'static str {
    let lower = raw.trim().to_lowercase();
    if lower.contains("strategy") || lower.contains("plan") || lower.contains("toc") {
        "strategy"
    } else if lower.contains("admin") || lower.contains("ops") || lower.contains("chore") || lower.contains("errand") {
        "admin"
    } else if lower.contains("break") || lower.contains("rest") || lower.contains("health") || lower.contains("walk") {
        "break"
    } else {
        "deep_work"
    }
}

#[tauri::command]
pub fn log_focus_session(
    state: State<'_, AppState>,
    mut session: FocusSessionItem,
) -> Result<FocusSessionItem, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    if session.category.trim().is_empty() {
        if let Some(ref gid) = session.goal_id {
            let goal_cat: String = conn
                .query_row(
                    "SELECT category FROM goals WHERE id = ?1",
                    params![gid],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            if !goal_cat.trim().is_empty() {
                session.category = goal_cat;
            }
        }
    }
    if session.category.trim().is_empty() {
        session.category = "deep_work".to_string();
    }

    conn.execute(
        "INSERT INTO focus_sessions (id, mode, target_minutes, elapsed_seconds, started_at, completed_at, label, goal_id, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            session.id,
            session.mode,
            session.target_minutes,
            session.elapsed_seconds,
            session.started_at,
            session.completed_at,
            session.label,
            session.goal_id,
            session.category
        ],
    )
    .map_err(|e| format!("Failed logging focus session: {e}"))?;

    let cutoff = load_or_init_config(&state.config_path)
        .map(|c| c.day_rollover_hour)
        .unwrap_or(3);
    let added_minutes = (session.elapsed_seconds as f64 / 60.0).ceil() as i64;
    let today_str = current_logical_date(cutoff);
    conn.execute(
        "INSERT INTO daily_activity (date, focus_minutes, goals_completed) VALUES (?1, ?2, 0)
         ON CONFLICT(date) DO UPDATE SET focus_minutes = focus_minutes + ?2",
        params![today_str, added_minutes.max(1)],
    )
    .map_err(|e| format!("Failed updating daily activity focus minutes: {e}"))?;

    // Auto-paint matching 1-hour logical-day block(s) (0..23 starting at cutoff:00)
    // whenever a session runs >= 5 minutes OR completes a custom countdown target.
    let reached_countdown = session.mode == "countdown"
        && session
            .target_minutes
            .map(|m| session.elapsed_seconds >= (m * 60).min(session.elapsed_seconds) && session.elapsed_seconds >= 5)
            .unwrap_or(false);
    if session.elapsed_seconds >= 300 || reached_countdown {
        let now_local = Local::now();
        let start_local = DateTime::parse_from_rfc3339(&session.started_at)
            .map(|dt| dt.with_timezone(&Local))
            .unwrap_or_else(|_| now_local - Duration::seconds(session.elapsed_seconds));
        let end_local = DateTime::parse_from_rfc3339(&session.completed_at)
            .map(|dt| dt.with_timezone(&Local))
            .unwrap_or(now_local);

        let first_slot = logical_hour_slot_index_for(start_local, cutoff);
        let last_slot = logical_hour_slot_index_for(end_local, cutoff).max(first_slot);
        let updated_at = now_local.to_rfc3339();
        let hourly_cat = map_goal_category_to_hourly_category(&session.category);
        for slot in first_slot..=last_slot {
            let _ = conn.execute(
                "INSERT INTO activity_blocks_hourly (date, slot_index, label, category, source, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'focus_timer', ?5)
                 ON CONFLICT(date, slot_index) DO UPDATE SET
                    label = CASE WHEN activity_blocks_hourly.label = '' THEN excluded.label ELSE activity_blocks_hourly.label END,
                    category = CASE WHEN activity_blocks_hourly.label = '' THEN excluded.category ELSE activity_blocks_hourly.category END,
                    updated_at = excluded.updated_at",
                params![today_str, slot, session.label, hourly_cat, updated_at],
            );
        }
    }

    Ok(session)
}

#[tauri::command]
pub fn list_focus_sessions(state: State<'_, AppState>) -> Result<Vec<FocusSessionItem>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, mode, target_minutes, elapsed_seconds, started_at, completed_at, label, goal_id, category
             FROM focus_sessions ORDER BY completed_at DESC LIMIT 200",
        )
        .map_err(|e| format!("Failed querying focus sessions: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(FocusSessionItem {
                id: row.get(0)?,
                mode: row.get(1)?,
                target_minutes: row.get(2)?,
                elapsed_seconds: row.get(3)?,
                started_at: row.get(4)?,
                completed_at: row.get(5)?,
                label: row.get(6)?,
                goal_id: row.get(7)?,
                category: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "deep_work".to_string()),
            })
        })
        .map_err(|e| format!("Failed mapping focus sessions: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Session read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn get_heatmap_60_days(state: State<'_, AppState>) -> Result<Vec<HeatmapDay>, String> {
    let cutoff = load_or_init_config(&state.config_path)
        .map(|c| c.day_rollover_hour)
        .unwrap_or(3);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let today = current_logical_naive_date(cutoff);
    let start_day = today - Duration::days(62);
    let start_str = start_day.format("%Y-%m-%d").to_string();

    let mut stmt = conn
        .prepare("SELECT date, focus_minutes, goals_completed FROM daily_activity WHERE date >= ?1")
        .map_err(|e| format!("Failed querying heatmap: {e}"))?;

    let mut by_date: HashMap<String, (i64, i64)> = HashMap::new();
    let rows = stmt
        .query_map(params![start_str], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("Failed mapping heatmap: {e}"))?;

    for row in rows {
        let (date, mins, goals) = row.map_err(|e| format!("Heatmap read error: {e}"))?;
        by_date.insert(date, (mins, goals));
    }

    let mut out = Vec::with_capacity(63);
    for offset in (0..63).rev() {
        let d = today - Duration::days(offset);
        let d_str = d.format("%Y-%m-%d").to_string();
        let (mins, goals) = by_date.get(&d_str).copied().unwrap_or((0, 0));
        out.push(HeatmapDay {
            date: d_str,
            focus_minutes: mins,
            goals_completed: goals,
            level: compute_heatmap_level(mins, goals),
        });
    }

    Ok(out)
}

#[tauri::command]
pub fn list_schedule_blocks(state: State<'_, AppState>) -> Result<Vec<ScheduleBlock>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, start_time, end_time, category, date FROM schedule_blocks ORDER BY date ASC, start_time ASC")
        .map_err(|e| format!("Failed querying schedule: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ScheduleBlock {
                id: row.get(0)?,
                title: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                category: row.get(4)?,
                date: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed mapping schedule: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Schedule read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_schedule_block(state: State<'_, AppState>, block: ScheduleBlock) -> Result<ScheduleBlock, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO schedule_blocks (id, title, start_time, end_time, category, date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            category = excluded.category,
            date = excluded.date",
        params![block.id, block.title, block.start_time, block.end_time, block.category, block.date],
    )
    .map_err(|e| format!("Failed upserting schedule block: {e}"))?;
    Ok(block)
}

#[tauri::command]
pub fn delete_schedule_block(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM schedule_blocks WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting schedule block: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_recurring_focus_blocks(
    state: State<'_, AppState>,
) -> Result<Vec<RecurringFocusBlock>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, linked_goal_id, category, start_time, duration_minutes, cadence, specific_days, active, created_at
             FROM recurring_focus_blocks ORDER BY start_time ASC, title ASC",
        )
        .map_err(|e| format!("Failed querying recurring_focus_blocks: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let days_csv: String = row.get(7)?;
            Ok(RecurringFocusBlock {
                id: row.get(0)?,
                title: row.get(1)?,
                linked_goal_id: row.get(2)?,
                category: row.get(3)?,
                start_time: row.get(4)?,
                duration_minutes: row.get(5)?,
                cadence: row.get(6)?,
                specific_days: parse_specific_days_csv(&days_csv),
                active: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed mapping recurring_focus_blocks: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Recurring block read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_recurring_focus_block(
    state: State<'_, AppState>,
    mut block: RecurringFocusBlock,
) -> Result<RecurringFocusBlock, String> {
    if block.created_at.trim().is_empty() {
        block.created_at = Local::now().to_rfc3339();
    }
    block.duration_minutes = block.duration_minutes.clamp(15, 480);
    let days_csv = encode_specific_days_csv(&block.specific_days);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO recurring_focus_blocks
         (id, title, linked_goal_id, category, start_time, duration_minutes, cadence, specific_days, active, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            linked_goal_id = excluded.linked_goal_id,
            category = excluded.category,
            start_time = excluded.start_time,
            duration_minutes = excluded.duration_minutes,
            cadence = excluded.cadence,
            specific_days = excluded.specific_days,
            active = excluded.active",
        params![
            block.id,
            block.title,
            block.linked_goal_id,
            block.category,
            block.start_time,
            block.duration_minutes,
            block.cadence,
            days_csv,
            if block.active { 1 } else { 0 },
            block.created_at
        ],
    )
    .map_err(|e| format!("Failed upserting recurring focus block: {e}"))?;
    Ok(block)
}

#[tauri::command]
pub fn delete_recurring_focus_block(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let _ = conn.execute(
        "DELETE FROM recurring_block_overrides WHERE block_id = ?1",
        params![id],
    );
    conn.execute(
        "DELETE FROM recurring_focus_blocks WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("Failed deleting recurring focus block: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_recurring_block_overrides(
    state: State<'_, AppState>,
) -> Result<Vec<RecurringBlockOverride>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT block_id, logical_date, status, override_start_time, override_duration_minutes, updated_at
             FROM recurring_block_overrides ORDER BY logical_date DESC",
        )
        .map_err(|e| format!("Failed querying recurring_block_overrides: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(RecurringBlockOverride {
                block_id: row.get(0)?,
                logical_date: row.get(1)?,
                status: row.get(2)?,
                override_start_time: row.get(3)?,
                override_duration_minutes: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed mapping recurring_block_overrides: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Override read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_recurring_block_override(
    state: State<'_, AppState>,
    mut item: RecurringBlockOverride,
) -> Result<RecurringBlockOverride, String> {
    item.updated_at = Local::now().to_rfc3339();
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO recurring_block_overrides
         (block_id, logical_date, status, override_start_time, override_duration_minutes, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(block_id, logical_date) DO UPDATE SET
            status = excluded.status,
            override_start_time = excluded.override_start_time,
            override_duration_minutes = excluded.override_duration_minutes,
            updated_at = excluded.updated_at",
        params![
            item.block_id,
            item.logical_date,
            item.status,
            item.override_start_time,
            item.override_duration_minutes,
            item.updated_at
        ],
    )
    .map_err(|e| format!("Failed upserting recurring block override: {e}"))?;
    Ok(item)
}

#[tauri::command]
pub fn delete_recurring_block_override(
    state: State<'_, AppState>,
    block_id: String,
    logical_date: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "DELETE FROM recurring_block_overrides WHERE block_id = ?1 AND logical_date = ?2",
        params![block_id, logical_date],
    )
    .map_err(|e| format!("Failed deleting recurring block override: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_journal_entries(state: State<'_, AppState>) -> Result<Vec<JournalEntry>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, date, title, body, mood, updated_at FROM journal_entries ORDER BY date DESC, updated_at DESC")
        .map_err(|e| format!("Failed querying journal: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(JournalEntry {
                id: row.get(0)?,
                date: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                mood: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed mapping journal: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Journal read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_journal_entry(state: State<'_, AppState>, entry: JournalEntry) -> Result<JournalEntry, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO journal_entries (id, date, title, body, mood, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            date = excluded.date,
            title = excluded.title,
            body = excluded.body,
            mood = excluded.mood,
            updated_at = excluded.updated_at",
        params![entry.id, entry.date, entry.title, entry.body, entry.mood, entry.updated_at],
    )
    .map_err(|e| format!("Failed upserting journal entry: {e}"))?;
    Ok(entry)
}

#[tauri::command]
pub fn list_library_books(state: State<'_, AppState>) -> Result<Vec<LibraryBook>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    list_all_books(&conn)
}

#[tauri::command]
pub fn upsert_library_book(state: State<'_, AppState>, book: LibraryBook) -> Result<LibraryBook, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO library_books
         (id, title, author, status, progress_percent, notes, file_path, format, current_page, total_pages, scroll_offset, last_opened_at, epub_cfi, cover_thumbnail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            status = excluded.status,
            progress_percent = excluded.progress_percent,
            notes = excluded.notes,
            file_path = excluded.file_path,
            format = excluded.format,
            current_page = excluded.current_page,
            total_pages = excluded.total_pages,
            scroll_offset = excluded.scroll_offset,
            last_opened_at = excluded.last_opened_at,
            epub_cfi = excluded.epub_cfi,
            cover_thumbnail = CASE WHEN excluded.cover_thumbnail != '' THEN excluded.cover_thumbnail ELSE library_books.cover_thumbnail END",
        params![
            book.id,
            book.title,
            book.author,
            book.status,
            book.progress_percent,
            book.notes,
            book.file_path,
            book.format,
            book.current_page.max(1),
            book.total_pages.max(0),
            book.scroll_offset,
            book.last_opened_at,
            book.epub_cfi,
            book.cover_thumbnail
        ],
    )
    .map_err(|e| format!("Failed upserting book: {e}"))?;
    Ok(book)
}

#[tauri::command]
pub fn save_book_cover_thumbnail(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    cover_thumbnail: String,
) -> Result<LibraryBook, String> {
    let trimmed = cover_thumbnail.trim().to_string();

    // Also cache thumbnail payload in {appDataDir}/thumbnails/ for fast local inspection/backup
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let thumb_dir = app_data_dir.join("thumbnails");
        if std::fs::create_dir_all(&thumb_dir).is_ok() {
            let safe_id: String = book_id
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                .collect();
            let ext = if trimmed.starts_with("data:image/png") { "png" } else { "webp" };
            let cache_path = thumb_dir.join(format!("{safe_id}.{ext}.txt"));
            let _ = std::fs::write(cache_path, trimmed.as_bytes());
        }
    }

    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "UPDATE library_books SET cover_thumbnail = ?1 WHERE id = ?2",
        params![trimmed, book_id],
    )
    .map_err(|e| format!("Failed saving book cover thumbnail: {e}"))?;

    let all = list_all_books(&conn)?;
    all.into_iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| "Book not found after thumbnail update".to_string())
}

#[tauri::command]
pub fn scan_books_folder(state: State<'_, AppState>) -> Result<Vec<LibraryBook>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    scan_books_directory(&conn, &cfg.books_folder_path)
}

#[tauri::command]
pub fn pick_books_folder() -> Result<Option<String>, String> {
    pick_folder_dialog()
}

#[tauri::command]
pub fn pick_and_add_book(state: State<'_, AppState>) -> Result<Option<LibraryBook>, String> {
    let Some(selected_path) = pick_book_file_dialog()? else {
        return Ok(None);
    };
    let cfg = load_or_init_config(&state.config_path)?;
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let book = import_external_book(&conn, &cfg.books_folder_path, &selected_path)?;
    Ok(Some(book))
}

fn encode_base64_bytes(input: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    let mut i = 0;
    while i < input.len() {
        let b0 = input[i];
        let b1 = if i + 1 < input.len() { input[i + 1] } else { 0 };
        let b2 = if i + 2 < input.len() { input[i + 2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < input.len() {
            out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < input.len() {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn resolve_existing_book_path(
    state: &State<'_, AppState>,
    file_path: &str,
) -> Result<PathBuf, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("No book file path specified.".to_string());
    }
    let direct = PathBuf::from(trimmed);
    if direct.exists() && direct.is_file() {
        return Ok(direct);
    }
    if let Ok(cfg) = load_or_init_config(&state.config_path) {
        let books_dir = PathBuf::from(cfg.books_folder_path.trim());
        let joined = books_dir.join(trimmed);
        if joined.exists() && joined.is_file() {
            return Ok(joined);
        }
        if let Some(file_name) = direct.file_name() {
            let by_name = books_dir.join(file_name);
            if by_name.exists() && by_name.is_file() {
                return Ok(by_name);
            }
        }
    }
    Err(format!("Book file not found: {}", direct.display()))
}

#[tauri::command]
pub async fn read_book_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<tauri::ipc::Response, String> {
    let resolved = resolve_existing_book_path(&state, &file_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&resolved))
        .await
        .map_err(|e| format!("Failed reading book file task: {e}"))?
        .map_err(|e| format!("Failed reading book file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn read_book_file_base64(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, String> {
    let resolved = resolve_existing_book_path(&state, &file_path)?;
    let encoded = tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&resolved)
            .map_err(|e| format!("Failed reading book file: {e}"))?;
        Ok::<String, String>(encode_base64_bytes(&bytes))
    })
    .await
    .map_err(|e| format!("Failed reading book file task: {e}"))??;
    Ok(encoded)
}

#[tauri::command]
pub async fn read_book_bytes(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<tauri::ipc::Response, String> {
    read_book_file(state, file_path).await
}

#[tauri::command]
pub fn update_book_progress(
    state: State<'_, AppState>,
    book_id: String,
    current_page: i64,
    total_pages: i64,
    scroll_offset: f64,
    epub_cfi: Option<String>,
) -> Result<LibraryBook, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let page = current_page.max(1);
    let total = total_pages.max(0);
    let progress_percent = if total > 0 {
        ((page as f64 / total as f64) * 100.0).round().clamp(0.0, 100.0) as i64
    } else {
        0
    };
    let status = if total > 0 && page >= total {
        "finished"
    } else {
        "reading"
    };
    let now_iso = Local::now().to_rfc3339();
    let cfi = epub_cfi.unwrap_or_default();

    conn.execute(
        "UPDATE library_books
         SET current_page = ?1,
             total_pages = CASE WHEN ?2 > 0 THEN ?2 ELSE total_pages END,
             progress_percent = ?3,
             scroll_offset = ?4,
             last_opened_at = ?5,
             status = ?6,
             epub_cfi = CASE WHEN ?7 != '' THEN ?7 ELSE epub_cfi END
         WHERE id = ?8",
        params![page, total, progress_percent, scroll_offset, now_iso, status, cfi, book_id],
    )
    .map_err(|e| format!("Failed updating book progress: {e}"))?;

    let all = list_all_books(&conn)?;
    all.into_iter()
        .find(|b| b.id == book_id)
        .ok_or_else(|| "Book not found after progress update".to_string())
}

#[tauri::command]
pub fn get_daily_reading_progress(
    state: State<'_, AppState>,
) -> Result<DailyReadingProgress, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_today = current_logical_date(cfg.day_rollover_hour);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    lib_get_daily_reading_progress(
        &conn,
        &logical_today,
        cfg.daily_reading_habit_enabled,
        cfg.daily_reading_target_pages,
    )
}

#[tauri::command]
pub fn record_reading_page(
    state: State<'_, AppState>,
    book_id: String,
    page_number: i64,
) -> Result<DailyReadingProgress, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_today = current_logical_date(cfg.day_rollover_hour);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    lib_record_reading_page(
        &conn,
        &logical_today,
        &book_id,
        page_number,
        cfg.daily_reading_habit_enabled,
        cfg.daily_reading_target_pages,
    )
}

#[tauri::command]
pub fn list_book_highlights(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<BookHighlight>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, book_id, page_number, quote, note, color, cfi_range, rects_json, created_at
             FROM book_highlights
             WHERE book_id = ?1
             ORDER BY page_number ASC, created_at DESC",
        )
        .map_err(|e| format!("Failed querying book highlights: {e}"))?;

    let rows = stmt
        .query_map(params![book_id], |row| {
            let rects_raw: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
            let rects = serde_json::from_str(&rects_raw).unwrap_or_default();
            Ok(BookHighlight {
                id: row.get(0)?,
                book_id: row.get(1)?,
                page_number: row.get(2)?,
                quote: row.get(3)?,
                note: row.get(4)?,
                color: row.get(5)?,
                cfi_range: row.get(6)?,
                rects,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed mapping book highlights: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Highlight read error: {e}"))?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddHighlightResponse {
    pub highlight: BookHighlight,
    pub vault_file_path: String,
}

#[tauri::command]
pub fn add_book_highlight(
    state: State<'_, AppState>,
    highlight: BookHighlight,
    book_title: String,
    book_author: String,
) -> Result<AddHighlightResponse, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let rects_json = serde_json::to_string(&highlight.rects).unwrap_or_else(|_| "[]".to_string());
    {
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        conn.execute(
            "INSERT INTO book_highlights (id, book_id, page_number, quote, note, color, cfi_range, rects_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                page_number = excluded.page_number,
                quote = excluded.quote,
                note = excluded.note,
                color = excluded.color,
                cfi_range = excluded.cfi_range,
                rects_json = excluded.rects_json",
            params![
                highlight.id,
                highlight.book_id,
                highlight.page_number.max(1),
                highlight.quote,
                highlight.note,
                highlight.color,
                highlight.cfi_range,
                rects_json,
                highlight.created_at
            ],
        )
        .map_err(|e| format!("Failed saving book highlight: {e}"))?;
    }

    let vault_file_path = append_book_note_to_vault(
        &cfg.vault_path,
        &book_title,
        &book_author,
        highlight.page_number,
        &highlight.quote,
        &highlight.note,
        &highlight.created_at,
    )?;

    Ok(AddHighlightResponse {
        highlight,
        vault_file_path,
    })
}

#[tauri::command]
pub fn delete_book_highlight(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM book_highlights WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting book highlight: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_reading_light_webhook(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<String, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let url = if !cfg.ha_reading_webhook_url.trim().is_empty() {
        cfg.ha_reading_webhook_url.trim().to_string()
    } else {
        cfg.home_assistant_webhook_url.trim().to_string()
    };
    if url.is_empty() {
        return Ok("Configure Reading Light webhook in Settings".to_string());
    }

    let entity_id = cfg.ha_reading_light_entity.trim().to_string();
    if entity_id.is_empty() {
        return Ok("Configure Light Entity ID in Settings".to_string());
    }

    let client = reqwest::Client::new();
    let mut req = client.post(&url).json(&json!({
        "source": "athenaeum",
        "event": "reading_light",
        "state": if enabled { "on" } else { "off" },
        "entity_id": entity_id,
        "color_temp_kelvin": 2700,
        "brightness_pct": if enabled { 45 } else { 0 },
        "timestamp": Local::now().to_rfc3339()
    }));

    if !cfg.home_assistant_token.trim().is_empty() {
        req = req.bearer_auth(cfg.home_assistant_token.trim());
    }

    match req.send().await {
        Ok(resp) => Ok(format!(
            "Reading light {} (HTTP {})",
            if enabled { "on" } else { "off" },
            resp.status().as_u16()
        )),
        Err(err) => Err(format!("Reading light webhook error: {err}")),
    }
}

#[tauri::command]
pub fn list_toc_nodes(state: State<'_, AppState>) -> Result<Vec<TocNode>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, kind, title, body, x, y FROM toc_nodes")
        .map_err(|e| format!("Failed querying TOC nodes: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(TocNode {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                x: row.get(4)?,
                y: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed mapping TOC nodes: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("TOC read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_toc_node(state: State<'_, AppState>, node: TocNode) -> Result<TocNode, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO toc_nodes (id, kind, title, body, x, y)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            body = excluded.body,
            x = excluded.x,
            y = excluded.y",
        params![node.id, node.kind, node.title, node.body, node.x, node.y],
    )
    .map_err(|e| format!("Failed upserting TOC node: {e}"))?;
    Ok(node)
}

#[tauri::command]
pub fn list_toc_trees(state: State<'_, AppState>) -> Result<Vec<TocTreeRecord>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, framework_type, tags, attached_to_debrief_date, graph_json, vault_file_path, created_at, updated_at
             FROM toc_trees ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Failed querying toc_trees: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let tags_json: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(TocTreeRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                framework_type: row.get(2)?,
                tags,
                attached_to_debrief_date: row.get(4)?,
                graph_json: row.get(5)?,
                vault_file_path: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed mapping toc_trees: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("TOC tree read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_toc_tree(
    state: State<'_, AppState>,
    mut tree: TocTreeRecord,
) -> Result<TocTreeRecord, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_today = current_logical_date(cfg.day_rollover_hour);
    let now_iso = Local::now().to_rfc3339();
    if tree.created_at.trim().is_empty() {
        tree.created_at = now_iso.clone();
    }
    tree.updated_at = now_iso;

    let vault_path = write_toc_tree_markdown(
        &cfg.vault_path,
        &logical_today,
        &tree.title,
        &tree.framework_type,
        &tree.tags,
        &tree.graph_json,
    )?;
    tree.vault_file_path = Some(vault_path);

    let tags_json = serde_json::to_string(&tree.tags).unwrap_or_else(|_| "[]".to_string());
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO toc_trees (id, title, framework_type, tags, attached_to_debrief_date, graph_json, vault_file_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            framework_type = excluded.framework_type,
            tags = excluded.tags,
            attached_to_debrief_date = excluded.attached_to_debrief_date,
            graph_json = excluded.graph_json,
            vault_file_path = excluded.vault_file_path,
            updated_at = excluded.updated_at",
        params![
            tree.id,
            tree.title,
            tree.framework_type,
            tags_json,
            tree.attached_to_debrief_date,
            tree.graph_json,
            tree.vault_file_path,
            tree.created_at,
            tree.updated_at
        ],
    )
    .map_err(|e| format!("Failed upserting toc_tree: {e}"))?;

    Ok(tree)
}

#[tauri::command]
pub fn delete_toc_tree(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM toc_trees WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed deleting toc_tree: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_ha_webhook(
    state: State<'_, AppState>,
    event: String,
    mode: String,
) -> Result<String, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    if cfg.home_assistant_webhook_url.trim().is_empty() {
        return Ok("Home Assistant webhook not configured in config.json".to_string());
    }

    let client = reqwest::Client::new();
    let mut req = client.post(cfg.home_assistant_webhook_url.trim()).json(&json!({
        "source": "athenaeum",
        "event": event,
        "mode": mode,
        "entity_id": cfg.home_assistant_focus_entity,
    }));

    if !cfg.home_assistant_token.trim().is_empty() {
        req = req.bearer_auth(cfg.home_assistant_token.trim());
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Webhook dispatch error: {e}"))?;

    Ok(format!("Webhook responded with HTTP {}", resp.status().as_u16()))
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HaLightCommand {
    pub mode: String, // "rgb" | "kelvin"
    pub rgb_color: Option<[u8; 3]>,
    pub kelvin: Option<u32>,
    pub brightness_pct: u8,
    pub entity_id: Option<String>,
    pub transition: Option<f32>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HaLightResult {
    pub ok: bool,
    pub endpoint: String,
    pub entity_id: String,
    pub applied_brightness_pct: u8,
    pub message: String,
}

#[tauri::command]
pub async fn set_ha_light_state(
    state: State<'_, AppState>,
    command: HaLightCommand,
) -> Result<HaLightResult, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let base_url = cfg.ha_base_url.trim().trim_end_matches('/').to_string();
    let entity_id = command
        .entity_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.ha_entity_id.trim())
        .to_string();

    // Full 1-100% brightness mapped cleanly to Home Assistant 0-255 brightness value
    let applied_pct = command.brightness_pct.clamp(1, 100);
    let brightness_255 = ((applied_pct as f64) * 2.55).round().clamp(0.0, 255.0) as u8;

    if base_url.is_empty() || entity_id.is_empty() {
        return Ok(HaLightResult {
            ok: false,
            endpoint: String::new(),
            entity_id,
            applied_brightness_pct: applied_pct,
            message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.".to_string(),
        });
    }

    let token = if !cfg.ha_token.trim().is_empty() {
        cfg.ha_token.trim().to_string()
    } else {
        cfg.home_assistant_token.trim().to_string()
    };

    let endpoint = format!("{base_url}/api/services/light/turn_on");
    let transition = command.transition.unwrap_or(1.2);
    let body = if command.mode == "kelvin" {
        let k = command.kelvin.unwrap_or(2700).clamp(2000, 6500);
        json!({
            "entity_id": entity_id,
            "color_temp_kelvin": k,
            "brightness": brightness_255,
            "transition": transition,
        })
    } else {
        let rgb = command.rgb_color.unwrap_or([128, 0, 255]);
        json!({
            "entity_id": entity_id,
            "rgb_color": rgb,
            "brightness": brightness_255,
            "transition": transition,
        })
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed creating HTTP client: {e}"))?;

    let mut req = client.post(&endpoint).json(&body);
    if !token.is_empty() {
        req = req.bearer_auth(&token);
    }

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            Ok(HaLightResult {
                ok: status.is_success(),
                endpoint,
                entity_id: entity_id.clone(),
                applied_brightness_pct: applied_pct,
                message: if status.is_success() {
                    format!("Room lighting updated ({applied_pct}%).")
                } else {
                    "Home Assistant isn't connected yet. Check your URL and token in Settings.".to_string()
                },
            })
        }
        Err(_) => Ok(HaLightResult {
            ok: false,
            endpoint,
            entity_id,
            applied_brightness_pct: applied_pct,
            message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.".to_string(),
        }),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<String, String> {
    crate::media::open_external_url_native(&url)
}

#[tauri::command]
pub fn media_control(action: String) -> Result<String, String> {
    send_windows_media_action(&action)
}

#[tauri::command]
pub fn get_media_state() -> MediaSessionState {
    get_windows_media_state()
}

#[tauri::command]
pub fn launch_apple_music() -> Result<String, String> {
    launch_apple_music_app()
}

#[tauri::command]
pub fn launch_spotify() -> Result<String, String> {
    launch_spotify_app()
}

#[tauri::command]
pub fn get_default_local_notes_path() -> String {
    crate::vault::default_vault_path()
}

#[tauri::command]
pub fn list_activity_blocks_hourly(
    state: State<'_, AppState>,
    date: String,
) -> Result<Vec<ActivityBlockHourly>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT date, slot_index, label, category, source, updated_at
             FROM activity_blocks_hourly
             WHERE date = ?1
             ORDER BY slot_index ASC",
        )
        .map_err(|e| format!("Failed querying hourly blocks: {e}"))?;

    let rows = stmt
        .query_map(params![date], |row| {
            Ok(ActivityBlockHourly {
                date: row.get(0)?,
                slot_index: row.get(1)?,
                label: row.get(2)?,
                category: row.get(3)?,
                source: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed mapping hourly blocks: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Hourly block read error: {e}"))?);
    }
    Ok(items)
}

#[tauri::command]
pub fn upsert_activity_block_hourly(
    state: State<'_, AppState>,
    block: ActivityBlockHourly,
) -> Result<ActivityBlockHourly, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO activity_blocks_hourly (date, slot_index, label, category, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(date, slot_index) DO UPDATE SET
            label = excluded.label,
            category = excluded.category,
            source = excluded.source,
            updated_at = excluded.updated_at",
        params![
            block.date,
            block.slot_index.clamp(0, 23),
            block.label,
            block.category,
            block.source,
            block.updated_at
        ],
    )
    .map_err(|e| format!("Failed upserting hourly block: {e}"))?;
    Ok(block)
}

#[tauri::command]
pub fn delete_activity_block_hourly(
    state: State<'_, AppState>,
    date: String,
    slot_index: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "DELETE FROM activity_blocks_hourly WHERE date = ?1 AND slot_index = ?2",
        params![date, slot_index],
    )
    .map_err(|e| format!("Failed deleting hourly block: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_external_calendar_events(
    state: State<'_, AppState>,
) -> Result<Vec<ExternalCalendarEvent>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, feed_url, title, date, start_time, end_time, location, all_day, updated_at
             FROM external_calendar_events
             ORDER BY date ASC, start_time ASC",
        )
        .map_err(|e| format!("Failed querying external calendar events: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ExternalCalendarEvent {
                id: row.get(0)?,
                feed_url: row.get(1)?,
                title: row.get(2)?,
                date: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
                location: row.get(6)?,
                all_day: row.get::<_, i64>(7)? != 0,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed mapping external calendar events: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| format!("Calendar event read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn sync_ics_calendars(state: State<'_, AppState>) -> Result<IcsSyncReport, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let today = current_logical_naive_date(cfg.day_rollover_hour);
    let (win_start, win_end) = sync_window_dates(today);

    let feeds: Vec<String> = cfg
        .calendar_ics_urls
        .into_iter()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .collect();

    if feeds.is_empty() {
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        let _ = conn.execute("DELETE FROM external_calendar_events", []);
        return Ok(IcsSyncReport {
            feeds_checked: 0,
            events_synced: 0,
            errors: Vec::new(),
        });
    }

    let mut total_events = 0usize;
    let mut errors = Vec::new();

    for feed_url in &feeds {
        match fetch_feed_text(feed_url).await {
            Ok(raw) => {
                let parsed = parse_ics_content(&raw, feed_url, win_start, win_end);
                total_events += parsed.len();
                let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
                if let Err(err) = store_synced_events(&conn, feed_url, &parsed) {
                    errors.push(err);
                }
            }
            Err(err) => errors.push(err),
        }
    }

    Ok(IcsSyncReport {
        feeds_checked: feeds.len(),
        events_synced: total_events,
        errors,
    })
}

#[tauri::command]
pub async fn generate_weekly_synthesis(
    state: State<'_, AppState>,
) -> Result<WeeklySynthesisReport, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let mut report = {
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        build_weekly_synthesis_sync(&conn, &cfg)?
    };
    report.webhook_status = dispatch_n8n_weekly_digest(&cfg.n8n_webhook_url, &report).await;
    Ok(report)
}

#[tauri::command]
pub async fn check_auto_weekly_synthesis(
    state: State<'_, AppState>,
) -> Result<Option<WeeklySynthesisReport>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    if !cfg.auto_weekly_synthesis {
        return Ok(None);
    }
    let now = Local::now();
    let today = current_logical_naive_date(cfg.day_rollover_hour);

    // Run once per logical week automatically:
    // - Sunday evening (>= 18:00): synthesize the current ISO week ending today
    // - Monday rollover: if Sunday evening was missed, synthesize the just-completed week ending yesterday
    let target_end_date = if today.weekday() == Weekday::Sun && now.hour() >= 18 {
        today
    } else if today.weekday() == Weekday::Mon {
        today - chrono::Duration::days(1)
    } else {
        return Ok(None);
    };

    let iso_week = target_end_date.iso_week();
    let week_key = format!("{}-W{:02}", iso_week.year(), iso_week.week());

    // Skip if already recorded in app_meta OR if the Markdown note already exists in {vaultPath}/Reflections/
    let vault_root = ensure_vault_structure(&cfg.vault_path)?;
    let review_path = vault_root
        .join("Reflections")
        .join(format!("{week_key}-Weekly-Review.md"));
    if review_path.exists() {
        return Ok(None);
    }

    let already_done: bool = {
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        conn.query_row(
            "SELECT value FROM app_meta WHERE key = 'weekly_synthesis_last_week'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == week_key)
        .unwrap_or(false)
    };

    if already_done {
        return Ok(None);
    }

    let mut report = {
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        build_weekly_synthesis_for_end_date_sync(&conn, &cfg, target_end_date)?
    };
    report.webhook_status = dispatch_n8n_weekly_digest(&cfg.n8n_webhook_url, &report).await;
    Ok(Some(report))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickCaptureResult {
    pub kind: String,
    pub message: String,
    pub focus_seconds: Option<i64>,
    pub focus_open: bool,
}

fn parse_focus_spec(spec: &str) -> (bool, Option<i64>) {
    let clean = spec.trim().to_ascii_lowercase();
    if clean.is_empty() || clean == "open" {
        return (true, None);
    }
    if let Some((m, s)) = clean.split_once(':') {
        let mins = m.trim().parse::<i64>().unwrap_or(0);
        let secs = s.trim().parse::<i64>().unwrap_or(0);
        let total = mins * 60 + secs;
        if total > 0 {
            return (false, Some(total));
        }
    }
    if let Ok(mins) = clean.trim_end_matches('m').trim().parse::<i64>() {
        if mins > 0 {
            return (false, Some(mins * 60));
        }
    }
    (true, None)
}

#[tauri::command]
pub fn execute_quick_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    input: String,
) -> Result<QuickCaptureResult, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Empty command".to_string());
    }
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_today = current_logical_date(cfg.day_rollover_hour);
    let now_iso = Local::now().to_rfc3339();
    let lower = trimmed.to_ascii_lowercase();

    let result = if lower.starts_with("n:") {
        let thought = trimmed[2..].trim();
        let title = thought
            .split_whitespace()
            .take(5)
            .collect::<Vec<_>>()
            .join(" ");
        let path = promote_note_to_inbox(&cfg.vault_path, &logical_today, &title, thought)?;
        QuickCaptureResult {
            kind: "inbox".to_string(),
            message: format!("Captured to Vault /Inbox ({path})"),
            focus_seconds: None,
            focus_open: false,
        }
    } else if lower.starts_with("s:") {
        let note_text = trimmed[2..].trim();
        let note_id = format!("note-{}", Local::now().timestamp_millis());
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        conn.execute(
            "INSERT INTO sticky_notes (id, title, content, collapsed, x, y, updated_at)
             VALUES (?1, ?2, ?3, 0, 5.0, 12.0, ?4)",
            params![note_id, "Quick Note", note_text, now_iso],
        )
        .map_err(|e| format!("Failed creating sticky note: {e}"))?;
        let _ = app.emit("athenaeum:data-updated", json!({ "kind": "sticky" }));
        QuickCaptureResult {
            kind: "sticky".to_string(),
            message: "Sticky note placed on Observatory".to_string(),
            focus_seconds: None,
            focus_open: false,
        }
    } else if lower.starts_with("f:") {
        let spec = trimmed[2..].trim();
        let (is_open, seconds) = parse_focus_spec(spec);
        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.show();
            let _ = main_win.unminimize();
            let _ = main_win.set_focus();
        }
        let _ = app.emit(
            "athenaeum:start-focus",
            json!({ "open": is_open, "seconds": seconds }),
        );
        QuickCaptureResult {
            kind: "focus".to_string(),
            message: if is_open {
                "Started Open Focus Session".to_string()
            } else {
                format!("Started Focus Session ({}s)", seconds.unwrap_or(0))
            },
            focus_seconds: seconds,
            focus_open: is_open,
        }
    } else {
        let task_title = if lower.starts_with("t:") {
            trimmed[2..].trim()
        } else {
            trimmed
        };
        let goal_id = format!("g-qc-{}", Local::now().timestamp_millis());
        let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
        let max_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM goals WHERE scope = 'daily'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        conn.execute(
            "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at)
             VALUES (?1, 'daily', ?2, 30, 0, 'medium', ?3, ?4, ?5)",
            params![goal_id, task_title, logical_today, max_order + 1, now_iso],
        )
        .map_err(|e| format!("Failed creating quick-capture daily task: {e}"))?;
        let _ = app.emit("athenaeum:data-updated", json!({ "kind": "goal" }));
        QuickCaptureResult {
            kind: "task".to_string(),
            message: format!("Added Daily Goal: {task_title}"),
            focus_seconds: None,
            focus_open: false,
        }
    };

    if let Some(qc_win) = app.get_webview_window("quick-capture") {
        let _ = qc_win.hide();
    }

    Ok(result)
}

#[tauri::command]
pub fn hide_quick_capture(app: AppHandle) {
    if let Some(qc_win) = app.get_webview_window("quick-capture") {
        let _ = qc_win.hide();
    }
}

#[tauri::command]
pub fn get_detected_activity_tracker_path() -> Option<String> {
    detect_activity_tracker_path()
}

#[tauri::command]
pub fn import_activity_tracker(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<ImportReport, String> {
    let resolved = path
        .filter(|p| !p.trim().is_empty())
        .or_else(|| {
            load_or_init_config(&state.config_path)
                .ok()
                .map(|c| c.activity_tracker_path)
                .filter(|p| !p.trim().is_empty())
        })
        .or_else(detect_activity_tracker_path)
        .ok_or_else(|| "Could not detect ActivityTracker ledger-v1.json path".to_string())?;

    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    import_from_path(&conn, &resolved)
}

#[tauri::command]
pub fn pick_vault_folder() -> Result<Option<String>, String> {
    pick_folder_dialog()
}

#[tauri::command]
pub fn promote_note_to_vault(
    state: State<'_, AppState>,
    note_id: String,
    title: String,
    content: String,
) -> Result<String, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_date = current_logical_date(cfg.day_rollover_hour);
    let written_path = promote_note_to_inbox(&cfg.vault_path, &logical_date, &title, &content)?;
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute("DELETE FROM sticky_notes WHERE id = ?1", params![note_id])
        .map_err(|e| format!("Failed removing promoted sticky note: {e}"))?;
    Ok(written_path)
}

#[tauri::command]
pub fn ensure_daily_debrief_goal(state: State<'_, AppState>) -> Result<GoalItem, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let logical_date = current_logical_date(cfg.day_rollover_hour);
    let goal_id = format!("daily-debrief-{logical_date}");
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;

    // Clean stale prior-day Daily Debrief rows so only today's logical debrief goal sits in Daily
    let _ = conn.execute(
        "DELETE FROM goals WHERE id LIKE 'daily-debrief-%' AND id != ?1",
        params![goal_id],
    );

    let existing_sql = format!("SELECT {GOAL_SELECT_COLS} FROM goals WHERE id = ?1");
    let existing: Result<GoalItem, _> = conn.query_row(&existing_sql, params![goal_id], map_goal_row);

    if let Ok(item) = existing {
        return Ok(item);
    }

    let max_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM goals WHERE scope = 'daily'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(-1);

    let item = GoalItem {
        id: goal_id,
        scope: "daily".to_string(),
        title: "Complete Daily Debrief".to_string(),
        duration_minutes: 15,
        completed: false,
        priority: "high".to_string(),
        due_date: Some(logical_date.clone()),
        sort_order: max_order + 1,
        created_at: Local::now().to_rfc3339(),
        description: "Review today's wins, gratitudes, and tomorrow's single anchor priority.".to_string(),
        category: "Reflection".to_string(),
        recurrence: "daily".to_string(),
        specific_days: Vec::new(),
        target_count: 1,
        current_count: 0,
        unit_label: String::new(),
        last_reset_period: logical_date,
    };

    conn.execute(
        "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at, description, category, recurrence, specific_days, target_count, current_count, unit_label, last_reset_period)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', 1, 0, '', ?12)",
        params![
            item.id,
            item.scope,
            item.title,
            item.duration_minutes,
            item.priority,
            item.due_date,
            item.sort_order,
            item.created_at,
            item.description,
            item.category,
            item.recurrence,
            item.last_reset_period
        ],
    )
    .map_err(|e| format!("Failed creating daily debrief goal: {e}"))?;

    Ok(item)
}

#[tauri::command]
pub fn get_daily_debrief(
    state: State<'_, AppState>,
    logical_date: String,
) -> Result<Option<DailyDebriefRecord>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let res = conn.query_row(
        "SELECT logical_date, memories, gratitude1, gratitude2, gratitude3, closing_thought, published, vault_file_path, updated_at
         FROM daily_debriefs WHERE logical_date = ?1",
        params![logical_date],
        |row| {
            Ok(DailyDebriefRecord {
                logical_date: row.get(0)?,
                memories: row.get(1)?,
                gratitude1: row.get(2)?,
                gratitude2: row.get(3)?,
                gratitude3: row.get(4)?,
                closing_thought: row.get(5)?,
                published: row.get::<_, i64>(6)? != 0,
                vault_file_path: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    );
    Ok(res.ok())
}

#[tauri::command]
pub fn save_daily_debrief_draft(
    state: State<'_, AppState>,
    record: DailyDebriefRecord,
) -> Result<DailyDebriefRecord, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO daily_debriefs (logical_date, memories, gratitude1, gratitude2, gratitude3, closing_thought, published, vault_file_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(logical_date) DO UPDATE SET
            memories = excluded.memories,
            gratitude1 = excluded.gratitude1,
            gratitude2 = excluded.gratitude2,
            gratitude3 = excluded.gratitude3,
            closing_thought = excluded.closing_thought,
            updated_at = excluded.updated_at",
        params![
            record.logical_date,
            record.memories,
            record.gratitude1,
            record.gratitude2,
            record.gratitude3,
            record.closing_thought,
            if record.published { 1 } else { 0 },
            record.vault_file_path,
            record.updated_at
        ],
    )
    .map_err(|e| format!("Failed saving daily debrief draft: {e}"))?;
    Ok(record)
}

#[tauri::command]
pub fn publish_daily_debrief(
    state: State<'_, AppState>,
    payload: DailyDebriefPayload,
) -> Result<DailyDebriefRecord, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let written_path = write_daily_debrief_markdown(&cfg.vault_path, &payload)?;
    let now_iso = Local::now().to_rfc3339();
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;

    conn.execute(
        "INSERT INTO daily_debriefs (logical_date, memories, gratitude1, gratitude2, gratitude3, closing_thought, published, vault_file_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)
         ON CONFLICT(logical_date) DO UPDATE SET
            memories = excluded.memories,
            gratitude1 = excluded.gratitude1,
            gratitude2 = excluded.gratitude2,
            gratitude3 = excluded.gratitude3,
            closing_thought = excluded.closing_thought,
            published = 1,
            vault_file_path = excluded.vault_file_path,
            updated_at = excluded.updated_at",
        params![
            payload.logical_date,
            payload.memories,
            payload.gratitude1,
            payload.gratitude2,
            payload.gratitude3,
            payload.closing_thought,
            written_path,
            now_iso
        ],
    )
    .map_err(|e| format!("Failed persisting published debrief: {e}"))?;

    // Automatically mark Complete Daily Debrief goal completed if publishing for today's logical date
    let goal_id = format!("daily-debrief-{}", payload.logical_date);
    let _ = conn.execute(
        "UPDATE goals SET completed = 1 WHERE id = ?1 OR (scope = 'daily' AND title = 'Complete Daily Debrief')",
        params![goal_id],
    );

    let completed_daily: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE scope = 'daily' AND completed = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO daily_activity (date, focus_minutes, goals_completed) VALUES (?1, 0, ?2)
         ON CONFLICT(date) DO UPDATE SET goals_completed = MAX(daily_activity.goals_completed, ?2)",
        params![payload.logical_date, completed_daily],
    );

    Ok(DailyDebriefRecord {
        logical_date: payload.logical_date,
        memories: payload.memories,
        gratitude1: payload.gratitude1,
        gratitude2: payload.gratitude2,
        gratitude3: payload.gratitude3,
        closing_thought: payload.closing_thought,
        published: true,
        vault_file_path: Some(written_path),
        updated_at: now_iso,
    })
}

#[tauri::command]
pub fn list_daily_debrief_archive(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    list_daily_debrief_dates(&cfg.vault_path)
}

#[tauri::command]
pub fn read_daily_debrief_file(
    state: State<'_, AppState>,
    logical_date: String,
) -> Result<Option<String>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    read_daily_debrief_markdown(&cfg.vault_path, &logical_date)
}

#[tauri::command]
pub fn list_reflections(state: State<'_, AppState>) -> Result<Vec<VaultFileEntry>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_list_reflections(&cfg.vault_path)
}

#[tauri::command]
pub fn save_reflection(
    state: State<'_, AppState>,
    input: ReflectionSaveInput,
) -> Result<VaultFileEntry, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_save_reflection(&cfg.vault_path, &input)
}

#[tauri::command]
pub fn delete_reflection(state: State<'_, AppState>, file_name: String) -> Result<(), String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_delete_reflection(&cfg.vault_path, &file_name)
}

#[tauri::command]
pub fn list_vault_index(state: State<'_, AppState>) -> Result<Vec<VaultIndexedNote>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    index_vault_notes(&cfg.vault_path)
}

#[tauri::command]
pub fn search_vault_notes(
    state: State<'_, AppState>,
    query: String,
    tag_filter: Option<String>,
) -> Result<Vec<VaultSearchResult>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_search_notes(&cfg.vault_path, &query, tag_filter.as_deref())
}

#[tauri::command]
pub fn find_vault_backlinks(
    state: State<'_, AppState>,
    target_title: String,
    exclude_file_name: Option<String>,
) -> Result<Vec<BacklinkMention>, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_find_backlinks(&cfg.vault_path, &target_title, exclude_file_name.as_deref())
}

#[tauri::command]
pub fn save_vault_note_body(
    state: State<'_, AppState>,
    folder: String,
    file_name: String,
    body: String,
) -> Result<VaultIndexedNote, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    vault_save_note_body(&cfg.vault_path, &folder, &file_name, &body)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivityRow {
    pub date: String,
    pub focus_minutes: i64,
    pub goals_completed: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReadingCount {
    pub logical_date: String,
    pub unique_pages: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsDataset {
    pub logical_today: String,
    pub day_rollover_hour: u32,
    pub daily_activity: Vec<DailyActivityRow>,
    pub focus_sessions: Vec<FocusSessionItem>,
    pub hourly_blocks: Vec<ActivityBlockHourly>,
    pub goal_completions: Vec<GoalCompletionLog>,
    pub daily_reading_pages: Vec<DailyReadingCount>,
    pub published_debrief_dates: Vec<String>,
    pub device_telemetry: Vec<DeviceTelemetryRecord>,
    pub recall_reviews: Vec<RecallReviewLog>,
}

#[tauri::command]
pub fn get_analytics_dataset(state: State<'_, AppState>) -> Result<AnalyticsDataset, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let cutoff = cfg.day_rollover_hour;
    let logical_today = current_logical_date(cutoff);
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;

    // 1. All daily_activity rows
    let mut daily_activity = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT date, focus_minutes, goals_completed FROM daily_activity ORDER BY date ASC")
            .map_err(|e| format!("Analytics daily_activity error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DailyActivityRow {
                    date: row.get(0)?,
                    focus_minutes: row.get(1)?,
                    goals_completed: row.get(2)?,
                })
            })
            .map_err(|e| format!("Analytics daily_activity map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                daily_activity.push(item);
            }
        }
    }

    // 2. All focus_sessions
    let mut focus_sessions = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, mode, target_minutes, elapsed_seconds, started_at, completed_at, label, goal_id, category
                 FROM focus_sessions ORDER BY completed_at DESC",
            )
            .map_err(|e| format!("Analytics focus_sessions error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FocusSessionItem {
                    id: row.get(0)?,
                    mode: row.get(1)?,
                    target_minutes: row.get(2)?,
                    elapsed_seconds: row.get(3)?,
                    started_at: row.get(4)?,
                    completed_at: row.get(5)?,
                    label: row.get(6)?,
                    goal_id: row.get(7)?,
                    category: row
                        .get::<_, Option<String>>(8)?
                        .unwrap_or_else(|| "deep_work".to_string()),
                })
            })
            .map_err(|e| format!("Analytics focus_sessions map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                focus_sessions.push(item);
            }
        }
    }

    // 3. All activity_blocks_hourly
    let mut hourly_blocks = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT date, slot_index, label, category, source, updated_at
                 FROM activity_blocks_hourly ORDER BY date ASC, slot_index ASC",
            )
            .map_err(|e| format!("Analytics hourly_blocks error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ActivityBlockHourly {
                    date: row.get(0)?,
                    slot_index: row.get(1)?,
                    label: row.get(2)?,
                    category: row.get(3)?,
                    source: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Analytics hourly_blocks map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                hourly_blocks.push(item);
            }
        }
    }

    // 4. All goal_completions
    let mut goal_completions = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at
                 FROM goal_completions ORDER BY completed_at DESC",
            )
            .map_err(|e| format!("Analytics goal_completions error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(GoalCompletionLog {
                    id: row.get(0)?,
                    goal_id: row.get(1)?,
                    goal_title: row.get(2)?,
                    category: row.get(3)?,
                    logical_date: row.get(4)?,
                    period_key: row.get(5)?,
                    logged_value: row.get(6)?,
                    target_value: row.get(7)?,
                    completed_at: row.get(8)?,
                })
            })
            .map_err(|e| format!("Analytics goal_completions map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                goal_completions.push(item);
            }
        }
    }

    // 5. Unique book pages read per logical day
    let mut daily_reading_pages = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT logical_date, COUNT(*) FROM daily_reading_pages GROUP BY logical_date ORDER BY logical_date ASC",
            )
            .map_err(|e| format!("Analytics daily_reading_pages error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DailyReadingCount {
                    logical_date: row.get(0)?,
                    unique_pages: row.get(1)?,
                })
            })
            .map_err(|e| format!("Analytics daily_reading_pages map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                daily_reading_pages.push(item);
            }
        }
    }

    // 6. Published Daily Debrief dates (SQLite daily_debriefs.published=1 UNION Vault /Daily/YYYY-MM-DD.md)
    let mut debrief_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT logical_date FROM daily_debriefs WHERE published = 1")
            .map_err(|e| format!("Analytics daily_debriefs error: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Analytics daily_debriefs map error: {e}"))?;
        for r in rows {
            if let Ok(d) = r {
                debrief_set.insert(d);
            }
        }
    }
    if let Ok(vault_dates) = list_daily_debrief_dates(&cfg.vault_path) {
        for d in vault_dates {
            debrief_set.insert(d);
        }
    }

    // 7. Device telemetry (iPhone Apple Health sleep_hours & screen_time_minutes)
    let mut device_telemetry = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT logical_date, sleep_hours, screen_time_minutes, source, updated_at
                 FROM daily_device_telemetry ORDER BY logical_date ASC",
            )
            .map_err(|e| format!("Analytics device_telemetry error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DeviceTelemetryRecord {
                    logical_date: row.get(0)?,
                    sleep_hours: row.get(1)?,
                    screen_time_minutes: row.get(2)?,
                    source: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Analytics device_telemetry map error: {e}"))?;
        for r in rows {
            if let Ok(item) = r {
                device_telemetry.push(item);
            }
        }
    }

    // 8. Recall review completions for weekly synthesis/recall consistency tracking
    let mut recall_reviews = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, card_hash, source_category, rating, logical_date, reviewed_at
                 FROM recall_reviews ORDER BY reviewed_at DESC",
            )
            .map_err(|e| format!("Analytics recall_reviews error: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RecallReviewLog {
                    id: row.get(0)?,
                    card_hash: row.get(1)?,
                    source_category: row.get(2)?,
                    rating: row.get(3)?,
                    logical_date: row.get(4)?,
                    reviewed_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Analytics recall_reviews map error: {e}"))?;
        for r in rows.flatten() {
            recall_reviews.push(r);
        }
    }

    Ok(AnalyticsDataset {
        logical_today,
        day_rollover_hour: cutoff,
        daily_activity,
        focus_sessions,
        hourly_blocks,
        goal_completions,
        daily_reading_pages,
        published_debrief_dates: debrief_set.into_iter().collect(),
        device_telemetry,
        recall_reviews,
    })
}

#[tauri::command]
pub fn get_recall_deck(state: State<'_, AppState>) -> Result<RecallDeckState, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    get_recall_deck_state(&conn, &cfg.vault_path, cfg.day_rollover_hour)
}

#[tauri::command]
pub fn review_recall_card(
    state: State<'_, AppState>,
    card_hash: String,
    rating: i64,
) -> Result<RecallReviewResult, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    apply_sm2_review(&conn, &cfg.vault_path, &card_hash, rating, cfg.day_rollover_hour)
}

#[tauri::command]
pub fn open_vault_file(file_path: String) -> Result<String, String> {
    open_vault_file_in_os(&file_path)
}

#[tauri::command]
pub fn regenerate_ingest_token(state: State<'_, AppState>) -> Result<String, String> {
    let mut cfg = load_or_init_config(&state.config_path)?;
    let next_token = generate_secure_ingest_token();
    cfg.ingest_api_token = next_token.clone();
    save_config_file(&state.config_path, &cfg)?;
    Ok(next_token)
}

#[tauri::command]
pub fn get_ingest_server_status(state: State<'_, AppState>) -> Result<IngestServerStatus, String> {
    let guard = state
        .ingest_server
        .lock()
        .map_err(|_| "Ingest server lock error".to_string())?;
    Ok(guard.status())
}

#[tauri::command]
pub async fn send_n8n_event(
    state: State<'_, AppState>,
    event_name: String,
    payload: serde_json::Value,
) -> Result<String, String> {
    let cfg = load_or_init_config(&state.config_path)?;
    let url = cfg.n8n_webhook_url.trim().to_string();
    if url.is_empty() {
        return Ok("n8n webhook URL not configured in Settings".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let body = json!({
        "source": "athenaeum",
        "event": event_name,
        "logicalDate": current_logical_date(cfg.day_rollover_hour),
        "timestamp": Local::now().to_rfc3339(),
        "data": payload,
    });

    match client.post(&url).json(&body).send().await {
        Ok(resp) => Ok(format!("n8n webhook responded HTTP {}", resp.status().as_u16())),
        Err(err) => Ok(format!("n8n webhook unreachable: {err}")),
    }
}

#[tauri::command]
pub fn list_device_telemetry(
    state: State<'_, AppState>,
) -> Result<Vec<DeviceTelemetryRecord>, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT logical_date, sleep_hours, screen_time_minutes, source, updated_at
             FROM daily_device_telemetry ORDER BY logical_date DESC",
        )
        .map_err(|e| format!("Failed querying device telemetry: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DeviceTelemetryRecord {
                logical_date: row.get(0)?,
                sleep_hours: row.get(1)?,
                screen_time_minutes: row.get(2)?,
                source: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed mapping device telemetry: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Device telemetry read error: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_device_telemetry(
    state: State<'_, AppState>,
    record: DeviceTelemetryRecord,
) -> Result<DeviceTelemetryRecord, String> {
    let conn = state.db.lock().map_err(|_| "DB lock error".to_string())?;
    conn.execute(
        "INSERT INTO daily_device_telemetry (logical_date, sleep_hours, screen_time_minutes, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(logical_date) DO UPDATE SET
            sleep_hours = COALESCE(excluded.sleep_hours, daily_device_telemetry.sleep_hours),
            screen_time_minutes = COALESCE(excluded.screen_time_minutes, daily_device_telemetry.screen_time_minutes),
            source = excluded.source,
            updated_at = excluded.updated_at",
        params![
            record.logical_date,
            record.sleep_hours,
            record.screen_time_minutes,
            record.source,
            record.updated_at
        ],
    )
    .map_err(|e| format!("Failed upserting device telemetry: {e}"))?;
    Ok(record)
}
