use crate::config::load_or_init_config;
use crate::logical_date::current_logical_date;
use crate::vault::promote_note_to_inbox;
use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub const INGEST_PORT: u16 = 1429;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestServerStatus {
    pub running: bool,
    pub bind_address: String,
    pub port: u16,
    pub lan_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum IngestPayload {
    #[serde(rename = "health_telemetry")]
    HealthTelemetry {
        logical_date: Option<String>,
        sleep_hours: Option<f64>,
        screen_time_minutes: Option<i64>,
        source: Option<String>,
    },
    #[serde(rename = "create_task")]
    CreateTask {
        title: String,
        scope: Option<String>,
        priority: Option<String>,
        category: Option<String>,
        description: Option<String>,
        recurrence: Option<String>,
    },
    #[serde(rename = "inbox_note")]
    InboxNote {
        title: Option<String>,
        content: String,
        tags: Option<Vec<String>>,
    },
}

pub struct IngestServerHandle {
    stop_flag: Arc<AtomicBool>,
    server: Option<Arc<Server>>,
    bind_address: String,
    lan_enabled: bool,
}

impl IngestServerHandle {
    pub fn inactive(lan_enabled: bool) -> Self {
        let addr = if lan_enabled {
            format!("0.0.0.0:{INGEST_PORT}")
        } else {
            format!("127.0.0.1:{INGEST_PORT}")
        };
        Self {
            stop_flag: Arc::new(AtomicBool::new(true)),
            server: None,
            bind_address: addr,
            lan_enabled,
        }
    }

    pub fn status(&self) -> IngestServerStatus {
        IngestServerStatus {
            running: self.server.is_some() && !self.stop_flag.load(Ordering::SeqCst),
            bind_address: self.bind_address.clone(),
            port: INGEST_PORT,
            lan_enabled: self.lan_enabled,
        }
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(srv) = self.server.take() {
            srv.unblock();
        }
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn validate_iso_date(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

pub fn process_ingest_request(
    db: &Mutex<Connection>,
    config_path: &PathBuf,
    auth_header: Option<&str>,
    body_str: &str,
) -> (u16, Value) {
    let cfg = match load_or_init_config(config_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                500,
                json!({ "ok": false, "error": format!("Config error: {e}") }),
            );
        }
    };

    let expected_token = cfg.ingest_api_token.trim();
    if expected_token.is_empty() {
        return (
            401,
            json!({ "ok": false, "error": "Unauthorized: ingest token not initialized" }),
        );
    }

    let provided_token = auth_header
        .and_then(|h| h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")))
        .map(str::trim)
        .unwrap_or("");

    if provided_token.is_empty()
        || !constant_time_eq(provided_token.as_bytes(), expected_token.as_bytes())
    {
        return (
            401,
            json!({ "ok": false, "error": "Unauthorized: missing or invalid Bearer token" }),
        );
    }

    let parsed: IngestPayload = match serde_json::from_str(body_str) {
        Ok(p) => p,
        Err(e) => {
            return (
                400,
                json!({ "ok": false, "error": format!("Invalid JSON schema: {e}") }),
            );
        }
    };

    let cutoff = cfg.day_rollover_hour;
    let now_local = Local::now();
    let now_iso = now_local.to_rfc3339();
    let logical_today = current_logical_date(cutoff);

    match parsed {
        IngestPayload::HealthTelemetry {
            logical_date,
            sleep_hours,
            screen_time_minutes,
            source,
        } => {
            if sleep_hours.is_none() && screen_time_minutes.is_none() {
                return (
                    400,
                    json!({ "ok": false, "error": "Provide sleep_hours and/or screen_time_minutes" }),
                );
            }
            if let Some(sh) = sleep_hours {
                if !sh.is_finite() || !(0.0..=24.0).contains(&sh) {
                    return (
                        400,
                        json!({ "ok": false, "error": "sleep_hours must be between 0 and 24" }),
                    );
                }
            }
            if let Some(st) = screen_time_minutes {
                if !(0..=1440).contains(&st) {
                    return (
                        400,
                        json!({ "ok": false, "error": "screen_time_minutes must be between 0 and 1440" }),
                    );
                }
            }
            let target_date = match logical_date {
                Some(d) => {
                    let trimmed = d.trim().to_string();
                    if !validate_iso_date(&trimmed) {
                        return (
                            400,
                            json!({ "ok": false, "error": "logical_date must be YYYY-MM-DD" }),
                        );
                    }
                    trimmed
                }
                None => logical_today,
            };
            let src = source
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("ios_shortcut")
                .to_string();

            let conn = match db.lock() {
                Ok(c) => c,
                Err(_) => {
                    return (500, json!({ "ok": false, "error": "DB lock error" }));
                }
            };
            if let Err(e) = conn.execute(
                "INSERT INTO daily_device_telemetry (logical_date, sleep_hours, screen_time_minutes, source, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(logical_date) DO UPDATE SET
                    sleep_hours = COALESCE(excluded.sleep_hours, daily_device_telemetry.sleep_hours),
                    screen_time_minutes = COALESCE(excluded.screen_time_minutes, daily_device_telemetry.screen_time_minutes),
                    source = excluded.source,
                    updated_at = excluded.updated_at",
                params![target_date, sleep_hours, screen_time_minutes, src, now_iso],
            ) {
                return (
                    500,
                    json!({ "ok": false, "error": format!("SQLite telemetry write failed: {e}") }),
                );
            }

            (
                200,
                json!({
                    "ok": true,
                    "type": "health_telemetry",
                    "logicalDate": target_date,
                    "sleepHours": sleep_hours,
                    "screenTimeMinutes": screen_time_minutes,
                }),
            )
        }
        IngestPayload::CreateTask {
            title,
            scope,
            priority,
            category,
            description,
            recurrence,
        } => {
            let clean_title = title.trim().to_string();
            if clean_title.is_empty() {
                return (
                    400,
                    json!({ "ok": false, "error": "create_task requires a non-empty title" }),
                );
            }
            let norm_scope = match scope.as_deref().unwrap_or("daily") {
                "weekly" => "weekly",
                "longTerm" | "long_term" => "longTerm",
                _ => "daily",
            };
            let norm_priority = match priority.as_deref().unwrap_or("medium") {
                "high" => "high",
                "low" => "low",
                _ => "medium",
            };
            let norm_rec = match recurrence.as_deref() {
                Some("daily") => "daily",
                Some("weekly") => "weekly",
                Some("long_term") => "long_term",
                Some("once") => "once",
                _ => {
                    if norm_scope == "weekly" {
                        "weekly"
                    } else if norm_scope == "longTerm" {
                        "long_term"
                    } else {
                        "once"
                    }
                }
            };
            let clean_cat = category.unwrap_or_default().trim().to_string();
            let clean_desc = description.unwrap_or_default().trim().to_string();
            let id = format!("ing-g-{}", now_local.timestamp_millis());

            let conn = match db.lock() {
                Ok(c) => c,
                Err(_) => return (500, json!({ "ok": false, "error": "DB lock error" })),
            };
            let next_order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM goals WHERE scope = ?1",
                    params![norm_scope],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if let Err(e) = conn.execute(
                "INSERT INTO goals (id, scope, title, duration_minutes, completed, priority, due_date, sort_order, created_at, description, category, recurrence, specific_days, target_count, current_count, unit_label, last_reset_period)
                 VALUES (?1, ?2, ?3, 30, 0, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '', 1, 0, '', ?11)",
                params![
                    id,
                    norm_scope,
                    clean_title,
                    norm_priority,
                    logical_today,
                    next_order,
                    now_iso,
                    clean_desc,
                    clean_cat,
                    norm_rec,
                    logical_today
                ],
            ) {
                return (
                    500,
                    json!({ "ok": false, "error": format!("SQLite goal insert failed: {e}") }),
                );
            }

            (
                200,
                json!({
                    "ok": true,
                    "type": "create_task",
                    "id": id,
                    "title": clean_title,
                    "scope": norm_scope,
                }),
            )
        }
        IngestPayload::InboxNote {
            title,
            content,
            tags,
        } => {
            let clean_content = content.trim().to_string();
            let clean_title = title
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("External Capture")
                .to_string();
            if clean_content.is_empty() {
                return (
                    400,
                    json!({ "ok": false, "error": "inbox_note requires non-empty content" }),
                );
            }

            let tag_line = tags
                .unwrap_or_default()
                .into_iter()
                .map(|t| t.trim().trim_start_matches('#').to_string())
                .filter(|t| !t.is_empty())
                .map(|t| format!("#{t}"))
                .collect::<Vec<_>>()
                .join(" ");

            let body_text = if tag_line.is_empty() {
                clean_content
            } else {
                format!("{clean_content}\n\n{tag_line}")
            };

            match promote_note_to_inbox(&cfg.vault_path, &logical_today, &clean_title, &body_text) {
                Ok(file_path) => (
                    200,
                    json!({
                        "ok": true,
                        "type": "inbox_note",
                        "title": clean_title,
                        "filePath": file_path,
                    }),
                ),
                Err(e) => (
                    500,
                    json!({ "ok": false, "error": format!("Inbox write failed: {e}") }),
                ),
            }
        }
    }
}

pub fn start_ingest_server(
    db: Arc<Mutex<Connection>>,
    config_path: PathBuf,
    on_update: Option<Arc<dyn Fn() + Send + Sync>>,
    bind_lan: bool,
) -> IngestServerHandle {
    let bind_address = if bind_lan {
        format!("0.0.0.0:{INGEST_PORT}")
    } else {
        format!("127.0.0.1:{INGEST_PORT}")
    };

    let server = match Server::http(&bind_address) {
        Ok(s) => Arc::new(s),
        Err(_) => {
            return IngestServerHandle::inactive(bind_lan);
        }
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop_flag);
    let thread_server = Arc::clone(&server);

    thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            let mut request = match thread_server.recv() {
                Ok(req) => req,
                Err(_) => break,
            };
            if thread_stop.load(Ordering::SeqCst) {
                break;
            }

            let path = request.url().split('?').next().unwrap_or("/");
            let method = request.method().clone();
            let json_header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                .expect("valid header");

            if method == Method::Get && path == "/health" {
                let body = json!({
                    "status": "ok",
                    "service": "athenaeum-ingest",
                    "port": INGEST_PORT,
                })
                .to_string();
                let resp = Response::from_string(body)
                    .with_status_code(StatusCode(200))
                    .with_header(json_header);
                let _ = request.respond(resp);
                continue;
            }

            if method != Method::Post || path != "/ingest" {
                let body = json!({ "ok": false, "error": "Use POST /ingest" }).to_string();
                let resp = Response::from_string(body)
                    .with_status_code(StatusCode(404))
                    .with_header(json_header);
                let _ = request.respond(resp);
                continue;
            }

            let auth_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str().to_string());

            let mut body_buf = String::new();
            let _ = request.as_reader().read_to_string(&mut body_buf);

            let (status, payload) =
                process_ingest_request(&db, &config_path, auth_header.as_deref(), &body_buf);

            if status == 200 {
                if let Some(ref notify) = on_update {
                    notify();
                }
            }

            let resp = Response::from_string(payload.to_string())
                .with_status_code(StatusCode(status))
                .with_header(json_header);
            let _ = request.respond(resp);
        }
    });

    IngestServerHandle {
        stop_flag,
        server: Some(server),
        bind_address,
        lan_enabled: bind_lan,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{save_config_file, AthenaeumConfig};
    use crate::db::init_database;

    #[test]
    fn ingest_enforces_bearer_auth_and_validates_all_schemas() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "athenaeum_ingest_test_{}",
            Local::now().timestamp_nanos_opt().unwrap_or(1)
        ));
        let vault_dir = tmp_dir.join("vault");
        let db_path = tmp_dir.join("test.db");
        let cfg_path = tmp_dir.join("config.json");

        let mut cfg = AthenaeumConfig::default();
        cfg.vault_path = vault_dir.to_string_lossy().to_string();
        cfg.ingest_api_token = "test_secret_token_32bytes_verified_123456".to_string();
        save_config_file(&cfg_path, &cfg).expect("save config");

        let conn = init_database(&db_path).expect("init db");
        let db = Mutex::new(conn);

        // 1. Missing token -> 401
        let (st, _) = process_ingest_request(
            &db,
            &cfg_path,
            None,
            r#"{"type":"health_telemetry","sleep_hours":7.5}"#,
        );
        assert_eq!(st, 401);

        // 2. Wrong token -> 401
        let (st, _) = process_ingest_request(
            &db,
            &cfg_path,
            Some("Bearer wrong_token"),
            r#"{"type":"health_telemetry","sleep_hours":7.5}"#,
        );
        assert_eq!(st, 401);

        let auth = format!("Bearer {}", cfg.ingest_api_token);

        // 3. Valid health_telemetry -> 200 & persisted in daily_device_telemetry
        let (st, val) = process_ingest_request(
            &db,
            &cfg_path,
            Some(&auth),
            r#"{"type":"health_telemetry","logical_date":"2026-11-23","sleep_hours":7.75,"screen_time_minutes":135}"#,
        );
        assert_eq!(st, 200, "unexpected error: {val}");
        {
            let c = db.lock().unwrap();
            let (sh, stm): (Option<f64>, Option<i64>) = c
                .query_row(
                    "SELECT sleep_hours, screen_time_minutes FROM daily_device_telemetry WHERE logical_date = '2026-11-23'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(sh, Some(7.75));
            assert_eq!(stm, Some(135));
        }

        // 4. Valid create_task -> 200 & persisted in goals
        let (st, val) = process_ingest_request(
            &db,
            &cfg_path,
            Some(&auth),
            r#"{"type":"create_task","title":"Review n8n ingest pipeline","scope":"daily","priority":"high","category":"Ops"}"#,
        );
        assert_eq!(st, 200, "unexpected error: {val}");
        {
            let c = db.lock().unwrap();
            let count: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM goals WHERE title = 'Review n8n ingest pipeline'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
        }

        // 5. Valid inbox_note -> 200 & written to Vault /Inbox
        let (st, val) = process_ingest_request(
            &db,
            &cfg_path,
            Some(&auth),
            r#"{"type":"inbox_note","title":"Voice Memo","content":"Capture from shortcut","tags":["shortcut","idea"]}"#,
        );
        assert_eq!(st, 200, "unexpected error: {val}");
        let written_path = val["filePath"].as_str().unwrap();
        assert!(std::path::Path::new(written_path).exists());

        // 6. Malformed payload -> 400
        let (st, _) = process_ingest_request(
            &db,
            &cfg_path,
            Some(&auth),
            r#"{"type":"health_telemetry","sleep_hours":99}"#,
        );
        assert_eq!(st, 400);

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn live_tcp_ingest_server_returns_401_and_200() {
        use std::io::{Read, Write};
        use std::net::TcpStream;

        let tmp_dir = std::env::temp_dir().join(format!(
            "athenaeum_ingest_tcp_{}",
            Local::now().timestamp_nanos_opt().unwrap_or(2)
        ));
        let vault_dir = tmp_dir.join("vault");
        let db_path = tmp_dir.join("tcp.db");
        let cfg_path = tmp_dir.join("config.json");

        let mut cfg = AthenaeumConfig::default();
        cfg.vault_path = vault_dir.to_string_lossy().to_string();
        cfg.ingest_api_token = "live_tcp_secret_token_32bytes_ok_987654321".to_string();
        save_config_file(&cfg_path, &cfg).expect("save config");

        let conn = init_database(&db_path).expect("init db");
        let shared_db = Arc::new(Mutex::new(conn));
        let mut handle = start_ingest_server(Arc::clone(&shared_db), cfg_path.clone(), None, false);
        assert!(handle.status().running, "ingest server should bind 127.0.0.1:1429");

        let send_raw = |req: &str| -> String {
            let mut stream = TcpStream::connect("127.0.0.1:1429").expect("connect 1429");
            stream.write_all(req.as_bytes()).expect("write");
            let _ = stream.shutdown(std::net::Shutdown::Write);
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            resp
        };

        // Unauthenticated POST /ingest -> 401
        let body = r#"{"type":"health_telemetry","sleep_hours":8.0,"screen_time_minutes":90}"#;
        let unauth_req = format!(
            "POST /ingest HTTP/1.1\r\nHost: 127.0.0.1:1429\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let unauth_resp = send_raw(&unauth_req);
        assert!(unauth_resp.starts_with("HTTP/1.1 401"), "got: {unauth_resp}");

        // Authenticated POST /ingest -> 200
        let auth_req = format!(
            "POST /ingest HTTP/1.1\r\nHost: 127.0.0.1:1429\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            cfg.ingest_api_token,
            body.len(),
            body
        );
        let auth_resp = send_raw(&auth_req);
        assert!(auth_resp.starts_with("HTTP/1.1 200"), "got: {auth_resp}");

        handle.stop();
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
