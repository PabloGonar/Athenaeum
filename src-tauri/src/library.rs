use crate::db::{DailyReadingProgress, LibraryBook};
use chrono::Local;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[allow(dead_code)]
pub const DEFAULT_DAILY_READING_TARGET_PAGES: i64 = 10;

pub fn default_books_folder_path() -> String {
    String::new()
}

fn stable_book_id(file_path: &str) -> String {
    // Simple deterministic FNV-1a 64-bit hash so rescans keep identical book IDs
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in file_path.to_lowercase().as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("book-{hash:016x}")
}

fn title_case_if_slug(raw: &str) -> String {
    let has_upper = raw.chars().any(|c| c.is_uppercase());
    if has_upper {
        return raw.to_string();
    }
    raw.split_whitespace()
        .enumerate()
        .map(|(i, w)| {
            let lower = w.to_lowercase();
            if lower == "pm" || lower == "ai" || lower == "os" || lower == "ui" || lower == "ux" {
                return lower.to_uppercase();
            }
            if i > 0
                && matches!(
                    lower.as_str(),
                    "the" | "a" | "an" | "of" | "in" | "on" | "and" | "for" | "to" | "with"
                )
            {
                return lower;
            }
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_book_metadata_from_filename(path: &Path) -> (String, String, String) {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf")
        .to_lowercase();
    let format = if ext == "epub" { "epub" } else { "pdf" }.to_string();

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled Book")
        .trim()
        .to_string();

    // Strip common archive suffixes like " - PDF Room", "(z-lib.org)", etc.
    let mut cleaned = stem;
    for suffix in [
        " - PDF Room",
        " - pdfroom",
        " (PDF Room)",
        " (z-lib.org)",
        " (Z-Library)",
    ] {
        if let Some(stripped) = cleaned.strip_suffix(suffix) {
            cleaned = stripped.trim().to_string();
        }
    }

    // Replace underscores used as colons ("Lee Kuan Yew_ The Grand...")
    cleaned = cleaned.replace("_ ", ": ").replace('_', " ");

    // If filename looks like kebab-case slug with no spaces, convert hyphens to spaces
    if !cleaned.contains(' ') && cleaned.contains('-') {
        cleaned = cleaned.replace('-', " ");
    }

    let mut title = cleaned.clone();
    let mut author = "Library Volume".to_string();

    if let Some((left, right)) = cleaned.rsplit_once(" - ") {
        let r = right.trim();
        let l = left.trim();
        if !l.is_empty() && !r.is_empty() && r.len() <= 48 {
            title = l.to_string();
            author = r.to_string();
        }
    } else if let Some((left, right)) = cleaned.rsplit_once(" by ") {
        let r = right.trim();
        let l = left.trim();
        if !l.is_empty() && !r.is_empty() && r.len() <= 48 {
            title = l.to_string();
            author = r.to_string();
        }
    }

    title = title_case_if_slug(title.trim());
    if title.is_empty() {
        title = "Untitled Volume".to_string();
    }

    (title, author, format)
}

fn collect_book_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_book_files(&path, out);
        } else if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            let lower = ext.to_lowercase();
            if lower == "pdf" || lower == "epub" {
                out.push(path);
            }
        }
    }
}

pub fn list_all_books(conn: &Connection) -> Result<Vec<LibraryBook>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, author, status, progress_percent, notes,
                    file_path, format, current_page, total_pages, scroll_offset, last_opened_at, epub_cfi, cover_thumbnail
             FROM library_books
             ORDER BY
               CASE WHEN last_opened_at IS NULL OR last_opened_at = '' THEN 1 ELSE 0 END ASC,
               last_opened_at DESC,
               title ASC",
        )
        .map_err(|e| format!("Failed querying library_books: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LibraryBook {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                status: row.get(3)?,
                progress_percent: row.get(4)?,
                notes: row.get(5)?,
                file_path: row.get(6)?,
                format: row.get(7)?,
                current_page: row.get::<_, i64>(8)?.max(1),
                total_pages: row.get::<_, i64>(9)?.max(0),
                scroll_offset: row.get(10)?,
                last_opened_at: row.get(11)?,
                epub_cfi: row.get(12)?,
                cover_thumbnail: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
            })
        })
        .map_err(|e| format!("Failed mapping library_books: {e}"))?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item.map_err(|e| format!("Book read error: {e}"))?);
    }
    Ok(items)
}

