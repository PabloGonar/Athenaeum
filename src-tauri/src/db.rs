use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_target_count() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalItem {
    pub id: String,
    pub scope: String, // "daily" | "weekly" | "longTerm"
    pub title: String,
    pub duration_minutes: i64,
    pub completed: bool,
    pub priority: String, // "high" | "medium" | "low"
    pub due_date: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub recurrence: String, // "once" | "daily" | "weekly" | "specific_days" | "long_term"
    #[serde(default)]
    pub specific_days: Vec<i64>, // 0=Mon .. 6=Sun
    #[serde(default = "default_target_count")]
    pub target_count: i64,
    #[serde(default)]
    pub current_count: i64,
    #[serde(default)]
    pub unit_label: String,
    #[serde(default)]
    pub last_reset_period: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalMilestone {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalCompletionLog {
    pub id: String,
    pub goal_id: String,
    pub goal_title: String,
    pub category: String,
    pub logical_date: String,
    pub period_key: String,
    pub logged_value: i64,
    pub target_value: i64,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyNoteItem {
    pub id: String,
    pub title: String,
    pub content: String,
    pub collapsed: bool,
    pub x: f64,
    pub y: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionItem {
    pub id: String,
    pub mode: String, // "open" | "countdown"
    pub target_minutes: Option<i64>,
    pub elapsed_seconds: i64,
    pub started_at: String,
    pub completed_at: String,
    pub label: String,
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapDay {
    pub date: String,
    pub focus_minutes: i64,
    pub goals_completed: i64,
    pub level: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleBlock {
    pub id: String,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub category: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringFocusBlock {
    pub id: String,
    pub title: String,
    pub linked_goal_id: Option<String>,
    pub category: String,
    pub start_time: String,
    pub duration_minutes: i64,
    pub cadence: String, // "daily" | "weekdays" | "weekends" | "specific_days"
    pub specific_days: Vec<i64>, // 0=Mon..6=Sun
    pub active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringBlockOverride {
    pub block_id: String,
    pub logical_date: String,
    pub status: String, // "rescheduled" | "skipped"
    pub override_start_time: Option<String>,
    pub override_duration_minutes: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub date: String,
    pub title: String,
    pub body: String,
    pub mood: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBook {
    pub id: String,
    pub title: String,
    pub author: String,
    pub status: String, // "reading" | "queued" | "finished"
    pub progress_percent: i64,
    pub notes: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub format: String, // "pdf" | "epub" | "manual"
    #[serde(default)]
    pub current_page: i64,
    #[serde(default)]
    pub total_pages: i64,
    #[serde(default)]
    pub scroll_offset: f64,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub epub_cfi: String,
    #[serde(default)]
    pub cover_thumbnail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRect {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookHighlight {
    pub id: String,
    pub book_id: String,
    pub page_number: i64,
    pub quote: String,
    pub note: String,
    pub color: String, // "brass" | "sage" | "amber"
    pub cfi_range: String,
    #[serde(default)]
    pub rects: Vec<HighlightRect>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReadingProgress {
    pub logical_date: String,
    pub pages_read_today: i64,
    pub target_pages: i64,
    pub goal_completed: bool,
    pub goal_auto_checked_now: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocNode {
    pub id: String,
    pub kind: String, // "constraint" | "assumption" | "injection" | "objective"
    pub title: String,
    pub body: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocTreeRecord {
    pub id: String,
    pub title: String,
    pub framework_type: String, // "crt" | "cloud" | "frt_nbr" | "prt_trt" | "five_steps"
    pub tags: Vec<String>,
    pub attached_to_debrief_date: Option<String>,
    pub graph_json: String,
    pub vault_file_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBlockHourly {
    pub date: String,
    pub slot_index: i64, // 0..23 representing rollover_hour:00 through rollover_hour-1:00 next morning
    pub label: String,
    pub category: String, // "deep_work" | "strategy" | "admin" | "break" | "custom"
    pub source: String,   // "manual" | "focus_timer"
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCalendarEvent {
    pub id: String,
    pub feed_url: String,
    pub title: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub location: String,
    pub all_day: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyDebriefRecord {
    pub logical_date: String,
    pub memories: String,
    pub gratitude1: String,
    pub gratitude2: String,
    pub gratitude3: String,
    pub closing_thought: String,
    pub published: bool,
    pub vault_file_path: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTelemetryRecord {
    pub logical_date: String,
    pub sleep_hours: Option<f64>,
    pub screen_time_minutes: Option<i64>,
    pub source: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallReviewLog {
    pub id: String,
    pub card_hash: String,
    pub source_category: String,
    pub rating: i64,
    pub logical_date: String,
    pub reviewed_at: String,
}

pub fn init_database(db_path: &PathBuf) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating db dir: {e}"))?;
    }
    let conn = Connection::open(db_path).map_err(|e| format!("Failed opening SQLite db: {e}"))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            title TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 30,
            completed INTEGER NOT NULL DEFAULT 0,
            priority TEXT NOT NULL DEFAULT 'medium',
            due_date TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            recurrence TEXT NOT NULL DEFAULT '',
            specific_days TEXT NOT NULL DEFAULT '',
            target_count INTEGER NOT NULL DEFAULT 1,
            current_count INTEGER NOT NULL DEFAULT 0,
            unit_label TEXT NOT NULL DEFAULT '',
            last_reset_period TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS goal_milestones (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            title TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goal_completions (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            goal_title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            logical_date TEXT NOT NULL,
            period_key TEXT NOT NULL DEFAULT '',
            logged_value INTEGER NOT NULL DEFAULT 1,
            target_value INTEGER NOT NULL DEFAULT 1,
            completed_at TEXT NOT NULL
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

        CREATE TABLE IF NOT EXISTS imported_activity_days (
            date TEXT PRIMARY KEY,
            focus_minutes INTEGER NOT NULL DEFAULT 0,
            goals_completed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS schedule_blocks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Deep Work',
            date TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_focus_blocks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            linked_goal_id TEXT,
            category TEXT NOT NULL DEFAULT 'Deep Work',
            start_time TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            cadence TEXT NOT NULL DEFAULT 'daily',
            specific_days TEXT NOT NULL DEFAULT '',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_block_overrides (
            block_id TEXT NOT NULL,
            logical_date TEXT NOT NULL,
            status TEXT NOT NULL,
            override_start_time TEXT,
            override_duration_minutes INTEGER,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (block_id, logical_date)
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            mood TEXT NOT NULL DEFAULT 'Clear',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS library_books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'reading',
            progress_percent INTEGER NOT NULL DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL DEFAULT '',
            format TEXT NOT NULL DEFAULT 'pdf',
            current_page INTEGER NOT NULL DEFAULT 1,
            total_pages INTEGER NOT NULL DEFAULT 0,
            scroll_offset REAL NOT NULL DEFAULT 0,
            last_opened_at TEXT,
            epub_cfi TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS book_highlights (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            page_number INTEGER NOT NULL DEFAULT 1,
            quote TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT 'brass',
            cfi_range TEXT NOT NULL DEFAULT '',
            rects_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_reading_pages (
            logical_date TEXT NOT NULL,
            book_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            recorded_at TEXT NOT NULL,
            PRIMARY KEY (logical_date, book_id, page_number)
        );

        CREATE TABLE IF NOT EXISTS toc_nodes (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS toc_trees (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            framework_type TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            attached_to_debrief_date TEXT,
            graph_json TEXT NOT NULL,
            vault_file_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_blocks_30m (
            date TEXT NOT NULL,
            slot_index INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'deep_work',
            source TEXT NOT NULL DEFAULT 'manual',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (date, slot_index)
        );

        CREATE TABLE IF NOT EXISTS activity_blocks_hourly (
            date TEXT NOT NULL,
            slot_index INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'deep_work',
            source TEXT NOT NULL DEFAULT 'manual',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (date, slot_index)
        );

        CREATE TABLE IF NOT EXISTS external_calendar_events (
            id TEXT PRIMARY KEY,
            feed_url TEXT NOT NULL,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            location TEXT NOT NULL DEFAULT '',
            all_day INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_debriefs (
            logical_date TEXT PRIMARY KEY,
            memories TEXT NOT NULL DEFAULT '',
            gratitude1 TEXT NOT NULL DEFAULT '',
            gratitude2 TEXT NOT NULL DEFAULT '',
            gratitude3 TEXT NOT NULL DEFAULT '',
            closing_thought TEXT NOT NULL DEFAULT '',
            published INTEGER NOT NULL DEFAULT 0,
            vault_file_path TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_device_telemetry (
            logical_date TEXT PRIMARY KEY,
            sleep_hours REAL,
            screen_time_minutes INTEGER,
            source TEXT NOT NULL DEFAULT 'ios_shortcut',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recall_cards (
            card_hash TEXT PRIMARY KEY,
            source_file TEXT NOT NULL,
            source_category TEXT NOT NULL,
            ease_factor REAL NOT NULL DEFAULT 2.5,
            interval_days INTEGER NOT NULL DEFAULT 0,
            next_due_logical_date TEXT NOT NULL,
            review_count INTEGER NOT NULL DEFAULT 0,
            last_reviewed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS recall_reviews (
            id TEXT PRIMARY KEY,
            card_hash TEXT NOT NULL,
            source_category TEXT NOT NULL,
            rating INTEGER NOT NULL,
            logical_date TEXT NOT NULL,
            reviewed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed creating SQLite schema: {e}"))?;

    // Safely add expanded Library reader, Goals, and Focus Session columns to any existing database without data loss.
    ensure_library_columns(&conn)?;
    ensure_book_highlights_columns(&conn)?;
    ensure_goals_columns(&conn)?;
    ensure_focus_session_columns(&conn)?;

    // One-time cleanup of any legacy Phase 1 mock seed rows if an existing DB predates this update.
    // Never inserts fabricated data.
    purge_legacy_mock_seeds(&conn)?;

    // One-time zero-loss migration of any existing 30-minute block entries into the 24-hour logical Day Log
    migrate_30m_blocks_to_hourly(&conn)?;

    Ok(conn)
}

fn purge_legacy_mock_seeds(conn: &Connection) -> Result<(), String> {
    let already_purged: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'mock_seed_purged_v1'",
            [],
            |r| r.get(0),
        )
        .ok();

    if already_purged.is_some() {
        return Ok(());
    }

    let had_mock_goals: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE id IN (
                'g-d-1','g-d-2','g-d-3','g-d-4',
                'g-w-1','g-w-2','g-w-3','g-w-4','g-w-5',
                'g-l-1','g-l-2','g-l-3'
            )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let session_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions", [], |r| r.get(0))
        .unwrap_or(0);

    conn.execute_batch(
        "
        DELETE FROM goals WHERE id IN (
            'g-d-1','g-d-2','g-d-3','g-d-4',
            'g-w-1','g-w-2','g-w-3','g-w-4','g-w-5',
            'g-l-1','g-l-2','g-l-3'
        );
        DELETE FROM sticky_notes WHERE id IN ('note-1','note-2');
        DELETE FROM schedule_blocks WHERE id IN ('sb-1','sb-2','sb-3','sb-4');
        DELETE FROM library_books WHERE id IN ('bk-1','bk-2','bk-3','bk-4');
        DELETE FROM journal_entries WHERE id IN ('j-1');
        DELETE FROM toc_nodes WHERE id IN ('toc-1','toc-2','toc-3');
        ",
    )
    .map_err(|e| format!("Failed purging legacy mock rows: {e}"))?;

    // If the database previously held the synthetic 60-day seeded heatmap and zero real focus sessions,
    // clear the synthetic heatmap rows so only real imported or newly recorded activity appears.
    if had_mock_goals > 0 && session_count == 0 {
        conn.execute("DELETE FROM daily_activity", [])
            .map_err(|e| format!("Failed clearing legacy synthetic daily_activity: {e}"))?;
    }

    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('mock_seed_purged_v1', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    )
    .map_err(|e| format!("Failed recording purge state: {e}"))?;

    Ok(())
}

fn migrate_30m_blocks_to_hourly(conn: &Connection) -> Result<(), String> {
    let already: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'migrated_30m_to_hourly_v1'",
            [],
            |r| r.get(0),
        )
        .ok();
    if already.is_some() {
        return Ok(());
    }

    let _ = conn.execute(
        "INSERT OR IGNORE INTO activity_blocks_hourly (date, slot_index, label, category, source, updated_at)
         SELECT date, MIN(23, MAX(0, slot_index / 2)), label, category, source, updated_at
         FROM activity_blocks_30m",
        [],
    );

    let _ = conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('migrated_30m_to_hourly_v1', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    );
    Ok(())
}

fn ensure_library_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(library_books)")
        .map_err(|e| format!("Failed inspecting library_books columns: {e}"))?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed reading library_books columns: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let additions: [(&str, &str); 8] = [
        ("file_path", "TEXT NOT NULL DEFAULT ''"),
        ("format", "TEXT NOT NULL DEFAULT 'pdf'"),
        ("current_page", "INTEGER NOT NULL DEFAULT 1"),
        ("total_pages", "INTEGER NOT NULL DEFAULT 0"),
        ("scroll_offset", "REAL NOT NULL DEFAULT 0"),
        ("last_opened_at", "TEXT"),
        ("epub_cfi", "TEXT NOT NULL DEFAULT ''"),
        ("cover_thumbnail", "TEXT NOT NULL DEFAULT ''"),
    ];

    for (col, def) in additions {
        if !existing.iter().any(|c| c == col) {
            let sql = format!("ALTER TABLE library_books ADD COLUMN {col} {def}");
            conn.execute(&sql, [])
                .map_err(|e| format!("Failed adding column {col} to library_books: {e}"))?;
        }
    }
    Ok(())
}

fn ensure_book_highlights_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(book_highlights)")
        .map_err(|e| format!("Failed inspecting book_highlights columns: {e}"))?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed reading book_highlights columns: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if !existing.iter().any(|c| c == "rects_json") {
        conn.execute(
            "ALTER TABLE book_highlights ADD COLUMN rects_json TEXT NOT NULL DEFAULT '[]'",
            [],
        )
        .map_err(|e| format!("Failed adding column rects_json to book_highlights: {e}"))?;
    }
    Ok(())
}

fn ensure_goals_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(goals)")
        .map_err(|e| format!("Failed inspecting goals columns: {e}"))?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed reading goals columns: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let additions: [(&str, &str); 8] = [
        ("description", "TEXT NOT NULL DEFAULT ''"),
        ("category", "TEXT NOT NULL DEFAULT ''"),
        ("recurrence", "TEXT NOT NULL DEFAULT ''"),
        ("specific_days", "TEXT NOT NULL DEFAULT ''"),
        ("target_count", "INTEGER NOT NULL DEFAULT 1"),
        ("current_count", "INTEGER NOT NULL DEFAULT 0"),
        ("unit_label", "TEXT NOT NULL DEFAULT ''"),
        ("last_reset_period", "TEXT NOT NULL DEFAULT ''"),
    ];

    for (col, def) in additions {
        if !existing.iter().any(|c| c == col) {
            let sql = format!("ALTER TABLE goals ADD COLUMN {col} {def}");
            conn.execute(&sql, [])
                .map_err(|e| format!("Failed adding column {col} to goals: {e}"))?;
        }
    }
    Ok(())
}

fn ensure_focus_session_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(focus_sessions)")
        .map_err(|e| format!("Failed inspecting focus_sessions columns: {e}"))?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed reading focus_sessions columns: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let additions: [(&str, &str); 2] = [
        ("goal_id", "TEXT"),
        ("category", "TEXT NOT NULL DEFAULT 'deep_work'"),
    ];

    for (col, def) in additions {
        if !existing.iter().any(|c| c == col) {
            let sql = format!("ALTER TABLE focus_sessions ADD COLUMN {col} {def}");
            conn.execute(&sql, [])
                .map_err(|e| format!("Failed adding column {col} to focus_sessions: {e}"))?;
        }
    }
    Ok(())
}

/// Computes tonal heatmap intensity (0..4) from combined focus minutes and completed goals/habits
/// so days with completed goals or focus timers accurately illuminate the 60-day cadence.
pub fn compute_heatmap_level(focus_minutes: i64, goals_completed: i64) -> i64 {
    let score = focus_minutes.max(0) + goals_completed.max(0) * 15;
    if score <= 0 {
        0
    } else if score < 60 {
        1
    } else if score < 120 {
        2
    } else if score < 180 {
        3
    } else {
        4
    }
}
