use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub source_path: String,
    pub daily_goals_imported: usize,
    pub weekly_goals_imported: usize,
    pub long_term_goals_imported: usize,
    pub focus_sessions_imported: usize,
    pub activity_days_imported: usize,
    pub journal_entries_imported: usize,
    pub active_date: Option<String>,
    pub active_week: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityTrackerLedger {
    #[serde(default)]
    active_date: Option<String>,
    #[serde(default)]
    active_week: Option<String>,
    #[serde(default)]
    daily_tasks: Vec<AtDailyTask>,
    #[serde(default)]
    weekly_goals: Vec<AtWeeklyGoal>,
    #[serde(default)]
    long_term_goals: Vec<AtLongTermGoal>,
    #[serde(default)]
    activity_log: Vec<AtActivityLog>,
    #[serde(default)]
    journal_entries: Vec<AtJournalEntry>,
    #[serde(default)]
    focus_sessions: Vec<AtFocusSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtDailyTask {
    id: String,
    date: String,
    title: String,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtWeeklyGoal {
    id: String,
    week_key: String,
    title: String,
    #[serde(default)]
    target_count: Option<i64>,
    #[serde(default)]
    current_count: Option<i64>,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtMilestone {
    #[serde(default)]
    completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtLongTermGoal {
    id: String,
    title: String,
    #[serde(default)]
    milestones: Vec<AtMilestone>,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtActivityLog {
    #[serde(default)]
    id: Option<String>,
    date: String,
    #[serde(default)]
    source_type: Option<String>,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default = "default_points")]
    points: i64,
}

fn default_points() -> i64 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtFocusSession {
    id: String,
    date: String,
    #[serde(default)]
    task_title: Option<String>,
    #[serde(default)]
    minutes: i64,
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AtJournalEntry {
    id: String,
    date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    mood: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

pub fn detect_activity_tracker_path() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(&appdata).join("Activity Tracker").join("ledger-v1.json"));
        candidates.push(PathBuf::from(&appdata).join("activitytracker").join("ledger-v1.json"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("Activity Tracker").join("ledger-v1.json"));
    }
    for path in candidates {
        if path.exists() && path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

fn upsert_historical_completions(
    conn: &Connection,
    ledger: &ActivityTrackerLedger,
) -> Result<usize, String> {
    let mut inserted = 0usize;

    // 1. All completed dailyTasks across every historical date
    for task in &ledger.daily_tasks {
        if !task.completed {
            continue;
        }
        let title = task.title.trim();
        let date = task.date.trim();
        if title.is_empty() || date.is_empty() {
            continue;
        }
        let row_id = format!("at-dtask-{}", task.id);
        let period_key = format!("legacy:{date}");
        let completed_at = task
            .created_at
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("{date}T12:00:00Z"));
        conn.execute(
            "INSERT INTO goal_completions
                (id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at)
             VALUES (?1, ?2, ?3, 'daily', ?4, ?5, 1, 1, ?6)
             ON CONFLICT(id) DO UPDATE SET
                goal_title = excluded.goal_title,
                logical_date = excluded.logical_date",
            params![row_id, task.id, title, date, period_key, completed_at],
        )
        .map_err(|e| format!("Failed backfilling daily task completion {}: {e}", task.id))?;
        inserted += 1;
    }

    // 2. Non-focus activityLog entries (daily / weekly / longTerm goal completions with exact titles)
    for (idx, act) in ledger.activity_log.iter().enumerate() {
        let src_type = act
            .source_type
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if src_type == "focus" {
            continue;
        }
        let label = act.label.as_deref().unwrap_or("").trim();
        let date = act.date.trim();
        if label.is_empty() || date.is_empty() {
            continue;
        }
        let act_id = act
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("{date}-{idx}"));
        let row_id = format!("at-act-{act_id}");
        let goal_id = act
            .source_id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| act_id.clone());
        let category = if src_type.is_empty() {
            "daily".to_string()
        } else {
            src_type
        };
        let period_key = format!("legacy:{date}");
        let completed_at = act
            .timestamp
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("{date}T12:00:00Z"));

        conn.execute(
            "INSERT INTO goal_completions
                (id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7)
             ON CONFLICT(id) DO UPDATE SET
                goal_title = excluded.goal_title,
                logical_date = excluded.logical_date",
            params![row_id, goal_id, label, category, date, period_key, completed_at],
        )
        .map_err(|e| format!("Failed backfilling activity log completion {act_id}: {e}"))?;
        inserted += 1;
    }

    Ok(inserted)
}

/// One-time automatic backfill on startup so previously imported ActivityTracker days
/// have individual task titles stored in `goal_completions` without requiring manual re-import.
pub fn backfill_historical_completions_if_needed(conn: &Connection, configured_path: &str) {
    let trimmed = configured_path.trim();
    if trimmed.is_empty() || !PathBuf::from(trimmed).exists() {
        return;
    }

    let already_done: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'legacy_completions_backfilled_v1'",
            [],
            |row| row.get(0),
        )
        .ok();
    if already_done.as_deref() == Some("1") {
        return;
    }

    if let Ok(raw) = fs::read_to_string(trimmed) {
        if let Ok(ledger) = serde_json::from_str::<ActivityTrackerLedger>(&raw) {
            let _ = upsert_historical_completions(conn, &ledger);
        }
    }

    let _ = conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('legacy_completions_backfilled_v1', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    );
}