pub fn scan_books_directory(
    conn: &Connection,
    folder_path: &str,
) -> Result<Vec<LibraryBook>, String> {
    let trimmed = folder_path.trim();
    let root = if trimmed.is_empty() {
        PathBuf::from(default_books_folder_path())
    } else {
        PathBuf::from(trimmed)
    };

    if !root.exists() {
        let _ = fs::create_dir_all(&root);
    }

    // Build lookup of existing books by normalized file_path so we never overwrite progress
    let existing = list_all_books(conn)?;
    let mut by_path: HashMap<String, LibraryBook> = HashMap::new();
    for b in existing {
        if !b.file_path.trim().is_empty() {
            by_path.insert(b.file_path.to_lowercase(), b);
        }
    }

    let mut found_files = Vec::new();
    collect_book_files(&root, &mut found_files);

    for path in found_files {
        let full_path = path.to_string_lossy().to_string();
        let key = full_path.to_lowercase();
        if by_path.contains_key(&key) {
            continue;
        }
        let (title, author, format) = parse_book_metadata_from_filename(&path);
        let id = stable_book_id(&full_path);

        conn.execute(
            "INSERT OR IGNORE INTO library_books
             (id, title, author, status, progress_percent, notes, file_path, format, current_page, total_pages, scroll_offset, last_opened_at, epub_cfi)
             VALUES (?1, ?2, ?3, 'queued', 0, '', ?4, ?5, 1, 0, 0.0, NULL, '')",
            params![id, title, author, full_path, format],
        )
        .map_err(|e| format!("Failed indexing book {}: {e}", full_path))?;
    }

    list_all_books(conn)
}

pub fn import_external_book(
    conn: &Connection,
    books_folder_path: &str,
    source_path: &str,
) -> Result<LibraryBook, String> {
    let src = PathBuf::from(source_path.trim());
    if !src.exists() {
        return Err(format!("Selected book file not found: {}", src.display()));
    }

    let folder = PathBuf::from(if books_folder_path.trim().is_empty() {
        default_books_folder_path()
    } else {
        books_folder_path.trim().to_string()
    });
    let _ = fs::create_dir_all(&folder);

    // Copy into books_folder_path if it lives outside, unless same file already exists there
    let final_path = if src.starts_with(&folder) {
        src.clone()
    } else if let Some(file_name) = src.file_name() {
        let dest = folder.join(file_name);
        if !dest.exists() {
            match fs::copy(&src, &dest) {
                Ok(_) => dest,
                Err(_) => src.clone(), // Fallback to linking original path directly
            }
        } else {
            dest
        }
    } else {
        src.clone()
    };

    let full_path = final_path.to_string_lossy().to_string();
    let (title, author, format) = parse_book_metadata_from_filename(&final_path);
    let id = stable_book_id(&full_path);

    conn.execute(
        "INSERT OR IGNORE INTO library_books
         (id, title, author, status, progress_percent, notes, file_path, format, current_page, total_pages, scroll_offset, last_opened_at, epub_cfi)
         VALUES (?1, ?2, ?3, 'queued', 0, '', ?4, ?5, 1, 0, 0.0, NULL, '')",
        params![id, title, author, full_path, format],
    )
    .map_err(|e| format!("Failed inserting imported book: {e}"))?;

    let all = list_all_books(conn)?;
    all.into_iter()
        .find(|b| b.id == id || b.file_path.eq_ignore_ascii_case(&full_path))
        .ok_or_else(|| "Imported book not found after insert".to_string())
}

pub fn ensure_daily_reading_goal(
    conn: &Connection,
    logical_date: &str,
    target_pages: i64,
) -> Result<String, String> {
    let clamped_target = target_pages.clamp(1, 500);
    let goal_id = format!("daily-reading-{logical_date}");

    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM goals WHERE id = ?1 LIMIT 1",
            params![goal_id],
            |r| r.get(0),
        )
        .ok();

    if let Some(id) = existing {
        return Ok(id);
    }

    // Prune stale auto-created daily-reading goals from prior logical days
    let _ = conn.execute(
        "DELETE FROM goals WHERE id LIKE 'daily-reading-%' AND id != ?1",
        params![goal_id],
    );

    let max_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM goals WHERE scope = 'daily'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(-1);

    let now = Local::now().to_rfc3339();
    let title = format!("Daily Reading ({clamped_target} pages)");
    conn.execute(
        "INSERT OR IGNORE INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at)
         VALUES (?1, 'daily', ?2, 0, 0, 'medium', ?3, ?4, ?5)",
        params![goal_id, title, logical_date, max_order + 1, now],
    )
    .map_err(|e| format!("Failed ensuring daily reading goal: {e}"))?;

    Ok(goal_id)
}

