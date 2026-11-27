use crate::logical_date::{current_logical_date, current_logical_naive_date};
use crate::vault::ensure_vault_structure;
use chrono::{Duration, Local};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const DAILY_RECALL_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRecallItem {
    pub card_hash: String,
    pub source_file: String,
    pub source_file_name: String,
    pub source_category: String, // "book" | "toc" | "snippet"
    pub source_title: String,
    pub context_badge: String,
    pub cue: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallCardItem {
    pub card_hash: String,
    pub source_file: String,
    pub source_file_name: String,
    pub source_category: String,
    pub source_title: String,
    pub context_badge: String,
    pub cue: String,
    pub answer: String,
    pub ease_factor: f64,
    pub interval_days: i64,
    pub next_due_logical_date: String,
    pub review_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallDeckState {
    pub logical_today: String,
    pub total_indexed: usize,
    pub total_due: usize,
    pub daily_limit: usize,
    pub reviewed_today: usize,
    pub due_cards: Vec<RecallCardItem>,
    pub weekly_reviews_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallReviewResult {
    pub card_hash: String,
    pub rating: i64,
    pub next_ease_factor: f64,
    pub next_interval_days: i64,
    pub next_due_logical_date: String,
    pub review_count: i64,
    pub deck: RecallDeckState,
}

/// Deterministic 64-bit FNV-1a hash so Vault cards retain SM-2 history cleanly across rescans.
pub fn compute_card_hash(category: &str, file_name: &str, cue: &str, answer: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in [category, file_name, cue.trim(), answer.trim()] {
        for &b in part.as_bytes() {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("rc-{hash:016x}")
}

fn strip_frontmatter(raw: &str) -> (HashMap<String, String>, &str) {
    let mut meta = HashMap::new();
    let trimmed = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = trimmed.strip_prefix("---\n").or_else(|| trimmed.strip_prefix("---\r\n")) {
        if let Some(end_idx) = rest.find("\n---").or_else(|| rest.find("\r\n---")) {
            let fm_block = &rest[..end_idx];
            for line in fm_block.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim().to_lowercase();
                    let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if !key.is_empty() {
                        meta.insert(key, val);
                    }
                }
            }
            let after_sep = &rest[end_idx + 4..];
            let body = after_sep.trim_start_matches(['\r', '\n']);
            return (meta, body);
        }
    }
    (meta, trimmed)
}

fn extract_heading_title(body: &str, fallback: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if let Some(h) = t.strip_prefix("# ") {
            let cleaned = h.trim();
            if !cleaned.is_empty() {
                return cleaned.to_string();
            }
        }
    }
    fallback.to_string()
}

fn parse_book_markdown(path: &Path, raw: &str) -> Vec<ParsedRecallItem> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let fallback_title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Book Notes".to_string());
    let (meta, body) = strip_frontmatter(raw);
    let book_title = meta
        .get("title")
        .filter(|s| !s.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| extract_heading_title(body, &fallback_title));

    let mut items = Vec::new();
    let mut current_heading = String::new();
    let mut quote_lines: Vec<String> = Vec::new();
    let mut note_lines: Vec<String> = Vec::new();

    let flush = |heading: &str,
                 quotes: &mut Vec<String>,
                 notes: &mut Vec<String>,
                 out: &mut Vec<ParsedRecallItem>| {
        let q = quotes.join("\n").trim().to_string();
        let n = notes.join("\n").trim().to_string();
        quotes.clear();
        notes.clear();
        if q.is_empty() && n.is_empty() {
            return;
        }
        let page_ref = heading
            .split('·')
            .next()
            .unwrap_or(heading)
            .trim()
            .to_string();
        let context = if page_ref.is_empty() {
            book_title.clone()
        } else {
            format!("{book_title}, {page_ref}")
        };
        let (cue, answer) = if !n.is_empty() && !q.is_empty() {
            (n, q)
        } else if !q.is_empty() {
            (
                format!("Recall the core highlighted passage from {context}."),
                q,
            )
        } else {
            (
                format!("Recall your margin insight from {context}."),
                n,
            )
        };
        let hash = compute_card_hash("book", &file_name, &cue, &answer);
        out.push(ParsedRecallItem {
            card_hash: hash,
            source_file: path.to_string_lossy().to_string(),
            source_file_name: file_name.clone(),
            source_category: "book".to_string(),
            source_title: book_title.clone(),
            context_badge: context,
            cue,
            answer,
        });
    };

    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(h2) = trimmed.strip_prefix("## ") {
            flush(&current_heading, &mut quote_lines, &mut note_lines, &mut items);
            current_heading = h2.trim().to_string();
            continue;
        }
        if current_heading.is_empty() {
            continue;
        }
        if let Some(q) = trimmed.strip_prefix("> ") {
            quote_lines.push(q.trim().to_string());
        } else if trimmed == ">" {
            continue;
        } else if !trimmed.is_empty() && !trimmed.starts_with("*By ") && !trimmed.starts_with("---") {
            note_lines.push(trimmed.to_string());
        }
    }
    flush(&current_heading, &mut quote_lines, &mut note_lines, &mut items);

    items
}

