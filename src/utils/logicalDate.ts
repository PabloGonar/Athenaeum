import type { GoalItem, GoalRecurrence, GoalScope, TimeFormat } from "../types/athenaeum";
import { formatTimeHHMM } from "./time";

/**
 * Computes the logical working date (YYYY-MM-DD) using a configurable rollover hour (default 3 -> 03:00).
 * Any timestamp from 00:00:00 through (cutoffHour - 1):59:59 belongs to the previous calendar day.
 */
export function getLogicalDateObject(
  now: Date = new Date(),
  cutoffHour: number = 3
): Date {
  const clamped = Math.max(0, Math.min(12, Math.floor(cutoffHour)));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < clamped) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export function getLogicalDate(
  now: Date = new Date(),
  cutoffHour: number = 3
): string {
  const d = getLogicalDateObject(now, cutoffHour);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getLogicalOffsetDate(
  daysAgo: number,
  cutoffHour: number = 3,
  now: Date = new Date()
): string {
  const d = getLogicalDateObject(now, cutoffHour);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Converts a local Date into a 1-hour logical day slot index (0..23),
 * where slot 0 starts at cutoffHour:00 (default 03:00) and slot 23 covers 02:00 to 02:59 next morning.
 */
export function getLogicalHourSlotIndex(
  now: Date = new Date(),
  cutoffHour: number = 3
): number {
  const clamped = Math.max(0, Math.min(12, Math.floor(cutoffHour)));
  const minsSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const shifted = (minsSinceMidnight - clamped * 60 + 1440) % 1440;
  return Math.max(0, Math.min(23, Math.floor(shifted / 60)));
}

/**
 * Formats logical day hourly slot index (0..24) starting from cutoffHour:00.
 * Default cutoffHour = 3 -> slot 0 = 3:00, slot 23 = 2:00 (next morning), slot 24 = 3:00.
 */
export function formatLogicalHourTime(
  slotIndex: number,
  cutoffHour: number = 3,
  format: TimeFormat = "12h"
): string {
  const clamped = Math.max(0, Math.min(12, Math.floor(cutoffHour)));
  const hour = (clamped + slotIndex) % 24;
  return formatTimeHHMM(`${String(hour).padStart(2, "0")}:00`, format);
}

/** Returns 0 = Mon .. 6 = Sun for the active logical date (rolling over at cutoffHour:00). */
export function getLogicalWeekdayIndex(
  now: Date = new Date(),
  cutoffHour: number = 3
): number {
  const d = getLogicalDateObject(now, cutoffHour);
  return (d.getDay() + 6) % 7;
}

/** Returns YYYY-MM-DD of the Monday starting the current logical week (resets Monday at cutoffHour:00). */
export function getLogicalWeekStartDate(
  now: Date = new Date(),
  cutoffHour: number = 3
): string {
  const d = getLogicalDateObject(now, cutoffHour);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveGoalRecurrence(goal: GoalItem): GoalRecurrence {
  if (
    goal.recurrence === "once" ||
    goal.recurrence === "daily" ||
    goal.recurrence === "weekly" ||
    goal.recurrence === "specific_days" ||
    goal.recurrence === "long_term"
  ) {
    return goal.recurrence;
  }
  if (goal.scope === "weekly") return "weekly";
  if (goal.scope === "longTerm") return "long_term";
  return "daily";
}

/**
 * Single source of truth for Today's Active Queue across GoalsMiniApp and the Upper Observatory pills.
 * - Daily tab: unified queue of Once, Daily, and Specific Days due on today's logical weekday (0=Mon..6=Sun).
 * - Weekly tab: Weekly goals (resetting Monday at 3:00 AM).
 * - Long-Term tab: Strategic milestone-bearing Long-Term goals.
 */
export function isGoalActiveForTab(
  goal: GoalItem,
  tab: GoalScope,
  logicalWeekday: number
): boolean {
  const rec = resolveGoalRecurrence(goal);
  if (tab === "weekly") return rec === "weekly";
  if (tab === "longTerm") return rec === "long_term";
  // Daily tab: unified queue combining Once, Daily, and Specific Days matching today's logical weekday
  if (rec === "once" || rec === "daily") return true;
  if (rec === "specific_days") {
    const days = goal.specificDays ?? [];
    return days.length === 0 || days.includes(logicalWeekday);
  }
  return false;
}