pub fn import_from_path(conn: &Connection, path_str: &str) -> Result<ImportReport, String> {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return Err("ActivityTracker ledger path is empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("ActivityTracker file not found: {trimmed}"));
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed reading ActivityTracker file: {e}"))?;
    let ledger: ActivityTrackerLedger = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed parsing ActivityTracker ledger JSON: {e}"))?;

    // Resolve active day & active week from ledger (fallback to latest date/week present)
    let active_date = ledger.active_date.clone().or_else(|| {
        ledger
            .daily_tasks
            .iter()
            .map(|t| t.date.clone())
            .max()
    });
    let active_week = ledger.active_week.clone().or_else(|| {
        ledger
            .weekly_goals
            .iter()
            .map(|w| w.week_key.clone())
            .max()
    });

    // Clear stale imported daily/weekly goals from earlier dates/weeks before upserting current horizon
    if let Some(ref ad) = active_date {
        conn.execute(
            "DELETE FROM goals WHERE id LIKE 'dtask_%' AND (due_date IS NULL OR due_date != ?1)",
            params![ad],
        )
        .map_err(|e| format!("Failed cleaning prior daily imported tasks: {e}"))?;
    }
    if let Some(ref aw) = active_week {
        conn.execute(
            "DELETE FROM goals WHERE id LIKE 'wgoal_%' AND (due_date IS NULL OR due_date != ?1)",
            params![aw],
        )
        .map_err(|e| format!("Failed cleaning prior weekly imported goals: {e}"))?;
    }

    // 1. Upsert active day's daily tasks (idempotent by original dtask_* ID)
    let mut daily_count = 0usize;
    for (idx, task) in ledger.daily_tasks.iter().enumerate() {
        if let Some(ref ad) = active_date {
            if &task.date != ad {
                continue;
            }
        }
        let created_at = task
            .created_at
            .clone()
            .unwrap_or_else(|| format!("{}T00:00:00Z", task.date));
        conn.execute(
            "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at)
             VALUES (?1, 'daily', ?2, 30, ?3, 'medium', ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                completed = excluded.completed,
                due_date = excluded.due_date,
                sort_order = excluded.sort_order",
            params![
                task.id,
                task.title,
                if task.completed { 1 } else { 0 },
                task.date,
                task.order.unwrap_or(idx as i64),
                created_at
            ],
        )
        .map_err(|e| format!("Failed importing daily task {}: {e}", task.id))?;
        daily_count += 1;
    }

    // 2. Upsert active week's weekly goals (idempotent by original wgoal_* ID)
    let mut weekly_count = 0usize;
    for (idx, goal) in ledger.weekly_goals.iter().enumerate() {
        if let Some(ref aw) = active_week {
            if &goal.week_key != aw {
                continue;
            }
        }
        let target = goal.target_count.unwrap_or(1);
        let current = goal.current_count.unwrap_or(0);
        let formatted_title = if target > 1 {
            format!("{} ({}/{})", goal.title, current, target)
        } else {
            goal.title.clone()
        };
        let created_at = goal
            .created_at
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        conn.execute(
            "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at)
             VALUES (?1, 'weekly', ?2, 45, ?3, 'medium', ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                completed = excluded.completed,
                due_date = excluded.due_date,
                sort_order = excluded.sort_order",
            params![
                goal.id,
                formatted_title,
                if goal.completed { 1 } else { 0 },
                goal.week_key,
                goal.order.unwrap_or(idx as i64),
                created_at
            ],
        )
        .map_err(|e| format!("Failed importing weekly goal {}: {e}", goal.id))?;
        weekly_count += 1;
    }

    // 3. Upsert long-term goals (idempotent by original ltgoal_* ID)
    let mut long_term_count = 0usize;
    for (idx, lt) in ledger.long_term_goals.iter().enumerate() {
        let done_ms = lt.milestones.iter().filter(|m| m.completed).count();
        let total_ms = lt.milestones.len();
        let formatted_title = if total_ms > 0 {
            format!("{} ({}/{} milestones)", lt.title, done_ms, total_ms)
        } else {
            lt.title.clone()
        };
        let created_at = lt
            .created_at
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        conn.execute(
            "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at)
             VALUES (?1, 'longTerm', ?2, 120, ?3, 'high', NULL, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                completed = excluded.completed,
                sort_order = excluded.sort_order",
            params![
                lt.id,
                formatted_title,
                if lt.completed { 1 } else { 0 },
                lt.order.unwrap_or(idx as i64),
                created_at
            ],
        )
        .map_err(|e| format!("Failed importing long-term goal {}: {e}", lt.id))?;
        long_term_count += 1;
    }

    // 4. Upsert focus sessions (idempotent by original focus_* ID)
    let mut focus_minutes_by_date: HashMap<String, i64> = HashMap::new();
    let mut sessions_count = 0usize;
    for session in &ledger.focus_sessions {
        let mins = session.minutes.max(1);
        let secs = mins * 60;
        let completed_at = session
            .completed_at
            .clone()
            .unwrap_or_else(|| format!("{}T12:00:00Z", session.date));
        let started_at = DateTime::parse_from_rfc3339(&completed_at)
            .map(|dt| (dt - Duration::minutes(mins)).to_rfc3339())
            .unwrap_or_else(|_| completed_at.clone());
        let label = session
            .task_title
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Focus Session".to_string());

        conn.execute(
            "INSERT INTO focus_sessions (id, mode, target_minutes, elapsed_seconds, started_at, completed_at, label)
             VALUES (?1, 'countdown', ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                target_minutes = excluded.target_minutes,
                elapsed_seconds = excluded.elapsed_seconds,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                label = excluded.label",
            params![session.id, mins, secs, started_at, completed_at, label],
        )
        .map_err(|e| format!("Failed importing focus session {}: {e}", session.id))?;

        *focus_minutes_by_date.entry(session.date.clone()).or_insert(0) += mins;
        sessions_count += 1;
    }

    // 5. Upsert journal entries (idempotent by original id)
    let mut journal_count = 0usize;
    for entry in &ledger.journal_entries {
        let body = entry
            .content
            .clone()
            .or_else(|| entry.body.clone())
            .unwrap_or_default();
        let mood = entry.mood.clone().unwrap_or_else(|| "Clear".to_string());
        let updated_at = entry
            .updated_at
            .clone()
            .unwrap_or_else(|| format!("{}T12:00:00Z", entry.date));
        conn.execute(
            "INSERT INTO journal_entries (id, date, title, body, mood, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                date = excluded.date,
                title = excluded.title,
                body = excluded.body,
                mood = excluded.mood,
                updated_at = excluded.updated_at",
            params![entry.id, entry.date, entry.title, body, mood, updated_at],
        )
        .map_err(|e| format!("Failed importing journal entry {}: {e}", entry.id))?;
        journal_count += 1;
    }

    // 6. Backfill individual historical completion titles into goal_completions
    let _ = upsert_historical_completions(conn, &ledger)?;

    // 7. Idempotently aggregate daily activity from activityLog + completed dailyTasks + focusSessions
    let mut goals_by_date: HashMap<String, i64> = HashMap::new();
    for act in &ledger.activity_log {
        *goals_by_date.entry(act.date.clone()).or_insert(0) += act.points.max(1);
    }
    // Also check completed dailyTasks for any date not represented in activityLog
    let mut completed_daily_by_date: HashMap<String, i64> = HashMap::new();
    for task in &ledger.daily_tasks {
        if task.completed {
            *completed_daily_by_date.entry(task.date.clone()).or_insert(0) += 1;
        }
    }
    for (date, cnt) in completed_daily_by_date {
        let entry = goals_by_date.entry(date).or_insert(0);
        if cnt > *entry {
            *entry = cnt;
        }
    }

    // Collect all dates from imported focus sessions & activity
    let mut all_dates: Vec<String> = focus_minutes_by_date
        .keys()
        .chain(goals_by_date.keys())
        .cloned()
        .collect();
    all_dates.sort();
    all_dates.dedup();

    // Calculate native (non-ActivityTracker) focus minutes already logged inside Athenaeum so re-imports never lose them
    let mut native_focus_by_date: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT substr(completed_at, 1, 10), SUM((elapsed_seconds + 59) / 60)
         FROM focus_sessions
         WHERE id NOT LIKE 'focus_%'
         GROUP BY substr(completed_at, 1, 10)",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }) {
            for r in rows.flatten() {
                native_focus_by_date.insert(r.0, r.1);
            }
        }
    }

    for date in &all_dates {
        let imported_mins = focus_minutes_by_date.get(date).copied().unwrap_or(0);
        let imported_goals = goals_by_date.get(date).copied().unwrap_or(0);
        let native_mins = native_focus_by_date.get(date).copied().unwrap_or(0);

        conn.execute(
            "INSERT INTO imported_activity_days (date, focus_minutes, goals_completed)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET
                focus_minutes = excluded.focus_minutes,
                goals_completed = excluded.goals_completed",
            params![date, imported_mins, imported_goals],
        )
        .map_err(|e| format!("Failed recording imported activity day {date}: {e}"))?;

        conn.execute(
            "INSERT INTO daily_activity (date, focus_minutes, goals_completed)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date) DO UPDATE SET
                focus_minutes = ?2,
                goals_completed = MAX(daily_activity.goals_completed, ?3)",
            params![date, imported_mins + native_mins, imported_goals],
        )
        .map_err(|e| format!("Failed updating daily_activity for {date}: {e}"))?;
    }

    Ok(ImportReport {
        source_path: trimmed.to_string(),
        daily_goals_imported: daily_count,
        weekly_goals_imported: weekly_count,
        long_term_goals_imported: long_term_count,
        focus_sessions_imported: sessions_count,
        activity_days_imported: all_dates.len(),
        journal_entries_imported: journal_count,
        active_date,
        active_week,
    })
}
