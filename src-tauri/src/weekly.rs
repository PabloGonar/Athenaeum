use crate::config::AthenaeumConfig;
use crate::logical_date::current_logical_naive_date;
use crate::vault::ensure_vault_structure;
use chrono::{Datelike, Duration, Local};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklySynthesisReport {
    pub week_key: String,
    pub start_date: String,
    pub end_date: String,
    pub total_focus_minutes: i64,
    pub total_focus_hours: f64,
    pub goals_completed: i64,
    pub goals_planned: i64,
    pub category_hours: HashMap<String, f64>,
    pub wins_excerpts: Vec<String>,
    pub gratitude_excerpts: Vec<String>,
    pub file_path: String,
    pub webhook_status: Option<String>,
    pub generated_at: String,
}

fn extract_markdown_section(raw: &str, heading: &str) -> Option<String> {
    let idx = raw.find(heading)?;
    let after = &raw[idx + heading.len()..];
    let next_heading = after.find("\n## ").unwrap_or(after.len());
    let body = after[..next_heading].trim();
    if body.is_empty() || body == "(None recorded)" {
        None
    } else {
        Some(body.to_string())
    }
}

pub fn build_weekly_synthesis_sync(
    conn: &Connection,
    cfg: &AthenaeumConfig,
) -> Result<WeeklySynthesisReport, String> {
    let today = current_logical_naive_date(cfg.day_rollover_hour);
    build_weekly_synthesis_for_end_date_sync(conn, cfg, today)
}

pub fn build_weekly_synthesis_for_end_date_sync(
    conn: &Connection,
    cfg: &AthenaeumConfig,
    end_day: chrono::NaiveDate,
) -> Result<WeeklySynthesisReport, String> {
    let start_day = end_day - Duration::days(6);
    let start_str = start_day.format("%Y-%m-%d").to_string();
    let end_str = end_day.format("%Y-%m-%d").to_string();
    let iso_week = end_day.iso_week();
    let week_key = format!("{}-W{:02}", iso_week.year(), iso_week.week());

    // 1. Focus minutes & completed goals from past 7 logical days
    let total_focus_minutes: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(focus_minutes), 0) FROM daily_activity WHERE date >= ?1 AND date <= ?2",
            params![start_str, end_str],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let activity_goals_done: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(goals_completed), 0) FROM daily_activity WHERE date >= ?1 AND date <= ?2",
            params![start_str, end_str],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let active_goals_planned: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE scope IN ('daily', 'weekly')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let active_goals_done: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE scope IN ('daily', 'weekly') AND completed = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let goals_completed = activity_goals_done.max(active_goals_done);
    let goals_planned = active_goals_planned.max(goals_completed);

    // 2. Hourly time distribution by category over past 7 logical days
    let mut category_hours: HashMap<String, f64> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT category, COUNT(*) FROM activity_blocks_hourly
         WHERE date >= ?1 AND date <= ?2
         GROUP BY category",
    ) {
        if let Ok(rows) = stmt.query_map(params![start_str, end_str], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }) {
            for r in rows.flatten() {
                category_hours.insert(r.0, r.1 as f64);
            }
        }
    }

    // 3. Extract wins & gratitudes from {vaultPath}/Daily/*.md over past 7 logical days
    let vault_root = ensure_vault_structure(&cfg.vault_path)?;
    let mut wins_excerpts = Vec::new();
    let mut gratitude_excerpts = Vec::new();

    for offset in (0..=6).rev() {
        let d = (end_day - Duration::days(offset)).format("%Y-%m-%d").to_string();
        let daily_file = vault_root.join("Daily").join(format!("{d}.md"));
        if let Ok(raw) = fs::read_to_string(&daily_file) {
            if let Some(wins) = extract_markdown_section(&raw, "## Memorable Moments & Wins") {
                wins_excerpts.push(format!("**{d}:** {wins}"));
            }
            if let Some(grats) =
                extract_markdown_section(&raw, "## 3 Specific Things I Am Grateful For")
            {
                let lines: Vec<String> = grats
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty() && !l.contains("(Empty)"))
                    .map(|l| l.to_string())
                    .collect();
                if !lines.is_empty() {
                    gratitude_excerpts.push(format!("**{d}:** {}", lines.join(" | ")));
                }
            }
        }
    }

    let total_focus_hours = (total_focus_minutes as f64) / 60.0;
    let generated_at = Local::now().to_rfc3339();

    let mut cat_lines: Vec<String> = category_hours
        .iter()
        .map(|(cat, hrs)| format!("- **{cat}:** {:.1}h", hrs))
        .collect();
    cat_lines.sort();
    let cat_md = if cat_lines.is_empty() {
        "- No hourly activity blocks logged during this window.".to_string()
    } else {
        cat_lines.join("\n")
    };

    let wins_md = if wins_excerpts.is_empty() {
        "- No Daily Debrief wins recorded in `/Daily` during this window.".to_string()
    } else {
        wins_excerpts
            .iter()
            .map(|w| format!("- {w}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let grats_md = if gratitude_excerpts.is_empty() {
        "- No Daily Debrief gratitudes recorded in `/Daily` during this window.".to_string()
    } else {
        gratitude_excerpts
            .iter()
            .map(|g| format!("- {g}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let review_path = vault_root
        .join("Reflections")
        .join(format!("{week_key}-Weekly-Review.md"));

    let md = format!(
        "---\ntype: weekly-synthesis\nweek: {week_key}\ndate: {end_str}\ntitle: \"{week_key} Weekly Review\"\ntags: [\"weekly-review\", \"synthesis\"]\nstart_date: {start_str}\nend_date: {end_str}\nfocus_hours: {:.2}\ngoals_completed: {goals_completed}\ngoals_planned: {goals_planned}\ngenerated_at: {generated_at}\n---\n\n# Weekly Review: {week_key} ({start_str} to {end_str})\n\n## Core Telemetry\n- **Total Focus:** {:.1}h ({total_focus_minutes} min)\n- **Goals Completed vs. Planned:** {goals_completed} / {goals_planned}\n\n## Hourly Time Distribution by Category\n{cat_md}\n\n## Highlights & Wins from Daily Debriefs\n{wins_md}\n\n## Gratitudes Archived This Week\n{grats_md}\n",
        total_focus_hours, total_focus_hours
    );

    fs::write(&review_path, md)
        .map_err(|e| format!("Failed writing Weekly Review markdown: {e}"))?;

    let _ = conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('weekly_synthesis_last_week', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![week_key],
    );

    Ok(WeeklySynthesisReport {
        week_key,
        start_date: start_str,
        end_date: end_str,
        total_focus_minutes,
        total_focus_hours,
        goals_completed,
        goals_planned,
        category_hours,
        wins_excerpts,
        gratitude_excerpts,
        file_path: review_path.to_string_lossy().to_string(),
        webhook_status: None,
        generated_at,
    })
}

pub async fn dispatch_n8n_weekly_digest(
    webhook_url: &str,
    report: &WeeklySynthesisReport,
) -> Option<String> {
    let trimmed = webhook_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let client = reqwest::Client::new();
    match client.post(trimmed).json(report).send().await {
        Ok(resp) => Some(format!("n8n webhook HTTP {}", resp.status().as_u16())),
        Err(err) => Some(format!("n8n webhook error: {err}")),
    }
}
