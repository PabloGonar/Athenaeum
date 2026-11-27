use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileEntry {
    pub file_name: String,
    pub file_path: String,
    pub date: String,
    pub title: String,
    pub tags: Vec<String>,
    pub content: String,
    pub body: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyDebriefPayload {
    pub logical_date: String,
    pub memories: String,
    pub gratitude1: String,
    pub gratitude2: String,
    pub gratitude3: String,
    pub closing_thought: String,
    pub completed_tasks: Vec<String>,
    pub focus_minutes: i64,
    pub block_highlights: Vec<String>,
    pub published: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionSaveInput {
    pub existing_file_name: Option<String>,
    pub logical_date: String,
    pub title: String,
    pub tags: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexedNote {
    pub folder: String, // "Reflections" | "Books" | "Daily" | "Inbox"
    pub file_name: String,
    pub file_path: String,
    pub title: String,
    pub date: String,
    pub tags: Vec<String>,
    pub body: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSearchResult {
    pub note: VaultIndexedNote,
    pub snippet: String,
    pub match_line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkMention {
    pub source_folder: String,
    pub source_file_name: String,
    pub source_title: String,
    pub source_date: String,
    pub context_line: String,
}

pub fn default_vault_path() -> String {
    if let Ok(profile) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        return PathBuf::from(profile)
            .join("Documents")
            .join("Athenaeum Notes")
            .to_string_lossy()
            .to_string();
    }
    "Athenaeum Notes".to_string()
}

pub fn ensure_vault_structure(vault_path: &str) -> Result<PathBuf, String> {
    let trimmed = vault_path.trim();
    let root = if trimmed.is_empty() {
        PathBuf::from(default_vault_path())
    } else {
        PathBuf::from(trimmed)
    };
    for sub in ["Daily", "Reflections", "Inbox", "Books", "TOC"] {
        let dir = root.join(sub);
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed creating vault folder {}: {e}", dir.display()))?;
    }
    Ok(root)
}

fn framework_display_name(ft: &str) -> &'static str {
    match ft {
        "crt" => "Current Reality Tree (CRT)",
        "cloud" => "Evaporating Cloud (Conflict Resolution)",
        "frt_nbr" => "Future Reality Tree & Negative Branch Reservation",
        "prt_trt" => "Prerequisite Tree / Transition Tree",
        "five_steps" => "The Five Focusing Steps (Throughput Audit)",
        _ => "Theory of Constraints Analysis",
    }
}

pub fn write_toc_tree_markdown(
    vault_path: &str,
    logical_date: &str,
    title: &str,
    framework_type: &str,
    tags: &[String],
    graph_json: &str,
) -> Result<String, String> {
    let root = ensure_vault_structure(vault_path)?;
    let display_title = if title.trim().is_empty() {
        "Untitled TOC Session".to_string()
    } else {
        title.trim().to_string()
    };
    let safe_title = sanitize_filename(&display_title, "Untitled TOC Session");
    let file_name = format!("{logical_date} - {safe_title}.md");
    let full_path = root.join("TOC").join(file_name);
    let now_iso = Local::now().to_rfc3339();

    let mut clean_tags: Vec<String> = tags
        .iter()
        .map(|t| t.trim().trim_start_matches('#').to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if !clean_tags.iter().any(|t| t.eq_ignore_ascii_case("toc")) {
        clean_tags.insert(0, "toc".to_string());
    }
    let tags_yaml = clean_tags
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(", ");

    let mut md = format!(
        "---\ntype: toc\nframework: \"{}\"\ndate: {}\ntitle: \"{}\"\ntags: [{}]\nupdated_at: {}\n---\n\n# {}\n\n*Framework: {}*\n",
        framework_type,
        logical_date,
        display_title.replace('"', "\\\""),
        tags_yaml,
        now_iso,
        display_title,
        framework_display_name(framework_type)
    );

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(graph_json) {
        if framework_type == "five_steps" {
            if let Some(fs_obj) = parsed.get("fiveSteps") {
                md.push_str("\n## System Definition & Throughput Accounting\n");
                let add_field = |buf: &mut String, label: &str, key: &str| {
                    if let Some(v) = fs_obj.get(key).and_then(|x| x.as_str()) {
                        if !v.trim().is_empty() {
                            buf.push_str(&format!("- **{label}:** {}\n", v.trim()));
                        }
                    }
                };
                add_field(&mut md, "System Goal", "systemGoal");
                add_field(&mut md, "Throughput (T)", "throughputT");
                add_field(&mut md, "Inventory / Investment (I)", "inventoryI");
                add_field(&mut md, "Operating Expense (OE)", "operatingExpenseOE");
                add_field(&mut md, "Drum-Buffer-Rope (DBR)", "dbrNotes");

                if let Some(steps) = fs_obj.get("steps") {
                    md.push_str("\n## The Five Focusing Steps\n");
                    for (num, label, key) in [
                        ("1", "Identify the Constraint", "identify"),
                        ("2", "Exploit the Constraint", "exploit"),
                        ("3", "Subordinate Everything Else", "subordinate"),
                        ("4", "Elevate the Constraint", "elevate"),
                        ("5", "Repeat & Prevent Inertia", "repeat"),
                    ] {
                        let val = steps
                            .get(key)
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .trim();
                        md.push_str(&format!(
                            "\n### {num}. {label}\n{}\n",
                            if val.is_empty() { "_Not yet specified._" } else { val }
                        ));
                    }
                }
            }
        } else {
            let nodes = parsed
                .get("nodes")
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default();
            let edges = parsed
                .get("edges")
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default();

            let mut node_map = std::collections::HashMap::<String, (String, String, String)>::new();
            for n in &nodes {
                let id = n.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let kind = n.get("kind").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let n_title = n.get("title").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
                let n_body = n.get("body").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
                if !id.is_empty() {
                    node_map.insert(id, (kind, n_title, n_body));
                }
            }

            // Key Breakthroughs: Core Problems, Injections, Trimming Injections
            let key_nodes: Vec<_> = nodes
                .iter()
                .filter(|n| {
                    matches!(
                        n.get("kind").and_then(|x| x.as_str()).unwrap_or(""),
                        "core_problem" | "injection" | "trimming_injection" | "objective"
                    )
                })
                .collect();
            if !key_nodes.is_empty() {
                md.push_str("\n## Key Strategic Nodes\n");
                for n in key_nodes {
                    let kind = n.get("kind").and_then(|x| x.as_str()).unwrap_or("");
                    let n_title = n.get("title").and_then(|x| x.as_str()).unwrap_or("").trim();
                    let n_body = n.get("body").and_then(|x| x.as_str()).unwrap_or("").trim();
                    let label = match kind {
                        "core_problem" => "Core Problem",
                        "injection" => "Injection",
                        "trimming_injection" => "Trimming Injection",
                        "objective" => "Objective (A)",
                        _ => kind,
                    };
                    if !n_title.is_empty() {
                        md.push_str(&format!("- **{label}:** {n_title}"));
                        if !n_body.is_empty() {
                            md.push_str(&format!(" ({n_body})"));
                        }
                        md.push('\n');
                    }
                }
            }

            // Surfaced Hidden Assumptions & Cloud Injections on Edges
            let mut assumption_lines = Vec::new();
            for e in &edges {
                let src = e.get("sourceId").and_then(|x| x.as_str()).unwrap_or("");
                let tgt = e.get("targetId").and_then(|x| x.as_str()).unwrap_or("");
                let src_title = node_map.get(src).map(|v| v.1.as_str()).unwrap_or(src);
                let tgt_title = node_map.get(tgt).map(|v| v.1.as_str()).unwrap_or(tgt);
                let assumptions = e
                    .get("assumptions")
                    .and_then(|x| x.as_array())
                    .cloned()
                    .unwrap_or_default();
                let inj = e.get("injection").and_then(|x| x.as_str()).unwrap_or("").trim();
                if !assumptions.is_empty() || !inj.is_empty() {
                    let mut block = format!("- **{src_title} -> {tgt_title}:**\n");
                    for a in assumptions {
                        if let Some(s) = a.as_str() {
                            if !s.trim().is_empty() {
                                block.push_str(&format!("  - Assumption: {}\n", s.trim()));
                            }
                        }
                    }
                    if !inj.is_empty() {
                        block.push_str(&format!("  - **Winning Injection:** {inj}\n"));
                    }
                    assumption_lines.push(block);
                }
            }
            if !assumption_lines.is_empty() {
                md.push_str("\n## Surfaced Assumptions & Injections\n");
                for line in assumption_lines {
                    md.push_str(&line);
                }
            }

            // Causal Chains (IF ... AND ... THEN ...)
            let mut incoming_by_target: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for e in &edges {
                let is_conflict = e.get("isConflict").and_then(|x| x.as_bool()).unwrap_or(false);
                if is_conflict {
                    continue;
                }
                let src = e.get("sourceId").and_then(|x| x.as_str()).unwrap_or("");
                let tgt = e.get("targetId").and_then(|x| x.as_str()).unwrap_or("");
                if !src.is_empty() && !tgt.is_empty() {
                    let src_title = node_map
                        .get(src)
                        .map(|v| v.1.clone())
                        .unwrap_or_else(|| src.to_string());
                    incoming_by_target
                        .entry(tgt.to_string())
                        .or_default()
                        .push(src_title);
                }
            }
            if !incoming_by_target.is_empty() {
                md.push_str("\n## Causal Logic Chains\n");
                for (tgt_id, causes) in incoming_by_target {
                    let effect_title = node_map
                        .get(&tgt_id)
                        .map(|v| v.1.as_str())
                        .unwrap_or(&tgt_id);
                    let joined = causes.join(" AND ");
                    md.push_str(&format!("- **IF** {joined}, **THEN** {effect_title}\n"));
                }
            }

            // Full Node Ledger
            if !nodes.is_empty() {
                md.push_str("\n## Node Ledger\n");
                for n in &nodes {
                    let kind = n.get("kind").and_then(|x| x.as_str()).unwrap_or("node").to_uppercase();
                    let n_title = n.get("title").and_then(|x| x.as_str()).unwrap_or("").trim();
                    let n_body = n.get("body").and_then(|x| x.as_str()).unwrap_or("").trim();
                    if !n_title.is_empty() {
                        md.push_str(&format!("- `[{kind}]` **{n_title}**"));
                        if !n_body.is_empty() {
                            md.push_str(&format!(": {n_body}"));
                        }
                        md.push('\n');
                    }
                }
            }
        }
    }

    fs::write(&full_path, md)
        .map_err(|e| format!("Failed writing TOC markdown file {}: {e}", full_path.display()))?;
    Ok(full_path.to_string_lossy().to_string())
}

pub fn append_book_note_to_vault(
    vault_path: &str,
    book_title: &str,
    author: &str,
    page_number: i64,
    quote: &str,
    note: &str,
    created_at: &str,
) -> Result<String, String> {
    let root = ensure_vault_structure(vault_path)?;
    let safe_title = sanitize_filename(book_title, "Untitled Volume");
    let full_path = root.join("Books").join(format!("{safe_title}.md"));
    let now = Local::now();
    let display_time = now.format("%Y-%m-%d %H:%M").to_string();

    if !full_path.exists() {
        let header = format!(
            "---\ntype: book-notes\ntitle: \"{}\"\nauthor: \"{}\"\ncreated_at: {}\nupdated_at: {}\ntags: [\"book\", \"reading\"]\n---\n\n# {}\n\n*By {}*\n",
            book_title.replace('"', "\\\""),
            author.replace('"', "\\\""),
            created_at,
            created_at,
            book_title.trim(),
            if author.trim().is_empty() { "Unknown Author" } else { author.trim() }
        );
        fs::write(&full_path, header)
            .map_err(|e| format!("Failed creating book vault note {}: {e}", full_path.display()))?;
    }

    let mut entry = format!("\n## p. {} · {}\n", page_number.max(1), display_time);
    let trimmed_quote = quote.trim();
    if !trimmed_quote.is_empty() {
        entry.push('\n');
        for line in trimmed_quote.lines() {
            entry.push_str(&format!("> {}\n", line.trim()));
        }
    }
    let trimmed_note = note.trim();
    if !trimmed_note.is_empty() {
        entry.push('\n');
        entry.push_str(trimmed_note);
        entry.push('\n');
    }

    let mut existing = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed reading book vault note: {e}"))?;
    if !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&entry);
    fs::write(&full_path, existing)
        .map_err(|e| format!("Failed appending book vault note: {e}"))?;

    Ok(full_path.to_string_lossy().to_string())
}

pub fn sanitize_filename(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            other => other,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated: String = collapsed.chars().take(72).collect();
    let final_str = truncated.trim().trim_end_matches('.');
    if final_str.is_empty() {
        fallback.to_string()
    } else {
        final_str.to_string()
    }
}

pub fn promote_note_to_inbox(
    vault_path: &str,
    logical_date: &str,
    title: &str,
    content: &str,
) -> Result<String, String> {
    let root = ensure_vault_structure(vault_path)?;
    let now = Local::now();
    let stamp = now.format("%H%M%S").to_string();
    let safe_title = sanitize_filename(title, "Quick Note");
    let file_name = format!("{logical_date} - {stamp} - {safe_title}.md");
    let full_path = root.join("Inbox").join(file_name);

    let md = format!(
        "---\ntype: inbox\nlogical_date: {logical_date}\ncreated_at: {}\ntitle: \"{}\"\n---\n\n# {}\n\n{}\n",
        now.to_rfc3339(),
        title.replace('"', "\\\""),
        if title.trim().is_empty() { "Quick Note" } else { title.trim() },
        content.trim()
    );

    fs::write(&full_path, md)
        .map_err(|e| format!("Failed writing Inbox markdown note: {e}"))?;
    Ok(full_path.to_string_lossy().to_string())
}

pub fn write_daily_debrief_markdown(
    vault_path: &str,
    debrief: &DailyDebriefPayload,
) -> Result<String, String> {
    let root = ensure_vault_structure(vault_path)?;
    let file_path = root
        .join("Daily")
        .join(format!("{}.md", debrief.logical_date));

    let focus_hours = (debrief.focus_minutes as f64) / 60.0;
    let tasks_md = if debrief.completed_tasks.is_empty() {
        "- No completed tasks logged yet.\n".to_string()
    } else {
        debrief
            .completed_tasks
            .iter()
            .map(|t| format!("- [x] {t}\n"))
            .collect()
    };

    let blocks_md = if debrief.block_highlights.is_empty() {
        "- No hourly activity blocks logged.\n".to_string()
    } else {
        debrief
            .block_highlights
            .iter()
            .map(|b| format!("- {b}\n"))
            .collect()
    };

    let g1 = debrief.gratitude1.trim();
    let g2 = debrief.gratitude2.trim();
    let g3 = debrief.gratitude3.trim();

    let md = format!(
        "---\ntype: daily-debrief\ndate: {}\npublished_at: {}\nfocus_hours: {:.2}\ntasks_completed: {}\nblocks_logged: {}\n---\n\n# Daily Debrief: {}\n\n## Day Summary\n- **Focus Logged:** {:.1}h ({} min)\n- **Tasks Completed:** {}\n\n### Completed Tasks\n{}\n### Hourly Activity Highlights\n{}\n## Memorable Moments & Wins\n{}\n\n## 3 Specific Things I Am Grateful For\n1. {}\n2. {}\n3. {}\n\n## Closing Thought & Tomorrow's Priority\n{}\n",
        debrief.logical_date,
        Local::now().to_rfc3339(),
        focus_hours,
        debrief.completed_tasks.len(),
        debrief.block_highlights.len(),
        debrief.logical_date,
        focus_hours,
        debrief.focus_minutes,
        debrief.completed_tasks.len(),
        tasks_md,
        blocks_md,
        if debrief.memories.trim().is_empty() {
            "(None recorded)"
        } else {
            debrief.memories.trim()
        },
        if g1.is_empty() { "(Empty)" } else { g1 },
        if g2.is_empty() { "(Empty)" } else { g2 },
        if g3.is_empty() { "(Empty)" } else { g3 },
        if debrief.closing_thought.trim().is_empty() {
            "(None recorded)"
        } else {
            debrief.closing_thought.trim()
        }
    );

    fs::write(&file_path, md)
        .map_err(|e| format!("Failed writing Daily Debrief markdown: {e}"))?;
    Ok(file_path.to_string_lossy().to_string())
}

pub fn list_daily_debrief_dates(vault_path: &str) -> Result<Vec<String>, String> {
    let root = ensure_vault_structure(vault_path)?;
    let dir = root.join("Daily");
    let mut dates = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    dates.push(stem.to_string());
                }
            }
        }
    }
    dates.sort();
    dates.reverse();
    Ok(dates)
}

