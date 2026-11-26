import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, FileText, X } from "lucide-react";
import { storageService } from "../services/storage";
import { formatLogicalHourTime } from "../utils/logicalDate";
import type {
  ActivityBlockHourly,
  DailyDebriefRecord,
  GoalCompletionLog,
  GoalItem,
  HeatmapDay,
  TimeFormat,
} from "../types/athenaeum";

interface ActivityHeatmapProps {
  days: HeatmapDay[];
  goalCompletions?: GoalCompletionLog[];
  goals?: GoalItem[];
  logicalToday?: string;
  timeFormat?: TimeFormat;
  dayRolloverHour?: number;
  onOpenAnalytics: () => void;
  onOpenDailyDebrief?: () => void;
}

const LEVEL_STYLES: Record<number, string> = {
  0: "bg-[rgba(28,34,46,0.78)] border-[rgba(226,180,109,0.16)]",
  1: "bg-[rgba(138,104,60,0.52)] border-[rgba(226,180,109,0.28)]",
  2: "bg-[rgba(182,135,70,0.72)] border-[rgba(226,180,109,0.42)]",
  3: "bg-[rgba(226,180,109,0.88)] border-[rgba(245,216,158,0.58)]",
  4: "bg-[#F2C464] border-[#F8E2A8]",
};