fn parse_toc_markdown(path: &Path, raw: &str) -> Vec<ParsedRecallItem> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let fallback_title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "TOC Analysis".to_string());
    let (meta, body) = strip_frontmatter(raw);
    let session_title = meta
        .get("title")
        .filter(|s| !s.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| extract_heading_title(body, &fallback_title));

    let mut items = Vec::new();
    let mut in_assumptions = false;
    let mut current_edge = String::new();
    let mut current_answers: Vec<String> = Vec::new();

    let flush_edge = |edge: &str, answers: &mut Vec<String>, out: &mut Vec<ParsedRecallItem>| {
        let ans = answers.join("\n").trim().to_string();
        answers.clear();
        if edge.trim().is_empty() || ans.is_empty() {
            return;
        }
        let cue = format!(
            "In \"{session_title}\", what hidden assumption or injection resolves: {edge}?"
        );
        let hash = compute_card_hash("toc", &file_name, &cue, &ans);
        out.push(ParsedRecallItem {
            card_hash: hash,
            source_file: path.to_string_lossy().to_string(),
            source_file_name: file_name.clone(),
            source_category: "toc".to_string(),
            source_title: session_title.clone(),
            context_badge: format!("TOC · {session_title}"),
            cue,
            answer: ans,
        });
    };

    let mut conflict_nodes: Vec<String> = Vec::new();
    let mut injection_nodes: Vec<String> = Vec::new();
    let mut five_steps_goal = String::new();
    let mut five_steps_identify = String::new();
    let mut five_steps_exploit = String::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            if in_assumptions {
                flush_edge(&current_edge, &mut current_answers, &mut items);
                current_edge.clear();
            }
            in_assumptions = trimmed.eq_ignore_ascii_case("## Surfaced Assumptions & Injections");
            continue;
        }

        if in_assumptions {
            if let Some(rest) = trimmed.strip_prefix("- **") {
                flush_edge(&current_edge, &mut current_answers, &mut items);
                current_edge = rest
                    .trim_end_matches(":**")
                    .trim_end_matches("**")
                    .trim_end_matches(':')
                    .trim()
                    .to_string();
            } else if trimmed.starts_with("- Assumption:")
                || trimmed.starts_with("- **Winning Injection:**")
            {
                let clean = trimmed
                    .trim_start_matches("- ")
                    .replace("**Winning Injection:**", "Winning Injection:")
                    .trim()
                    .to_string();
                if !clean.is_empty() {
                    current_answers.push(clean);
                }
            }
        } else {
            // Also scan Node Ledger for conflict/obstacle/UDE vs injection nodes
            if trimmed.contains("`[CONFLICT]`")
                || trimmed.contains("`[UDE]`")
                || trimmed.contains("`[OBSTACLE]`")
                || trimmed.contains("`[ROOT_CAUSE]`")
            {
                conflict_nodes.push(trimmed.trim_start_matches("- ").replace("**", ""));
            } else if trimmed.contains("`[INJECTION]`") || trimmed.contains("`[INTERMEDIATE]`") {
                injection_nodes.push(trimmed.trim_start_matches("- ").replace("**", ""));
            } else if let Some(v) = trimmed.strip_prefix("- **System Goal:**") {
                five_steps_goal = v.trim().to_string();
            } else if trimmed.starts_with("### 1. Identify") {
                // Handled by next non-empty line if needed
            } else if !five_steps_goal.is_empty() && trimmed.starts_with("- **Identify") {
                five_steps_identify = trimmed.to_string();
            } else if !five_steps_goal.is_empty() && trimmed.starts_with("- **Exploit") {
                five_steps_exploit = trimmed.to_string();
            }
        }
    }

    if in_assumptions {
        flush_edge(&current_edge, &mut current_answers, &mut items);
    }

    // Fallback: if TOC file had conflict/UDE nodes and injection nodes without edge annotations
    if items.is_empty() && !conflict_nodes.is_empty() && !injection_nodes.is_empty() {
        let cue = format!(
            "In \"{session_title}\", what injection resolves {}?",
            conflict_nodes[0]
        );
        let ans = injection_nodes.join("\n");
        let hash = compute_card_hash("toc", &file_name, &cue, &ans);
        items.push(ParsedRecallItem {
            card_hash: hash,
            source_file: path.to_string_lossy().to_string(),
            source_file_name: file_name.clone(),
            source_category: "toc".to_string(),
            source_title: session_title.clone(),
            context_badge: format!("TOC · {session_title}"),
            cue,
            answer: ans,
        });
    } else if items.is_empty() && !five_steps_goal.is_empty() && (!five_steps_identify.is_empty() || !five_steps_exploit.is_empty()) {
        let cue = format!("In \"{session_title}\", what is the core constraint for goal \"{five_steps_goal}\"?");
        let ans = [five_steps_identify, five_steps_exploit]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        let hash = compute_card_hash("toc", &file_name, &cue, &ans);
        items.push(ParsedRecallItem {
            card_hash: hash,
            source_file: path.to_string_lossy().to_string(),
            source_file_name: file_name,
            source_category: "toc".to_string(),
            source_title: session_title.clone(),
            context_badge: format!("TOC · {session_title}"),
            cue,
            answer: ans,
        });
    }

    items
}

