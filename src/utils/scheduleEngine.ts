import type {
  ExternalCalendarEvent,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ScheduleBlock,
} from "../types/athenaeum";

export interface ResolvedScheduleItem {
  id: string;
  sourceId: string;
  kind: "external_ics" | "manual" | "recurring";
  title: string;
  date: string;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  startLogicalMin: number; // 0 = cutoffHour:00 .. 1439
  endLogicalMin: number;
  durationMinutes: number;
  category: string;
  allDay?: boolean;
  isRescheduled?: boolean;
}

export interface DisplacedRecurringItem {
  block: RecurringFocusBlock;
  logicalDate: string;
  originalStartTime: string;
  originalEndTime: string;
  displacedByTitle: string;
  displacedByTime: string;
  suggestedSlots: { startTime: string; endTime: string }[];
}

export interface ResolvedDaySchedule {
  dateIso: string;
  items: ResolvedScheduleItem[];
  displaced: DisplacedRecurringItem[];
  skipped: RecurringFocusBlock[];
}

export function hhmmToClockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h || 0) * 60 + (m || 0) + 1440) % 1440;
}

/** Converts "HH:MM" to minutes elapsed since cutoffHour:00 (default 03:00 -> 0, 02:59 next morning -> 1439). */
export function toLogicalMinutes(hhmm: string, cutoffHour = 3): number {
  const clamped = Math.max(0, Math.min(12, Math.floor(cutoffHour)));
  const mins = hhmmToClockMinutes(hhmm);
  return (mins - clamped * 60 + 1440) % 1440;
}