pub fn get_daily_reading_progress(
    conn: &Connection,
    logical_date: &str,
    habit_enabled: bool,
    target_pages: i64,
) -> Result<DailyReadingProgress, String> {
    let clamped_target = target_pages.clamp(1, 500);
    let pages_read: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM daily_reading_pages WHERE logical_date = ?1",
            params![logical_date],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let goal_completed = habit_enabled && pages_read >= clamped_target;

    Ok(DailyReadingProgress {
        logical_date: logical_date.to_string(),
        pages_read_today: pages_read,
        target_pages: clamped_target,
        goal_completed,
        goal_auto_checked_now: false,
    })
}

pub fn record_reading_page(
    conn: &Connection,
    logical_date: &str,
    book_id: &str,
    page_number: i64,
    habit_enabled: bool,
    target_pages: i64,
) -> Result<DailyReadingProgress, String> {
    let clamped_page = page_number.max(1);
    let clamped_target = target_pages.clamp(1, 500);
    let now = Local::now().to_rfc3339();

    conn.execute(
        "INSERT OR IGNORE INTO daily_reading_pages (logical_date, book_id, page_number, recorded_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![logical_date, book_id, clamped_page, now],
    )
    .map_err(|e| format!("Failed recording daily reading page: {e}"))?;

    let pages_read: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM daily_reading_pages WHERE logical_date = ?1",
            params![logical_date],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut goal_auto_checked_now = false;
    let goal_completed = habit_enabled && pages_read >= clamped_target;

    if goal_completed {
        let goal_id = ensure_daily_reading_goal(conn, logical_date, clamped_target)?;
        let already_done: i64 = conn
            .query_row(
                "SELECT completed FROM goals WHERE id = ?1",
                params![goal_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if already_done == 0 {
            let _ = conn.execute(
                "UPDATE goals SET completed = 1 WHERE id = ?1",
                params![goal_id],
            );
            let _ = conn.execute(
                "INSERT INTO goal_completions (id, goal_id, goal_title, category, logical_date, period_key, logged_value, target_value, completed_at)
                 VALUES (?1, ?2, ?3, 'reading', ?4, ?5, ?6, ?6, ?7)
                 ON CONFLICT(id) DO NOTHING",
                params![
                    format!("gc-reading-{logical_date}"),
                    goal_id,
                    format!("Daily Reading ({clamped_target} pages)"),
                    logical_date,
                    format!("daily:{logical_date}"),
                    clamped_target,
                    now
                ],
            );
            let _ = conn.execute(
                "INSERT INTO daily_activity (date, focus_minutes, goals_completed) VALUES (?1, 0, 1)
                 ON CONFLICT(date) DO UPDATE SET goals_completed = goals_completed + 1",
                params![logical_date],
            );
            goal_auto_checked_now = true;
        }
    }

    Ok(DailyReadingProgress {
        logical_date: logical_date.to_string(),
        pages_read_today: pages_read,
        target_pages: clamped_target,
        goal_completed,
        goal_auto_checked_now,
    })
}

pub fn pick_book_file_dialog() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Add Book to Athenaeum Library'
$dialog.Filter = 'Books (*.pdf;*.epub)|*.pdf;*.epub|PDF Documents (*.pdf)|*.pdf|EPUB Books (*.epub)|*.epub'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", ps_script])
            .output()
            .map_err(|e| format!("Failed launching book file picker: {e}"))?;
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose file of type {\"pdf\", \"epub\"} with prompt \"Add Book to Athenaeum Library\")",
            ])
            .output()
            .map_err(|e| format!("Failed launching macOS file picker: {e}"))?;
        if !output.status.success() {
            return Ok(None);
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Ok(None)
    }
}