fn contains_recall_tag(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("#recall")
}

fn strip_recall_tag(text: &str) -> String {
    text.replace("#recall", "")
        .replace("#Recall", "")
        .replace("#RECALL", "")
        .trim()
        .to_string()
}

fn parse_snippet_markdown(path: &Path, folder_label: &str, raw: &str) -> Vec<ParsedRecallItem> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let fallback_title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vault Note".to_string());
    let (meta, body) = strip_frontmatter(raw);
    let note_title = meta
        .get("title")
        .filter(|s| !s.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| extract_heading_title(body, &fallback_title));

    let mut items = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Pattern A: Any line/bullet with `#recall` and `::` separator (Question :: Answer)
        if contains_recall_tag(trimmed) && trimmed.contains("::") {
            let cleaned = strip_recall_tag(
                trimmed
                    .trim_start_matches("- ")
                    .trim_start_matches("* ")
                    .trim(),
            );
            if let Some((q, a)) = cleaned.split_once("::") {
                let cue = q.trim().to_string();
                let answer = a.trim().to_string();
                if !cue.is_empty() && !answer.is_empty() {
                    let hash = compute_card_hash("snippet", &file_name, &cue, &answer);
                    items.push(ParsedRecallItem {
                        card_hash: hash,
                        source_file: path.to_string_lossy().to_string(),
                        source_file_name: file_name.clone(),
                        source_category: "snippet".to_string(),
                        source_title: note_title.clone(),
                        context_badge: format!("{folder_label} · {note_title}"),
                        cue,
                        answer,
                    });
                }
            }
            i += 1;
            continue;
        }

        // Pattern B: Markdown heading containing `#recall` followed by body block
        if trimmed.starts_with('#') && contains_recall_tag(trimmed) {
            let cue = strip_recall_tag(trimmed.trim_start_matches('#').trim());
            let mut block_lines = Vec::new();
            i += 1;
            while i < lines.len() {
                let next_t = lines[i].trim();
                if next_t.starts_with('#') {
                    break;
                }
                if !next_t.is_empty() {
                    block_lines.push(next_t);
                }
                i += 1;
            }
            let answer = block_lines.join("\n").trim().to_string();
            if !cue.is_empty() && !answer.is_empty() {
                let hash = compute_card_hash("snippet", &file_name, &cue, &answer);
                items.push(ParsedRecallItem {
                    card_hash: hash,
                    source_file: path.to_string_lossy().to_string(),
                    source_file_name: file_name.clone(),
                    source_category: "snippet".to_string(),
                    source_title: note_title.clone(),
                    context_badge: format!("{folder_label} · {note_title}"),
                    cue,
                    answer,
                });
            }
            continue;
        }

        // Pattern C: Standalone bullet/paragraph tagged `#recall` (without `::`)
        if contains_recall_tag(trimmed) {
            let answer = strip_recall_tag(
                trimmed
                    .trim_start_matches("- ")
                    .trim_start_matches("* ")
                    .trim(),
            );
            if !answer.is_empty() {
                let cue = format!("Recall your #recall note from \"{note_title}\" ({folder_label}).");
                let hash = compute_card_hash("snippet", &file_name, &cue, &answer);
                items.push(ParsedRecallItem {
                    card_hash: hash,
                    source_file: path.to_string_lossy().to_string(),
                    source_file_name: file_name.clone(),
                    source_category: "snippet".to_string(),
                    source_title: note_title.clone(),
                    context_badge: format!("{folder_label} · {note_title}"),
                    cue,
                    answer,
                });
            }
        }

        i += 1;
    }

    // Pattern D: Frontmatter tags include "recall" (e.g. tags: ["recall"]) and no inline blocks matched
    if items.is_empty() {
        if let Some(tags) = meta.get("tags") {
            if tags.to_lowercase().contains("recall") {
                let clean_body = body
                    .lines()
                    .filter(|l| !l.trim().starts_with("# "))
                    .collect::<Vec<_>>()
                    .join("\n")
                    .trim()
                    .to_string();
                if !clean_body.is_empty() {
                    let cue = format!("Recall the key synthesis from \"{note_title}\".");
                    let hash = compute_card_hash("snippet", &file_name, &cue, &clean_body);
                    items.push(ParsedRecallItem {
                        card_hash: hash,
                        source_file: path.to_string_lossy().to_string(),
                        source_file_name: file_name,
                        source_category: "snippet".to_string(),
                        source_title: note_title.clone(),
                        context_badge: format!("{folder_label} · {note_title}"),
                        cue,
                        answer: clean_body,
                    });
                }
            }
        }
    }

    items
}

