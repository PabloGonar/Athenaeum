use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, Timelike};

/// Returns the logical working date (YYYY-MM-DD) for a local DateTime using `cutoff_hour` (default 3).
/// Timestamps from 00:00:00 through (cutoff_hour - 1):59:59 belong to the previous calendar day.
pub fn logical_naive_date_for(dt: DateTime<Local>, cutoff_hour: u32) -> NaiveDate {
    let clamped_cutoff = cutoff_hour.min(12);
    if dt.hour() < clamped_cutoff {
        dt.date_naive() - Duration::days(1)
    } else {
        dt.date_naive()
    }
}

pub fn logical_date_string_for(dt: DateTime<Local>, cutoff_hour: u32) -> String {
    logical_naive_date_for(dt, cutoff_hour)
        .format("%Y-%m-%d")
        .to_string()
}

pub fn current_logical_naive_date(cutoff_hour: u32) -> NaiveDate {
    logical_naive_date_for(Local::now(), cutoff_hour)
}

pub fn current_logical_date(cutoff_hour: u32) -> String {
    logical_date_string_for(Local::now(), cutoff_hour)
}

/// Returns the logical week's Monday start date (YYYY-MM-DD), rolling over Monday at `cutoff_hour:00` (default 3:00 AM).
pub fn logical_week_start_for(dt: DateTime<Local>, cutoff_hour: u32) -> String {
    let logical_day = logical_naive_date_for(dt, cutoff_hour);
    let offset_from_monday = logical_day.weekday().num_days_from_monday() as i64;
    (logical_day - Duration::days(offset_from_monday))
        .format("%Y-%m-%d")
        .to_string()
}

pub fn current_logical_week_start(cutoff_hour: u32) -> String {
    logical_week_start_for(Local::now(), cutoff_hour)
}

/// Converts a local DateTime into a 1-hour logical day slot index (0..23),
/// where slot 0 starts at `cutoff_hour:00` (e.g., 03:00) and slot 23 covers `02:00..02:59` next morning.
pub fn logical_hour_slot_index_for(dt: DateTime<Local>, cutoff_hour: u32) -> i64 {
    let clamped_cutoff = (cutoff_hour.min(12) as i64) * 60;
    let mins_since_midnight = (dt.hour() as i64) * 60 + (dt.minute() as i64);
    let shifted = (mins_since_midnight - clamped_cutoff).rem_euclid(1440);
    (shifted / 60).clamp(0, 23)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn rolls_over_at_3am_boundary() {
        let before_cutoff = Local.with_ymd_and_hms(2026, 11, 24, 2, 59, 59).unwrap();
        let at_cutoff = Local.with_ymd_and_hms(2026, 11, 24, 3, 0, 0).unwrap();
        let midnight = Local.with_ymd_and_hms(2026, 11, 24, 0, 0, 0).unwrap();

        assert_eq!(logical_date_string_for(midnight, 3), "2026-11-23");
        assert_eq!(logical_date_string_for(before_cutoff, 3), "2026-11-23");
        assert_eq!(logical_date_string_for(at_cutoff, 3), "2026-11-24");

        // Weekly reset boundary: Monday 2026-11-23 at 02:59 belongs to prior week (2026-11-16),
        // while Monday 2026-11-23 at 03:00 starts the new logical week (2026-11-23).
        let mon_before = Local.with_ymd_and_hms(2026, 11, 23, 2, 59, 59).unwrap();
        let mon_at = Local.with_ymd_and_hms(2026, 11, 23, 3, 0, 0).unwrap();
        assert_eq!(logical_week_start_for(mon_before, 3), "2026-11-16");
        assert_eq!(logical_week_start_for(mon_at, 3), "2026-11-23");

        // Hourly Slot 0 = 03:00, Slot 23 = 02:00..02:59
        assert_eq!(logical_hour_slot_index_for(at_cutoff, 3), 0);
        assert_eq!(logical_hour_slot_index_for(before_cutoff, 3), 23);
    }
}