export function fromLogicalMinutes(logicalMins: number, cutoffHour = 3): string {
  const clamped = Math.max(0, Math.min(12, Math.floor(cutoffHour)));
  const wrapped = ((Math.round(logicalMins) + clamped * 60) % 1440 + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesToHHMM(startHHMM: string, durationMinutes: number): string {
  const total = (hhmmToClockMinutes(startHHMM) + Math.max(15, durationMinutes)) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function getIsoWeekdayIndex(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return (dt.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
}

export function shiftIsoDate(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

export function recurringMatchesDate(block: RecurringFocusBlock, dateIso: string): boolean {
  if (!block.active) return false;
  const dow = getIsoWeekdayIndex(dateIso);
  if (block.cadence === "daily") return true;
  if (block.cadence === "weekdays") return dow >= 0 && dow <= 4;
  if (block.cadence === "weekends") return dow === 5 || dow === 6;
  if (block.cadence === "specific_days") {
    return (block.specificDays ?? []).includes(dow);
  }
  return true;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Finds up to 3 conflict-free open gaps on the logical day for rescheduling a displaced Focus Block. */
export function findOpenGapsForDay(
  durationMinutes: number,
  busyIntervals: { start: number; end: number }[],
  preferredStartLogicalMin: number,
  cutoffHour = 3
): { startTime: string; endTime: string }[] {
  const dur = Math.max(15, durationMinutes);
  // Search sensible working window: 07:00 (240 logical mins at 3AM cutoff) to 23:30 (1230 logical mins)
  const minSearch = toLogicalMinutes("07:00", cutoffHour);
  const maxSearch = toLogicalMinutes("23:30", cutoffHour);
  const sortedBusy = [...busyIntervals].sort((a, b) => a.start - b.start);

  const candidates: { start: number; dist: number }[] = [];
  for (let start = minSearch; start + dur <= maxSearch; start += 30) {
    const end = start + dur;
    const collides = sortedBusy.some((b) => intervalsOverlap(start, end, b.start, b.end));
    if (!collides) {
      candidates.push({ start, dist: Math.abs(start - preferredStartLogicalMin) });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist || a.start - b.start);
  const picked: { startTime: string; endTime: string }[] = [];
  for (const c of candidates) {
    // Space suggested options at least 60 minutes apart so suggestions are genuinely distinct
    if (
      picked.some(
        (p) => Math.abs(toLogicalMinutes(p.startTime, cutoffHour) - c.start) < 60
      )
    ) {
      continue;
    }
    picked.push({
      startTime: fromLogicalMinutes(c.start, cutoffHour),
      endTime: fromLogicalMinutes(c.start + dur, cutoffHour),
    });
    if (picked.length >= 3) break;
  }
  return picked;
}

export function resolveDaySchedule(
  dateIso: string,
  manualBlocks: ScheduleBlock[],
  recurringBlocks: RecurringFocusBlock[],
  overrides: RecurringBlockOverride[],
  externalEvents: ExternalCalendarEvent[],
  cutoffHour = 3,
  isToday = false
): ResolvedDaySchedule {
  const items: ResolvedScheduleItem[] = [];
  const displaced: DisplacedRecurringItem[] = [];
  const skipped: RecurringFocusBlock[] = [];

  // 1. Read-only synced .ics external events
  const externalTimed: ResolvedScheduleItem[] = [];
  for (const evt of externalEvents) {
    if (evt.date !== dateIso) continue;
    const startMin = evt.allDay ? 0 : toLogicalMinutes(evt.startTime, cutoffHour);
    let endMin = evt.allDay ? 60 : toLogicalMinutes(evt.endTime, cutoffHour);
    if (endMin <= startMin) endMin = startMin + 30;
    const item: ResolvedScheduleItem = {
      id: `ics-${evt.id}`,
      sourceId: evt.id,
      kind: "external_ics",
      title: evt.title,
      date: dateIso,
      startTime: evt.startTime,
      endTime: evt.endTime,
      startLogicalMin: startMin,
      endLogicalMin: endMin,
      durationMinutes: Math.max(15, endMin - startMin),
      category: evt.location ? `Calendar · ${evt.location}` : "Calendar",
      allDay: evt.allDay,
    };
    items.push(item);
    if (!evt.allDay) externalTimed.push(item);
  }

  // 2. One-off manual ScheduleBlocks for this date
  for (const b of manualBlocks) {
    const matches = b.date ? b.date === dateIso : isToday;
    if (!matches) continue;
    const startMin = toLogicalMinutes(b.startTime, cutoffHour);
    let endMin = toLogicalMinutes(b.endTime, cutoffHour);
    if (endMin <= startMin) endMin = startMin + 30;
    items.push({
      id: `man-${b.id}`,
      sourceId: b.id,
      kind: "manual",
      title: b.title,
      date: dateIso,
      startTime: b.startTime,
      endTime: b.endTime,
      startLogicalMin: startMin,
      endLogicalMin: endMin,
      durationMinutes: Math.max(15, endMin - startMin),
      category: b.category || "Focus Block",
    });
  }

  // 3. Conflict-aware Recurring Focus Blocks ("Soft Blocks")
  const overrideMap = new Map(
    overrides
      .filter((o) => o.logicalDate === dateIso)
      .map((o) => [o.blockId, o])
  );

  const pendingDisplaced: {
    block: RecurringFocusBlock;
    startTime: string;
    endTime: string;
    startMin: number;
    conflict: ResolvedScheduleItem;
  }[] = [];

  for (const rb of recurringBlocks) {
    if (!recurringMatchesDate(rb, dateIso)) continue;
    const ov = overrideMap.get(rb.id);
    if (ov?.status === "skipped") {
      skipped.push(rb);
      continue;
    }

    const effStart = ov?.status === "rescheduled" && ov.overrideStartTime ? ov.overrideStartTime : rb.startTime;
    const effDuration =
      ov?.status === "rescheduled" && ov.overrideDurationMinutes
        ? ov.overrideDurationMinutes
        : rb.durationMinutes;
    const effEnd = addMinutesToHHMM(effStart, effDuration);
    const startMin = toLogicalMinutes(effStart, cutoffHour);
    const endMin = startMin + Math.max(15, effDuration);

    // Check overlap against strictly read-only .ics events
    const conflict = externalTimed.find((ext) =>
      intervalsOverlap(startMin, endMin, ext.startLogicalMin, ext.endLogicalMin)
    );

    if (conflict) {
      pendingDisplaced.push({
        block: rb,
        startTime: effStart,
        endTime: effEnd,
        startMin,
        conflict,
      });
      continue;
    }

    items.push({
      id: `rec-${rb.id}-${dateIso}`,
      sourceId: rb.id,
      kind: "recurring",
      title: rb.title,
      date: dateIso,
      startTime: effStart,
      endTime: effEnd,
      startLogicalMin: startMin,
      endLogicalMin: endMin,
      durationMinutes: Math.max(15, effDuration),
      category: rb.category || "Focus Block",
      isRescheduled: ov?.status === "rescheduled",
    });
  }

  // Compute smart open-gap suggestions for each displaced recurring Focus Block
  const busyIntervals = items
    .filter((i) => !i.allDay)
    .map((i) => ({ start: i.startLogicalMin, end: i.endLogicalMin }));

  for (const pd of pendingDisplaced) {
    displaced.push({
      block: pd.block,
      logicalDate: dateIso,
      originalStartTime: pd.startTime,
      originalEndTime: pd.endTime,
      displacedByTitle: pd.conflict.title,
      displacedByTime: `${pd.conflict.startTime} to ${pd.conflict.endTime}`,
      suggestedSlots: findOpenGapsForDay(
        pd.block.durationMinutes,
        busyIntervals,
        pd.startMin,
        cutoffHour
      ),
    });
  }

  items.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return a.startLogicalMin - b.startLogicalMin;
  });

  return { dateIso, items, displaced, skipped };
}