pub fn scan_vault_recall_items(vault_path: &str) -> Result<Vec<ParsedRecallItem>, String> {
    let root = ensure_vault_structure(vault_path)?;
    let mut all = Vec::new();

    let scan_dir = |dir: PathBuf,
                    parser: &dyn Fn(&Path, &str) -> Vec<ParsedRecallItem>,
                    out: &mut Vec<ParsedRecallItem>| {
        if let Ok(entries) = fs::read_dir(&dir) {
            let mut paths: Vec<PathBuf> = entries
                .filter_map(|e| e.ok().map(|x| x.path()))
                .filter(|p| {
                    p.is_file()
                        && p.extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.eq_ignore_ascii_case("md"))
                            .unwrap_or(false)
                })
                .collect();
            paths.sort();
            for p in paths {
                if let Ok(raw) = fs::read_to_string(&p) {
                    out.extend(parser(&p, &raw));
                }
            }
        }
    };

    scan_dir(root.join("Books"), &parse_book_markdown, &mut all);
    scan_dir(root.join("TOC"), &parse_toc_markdown, &mut all);
    scan_dir(
        root.join("Reflections"),
        &|p, r| parse_snippet_markdown(p, "Reflections", r),
        &mut all,
    );
    scan_dir(
        root.join("Inbox"),
        &|p, r| parse_snippet_markdown(p, "Inbox", r),
        &mut all,
    );

    Ok(all)
}