pub fn read_daily_debrief_markdown(vault_path: &str, logical_date: &str) -> Result<Option<String>, String> {
    let root = ensure_vault_structure(vault_path)?;
    let file_path = root.join("Daily").join(format!("{logical_date}.md"));
    if !file_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed reading daily debrief file: {e}"))?;
    Ok(Some(raw))
}

fn parse_frontmatter(raw: &str, fallback_date: &str, fallback_title: &str) -> (String, String, Vec<String>, String) {
    let mut date = fallback_date.to_string();
    let mut title = fallback_title.to_string();
    let mut tags: Vec<String> = Vec::new();
    let mut body = raw.to_string();

    if let Some(rest) = raw.strip_prefix("---\n").or_else(|| raw.strip_prefix("---\r\n")) {
        if let Some(end_idx) = rest.find("\n---") {
            let fm = &rest[..end_idx];
            let after = &rest[end_idx + 4..];
            body = after.trim_start_matches(['\r', '\n']).to_string();

            for line in fm.lines() {
                let l = line.trim();
                if let Some(v) = l.strip_prefix("date:").or_else(|| l.strip_prefix("logical_date:")) {
                    let clean = v.trim().trim_matches('"');
                    if !clean.is_empty() {
                        date = clean.to_string();
                    }
                } else if let Some(v) = l.strip_prefix("title:") {
                    let clean = v.trim().trim_matches('"');
                    if !clean.is_empty() {
                        title = clean.to_string();
                    }
                } else if let Some(v) = l.strip_prefix("tags:") {
                    let clean = v.trim().trim_matches(['[', ']']);
                    tags = clean
                        .split(',')
                        .map(|t| t.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|t| !t.is_empty())
                        .collect();
                }
            }
        }
    }

    (date, title, tags, body)
}

