import type { TimeFormat } from "../types/athenaeum";

export interface ClockParts {
  hours: string;
  minutes: string;
}

export function formatClockParts(date: Date, format: TimeFormat = "12h"): ClockParts {
  const rawHours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");

  if (format === "24h") {
    return {
      hours: String(rawHours).padStart(2, "0"),
      minutes,
    };
  }

  const h12 = rawHours % 12 === 0 ? 12 : rawHours % 12;
  return {
    hours: String(h12),
    minutes,
  };
}

export function formatTimeHHMM(hhmm: string, format: TimeFormat = "12h"): string {
  const parts = hhmm.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;

  const mins = String(m).padStart(2, "0");
  if (format === "24h") {
    return `${String(h).padStart(2, "0")}:${mins}`;
  }

  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mins}`;
}

export function formatIsoTimestamp(iso: string, format: TimeFormat = "12h"): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const { hours, minutes } = formatClockParts(dt, format);
  return `${hours}:${minutes}`;
}

/** Formats 30-minute Day Log slot index (0 = 6:00, 35 = 23:30) cleanly without AM/PM clutter */
export function formatSlotTime(slotIndex: number, format: TimeFormat = "12h"): string {
  const totalMinutes = 360 + slotIndex * 30;
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return formatTimeHHMM(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, format);
}

/**
 * Parses custom focus timer input into total seconds:
 * - Explicit "MM:SS" or "M:SS" (e.g. "15:24", "3:42", "0:45")
 * - 1-2 digits without colon (e.g. "30" -> 30 minutes = 1800s)
 * - 3-4 digits without colon (e.g. "1524" -> 15:24 = 924s, "524" -> 5:24 = 324s)
 */
export function parseDurationSeconds(input: string): number | null {
  const clean = input.trim();
  if (!clean) return null;

  if (clean.includes(":")) {
    const parts = clean.split(":").map((p) => p.trim());
    if (parts.length !== 2) return null;
    const mins = Number(parts[0] || "0");
    const secs = Number(parts[1] || "0");
    if (
      !Number.isFinite(mins) ||
      !Number.isFinite(secs) ||
      mins < 0 ||
      secs < 0 ||
      secs >= 60
    ) {
      return null;
    }
    const total = Math.floor(mins) * 60 + Math.floor(secs);
    return total > 0 && total <= 28800 ? total : null;
  }

  if (/^\d{3,4}$/.test(clean)) {
    const mins = Number(clean.slice(0, -2));
    const secs = Number(clean.slice(-2));
    if (secs < 60) {
      const total = mins * 60 + secs;
      return total > 0 && total <= 28800 ? total : null;
    }
  }

  const numeric = Number(clean);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const total = Math.round(numeric * 60);
  return total > 0 && total <= 28800 ? total : null;
}

/**
 * Formats live custom timer typing so 3-4 digits auto-format as M:SS / MM:SS
 * while keeping 1-2 digit minute shortcuts and explicit MM:SS entry clean.
 */
export function formatSmartTimerInput(raw: string, prevValue = ""): string {
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (!cleaned) return "";

  // Preserve explicit user-typed colon (e.g. "3:42" or "15:") unless backspacing right onto a trailing colon
  if (cleaned.includes(":")) {
    const hadColonBefore = prevValue.includes(":");
    const rawDigits = cleaned.replace(/:/g, "");
    // If user backspaced from an auto-formatted 3-4 digit string (e.g. "15:24" -> "15:2" or "5:24" -> "5:2"), re-evaluate digits smoothly
    if (hadColonBefore && raw.length < prevValue.length) {
      if (rawDigits.length <= 2) return rawDigits;
      if (rawDigits.length <= 4) {
        return `${rawDigits.slice(0, -2)}:${rawDigits.slice(-2)}`;
      }
    }
    const [mPart = "", sPart = ""] = cleaned.split(":");
    return `${mPart.slice(0, 3)}:${sPart.slice(0, 2)}`;
  }

  const digits = cleaned.slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

export function formatSecondsMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
