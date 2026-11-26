import {
  formatLogicalHourTime,
  getLogicalDate,
  getLogicalHourSlotIndex,
  resolveGoalRecurrence,
} from "./logicalDate";
import { fromLogicalMinutes, getIsoWeekdayIndex, shiftIsoDate } from "./scheduleEngine";
import type {
  AnalyticsDataset,
  AnalyticsTimeframe,
  GoalItem,
  GoalMilestone,
  TimeFormat,
} from "../types/athenaeum";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isDebriefGoalIdentity(goalId?: string | null, title?: string | null): boolean {
  if (goalId === "sys-daily-debrief") return true;
  const lower = (title ?? "").trim().toLowerCase();
  return lower.includes("daily debrief");
}

function parseIsoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function daysBetweenIso(startIso: string, endIso: string): number {
  const a = parseIsoToLocalDate(startIso);
  const b = parseIsoToLocalDate(endIso);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function getMondayForIso(iso: string): string {
  const dow = getIsoWeekdayIndex(iso); // 0=Mon..6=Sun
  return shiftIsoDate(iso, -dow);
}

function formatWeekLabel(mondayIso: string): string {
  const dt = parseIsoToLocalDate(mondayIso);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMedianTime(hhmm: string, timeFormat: TimeFormat): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  const mm = String(m).padStart(2, "0");
  if (timeFormat === "24h") {
    return `${String(h).padStart(2, "0")}:${mm}`;
  }
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${period}`;
}

export interface ConsistencyStreakSummary {
  currentStreak: number;
  longestStreak: number;
  todayHasGoal: boolean;
  todayHasDebrief: boolean;
  todayLocked: boolean;
  logicalToday: string;
  qualifyingDates: Set<string>;
}

/**
 * Computes the Active Consistency Streak across logical days (dayRolloverHour = 3).
 * A logical day qualifies ONLY when BOTH:
 *   1) >= 1 non-debrief scheduled goal/habit is completed on that logical day, AND
 *   2) That logical day's Daily Debrief has been published.
 * If yesterday's streak is intact and today is still in progress, currentStreak preserves
 * yesterday's count while exposing live todayHasGoal / todayHasDebrief flags.
 */
export function computeConsistencyStreak(
  dataset: AnalyticsDataset,
  goals: GoalItem[]
): ConsistencyStreakSummary {
  const today = dataset.logicalToday;
  const publishedSet = new Set(dataset.publishedDebriefDates);

  // Index completions by logicalDate
  const nonDebriefGoalDates = new Set<string>();
  const datesWithAnyCompletionRecord = new Set<string>();

  for (const c of dataset.goalCompletions) {
    if (!c.logicalDate) continue;
    datesWithAnyCompletionRecord.add(c.logicalDate);
    if (c.periodKey?.startsWith("milestone:")) continue;
    if (!isDebriefGoalIdentity(c.goalId, c.goalTitle)) {
      nonDebriefGoalDates.add(c.logicalDate);
    }
  }

  // Also check live today completed non-debrief goals in case goal_completions hasn't synced yet
  const liveTodayNonDebriefGoal = goals.some((g) => {
    if (!g.completed) return false;
    if (isDebriefGoalIdentity(g.id, g.title)) return false;
    const rec = resolveGoalRecurrence(g);
    return rec === "daily" || rec === "once" || rec === "specific_days" || g.scope === "daily";
  });
  if (liveTodayNonDebriefGoal) {
    nonDebriefGoalDates.add(today);
  }

  // Historical fallback for pre-upgrade imported ActivityTracker days without granular goal_completions rows
  const activityByDate = new Map(dataset.dailyActivity.map((r) => [r.date, r]));
  const hasQualifyingGoalOnDate = (iso: string): boolean => {
    if (nonDebriefGoalDates.has(iso)) return true;
    if (iso === today) return false;
    if (datesWithAnyCompletionRecord.has(iso)) return false;
    const row = activityByDate.get(iso);
    return Boolean(row && row.goalsCompleted >= 1);
  };

  // Build qualifying date set (intersection of published debriefs and qualifying goals)
  const qualifyingDates = new Set<string>();
  for (const d of publishedSet) {
    if (d <= today && hasQualifyingGoalOnDate(d)) {
      qualifyingDates.add(d);
    }
  }

  const todayHasGoal = hasQualifyingGoalOnDate(today);
  const todayHasDebrief = publishedSet.has(today);
  const todayLocked = todayHasGoal && todayHasDebrief;

  // Walk backward from yesterday
  let yesterdayChain = 0;
  let cursor = shiftIsoDate(today, -1);
  for (let guard = 0; guard < 1500; guard++) {
    if (qualifyingDates.has(cursor)) {
      yesterdayChain += 1;
      cursor = shiftIsoDate(cursor, -1);
    } else {
      break;
    }
  }

  const currentStreak = todayLocked ? yesterdayChain + 1 : yesterdayChain;

  // Compute longest streak across all qualifying dates
  const sortedQual = Array.from(qualifyingDates).sort();
  let longestStreak = currentStreak;
  let run = 0;
  for (let i = 0; i < sortedQual.length; i++) {
    if (i === 0 || daysBetweenIso(sortedQual[i - 1], sortedQual[i]) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longestStreak) longestStreak = run;
  }

  return {
    currentStreak,
    longestStreak,
    todayHasGoal,
    todayHasDebrief,
    todayLocked,
    logicalToday: today,
    qualifyingDates,
  };
}

export interface DiagnosticBullet {
  title: string;
  detail: string;
  metric: string;
}

export interface CircadianHourBucket {
  slotIndex: number; // 0..23 starting from cutoff:00
  label: string;
  focusMinutes: number;
  goalCompletions: number;
}

export interface HabitTimingEntry {
  goalId: string;
  title: string;
  category: string;
  cadenceLabel: string;
  medianTimeLabel: string | null;
  spreadMinutes: number | null;
  adherencePct: number;
  completedCount: number;
  scheduledCount: number;
  daysSinceLast: number | null;
}

export interface CategoryAllocationEntry {
  id: "deep_work" | "strategy" | "reading" | "operations";
  label: string;
  hours: number;
  percent: number;
  colorClass: string;
}

export interface WeeklyTrendPoint {
  weekStart: string;
  label: string;
  focusHours: number;
  uniquePagesRead: number;
  consistencyPct: number;
  milestonesCompleted: number;
}

export interface SleepCorrelationSummary {
  sampleDays: number;
  avgSleepHours: number | null;
  avgScreenTimeMinutes: number | null;
  wellRestedFocusHours: number | null; // avg daily focus when sleep >= 7.0h
  lowSleepFocusHours: number | null; // avg daily focus when sleep < 7.0h
  pairedDays: {
    date: string;
    sleepHours: number | null;
    screenTimeMinutes: number | null;
    focusHours: number;
  }[];
}

export interface AdvancedAnalyticsReport {
  timeframe: AnalyticsTimeframe;
  startDate: string;
  endDate: string;
  totalDays: number;
  streak: ConsistencyStreakSummary;
  totalFocusHours: number;
  totalUniquePagesRead: number;
  qualifyingConsistencyPct: number;
  milestonesCompleted: number;
  recallReviewsCompleted: number;
  recallActiveDays: number;
  strongestMomentum: DiagnosticBullet[];
  slippageAlerts: DiagnosticBullet[];
  circadianHours: CircadianHourBucket[];
  peakWindowLabel: string;
  peakWindowMinutes: number;
  habitTimingLedger: HabitTimingEntry[];
  categoryBreakdown: CategoryAllocationEntry[];
  weeklyTrends: WeeklyTrendPoint[];
  sleepCorrelation: SleepCorrelationSummary;
}

function classifyAnalyticsCategory(
  rawCategory?: string | null,
  label?: string | null
): "deep_work" | "strategy" | "reading" | "operations" {
  const cat = (rawCategory ?? "").toLowerCase();
  const title = (label ?? "").toLowerCase();
  if (
    cat.includes("read") ||
    title.includes("read book") ||
    title.includes("reading") ||
    title.includes("book")
  ) {
    return "reading";
  }
  if (
    cat.includes("strategy") ||
    cat.includes("plan") ||
    cat.includes("toc") ||
    title.includes("toc") ||
    title.includes("strategy") ||
    title.includes("review")
  ) {
    return "strategy";
  }
  if (
    cat.includes("admin") ||
    cat.includes("ops") ||
    cat.includes("break") ||
    cat.includes("chore") ||
    cat.includes("personal") ||
    cat.includes("custom")
  ) {
    return "operations";
  }
  return "deep_work";
}

export function computeAdvancedAnalytics(
  dataset: AnalyticsDataset,
  goals: GoalItem[],
  milestones: GoalMilestone[],
  timeframe: AnalyticsTimeframe,
  timeFormat: TimeFormat
): AdvancedAnalyticsReport {
  const cutoff = dataset.dayRolloverHour ?? 3;
  const endDate = dataset.logicalToday;
  const streak = computeConsistencyStreak(dataset, goals);

  // Determine timeframe startDate
  let startDate: string;
  if (timeframe === "7d") {
    startDate = shiftIsoDate(endDate, -6);
  } else if (timeframe === "30d") {
    startDate = shiftIsoDate(endDate, -29);
  } else if (timeframe === "90d") {
    startDate = shiftIsoDate(endDate, -89);
  } else {
    // All-Time: earliest recorded date across all sources
    const candidates: string[] = [shiftIsoDate(endDate, -29)];
    if (dataset.dailyActivity.length > 0) candidates.push(dataset.dailyActivity[0].date);
    if (dataset.hourlyBlocks.length > 0) candidates.push(dataset.hourlyBlocks[0].date);
    if (dataset.dailyReadingPages.length > 0) {
      candidates.push(dataset.dailyReadingPages[0].logicalDate);
    }
    if (dataset.publishedDebriefDates.length > 0) {
      candidates.push(dataset.publishedDebriefDates[0]);
    }
    for (const s of dataset.focusSessions) {
      candidates.push(getLogicalDate(new Date(s.completedAt), cutoff));
    }
    for (const c of dataset.goalCompletions) {
      if (c.logicalDate) candidates.push(c.logicalDate);
    }
    candidates.sort();
    startDate = candidates[0] <= endDate ? candidates[0] : shiftIsoDate(endDate, -6);
  }

  const totalDays = Math.max(1, daysBetweenIso(startDate, endDate) + 1);
  const inRange = (iso: string) => iso >= startDate && iso <= endDate;

  // Build date list for window
  const windowDates: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    windowDates.push(shiftIsoDate(startDate, i));
  }

  // ==================== 1. FOCUS & CIRCADIAN DISTRIBUTION ====================
  const circadianHours: CircadianHourBucket[] = Array.from({ length: 24 }, (_, slot) => ({
    slotIndex: slot,
    label: formatLogicalHourTime(slot, cutoff, timeFormat),
    focusMinutes: 0,
    goalCompletions: 0,
  }));

  const categoryMinutes: Record<"deep_work" | "strategy" | "reading" | "operations", number> = {
    deep_work: 0,
    strategy: 0,
    reading: 0,
    operations: 0,
  };

  const focusMinutesByDate = new Map<string, number>();
  const coveredDateSlots = new Set<string>();
  const goalFocusMinutes = new Map<string, { label: string; minutes: number }>();

  for (const s of dataset.focusSessions) {
    const startDt = new Date(s.startedAt);
    const endDt = new Date(s.completedAt);
    const logicalDay = getLogicalDate(endDt, cutoff);
    if (!inRange(logicalDay)) continue;

    const mins = Math.max(1, Math.round(s.elapsedSeconds / 60));
    focusMinutesByDate.set(logicalDay, (focusMinutesByDate.get(logicalDay) ?? 0) + mins);

    const bucket = classifyAnalyticsCategory(s.category, s.label);
    categoryMinutes[bucket] += mins;

    const cleanLabel = (s.label || "General Focus").trim() || "General Focus";
    const key = cleanLabel.toLowerCase();
    const prevGoal = goalFocusMinutes.get(key);
    if (prevGoal) prevGoal.minutes += mins;
    else goalFocusMinutes.set(key, { label: cleanLabel, minutes: mins });

    // Distribute across logical hour slots
    const firstSlot = getLogicalHourSlotIndex(startDt, cutoff);
    const lastSlot = Math.max(firstSlot, getLogicalHourSlotIndex(endDt, cutoff));
    const span = Math.max(1, lastSlot - firstSlot + 1);
    const perSlot = mins / span;
    for (let slot = firstSlot; slot <= lastSlot && slot < 24; slot++) {
      circadianHours[slot].focusMinutes += perSlot;
      coveredDateSlots.add(`${logicalDay}:${slot}`);
    }
  }

  // Layer non-overlapping manual hourly Day Log blocks into Circadian + Category breakdown
  for (const blk of dataset.hourlyBlocks) {
    if (!inRange(blk.date)) continue;
    const key = `${blk.date}:${blk.slotIndex}`;
    if (coveredDateSlots.has(key)) continue;
    const slot = Math.max(0, Math.min(23, blk.slotIndex));
    circadianHours[slot].focusMinutes += 60;
    const bucket = classifyAnalyticsCategory(blk.category, blk.label);
    categoryMinutes[bucket] += 60;
    if (!focusMinutesByDate.has(blk.date)) {
      focusMinutesByDate.set(blk.date, 60);
    }
  }

  // Incorporate daily_activity focus minutes for imported historical days without granular sessions
  let totalFocusMinutes = 0;
  const weekdayTotals = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  const dailyActivityMap = new Map(dataset.dailyActivity.map((d) => [d.date, d]));

  for (const d of windowDates) {
    const rowMins = dailyActivityMap.get(d)?.focusMinutes ?? 0;
    const sessionMins = focusMinutesByDate.get(d) ?? 0;
    const effMins = Math.max(rowMins, sessionMins);
    focusMinutesByDate.set(d, effMins);
    totalFocusMinutes += effMins;

    const dow = getIsoWeekdayIndex(d);
    weekdayTotals[dow].sum += effMins;
    weekdayTotals[dow].days += 1;

    // If historical imported minutes exist without category attribution, attribute to Deep Work
    if (rowMins > sessionMins) {
      categoryMinutes.deep_work += rowMins - sessionMins;
    }
  }

  // Round circadian minutes & find Peak 2-Hour Window
  for (const h of circadianHours) {
    h.focusMinutes = Math.round(h.focusMinutes);
  }
  let bestStartSlot = 5; // default ~8:00
  let bestTwoHourMins = -1;
  for (let s = 0; s < 23; s++) {
    const pair = circadianHours[s].focusMinutes + circadianHours[s + 1].focusMinutes;
    if (pair > bestTwoHourMins) {
      bestTwoHourMins = pair;
      bestStartSlot = s;
    }
  }
  const peakWindowLabel =
    bestTwoHourMins > 0
      ? `${formatLogicalHourTime(bestStartSlot, cutoff, timeFormat)} to ${formatLogicalHourTime(
          bestStartSlot + 2,
          cutoff,
          timeFormat
        )}`
      : "No sessions yet";

  // ==================== 2. HABIT ADHERENCE & TIMING LEDGER ====================
  const completionsInRange = dataset.goalCompletions.filter((c) => inRange(c.logicalDate));
  for (const c of completionsInRange) {
    if (c.periodKey?.startsWith("milestone:")) continue;
    const dt = new Date(c.completedAt);
    if (!Number.isNaN(dt.getTime())) {
      const slot = getLogicalHourSlotIndex(dt, cutoff);
      circadianHours[slot].goalCompletions += 1;
    }
  }

  const recurringGoals = goals.filter((g) => {
    if (isDebriefGoalIdentity(g.id, g.title)) return false;
    const rec = resolveGoalRecurrence(g);
    return rec === "daily" || rec === "specific_days" || rec === "weekly";
  });

  const habitTimingLedger: HabitTimingEntry[] = recurringGoals.map((g) => {
    const rec = resolveGoalRecurrence(g);
    const createdLogical = g.createdAt
      ? getLogicalDate(new Date(g.createdAt), cutoff)
      : startDate;
    const effectiveStart = createdLogical > startDate ? createdLogical : startDate;

    // Count scheduled occurrences in [effectiveStart .. endDate]
    let scheduledCount = 0;
    if (rec === "weekly") {
      const weeks = new Set<string>();
      for (const d of windowDates) {
        if (d >= effectiveStart) weeks.add(getMondayForIso(d));
      }
      scheduledCount = Math.max(1, weeks.size);
    } else if (rec === "specific_days") {
      const daysSet = new Set(g.specificDays ?? []);
      for (const d of windowDates) {
        if (d >= effectiveStart) {
          if (daysSet.size === 0 || daysSet.has(getIsoWeekdayIndex(d))) {
            scheduledCount += 1;
          }
        }
      }
      scheduledCount = Math.max(1, scheduledCount);
    } else {
      scheduledCount = Math.max(1, windowDates.filter((d) => d >= effectiveStart).length);
    }

    // Gather completions for this goal in window + all-time for daysSinceLast
    const allGoalLogs = dataset.goalCompletions.filter(
      (c) => c.goalId === g.id && !c.periodKey?.startsWith("milestone:")
    );
    const windowLogs = allGoalLogs.filter((c) => inRange(c.logicalDate));
    const uniquePeriods = new Set<string>(
      windowLogs.map((c) => (rec === "weekly" ? getMondayForIso(c.logicalDate) : c.logicalDate))
    );
    if (g.completed) {
      uniquePeriods.add(rec === "weekly" ? getMondayForIso(endDate) : endDate);
    }
    const completedCount = Math.min(scheduledCount, uniquePeriods.size);
    const adherencePct = Math.min(100, Math.round((completedCount / scheduledCount) * 100));

    // Most recent completion date
    let latestDate: string | null = null;
    for (const c of allGoalLogs) {
      if (!latestDate || c.logicalDate > latestDate) latestDate = c.logicalDate;
    }
    if (g.completed) latestDate = endDate;
    const daysSinceLast = latestDate ? Math.max(0, daysBetweenIso(latestDate, endDate)) : null;

    // Median completion time & spread (MAD) from immutable completed_at timestamps
    const logicalMins: number[] = [];
    for (const c of windowLogs) {
      const dt = new Date(c.completedAt);
      if (Number.isNaN(dt.getTime())) continue;
      const mins = dt.getHours() * 60 + dt.getMinutes();
      const shifted = (mins - cutoff * 60 + 1440) % 1440;
      logicalMins.push(shifted);
    }
    logicalMins.sort((a, b) => a - b);

    let medianTimeLabel: string | null = null;
    let spreadMinutes: number | null = null;
    if (logicalMins.length > 0) {
      const mid = Math.floor(logicalMins.length / 2);
      const medianLogical =
        logicalMins.length % 2 === 1
          ? logicalMins[mid]
          : Math.round((logicalMins[mid - 1] + logicalMins[mid]) / 2);
      const hhmm = fromLogicalMinutes(medianLogical, cutoff);
      medianTimeLabel = formatMedianTime(hhmm, timeFormat);

      if (logicalMins.length >= 2) {
        const deviations = logicalMins
          .map((v) => Math.abs(v - medianLogical))
          .sort((a, b) => a - b);
        const mad = deviations[Math.floor(deviations.length / 2)];
        spreadMinutes = Math.max(5, Math.round(mad / 5) * 5);
      } else {
        spreadMinutes = 0;
      }
    }

    const cadenceLabel =
      rec === "weekly"
        ? "Weekly"
        : rec === "specific_days"
        ? (g.specificDays ?? []).map((idx) => WEEKDAY_NAMES[idx] ?? "").filter(Boolean).join("/") ||
          "Selected Days"
        : "Daily";

    return {
      goalId: g.id,
      title: g.title,
      category: g.category || "Habit",
      cadenceLabel,
      medianTimeLabel,
      spreadMinutes,
      adherencePct,
      completedCount,
      scheduledCount,
      daysSinceLast,
    };
  });

  habitTimingLedger.sort(
    (a, b) => b.adherencePct - a.adherencePct || b.completedCount - a.completedCount
  );

  // ==================== 3. DIAGNOSTIC DIGEST (SECTION A) ====================
  const strongestMomentum: DiagnosticBullet[] = [];
  const slippageAlerts: DiagnosticBullet[] = [];

  const topHabits = habitTimingLedger.filter((h) => h.completedCount > 0).slice(0, 2);
  for (const h of topHabits) {
    strongestMomentum.push({
      title: h.title,
      detail: `${h.completedCount} of ${h.scheduledCount} scheduled ${
        h.cadenceLabel === "Weekly" ? "weeks" : "days"
      } completed${h.medianTimeLabel ? ` · Median ${h.medianTimeLabel}` : ""}`,
      metric: `${h.adherencePct}%`,
    });
  }

  const topProject = Array.from(goalFocusMinutes.values()).sort(
    (a, b) => b.minutes - a.minutes
  )[0];
  if (topProject) {
    strongestMomentum.push({
      title: `Top Focus Thread: ${topProject.label}`,
      detail: `Highest cumulative deep focus logged across this window`,
      metric: `${(topProject.minutes / 60).toFixed(1)}h`,
    });
  }

  if (bestTwoHourMins > 0) {
    strongestMomentum.push({
      title: `Peak Circadian Window`,
      detail: `Highest concentration of focus output lands between ${peakWindowLabel}`,
      metric: `${(bestTwoHourMins / 60).toFixed(1)}h`,
    });
  }

  // Slippage alerts: lowest adherence recurring habits & longest gap
  const laggingHabits = [...habitTimingLedger]
    .filter((h) => h.adherencePct < 70)
    .sort((a, b) => a.adherencePct - b.adherencePct || (b.daysSinceLast ?? 999) - (a.daysSinceLast ?? 999))
    .slice(0, 2);
  for (const h of laggingHabits) {
    const gapText =
      h.daysSinceLast === null
        ? "Not yet logged in this window"
        : h.daysSinceLast === 0
        ? "Completed today"
        : `${h.daysSinceLast}d since last completion`;
    slippageAlerts.push({
      title: h.title,
      detail: `${h.completedCount}/${h.scheduledCount} completed · ${gapText}`,
      metric: `${h.adherencePct}%`,
    });
  }

  // Weekday focus drop detection
  const weekdayAvgs = weekdayTotals.map((w, idx) => ({
    idx,
    name: WEEKDAY_NAMES[idx],
    avgMins: w.days > 0 ? w.sum / w.days : 0,
    days: w.days,
  }));
  const overallDayAvg = totalFocusMinutes / totalDays;
  const activeWeekdays = weekdayAvgs.filter((w) => w.days > 0);
  if (overallDayAvg > 0 && activeWeekdays.length >= 2) {
    const weakest = [...activeWeekdays].sort((a, b) => a.avgMins - b.avgMins)[0];
    const dropPct = Math.round(((overallDayAvg - weakest.avgMins) / overallDayAvg) * 100);
    if (dropPct >= 15) {
      slippageAlerts.push({
        title: `${weakest.name} Focus Dip`,
        detail: `Averages ${(weakest.avgMins / 60).toFixed(1)}h vs ${(overallDayAvg / 60).toFixed(
          1
        )}h daily mean across ${timeframe.toUpperCase()}`,
        metric: `-${dropPct}%`,
      });
    }
  }

  // ==================== 4. CATEGORY BREAKDOWN & WEEKLY TRENDS (SECTION C) ====================
  const totalCatMinutes = Math.max(
    1,
    categoryMinutes.deep_work +
      categoryMinutes.strategy +
      categoryMinutes.reading +
      categoryMinutes.operations
  );

  const categoryBreakdown: CategoryAllocationEntry[] = [
    {
      id: "deep_work",
      label: "Deep Work",
      hours: Number((categoryMinutes.deep_work / 60).toFixed(1)),
      percent: Math.round((categoryMinutes.deep_work / totalCatMinutes) * 100),
      colorClass: "bg-[#F2C464]",
    },
    {
      id: "strategy",
      label: "Strategy & TOC",
      hours: Number((categoryMinutes.strategy / 60).toFixed(1)),
      percent: Math.round((categoryMinutes.strategy / totalCatMinutes) * 100),
      colorClass: "bg-[#D96B43]",
    },
    {
      id: "reading",
      label: "Reading",
      hours: Number((categoryMinutes.reading / 60).toFixed(1)),
      percent: Math.round((categoryMinutes.reading / totalCatMinutes) * 100),
      colorClass: "bg-[#DFC9A6]",
    },
    {
      id: "operations",
      label: "Operations & Admin",
      hours: Number((categoryMinutes.operations / 60).toFixed(1)),
      percent: Math.round((categoryMinutes.operations / totalCatMinutes) * 100),
      colorClass: "bg-[#8A7968]",
    },
  ];

  // Reading pages & milestone completions per week
  const readingByDate = new Map(
    dataset.dailyReadingPages.map((r) => [r.logicalDate, r.uniquePages])
  );
  let totalUniquePagesRead = 0;
  for (const d of windowDates) {
    totalUniquePagesRead += readingByDate.get(d) ?? 0;
  }

  const milestoneDates: string[] = [];
  const seenMsKeys = new Set<string>();
  for (const c of completionsInRange) {
    if (c.periodKey?.startsWith("milestone:")) {
      seenMsKeys.add(c.periodKey);
      milestoneDates.push(c.logicalDate);
    }
  }
  for (const m of milestones) {
    if (m.completed && m.completedAt && !seenMsKeys.has(`milestone:${m.id}`)) {
      const ld = getLogicalDate(new Date(m.completedAt), cutoff);
      if (inRange(ld)) milestoneDates.push(ld);
    }
  }

  const qualifyingInWindow = windowDates.filter((d) => streak.qualifyingDates.has(d)).length;
  const qualifyingConsistencyPct = Math.round((qualifyingInWindow / totalDays) * 100);

  // Weekly trend buckets
  const weekBuckets = new Map<
    string,
    {
      focusMins: number;
      pages: number;
      qualDays: number;
      totalDays: number;
      milestones: number;
    }
  >();

  for (const d of windowDates) {
    const wk = getMondayForIso(d);
    const cur = weekBuckets.get(wk) ?? {
      focusMins: 0,
      pages: 0,
      qualDays: 0,
      totalDays: 0,
      milestones: 0,
    };
    cur.focusMins += focusMinutesByDate.get(d) ?? 0;
    cur.pages += readingByDate.get(d) ?? 0;
    cur.totalDays += 1;
    if (streak.qualifyingDates.has(d)) cur.qualDays += 1;
    weekBuckets.set(wk, cur);
  }
  for (const md of milestoneDates) {
    const wk = getMondayForIso(md);
    const cur = weekBuckets.get(wk);
    if (cur) cur.milestones += 1;
  }

  const weeklyTrends: WeeklyTrendPoint[] = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([weekStart, agg]) => ({
      weekStart,
      label: formatWeekLabel(weekStart),
      focusHours: Number((agg.focusMins / 60).toFixed(1)),
      uniquePagesRead: agg.pages,
      consistencyPct: Math.round((agg.qualDays / Math.max(1, agg.totalDays)) * 100),
      milestonesCompleted: agg.milestones,
    }));

  // Sleep Hours vs. Focus Output & Screen Time correlation
  const telemetryInWindow = (dataset.deviceTelemetry ?? []).filter((t) =>
    inRange(t.logicalDate)
  );
  const sleepSamples = telemetryInWindow.filter(
    (t) => typeof t.sleepHours === "number" && Number.isFinite(t.sleepHours)
  );
  const screenSamples = telemetryInWindow.filter(
    (t) => typeof t.screenTimeMinutes === "number" && Number.isFinite(t.screenTimeMinutes)
  );
  const avgSleepHours =
    sleepSamples.length > 0
      ? Number(
          (
            sleepSamples.reduce((acc, t) => acc + (t.sleepHours ?? 0), 0) / sleepSamples.length
          ).toFixed(1)
        )
      : null;
  const avgScreenTimeMinutes =
    screenSamples.length > 0
      ? Math.round(
          screenSamples.reduce((acc, t) => acc + (t.screenTimeMinutes ?? 0), 0) /
            screenSamples.length
        )
      : null;

  const wellRested = sleepSamples.filter((t) => (t.sleepHours ?? 0) >= 7.0);
  const lowSleep = sleepSamples.filter((t) => (t.sleepHours ?? 0) < 7.0);
  const wellRestedFocusHours =
    wellRested.length > 0
      ? Number(
          (
            wellRested.reduce(
              (acc, t) => acc + (focusMinutesByDate.get(t.logicalDate) ?? 0),
              0
            ) /
            (wellRested.length * 60)
          ).toFixed(1)
        )
      : null;
  const lowSleepFocusHours =
    lowSleep.length > 0
      ? Number(
          (
            lowSleep.reduce(
              (acc, t) => acc + (focusMinutesByDate.get(t.logicalDate) ?? 0),
              0
            ) /
            (lowSleep.length * 60)
          ).toFixed(1)
        )
      : null;

  const pairedDays = telemetryInWindow.slice(-10).map((t) => ({
    date: t.logicalDate,
    sleepHours: t.sleepHours ?? null,
    screenTimeMinutes: t.screenTimeMinutes ?? null,
    focusHours: Number(((focusMinutesByDate.get(t.logicalDate) ?? 0) / 60).toFixed(1)),
  }));

  const sleepCorrelation: SleepCorrelationSummary = {
    sampleDays: telemetryInWindow.length,
    avgSleepHours,
    avgScreenTimeMinutes,
    wellRestedFocusHours,
    lowSleepFocusHours,
    pairedDays,
  };

  const recallInRange = (dataset.recallReviews ?? []).filter((r) => inRange(r.logicalDate));
  const recallReviewsCompleted = recallInRange.length;
  const recallActiveDays = new Set(recallInRange.map((r) => r.logicalDate)).size;

  return {
    timeframe,
    startDate,
    endDate,
    totalDays,
    streak,
    totalFocusHours: Number((totalFocusMinutes / 60).toFixed(1)),
    totalUniquePagesRead,
    qualifyingConsistencyPct,
    milestonesCompleted: milestoneDates.length,
    recallReviewsCompleted,
    recallActiveDays,
    strongestMomentum,
    slippageAlerts,
    circadianHours,
    peakWindowLabel,
    peakWindowMinutes: Math.max(0, Math.round(bestTwoHourMins)),
    habitTimingLedger,
    categoryBreakdown,
    weeklyTrends,
    sleepCorrelation,
  };
}