fn filename_metadata(path: &Path) -> (String, String) {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    if let Some((d, t)) = stem.split_once(" - ") {
        (d.trim().to_string(), t.trim().to_string())
    } else {
        (String::new(), stem.to_string())
    }
}

pub fn list_reflections(vault_path: &str) -> Result<Vec<VaultFileEntry>, String> {
    let root = ensure_vault_structure(vault_path)?;
    let dir = root.join("Reflections");
    let mut out = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed reading Reflections dir: {e}"))?;

    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else {
            continue;
        };
        let (fn_date, fn_title) = filename_metadata(&p);
        let (date, title, tags, body) = parse_frontmatter(&raw, &fn_date, &fn_title);
        let file_name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let updated_at = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .map(|st| chrono::DateTime::<Local>::from(st).to_rfc3339())
            .unwrap_or_else(|| Local::now().to_rfc3339());

        out.push(VaultFileEntry {
            file_name,
            file_path: p.to_string_lossy().to_string(),
            date,
            title,
            tags,
            content: raw,
            body,
            updated_at,
        });
    }

    out.sort_by(|a, b| {
        b.date
            .cmp(&a.date)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    Ok(out)
}

pub fn save_reflection(
    vault_path: &str,
    input: &ReflectionSaveInput,
) -> Result<VaultFileEntry, String> {
    let root = ensure_vault_structure(vault_path)?;
    let dir = root.join("Reflections");
    let safe_title = sanitize_filename(&input.title, "Untitled Reflection");
    let display_title = if input.title.trim().is_empty() {
        "Untitled Reflection".to_string()
    } else {
        input.title.trim().to_string()
    };

    let target_name = format!("{} - {}.md", input.logical_date, safe_title);
    let target_path = dir.join(&target_name);

    // If renaming an existing reflection file, clean up old file if different
    if let Some(ref existing) = input.existing_file_name {
        let clean_existing = Path::new(existing)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if !clean_existing.is_empty() && clean_existing != target_name {
            let old_path = dir.join(clean_existing);
            if old_path.exists() {
                let _ = fs::remove_file(old_path);
            }
        }
    }

    let now_iso = Local::now().to_rfc3339();
    let tags_clean: Vec<String> = input
        .tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let tags_yaml = tags_clean
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(", ");

    let md = format!(
        "---\ntype: reflection\ndate: {}\ntitle: \"{}\"\ntags: [{}]\nupdated_at: {}\n---\n\n{}\n",
        input.logical_date,
        display_title.replace('"', "\\\""),
        tags_yaml,
        now_iso,
        input.body.trim_end()
    );

    fs::write(&target_path, &md)
        .map_err(|e| format!("Failed writing reflection file: {e}"))?;

    Ok(VaultFileEntry {
        file_name: target_name,
        file_path: target_path.to_string_lossy().to_string(),
        date: input.logical_date.clone(),
        title: display_title,
        tags: tags_clean,
        content: md,
        body: input.body.clone(),
        updated_at: now_iso,
    })
}

pub fn delete_reflection(vault_path: &str, file_name: &str) -> Result<(), String> {
    let root = ensure_vault_structure(vault_path)?;
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid reflection filename".to_string())?;
    let target = root.join("Reflections").join(safe_name);
    if target.exists() {
        fs::remove_file(&target)
            .map_err(|e| format!("Failed deleting reflection file: {e}"))?;
    }
    Ok(())
}

fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let prev_ok = i == 0 || bytes[i - 1].is_ascii_whitespace() || bytes[i - 1] == b'(' || bytes[i - 1] == b'[';
            if prev_ok && i + 1 < bytes.len() && bytes[i + 1].is_ascii_alphabetic() {
                let start = i + 1;
                let mut end = start;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric()
                        || bytes[end] == b'-'
                        || bytes[end] == b'_'
                        || bytes[end] == b'/')
                {
                    end += 1;
                }
                let tag = body[start..end].trim().to_lowercase();
                if tag.len() >= 2 && !found.contains(&tag) {
                    found.push(tag);
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    found
}

pub fn index_vault_notes(vault_path: &str) -> Result<Vec<VaultIndexedNote>, String> {
    let root = ensure_vault_structure(vault_path)?;
    let folders = ["Reflections", "Books", "Daily", "Inbox"];
    let mut out = Vec::new();

    for folder in folders {
        let dir = root.join(folder);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&p) else {
                continue;
            };

            let file_name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let stem = p
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled")
                .to_string();

            let (fn_date, fn_title) = if folder == "Daily" {
                (stem.clone(), stem.clone())
            } else if folder == "Books" {
                (String::new(), stem.clone())
            } else {
                filename_metadata(&p)
            };

            let (date, title, mut tags, body) = parse_frontmatter(&raw, &fn_date, &fn_title);
            for t in extract_inline_tags(&body) {
                if !tags.iter().any(|existing| existing.eq_ignore_ascii_case(&t)) {
                    tags.push(t);
                }
            }

            let updated_at = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .map(|st| chrono::DateTime::<Local>::from(st).to_rfc3339())
                .unwrap_or_else(|| Local::now().to_rfc3339());

            out.push(VaultIndexedNote {
                folder: folder.to_string(),
                file_name,
                file_path: p.to_string_lossy().to_string(),
                title,
                date,
                tags,
                body,
                updated_at,
            });
        }
    }

    out.sort_by(|a, b| {
        b.date
            .cmp(&a.date)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.title.cmp(&b.title))
    });
    Ok(out)
}