const ROW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatShortDate(iso: string): string {
  const dt = parseIsoDate(iso);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatFullDate(iso: string): string {
  const dt = parseIsoDate(iso);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function extractDebriefSummary(
  rec: DailyDebriefRecord | null,
  rawMd: string | null
): { memories?: string; gratitudes: string[]; closingThought?: string; rawExcerpt?: string } | null {
  if (rec) {
    const memories = rec.memories?.trim() || "";
    const gratitudes = [rec.gratitude1, rec.gratitude2, rec.gratitude3]
      .map((g) => (g || "").trim())
      .filter(Boolean);
    const closingThought = rec.closingThought?.trim() || "";
    if (memories || gratitudes.length > 0 || closingThought) {
      return {
        memories: memories || undefined,
        gratitudes,
        closingThought: closingThought || undefined,
      };
    }
  }
  if (rawMd && rawMd.trim()) {
    const cleaned = rawMd
      .replace(/^---[\s\S]*?---\s*/, "")
      .replace(/^#+\s*/gm, "")
      .trim();
    if (cleaned) {
      return {
        gratitudes: [],
        rawExcerpt: cleaned.length > 260 ? `${cleaned.slice(0, 260)}...` : cleaned,
      };
    }
  }
  return null;
}

interface GridSlot {
  key: string;
  day: HeatmapDay | null;
  isToday: boolean;
}

interface DayDetailsState {
  loading: boolean;
  completedTaskTitles: string[];
  debrief: ReturnType<typeof extractDebriefSummary>;
  hourlyBlocks: ActivityBlockHourly[];
}

export function ActivityHeatmap({
  days,
  goalCompletions = [],
  goals = [],
  logicalToday,
  timeFormat = "12h",
  dayRolloverHour = 3,
  onOpenAnalytics,
  onOpenDailyDebrief,
}: ActivityHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<HeatmapDay | null>(null);
  const [selectedDay, setSelectedDay] = useState<HeatmapDay | null>(null);
  const [dayDetails, setDayDetails] = useState<DayDetailsState>({
    loading: false,
    completedTaskTitles: [],
    debrief: null,
    hourlyBlocks: [],
  });

  // Dismiss popover on Escape or outside click
  useEffect(() => {
    if (!selectedDay) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedDay(null);
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedDay(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [selectedDay]);

  // Fetch completed tasks, Daily Debrief & Hourly Check-In log from SQLite whenever a day square is selected
  useEffect(() => {
    if (!selectedDay) return;
    let active = true;
    const iso = selectedDay.date;
    setDayDetails({
      loading: true,
      completedTaskTitles: [],
      debrief: null,
      hourlyBlocks: [],
    });

    void Promise.all([
      storageService.listCompletedTasksByDate(iso).catch(() => [] as string[]),
      storageService.getDailyDebrief(iso).catch(() => null),
      storageService.readDailyDebriefFile(iso).catch(() => null),
      storageService.listActivityBlocksHourly(iso).catch(() => [] as ActivityBlockHourly[]),
    ]).then(([taskTitles, debriefRec, rawMd, blocks]) => {
      if (!active) return;
      const sortedBlocks = [...blocks].sort((a, b) => a.slotIndex - b.slotIndex);
      setDayDetails({
        loading: false,
        completedTaskTitles: taskTitles,
        debrief: extractDebriefSummary(debriefRec, rawMd),
        hourlyBlocks: sortedBlocks,
      });
    });

    return () => {
      active = false;
    };
  }, [selectedDay]);

  // Build true 7-day Monday-to-Sunday week columns (9 columns x 7 rows)
  const { slots } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const latest = days[days.length - 1];
    const todayDate = latest ? parseIsoDate(latest.date) : new Date();
    const todayDow = (todayDate.getDay() + 6) % 7; // 0 = Mon .. 6 = Sun
    const currentWeekMonday = new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() - todayDow
    );

    const numWeeks = 9;
    const gridStartMonday = new Date(
      currentWeekMonday.getFullYear(),
      currentWeekMonday.getMonth(),
      currentWeekMonday.getDate() - (numWeeks - 1) * 7
    );

    const built: GridSlot[] = [];
    const todayIso = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(todayDate.getDate()).padStart(2, "0")}`;

    for (let week = 0; week < numWeeks; week++) {
      for (let row = 0; row < 7; row++) {
        const dt = new Date(
          gridStartMonday.getFullYear(),
          gridStartMonday.getMonth(),
          gridStartMonday.getDate() + week * 7 + row
        );
        const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
          dt.getDate()
        ).padStart(2, "0")}`;
        const isFuture = dt.getTime() > todayDate.getTime();
        if (isFuture) {
          built.push({ key: `future-${iso}`, day: null, isToday: false });
        } else {
          const rec = byDate.get(iso) ?? {
            date: iso,
            focusMinutes: 0,
            goalsCompleted: 0,
            level: 0,
          };
          built.push({ key: iso, day: rec, isToday: iso === todayIso });
        }
      }
    }

    return { slots: built };
  }, [days]);

  // Merge SQLite completed task titles with live completions/goals for the selected day
  const selectedDayCompletedGoals = useMemo(() => {
    if (!selectedDay) return [];
    const seen = new Set<string>();
    const titles: string[] = [];

    const pushUnique = (raw?: string | null) => {
      const clean = (raw || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        titles.push(clean);
      }
    };

    for (const t of dayDetails.completedTaskTitles) {
      pushUnique(t);
    }

    for (const c of goalCompletions) {
      if (c.logicalDate === selectedDay.date) {
        pushUnique(c.goalTitle);
      }
    }

    if (logicalToday && selectedDay.date === logicalToday) {
      for (const g of goals) {
        if (g.completed && g.scope === "daily") {
          pushUnique(g.title);
        }
      }
    }

    return titles;
  }, [selectedDay, dayDetails.completedTaskTitles, goalCompletions, goals, logicalToday]);

  return (
    <div
      ref={containerRef}
      className="relative flex w-[320px] flex-col items-stretch rounded-[6px] border border-[rgba(226,180,109,0.16)] px-4 py-3.5 select-none"
      style={{
        backgroundColor: "rgba(10, 14, 20, 0.58)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow:
          "inset 0 1px 0 rgba(244, 239, 230, 0.06), 0 12px 30px rgba(4, 8, 16, 0.38)",
      }}
      data-testid="activity-heatmap"
    >
      {/* Header / Hover Readout inside recessed dark plate */}
      <div className="mb-2.5 flex w-full items-center justify-between gap-2 border-b border-[rgba(226,180,109,0.12)] pb-1.5">
        {hovered ? (
          <div className="font-ui text-[0.64rem] tracking-[0.04em] text-[#F3EFE6] whitespace-nowrap">
            {formatShortDate(hovered.date)} · {(hovered.focusMinutes / 60).toFixed(1)}h ·{" "}
            {hovered.goalsCompleted} {hovered.goalsCompleted === 1 ? "Goal" : "Goals"}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onOpenAnalytics}
              title="Open Analytics"
              className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#E2B46D]/90 hover:text-[#F2C464] transition-colors"
            >
              Weekly Cadence
            </button>
            <span className="font-ui text-[0.54rem] uppercase tracking-[0.12em] text-[#A8B7C8]">
              9 Weeks
            </span>
          </>
        )}
      </div>

      {/* 7-Day Week-Aligned Grid (Monday through Sunday) scaled cleanly across 320px column */}
      <div className="flex w-full items-start justify-between gap-2.5">
        <div
          className="grid grid-rows-7 gap-[6px] pt-[1px]"
          aria-hidden="true"
          data-testid="heatmap-weekday-labels"
        >
          {ROW_LABELS.map((lbl, idx) => (
            <span
              key={idx}
              className={`flex h-[18px] w-3.5 items-center justify-start font-ui text-[0.58rem] font-medium tracking-[0.06em] ${
                idx % 2 === 0 ? "text-[#C2CFDD]" : "text-[#8B9BAD]/70"
              }`}
            >
              {lbl}
            </span>
          ))}
        </div>

        <div
          className="grid flex-1 grid-flow-col grid-rows-7 gap-[6px]"
          role="grid"
          aria-label="7-day week-aligned rolling activity heatmap"
          data-testid="heatmap-grid-7day"
        >
          {slots.map((slot) => {
            if (!slot.day) {
              return (
                <div
                  key={slot.key}
                  aria-hidden="true"
                  className="h-[18px] w-full opacity-0 pointer-events-none"
                />
              );
            }
            const day = slot.day;
            const isSelected = selectedDay?.date === day.date;
            return (
              <button
                key={slot.key}
                type="button"
                data-today={slot.isToday ? "true" : undefined}
                data-date={day.date}
                onMouseEnter={() => setHovered(day)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(day)}
                onBlur={() => setHovered(null)}
                onClick={() =>
                  setSelectedDay((prev) => (prev?.date === day.date ? null : day))
                }
                aria-label={`${formatShortDate(day.date)}: ${(day.focusMinutes / 60).toFixed(1)} hours focused, ${day.goalsCompleted} goals completed. Click for day details.`}
                className={`h-[18px] w-full cursor-pointer rounded-[2px] border transition-transform duration-150 hover:scale-115 focus:outline-none ${
                  LEVEL_STYLES[day.level] ?? LEVEL_STYLES[0]
                } ${
                  isSelected
                    ? "ring-2 ring-[#F2C464] ring-offset-1 ring-offset-[#0a0e14]"
                    : slot.isToday
                    ? "ring-1 ring-[#F3EFE6]/90 ring-offset-1 ring-offset-[#0a0e14]"
                    : ""
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Compact Day Detail Popover (anchored cleanly to the left of the Weekly Cadence card) */}
      {selectedDay && (
        <div
          data-testid="heatmap-day-popover"
          data-popover-date={selectedDay.date}
          data-local-scroll="true"
          role="dialog"
          aria-label={`Activity summary for ${formatFullDate(selectedDay.date)}`}
          className="absolute right-[calc(100%+12px)] top-1/2 z-50 w-[336px] -translate-y-1/2 rounded-[6px] border border-[rgba(226,180,109,0.28)] bg-[rgba(12,16,24,0.95)] p-4 text-left shadow-[0_20px_50px_rgba(0,0,0,0.68)] overscroll-contain"
          style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        >
          {/* Popover Header */}
          <div className="flex items-start justify-between gap-2 border-b border-[rgba(226,180,109,0.16)] pb-2.5">
            <div>
              <div className="font-editorial text-[1.1rem] leading-tight text-[#F3EFE6]">
                {formatFullDate(selectedDay.date)}
              </div>
              <div className="mt-0.5 font-ui tabular-nums text-[0.6rem] uppercase tracking-[0.14em] text-[#E2B46D]">
                {(selectedDay.focusMinutes / 60).toFixed(1)}h Focus ·{" "}
                {Math.max(selectedDay.goalsCompleted, selectedDayCompletedGoals.length)}{" "}
                {Math.max(selectedDay.goalsCompleted, selectedDayCompletedGoals.length) === 1
                  ? "Goal"
                  : "Goals"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              data-testid="heatmap-day-popover-close"
              aria-label="Close day summary"
              className="cursor-pointer bg-transparent border-0 p-1 text-[#9FB0C3] hover:text-[#F3EFE6] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 max-h-[340px] space-y-3.5 overflow-y-auto pr-1">
            {/* 1. Completed Goals / Tasks */}
            <section data-testid="heatmap-popover-goals">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={1.6} />
                  Completed Tasks
                </div>
                {selectedDayCompletedGoals.length > 0 && (
                  <span className="font-ui tabular-nums text-[0.56rem] uppercase tracking-[0.12em] text-[#9FB0C3]">
                    {selectedDayCompletedGoals.length}
                  </span>
                )}
              </div>
              {dayDetails.loading && selectedDayCompletedGoals.length === 0 ? (
                <div className="mt-1.5 font-ui text-[0.68rem] text-[#8E9EAE]">Loading...</div>
              ) : selectedDayCompletedGoals.length > 0 ? (
                <ul
                  data-testid="heatmap-popover-goals-list"
                  data-local-scroll="true"
                  className="mt-1.5 max-h-[168px] space-y-1.5 overflow-y-auto overscroll-contain pr-1.5 list-none p-0 m-0"
                >
                  {selectedDayCompletedGoals.map((title, idx) => (
                    <li
                      key={`${title}-${idx}`}
                      className="flex items-start gap-2 font-reading text-[0.88rem] leading-snug text-[#F3EFE6]/94"
                    >
                      <span className="shrink-0 font-ui text-[0.74rem] text-[#E2B46D] leading-snug">
                        ✓
                      </span>
                      <span>{title}</span>
                    </li>
                  ))}
                </ul>
              ) : selectedDay.goalsCompleted > 0 ? (
                <div className="mt-1.5 font-reading text-[0.84rem] text-[#C6D2DF]">
                  {selectedDay.goalsCompleted}{" "}
                  {selectedDay.goalsCompleted === 1 ? "task" : "tasks"} completed (titles unavailable)
                </div>
              ) : (
                <div className="mt-1.5 font-reading text-[0.84rem] text-[#8E9EAE]">
                  No tasks completed on this day.
                </div>
              )}
            </section>

            {/* 2. Daily Debrief */}
            <section
              data-testid="heatmap-popover-debrief"
              className="border-t border-[rgba(226,180,109,0.12)] pt-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                  <FileText className="h-3 w-3" strokeWidth={1.6} />
                  Daily Debrief
                </div>
                {onOpenDailyDebrief && selectedDay.date === logicalToday && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDay(null);
                      onOpenDailyDebrief();
                    }}
                    className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[#9FB0C3] hover:text-[#E2B46D]"
                  >
                    Open
                  </button>
                )}
              </div>
              {dayDetails.loading ? (
                <div className="mt-1 font-ui text-[0.68rem] text-[#8E9EAE]">Loading...</div>
              ) : dayDetails.debrief ? (
                <div className="mt-1.5 space-y-1.5 font-reading text-[0.86rem] leading-relaxed text-[#E6E0D4]">
                  {dayDetails.debrief.memories && (
                    <p className="m-0 line-clamp-3">{dayDetails.debrief.memories}</p>
                  )}
                  {dayDetails.debrief.gratitudes.length > 0 && (
                    <div className="text-[0.82rem] text-[#B8C6D6]">
                      <span className="font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[#E2B46D]/85 mr-1.5">
                        Gratitude:
                      </span>
                      {dayDetails.debrief.gratitudes.join(" · ")}
                    </div>
                  )}
                  {dayDetails.debrief.closingThought && (
                    <div className="border-l-2 border-[rgba(226,180,109,0.45)] pl-2.5 text-[0.84rem] text-[#F3EFE6]/90">
                      {dayDetails.debrief.closingThought}
                    </div>
                  )}
                  {dayDetails.debrief.rawExcerpt && (
                    <p className="m-0 whitespace-pre-line text-[0.82rem] text-[#C6D2DF]">
                      {dayDetails.debrief.rawExcerpt}
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-1 font-reading text-[0.84rem] text-[#8E9EAE]">
                  No debrief logged for this day.
                </div>
              )}
            </section>

            {/* 3. Hourly Check-In Log */}
            <section
              data-testid="heatmap-popover-hourly"
              className="border-t border-[rgba(226,180,109,0.12)] pt-2.5"
            >
              <div className="flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                <Clock className="h-3 w-3" strokeWidth={1.6} />
                Hourly Check-In Log
              </div>
              {dayDetails.loading ? (
                <div className="mt-1 font-ui text-[0.68rem] text-[#8E9EAE]">Loading...</div>
              ) : dayDetails.hourlyBlocks.length > 0 ? (
                <ul className="mt-1.5 space-y-1 list-none p-0 m-0">
                  {dayDetails.hourlyBlocks.map((blk) => (
                    <li
                      key={blk.slotIndex}
                      className="flex items-baseline gap-2.5 font-reading text-[0.84rem] text-[#E6E0D4]"
                    >
                      <span className="w-[46px] shrink-0 font-ui tabular-nums text-[0.62rem] text-[#E2B46D]/90">
                        {formatLogicalHourTime(blk.slotIndex, dayRolloverHour, timeFormat)}
                      </span>
                      <span className="truncate">{blk.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 font-reading text-[0.84rem] text-[#8E9EAE]">
                  No hourly check-ins logged.
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
