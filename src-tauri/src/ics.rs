use crate::db::ExternalCalendarEvent;
use chrono::{Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcsSyncReport {
    pub feeds_checked: usize,
    pub events_synced: usize,
    pub errors: Vec<String>,
}

/// Unfolds RFC 5545 folded lines (CRLF/LF followed by single space or tab).
fn unfold_ics(raw: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw_line in raw.lines() {
        let line = raw_line.trim_end_matches('\r');
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            if let Some(last) = lines.last_mut() {
                last.push_str(&line[1..]);
            }
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

fn unescape_ics_text(raw: &str) -> String {
    raw.replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .trim()
        .to_string()
}

/// Parses an ICS DTSTART/DTEND value into (YYYY-MM-DD, HH:MM, is_all_day).
fn parse_ics_datetime(value: &str) -> Option<(NaiveDate, String, bool)> {
    let clean = value.trim();
    if clean.len() == 8 && clean.chars().all(|c| c.is_ascii_digit()) {
        let date = NaiveDate::parse_from_str(clean, "%Y%m%d").ok()?;
        return Some((date, "00:00".to_string(), true));
    }

    if clean.ends_with('Z') && clean.len() >= 16 {
        let core = &clean[..15];
        let naive = NaiveDateTime::parse_from_str(core, "%Y%m%dT%H%M%S").ok()?;
        let utc_dt = Utc.from_utc_datetime(&naive);
        let local_dt = utc_dt.with_timezone(&Local);
        return Some((
            local_dt.date_naive(),
            local_dt.format("%H:%M").to_string(),
            false,
        ));
    }

    if clean.len() >= 15 && clean.as_bytes().get(8) == Some(&b'T') {
        let core = &clean[..15];
        let naive = NaiveDateTime::parse_from_str(core, "%Y%m%dT%H%M%S").ok()?;
        return Some((
            naive.date(),
            naive.format("%H:%M").to_string(),
            false,
        ));
    }

    None
}

pub fn parse_ics_content(
    raw: &str,
    feed_url: &str,
    window_start: NaiveDate,
    window_end: NaiveDate,
) -> Vec<ExternalCalendarEvent> {
    let lines = unfold_ics(raw);
    let mut events = Vec::new();
    let mut in_event = false;

    let mut uid = String::new();
    let mut summary = String::new();
    let mut location = String::new();
    let mut dtstart_raw = String::new();
    let mut dtend_raw = String::new();

    let now_iso = Local::now().to_rfc3339();

    for line in lines {
        let upper = line.to_ascii_uppercase();
        if upper == "BEGIN:VEVENT" {
            in_event = true;
            uid.clear();
            summary.clear();
            location.clear();
            dtstart_raw.clear();
            dtend_raw.clear();
            continue;
        }
        if upper == "END:VEVENT" {
            if in_event && !dtstart_raw.is_empty() {
                if let Some((start_date, start_hhmm, all_day)) = parse_ics_datetime(&dtstart_raw) {
                    if start_date >= window_start && start_date <= window_end {
                        let end_hhmm = if !dtend_raw.is_empty() {
                            parse_ics_datetime(&dtend_raw)
                                .map(|(_, t, _)| t)
                                .unwrap_or_else(|| start_hhmm.clone())
                        } else if all_day {
                            "23:59".to_string()
                        } else {
                            // Default 1h duration if DTEND missing
                            let parts: Vec<u32> = start_hhmm
                                .split(':')
                                .filter_map(|p| p.parse().ok())
                                .collect();
                            if parts.len() == 2 {
                                format!("{:02}:{:02}", (parts[0] + 1) % 24, parts[1])
                            } else {
                                start_hhmm.clone()
                            }
                        };

                        let event_title = if summary.trim().is_empty() {
                            "Calendar Event".to_string()
                        } else {
                            unescape_ics_text(&summary)
                        };

                        let id_seed = if uid.trim().is_empty() {
                            format!("{}-{}-{}", start_date, start_hhmm, event_title)
                        } else {
                            format!("{}-{}", uid.trim(), start_date)
                        };

                        events.push(ExternalCalendarEvent {
                            id: format!("ics_{}", id_seed.replace([' ', '/', '\\'], "_")),
                            feed_url: feed_url.to_string(),
                            title: event_title,
                            date: start_date.format("%Y-%m-%d").to_string(),
                            start_time: start_hhmm,
                            end_time: end_hhmm,
                            location: unescape_ics_text(&location),
                            all_day,
                            updated_at: now_iso.clone(),
                        });
                    }
                }
            }
            in_event = false;
            continue;
        }

        if !in_event {
            continue;
        }

        if let Some((prop, val)) = line.split_once(':') {
            let prop_name = prop.split(';').next().unwrap_or("").to_ascii_uppercase();
            match prop_name.as_str() {
                "UID" => uid = val.trim().to_string(),
                "SUMMARY" => summary = val.to_string(),
                "LOCATION" => location = val.to_string(),
                "DTSTART" => dtstart_raw = val.trim().to_string(),
                "DTEND" => dtend_raw = val.trim().to_string(),
                _ => {}
            }
        }
    }

    events
}

pub async fn fetch_feed_text(feed_url: &str) -> Result<String, String> {
    let trimmed = feed_url.trim();
    if trimmed.is_empty() {
        return Err("Empty ICS URL".to_string());
    }

    // Support local .ics files (either file:// or direct Windows/POSIX path) for offline feeds/testing
    if let Some(local_path) = trimmed.strip_prefix("file:///") {
        let p = PathBuf::from(local_path.replace('/', "\\"));
        return fs::read_to_string(&p)
            .map_err(|e| format!("Failed reading local ICS file {}: {e}", p.display()));
    }
    if PathBuf::from(trimmed).exists() {
        return fs::read_to_string(trimmed)
            .map_err(|e| format!("Failed reading local ICS file {trimmed}: {e}"));
    }

    let normalized = if let Some(rest) = trimmed.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        trimmed.to_string()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(&normalized)
        .header("User-Agent", "Athenaeum-CalendarSync/1.0")
        .send()
        .await
        .map_err(|e| format!("Failed fetching ICS feed {normalized}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ICS feed returned HTTP {}", resp.status().as_u16()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed reading ICS response body: {e}"))
}

pub fn store_synced_events(
    conn: &Connection,
    feed_url: &str,
    events: &[ExternalCalendarEvent],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM external_calendar_events WHERE feed_url = ?1",
        params![feed_url],
    )
    .map_err(|e| format!("Failed clearing stale ICS events: {e}"))?;

    for ev in events {
        conn.execute(
            "INSERT INTO external_calendar_events (id, feed_url, title, date, start_time, end_time, location, all_day, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                date = excluded.date,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                location = excluded.location,
                all_day = excluded.all_day,
                updated_at = excluded.updated_at",
            params![
                ev.id,
                ev.feed_url,
                ev.title,
                ev.date,
                ev.start_time,
                ev.end_time,
                ev.location,
                if ev.all_day { 1 } else { 0 },
                ev.updated_at
            ],
        )
        .map_err(|e| format!("Failed storing ICS event {}: {e}", ev.id))?;
    }
    Ok(())
}

pub fn sync_window_dates(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    (today - Duration::days(1), today + Duration::days(14))
}