fn trim_snippet_around(line: &str, needle_lower: &str) -> String {
    let trimmed = line.trim();
    if trimmed.len() <= 140 {
        return trimmed.to_string();
    }
    if needle_lower.is_empty() {
        return format!("{}...", trimmed.chars().take(136).collect::<String>());
    }
    let lower = trimmed.to_lowercase();
    if let Some(byte_pos) = lower.find(needle_lower) {
        let char_pos = lower[..byte_pos].chars().count();
        let start = char_pos.saturating_sub(42);
        let chars: Vec<char> = trimmed.chars().collect();
        let end = (start + 132).min(chars.len());
        let slice: String = chars[start..end].iter().collect();
        let prefix = if start > 0 { "..." } else { "" };
        let suffix = if end < chars.len() { "..." } else { "" };
        return format!("{prefix}{slice}{suffix}");
    }
    format!("{}...", trimmed.chars().take(136).collect::<String>())
}

pub fn search_vault_notes(
    vault_path: &str,
    query: &str,
    tag_filter: Option<&str>,
) -> Result<Vec<VaultSearchResult>, String> {
    let indexed = index_vault_notes(vault_path)?;
    let q_lower = query.trim().to_lowercase();
    let tag_lower = tag_filter
        .map(|t| t.trim().trim_start_matches('#').to_lowercase())
        .filter(|t| !t.is_empty());

    let mut results = Vec::new();
    for note in indexed {
        if let Some(ref tf) = tag_lower {
            let has_tag = note.tags.iter().any(|t| t.to_lowercase() == *tf);
            if !has_tag {
                continue;
            }
        }

        if q_lower.is_empty() {
            let preview = note
                .body
                .lines()
                .map(|l| l.trim())
                .find(|l| !l.is_empty() && !l.starts_with('#'))
                .unwrap_or(note.title.as_str());
            results.push(VaultSearchResult {
                snippet: trim_snippet_around(preview, ""),
                match_line: 1,
                note,
            });
            continue;
        }

        // Check body lines first for a crisp matching snippet
        let mut found_snippet: Option<(String, usize)> = None;
        for (idx, line) in note.body.lines().enumerate() {
            if line.to_lowercase().contains(&q_lower) {
                found_snippet = Some((trim_snippet_around(line, &q_lower), idx + 1));
                break;
            }
        }

        if found_snippet.is_none() {
            let title_hit = note.title.to_lowercase().contains(&q_lower);
            let file_hit = note.file_name.to_lowercase().contains(&q_lower);
            let tag_hit = note.tags.iter().any(|t| t.to_lowercase().contains(&q_lower));
            if title_hit || file_hit || tag_hit {
                let preview = note
                    .body
                    .lines()
                    .map(|l| l.trim())
                    .find(|l| !l.is_empty())
                    .unwrap_or(note.title.as_str());
                found_snippet = Some((trim_snippet_around(preview, &q_lower), 1));
            }
        }

        if let Some((snippet, match_line)) = found_snippet {
            results.push(VaultSearchResult {
                note,
                snippet,
                match_line,
            });
        }
    }

    Ok(results)
}