pub fn get_recall_deck_state(
    conn: &Connection,
    vault_path: &str,
    cutoff_hour: u32,
) -> Result<RecallDeckState, String> {
    let logical_today = current_logical_date(cutoff_hour);
    let parsed_items = scan_vault_recall_items(vault_path)?;

    // Ensure every discovered card has an SM-2 scheduling row in SQLite
    for item in &parsed_items {
        let _ = conn.execute(
            "INSERT INTO recall_cards (card_hash, source_file, source_category, ease_factor, interval_days, next_due_logical_date, review_count)
             VALUES (?1, ?2, ?3, 2.5, 0, ?4, 0)
             ON CONFLICT(card_hash) DO UPDATE SET
                source_file = excluded.source_file,
                source_category = excluded.source_category",
            params![
                item.card_hash,
                item.source_file,
                item.source_category,
                logical_today
            ],
        );
    }

    // Load SM-2 metadata
    let mut meta_map: HashMap<String, (f64, i64, String, i64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT card_hash, ease_factor, interval_days, next_due_logical_date, review_count
                 FROM recall_cards",
            )
            .map_err(|e| format!("Failed querying recall_cards: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| format!("Failed mapping recall_cards: {e}"))?;
        for r in rows.flatten() {
            meta_map.insert(r.0, (r.1, r.2, r.3, r.4));
        }
    }

    let reviewed_today: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM recall_reviews WHERE logical_date = ?1",
            params![logical_today],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as usize;

    let week_ago = (current_logical_naive_date(cutoff_hour) - Duration::days(6))
        .format("%Y-%m-%d")
        .to_string();
    let weekly_reviews_count: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM recall_reviews WHERE logical_date >= ?1",
            params![week_ago],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as usize;

    let mut all_due: Vec<RecallCardItem> = Vec::new();
    for item in &parsed_items {
        let (ease, interval, next_due, count) = meta_map
            .get(&item.card_hash)
            .cloned()
            .unwrap_or((2.5, 0, logical_today.clone(), 0));
        if next_due <= logical_today {
            all_due.push(RecallCardItem {
                card_hash: item.card_hash.clone(),
                source_file: item.source_file.clone(),
                source_file_name: item.source_file_name.clone(),
                source_category: item.source_category.clone(),
                source_title: item.source_title.clone(),
                context_badge: item.context_badge.clone(),
                cue: item.cue.clone(),
                answer: item.answer.clone(),
                ease_factor: ease,
                interval_days: interval,
                next_due_logical_date: next_due,
                review_count: count,
            });
        }
    }

    // Prioritize oldest due cards first, then least-reviewed
    all_due.sort_by(|a, b| {
        a.next_due_logical_date
            .cmp(&b.next_due_logical_date)
            .then_with(|| a.review_count.cmp(&b.review_count))
            .then_with(|| a.card_hash.cmp(&b.card_hash))
    });

    let total_due = all_due.len();
    let remaining_slots = DAILY_RECALL_LIMIT.saturating_sub(reviewed_today);
    let due_cards = all_due.into_iter().take(remaining_slots).collect();

    Ok(RecallDeckState {
        logical_today,
        total_indexed: parsed_items.len(),
        total_due,
        daily_limit: DAILY_RECALL_LIMIT,
        reviewed_today,
        due_cards,
        weekly_reviews_count,
    })
}

pub fn apply_sm2_review(
    conn: &Connection,
    vault_path: &str,
    card_hash: &str,
    rating: i64,
    cutoff_hour: u32,
) -> Result<RecallReviewResult, String> {
    let clamped_rating = rating.clamp(1, 3);
    let today_naive = current_logical_naive_date(cutoff_hour);
    let logical_today = today_naive.format("%Y-%m-%d").to_string();
    let now_iso = Local::now().to_rfc3339();

    let (source_category, prev_ease, prev_interval, prev_count): (String, f64, i64, i64) = conn
        .query_row(
            "SELECT source_category, ease_factor, interval_days, review_count
             FROM recall_cards WHERE card_hash = ?1",
            params![card_hash],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Recall card not found ({card_hash}): {e}"))?;

    let (next_ease, next_interval) = match clamped_rating {
        1 => {
            // 1 · Forgot -> reset interval to 1 logical day
            ((prev_ease - 0.25).max(1.3), 1_i64)
        }
        2 => {
            // 2 · Hard / Partial -> shorter conservative interval
            let interval = if prev_interval <= 1 {
                2
            } else {
                ((prev_interval as f64) * 1.2).round() as i64
            };
            ((prev_ease - 0.14).max(1.3), interval.max(2).min(180))
        }
        _ => {
            // 3 · Solid -> expand interval via SM-2
            let interval = if prev_count == 0 || prev_interval <= 0 {
                3
            } else if prev_count == 1 || prev_interval <= 3 {
                6
            } else {
                ((prev_interval as f64) * prev_ease).round() as i64
            };
            ((prev_ease + 0.1).min(3.0), interval.max(3).min(365))
        }
    };

    let next_count = prev_count + 1;
    let next_due = (today_naive + Duration::days(next_interval))
        .format("%Y-%m-%d")
        .to_string();

    conn.execute(
        "UPDATE recall_cards
         SET ease_factor = ?1, interval_days = ?2, next_due_logical_date = ?3, review_count = ?4, last_reviewed_at = ?5
         WHERE card_hash = ?6",
        params![
            next_ease,
            next_interval,
            next_due,
            next_count,
            now_iso,
            card_hash
        ],
    )
    .map_err(|e| format!("Failed updating recall_cards: {e}"))?;

    let review_id = format!("rr-{}-{}", Local::now().timestamp_millis(), card_hash);
    conn.execute(
        "INSERT INTO recall_reviews (id, card_hash, source_category, rating, logical_date, reviewed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            review_id,
            card_hash,
            source_category,
            clamped_rating,
            logical_today,
            now_iso
        ],
    )
    .map_err(|e| format!("Failed inserting recall_reviews: {e}"))?;

    let deck = get_recall_deck_state(conn, vault_path, cutoff_hour)?;

    Ok(RecallReviewResult {
        card_hash: card_hash.to_string(),
        rating: clamped_rating,
        next_ease_factor: next_ease,
        next_interval_days: next_interval,
        next_due_logical_date: next_due,
        review_count: next_count,
        deck,
    })
}

pub fn open_vault_file_in_os(file_path: &str) -> Result<String, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() || !Path::new(trimmed).exists() {
        return Err("Vault file not found on disk".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("Failed opening Vault file: {e}"))?;
        Ok(format!("Opened {trimmed}"))
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed opening Vault file: {e}"))?;
        Ok(format!("Opened {trimmed}"))
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        use std::process::Command;
        let _ = Command::new("xdg-open").arg(trimmed).spawn();
        Ok(format!("Opened {trimmed}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_database;

    #[test]
    fn parses_books_toc_and_recall_snippets_and_schedules_sm2() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "athenaeum_recall_test_{}",
            Local::now().timestamp_nanos_opt().unwrap_or(7)
        ));
        let vault_dir = tmp_dir.join("vault");
        let db_path = tmp_dir.join("recall.db");
        let root = ensure_vault_structure(&vault_dir.to_string_lossy()).expect("vault");

        // 1. Seed Books/*.md highlight
        fs::write(
            root.join("Books").join("The Goal.md"),
            "---\ntitle: \"The Goal\"\n---\n\n# The Goal\n\n## p. 42 · 2026-11-23 19:00\n\n> An hour lost at a bottleneck is an hour lost for the entire system.\n\nWhy does protecting the bottleneck govern total throughput?\n",
        )
        .unwrap();

        // 2. Seed TOC/*.md strategic insight
        fs::write(
            root.join("TOC").join("2026-11-23 - Deep Work Cloud.md"),
            "---\ntitle: \"Deep Work Cloud\"\n---\n\n# Deep Work Cloud\n\n## Surfaced Assumptions & Injections\n- **Protect Deep Focus -> Instant Slack Replies:**\n  - Assumption: Teammates need sub-minute answers.\n  - **Winning Injection:** Publish a single daily 1:00 PM async response window.\n",
        )
        .unwrap();

        // 3. Seed Reflections/*.md #recall snippet
        fs::write(
            root.join("Reflections").join("2026-11-23 - Systems.md"),
            "---\ntitle: \"Systems Notes\"\n---\n\n- What is Little's Law? :: L = λW (WIP = Throughput x Cycle Time) #recall\n",
        )
        .unwrap();

        let conn = init_database(&db_path).expect("db");
        let vault_str = vault_dir.to_string_lossy().to_string();

        let deck = get_recall_deck_state(&conn, &vault_str, 3).expect("deck");
        assert_eq!(deck.total_indexed, 3);
        assert_eq!(deck.total_due, 3);
        assert_eq!(deck.due_cards.len(), 3);
        assert!(deck.due_cards.iter().any(|c| c.source_category == "book"));
        assert!(deck.due_cards.iter().any(|c| c.source_category == "toc"));
        assert!(deck.due_cards.iter().any(|c| c.source_category == "snippet"));

        // Rate card 1 as Solid (3) -> interval 3 days
        let first_hash = deck.due_cards[0].card_hash.clone();
        let res_solid = apply_sm2_review(&conn, &vault_str, &first_hash, 3, 3).expect("solid");
        assert_eq!(res_solid.next_interval_days, 3);
        assert_eq!(res_solid.deck.reviewed_today, 1);
        assert_eq!(res_solid.deck.total_due, 2);

        // Rate card 2 as Forgot (1) -> interval 1 day
        let second_hash = res_solid.deck.due_cards[0].card_hash.clone();
        let res_forgot = apply_sm2_review(&conn, &vault_str, &second_hash, 1, 3).expect("forgot");
        assert_eq!(res_forgot.next_interval_days, 1);
        assert_eq!(res_forgot.deck.reviewed_today, 2);
        assert_eq!(res_forgot.deck.total_due, 1);

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