fn line_links_to_title(line: &str, target_lower: &str) -> bool {
    let mut rest = line;
    while let Some(open_idx) = rest.find("[[") {
        let after_open = &rest[open_idx + 2..];
        let Some(close_idx) = after_open.find("]]") else {
            break;
        };
        let inner = after_open[..close_idx].trim();
        let target_part = inner
            .split('|')
            .next()
            .unwrap_or(inner)
            .split('#')
            .next()
            .unwrap_or(inner)
            .trim()
            .to_lowercase();
        if !target_part.is_empty() && target_part == target_lower {
            return true;
        }
        rest = &after_open[close_idx + 2..];
    }
    false
}

pub fn find_vault_backlinks(
    vault_path: &str,
    target_title: &str,
    exclude_file_name: Option<&str>,
) -> Result<Vec<BacklinkMention>, String> {
    let target_lower = target_title.trim().to_lowercase();
    if target_lower.is_empty() {
        return Ok(Vec::new());
    }

    let indexed = index_vault_notes(vault_path)?;
    let mut mentions = Vec::new();
    for note in indexed {
        if let Some(excl) = exclude_file_name {
            if !excl.is_empty() && note.file_name.eq_ignore_ascii_case(excl) {
                continue;
            }
        }
        for line in note.body.lines() {
            if line_links_to_title(line, &target_lower) {
                mentions.push(BacklinkMention {
                    source_folder: note.folder.clone(),
                    source_file_name: note.file_name.clone(),
                    source_title: note.title.clone(),
                    source_date: note.date.clone(),
                    context_line: trim_snippet_around(line, &target_lower),
                });
                break;
            }
        }
    }
    Ok(mentions)
}

pub fn save_vault_note_body(
    vault_path: &str,
    folder: &str,
    file_name: &str,
    body: &str,
) -> Result<VaultIndexedNote, String> {
    if !matches!(folder, "Reflections" | "Books" | "Daily" | "Inbox") {
        return Err(format!("Unsupported vault folder: {folder}"));
    }
    let root = ensure_vault_structure(vault_path)?;
    let safe_name = Path::new(file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid vault note filename".to_string())?;
    let target_path = root.join(folder).join(safe_name);
    let now_iso = Local::now().to_rfc3339();

    let mut frontmatter_block = String::new();
    if target_path.exists() {
        if let Ok(existing) = fs::read_to_string(&target_path) {
            if let Some(rest) = existing
                .strip_prefix("---\n")
                .or_else(|| existing.strip_prefix("---\r\n"))
            {
                if let Some(end_idx) = rest.find("\n---") {
                    let fm = &rest[..end_idx];
                    let mut updated_lines = Vec::new();
                    let mut saw_updated = false;
                    for line in fm.lines() {
                        if line.trim_start().starts_with("updated_at:") {
                            updated_lines.push(format!("updated_at: {now_iso}"));
                            saw_updated = true;
                        } else {
                            updated_lines.push(line.to_string());
                        }
                    }
                    if !saw_updated {
                        updated_lines.push(format!("updated_at: {now_iso}"));
                    }
                    frontmatter_block = format!("---\n{}\n---\n\n", updated_lines.join("\n"));
                }
            }
        }
    }

    let final_md = format!("{frontmatter_block}{}\n", body.trim_end());
    fs::write(&target_path, &final_md)
        .map_err(|e| format!("Failed saving vault note {}: {e}", target_path.display()))?;

    let indexed = index_vault_notes(vault_path)?;
    indexed
        .into_iter()
        .find(|n| n.folder == folder && n.file_name == safe_name)
        .ok_or_else(|| "Saved vault note not found in index".to_string())
}

pub fn pick_folder_dialog() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Athenaeum Markdown Vault Folder'
$dialog.UseDescriptionForTitle = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", ps_script])
            .output()
            .map_err(|e| format!("Failed launching folder picker: {e}"))?;
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
                "POSIX path of (choose folder with prompt \"Select Athenaeum Folder\")",
            ])
            .output()
            .map_err(|e| format!("Failed launching macOS folder picker: {e}"))?;
        if !output.status.success() {
            return Ok(None);
        }
        let selected = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_end_matches('/')
            .to_string();
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
