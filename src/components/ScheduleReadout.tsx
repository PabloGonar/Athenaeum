import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  ExternalCalendarEvent,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ScheduleBlock,
  TimeFormat,
} from "../types/athenaeum";
import { formatTimeHHMM } from "../utils/time";
import { getLogicalDate, getLogicalDateObject } from "../utils/logicalDate";
import {
  resolveDaySchedule,
  toLogicalMinutes,
  type ResolvedScheduleItem,
} from "../utils/scheduleEngine";

interface ScheduleReadoutProps {
  blocks: ScheduleBlock[];
  recurringBlocks: RecurringFocusBlock[];
  overrides: RecurringBlockOverride[];
  externalEvents: ExternalCalendarEvent[];
  hasIcsFeeds: boolean;
  timeFormat: TimeFormat;
  dayRolloverHour?: number;
  onAddBlock: (block: ScheduleBlock) => void;
  onRescheduleRecurring: (
    blockId: string,
    logicalDate: string,
    newStartTime: string,
    durationMinutes: number
  ) => void;
  onSkipRecurringToday: (blockId: string, logicalDate: string) => void;
  onStartFocusBlock: (title: string, durationMinutes?: number) => void;
  onSyncCalendars?: () => Promise<void>;
  onOpenCalendar: () => void;
}

const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function getCurrentWeekDays(now: Date) {
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
      dt.getDate()
    ).padStart(2, "0")}`;
    return {
      letter: WEEK_LETTERS[i],
      dayNum: dt.getDate(),
      iso,
      isToday: i === dow,
    };
  });
}

function formatIsoDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function ScheduleReadout({
  blocks,
  recurringBlocks,
  overrides,
  externalEvents,
  hasIcsFeeds,
  timeFormat,
  dayRolloverHour = 3,
  onAddBlock,
  onRescheduleRecurring,
  onSkipRecurringToday,
  onStartFocusBlock,
  onSyncCalendars,
  onOpenCalendar,
}: ScheduleReadoutProps) {
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showDisplacedDrawer, setShowDisplacedDrawer] = useState(false);
  const [customTimeByBlock, setCustomTimeByBlock] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:00");

  // Keep Active Now indicator & progress hairline live
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const logicalDateObj = getLogicalDateObject(nowTick, dayRolloverHour);
  const todayIso = getLogicalDate(nowTick, dayRolloverHour);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(todayIso);
  const prevTodayRef = useRef<string>(todayIso);

  useEffect(() => {
    if (prevTodayRef.current !== todayIso) {
      if (selectedDateIso === prevTodayRef.current) {
        setSelectedDateIso(todayIso);
      }
      prevTodayRef.current = todayIso;
    }
  }, [todayIso, selectedDateIso]);

  const isViewingToday = selectedDateIso === todayIso;
  const headerDateLabel = formatIsoDayLabel(selectedDateIso);
  const weekDays = useMemo(() => getCurrentWeekDays(logicalDateObj), [logicalDateObj]);

  // Indicator dots for days in the current week that have scheduled events/blocks
  const dayItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of weekDays) {
      const res = resolveDaySchedule(
        d.iso,
        blocks,
        recurringBlocks,
        overrides,
        externalEvents,
        dayRolloverHour,
        d.iso === todayIso
      );
      counts[d.iso] = res.items.length;
    }
    return counts;
  }, [weekDays, blocks, recurringBlocks, overrides, externalEvents, dayRolloverHour, todayIso]);

  const nowLogicalMin = useMemo(() => {
    const hhmm = `${String(nowTick.getHours()).padStart(2, "0")}:${String(
      nowTick.getMinutes()
    ).padStart(2, "0")}`;
    return toLogicalMinutes(hhmm, dayRolloverHour);
  }, [nowTick, dayRolloverHour]);

  const { activeItem, activeProgressPct, nextThreeItems, selectedDayItems, displaced } = useMemo(() => {
    const resolved = resolveDaySchedule(
      selectedDateIso,
      blocks,
      recurringBlocks,
      overrides,
      externalEvents,
      dayRolloverHour,
      isViewingToday
    );

    let current: ResolvedScheduleItem | null = null;
    const upcoming: ResolvedScheduleItem[] = [];

    if (isViewingToday) {
      for (const item of resolved.items) {
        if (item.allDay) {
          upcoming.push(item);
        } else if (
          nowLogicalMin >= item.startLogicalMin &&
          nowLogicalMin < item.endLogicalMin &&
          !current
        ) {
          current = item;
        } else if (item.startLogicalMin >= nowLogicalMin) {
          upcoming.push(item);
        }
      }
    }

    const pct = current
      ? Math.max(
          4,
          Math.min(
            100,
            Math.round(
              ((nowLogicalMin - current.startLogicalMin) /
                Math.max(1, current.endLogicalMin - current.startLogicalMin)) *
                100
            )
          )
        )
      : 0;

    return {
      activeItem: current,
      activeProgressPct: pct,
      nextThreeItems: upcoming.slice(0, 3),
      selectedDayItems: resolved.items,
      displaced: resolved.displaced,
    };
  }, [
    blocks,
    recurringBlocks,
    overrides,
    externalEvents,
    selectedDateIso,
    isViewingToday,
    dayRolloverHour,
    nowLogicalMin,
  ]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAddBlock({
      id: `sb-${Date.now()}`,
      title: trimmed,
      startTime,
      endTime,
      category: "Focus Block",
      date: selectedDateIso,
    });
    setTitle("");
    setAdding(false);
  };

  return (
    <div
      data-testid="schedule-readout"
      className="relative smoked-glass w-[324px] rounded-[6px] p-4 text-left select-none"
    >
      {/* Header: Clickable Date -> Full Calendar + Optional Today Reset + Optional ICS Sync */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onOpenCalendar}
            className="cursor-pointer bg-transparent border-0 p-0 text-left font-editorial text-[1.12rem] tracking-[0.03em] text-[var(--text-ivory)] hover:text-[#f2dfb3] transition-colors truncate"
            title="Open Full Calendar"
          >
            {headerDateLabel}
          </button>
          {!isViewingToday && (
            <button
              type="button"
              onClick={() => setSelectedDateIso(todayIso)}
              data-testid="schedule-reset-today-btn"
              className="cursor-pointer shrink-0 rounded-[3px] border border-[rgba(226,180,109,0.42)] bg-[rgba(226,180,109,0.14)] px-1.5 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.24)] transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {hasIcsFeeds && onSyncCalendars && (
            <button
              type="button"
              onClick={async () => {
                setSyncing(true);
                try {
                  await onSyncCalendars();
                } finally {
                  window.setTimeout(() => setSyncing(false), 320);
                }
              }}
              aria-label="Sync ICS calendars"
              title="Sync external .ics calendars"
              className="cursor-pointer bg-transparent border-0 p-0 text-[var(--accent-brass)]/80 hover:text-[var(--text-ivory)]"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            onClick={onOpenCalendar}
            data-testid="open-full-calendar-btn"
            className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1 font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)] transition-colors"
            title="Open Full Calendar Overlay"
          >
            <CalendarIcon className="h-3 w-3" strokeWidth={1.6} />
            Calendar
          </button>
        </div>
      </div>

      {/* Clickable 7-Day Mini-Week Strip */}
      <div
        className="mt-3 grid grid-cols-7 gap-1 border-b border-[rgba(218,195,152,0.12)] pb-3"
        data-testid="schedule-mini-week"
      >
        {weekDays.map((d) => {
          const isSelected = d.iso === selectedDateIso;
          const hasEvents = (dayItemCounts[d.iso] ?? 0) > 0;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => setSelectedDateIso(d.iso)}
              data-testid={`mini-week-day-${d.iso}`}
              aria-pressed={isSelected}
              title={`View schedule for ${formatIsoDayLabel(d.iso)}`}
              className={`cursor-pointer flex flex-col items-center rounded-[6px] py-1 transition-colors ${
                isSelected
                  ? "bg-[rgba(224,177,104,0.22)] border border-[rgba(224,177,104,0.58)]"
                  : d.isToday
                  ? "bg-[rgba(224,177,104,0.08)] border border-[rgba(224,177,104,0.26)] hover:bg-[rgba(224,177,104,0.16)]"
                  : "border border-transparent bg-transparent hover:bg-[rgba(237,234,224,0.06)] hover:border-[rgba(218,195,152,0.18)]"
              }`}
            >
              <span className="font-ui text-[0.55rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {d.letter}
              </span>
              <span
                className={`mt-0.5 font-ui tabular-nums text-[0.72rem] ${
                  isSelected || d.isToday
                    ? "text-[var(--text-ivory)] font-medium"
                    : "text-[var(--text-ivory-soft)]/75"
                }`}
              >
                {d.dayNum}
              </span>
              <span
                className={`mt-0.5 h-1 w-1 rounded-full ${
                  hasEvents ? "bg-[#E2B46D]/85" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* SCHEDULE BODY: Live Active Now + Up Next (Today) OR Selected Day's Schedule */}
      {isViewingToday ? (
        <>
          {/* 1. ACTIVE NOW SECTION */}
          <div className="mt-3" data-testid="schedule-active-now">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    activeItem
                      ? activeItem.kind === "external_ics"
                        ? "bg-[#C5A059]"
                        : "bg-[var(--accent-luminous)]"
                      : "bg-[var(--text-muted)]/50"
                  }`}
                />
                <span
                  className={`font-ui text-[0.58rem] uppercase tracking-[0.2em] ${
                    activeItem?.kind === "external_ics"
                      ? "text-[#C5A059]"
                      : "text-[var(--accent-luminous)]/90"
                  }`}
                >
                  {activeItem
                    ? activeItem.kind === "external_ics"
                      ? "Active Now · Calendar"
                      : "Active Now · Focus Block"
                    : "Active Now"}
                </span>
              </div>

              {activeItem && activeItem.kind !== "external_ics" && (
                <button
                  type="button"
                  onClick={() =>
                    onStartFocusBlock(activeItem.title, activeItem.durationMinutes)
                  }
                  data-testid="schedule-active-start-btn"
                  className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.48)] bg-[rgba(226,180,109,0.16)] px-2.5 py-0.5 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.28)] transition-colors"
                >
                  <Play className="h-2.5 w-2.5 fill-current" />
                  Start
                </button>
              )}
            </div>

            {activeItem ? (
              <div className="mt-1.5">
                <div className="font-editorial text-[1.08rem] leading-snug text-[var(--text-ivory)]">
                  {activeItem.title}
                </div>
                <div className="mt-0.5 font-ui tabular-nums text-[0.65rem] tracking-[0.06em] text-[var(--text-muted)]">
                  {formatTimeHHMM(activeItem.startTime, timeFormat)} to{" "}
                  {formatTimeHHMM(activeItem.endTime, timeFormat)} · {activeItem.category}
                </div>
                {/* Live Progress Hairline */}
                <div
                  data-testid="schedule-active-progress"
                  className="mt-2 h-[2px] w-full rounded-full bg-[rgba(237,234,224,0.14)] overflow-hidden"
                >
                  <div
                    className={`h-full transition-all duration-700 ${
                      activeItem.kind === "external_ics"
                        ? "bg-[#C5A059]"
                        : "bg-[var(--accent-luminous)]"
                    }`}
                    style={{ width: `${activeProgressPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-1 font-reading text-[0.9rem] text-[var(--text-muted)]">
                No scheduled block right now
              </div>
            )}
          </div>

          {/* 2. UP NEXT (Next 3 Upcoming Items for Today's Logical Day) */}
          <div
            className="mt-3 space-y-2 border-t border-[rgba(214,224,212,0.08)] pt-2.5"
            data-testid="schedule-up-next"
          >
            <div className="flex items-center justify-between">
              <span className="font-ui text-[0.56rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Up Next
              </span>
              {nextThreeItems.length > 0 && (
                <span className="font-ui tabular-nums text-[0.54rem] uppercase tracking-[0.14em] text-[var(--text-muted)]/70">
                  Next {nextThreeItems.length}
                </span>
              )}
            </div>

            {nextThreeItems.length > 0 ? (
              nextThreeItems.map((item) => {
                const isExternal = item.kind === "external_ics";
                return (
                  <div
                    key={item.id}
                    data-testid={isExternal ? "external-ics-event-row" : "focus-block-schedule-row"}
                    className={`flex items-baseline justify-between gap-2 pl-2.5 border-l ${
                      isExternal
                        ? "border-[rgba(224,177,104,0.68)]"
                        : "border-[rgba(159,176,195,0.46)]"
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isExternal ? "bg-[#C5A059]" : "bg-[var(--accent-luminous)]/80"
                        }`}
                        title={isExternal ? "Read-only .ics Event" : "Focus Block"}
                      />
                      <span className="font-reading text-[0.92rem] text-[var(--text-ivory-soft)] truncate">
                        {item.title}
                      </span>
                    </div>
                    <span className="font-ui tabular-nums text-[0.64rem] text-[var(--text-muted)] shrink-0">
                      {item.allDay
                        ? "All Day"
                        : formatTimeHHMM(item.startTime, timeFormat)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="font-reading text-[0.86rem] text-[var(--text-muted)]/85">
                No more scheduled blocks today.
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          className="mt-3 space-y-2"
          data-testid="schedule-selected-day-list"
        >
          <div className="flex items-center justify-between">
            <span className="font-ui text-[0.56rem] uppercase tracking-[0.2em] text-[#E2B46D]">
              Scheduled ({selectedDayItems.length})
            </span>
          </div>

          {selectedDayItems.length > 0 ? (
            <div
              data-local-scroll="true"
              className="max-h-[168px] space-y-2 overflow-y-auto overscroll-contain pr-1"
            >
              {selectedDayItems.map((item) => {
                const isExternal = item.kind === "external_ics";
                return (
                  <div
                    key={item.id}
                    className={`flex items-baseline justify-between gap-2 pl-2.5 border-l ${
                      isExternal
                        ? "border-[rgba(224,177,104,0.68)]"
                        : "border-[rgba(159,176,195,0.46)]"
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          isExternal ? "bg-[#C5A059]" : "bg-[var(--accent-luminous)]/80"
                        }`}
                      />
                      <span className="font-reading text-[0.92rem] text-[var(--text-ivory-soft)] truncate">
                        {item.title}
                      </span>
                    </div>
                    <span className="font-ui tabular-nums text-[0.62rem] text-[var(--text-muted)] shrink-0">
                      {item.allDay
                        ? "All Day"
                        : `${formatTimeHHMM(item.startTime, timeFormat)} – ${formatTimeHHMM(
                            item.endTime,
                            timeFormat
                          )}`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-3 font-reading text-[0.88rem] text-[var(--text-muted)]/85">
              No scheduled events or blocks on this day.
            </div>
          )}
        </div>
      )}

      {/* 3. DISPLACED RECURRING BLOCK ALERT BADGE & SIDE-FLOATING RESCHEDULE / SKIP DRAWER */}
      {displaced.length > 0 && (
        <div
          data-testid="schedule-displaced-alert"
          className="relative mt-3 border-t border-[rgba(214,224,212,0.08)] pt-2.5"
        >
          <button
            type="button"
            onClick={() => setShowDisplacedDrawer((v) => !v)}
            data-testid="schedule-displaced-pill"
            className="w-full cursor-pointer rounded-[3px] border border-[#C5A059]/45 bg-[#C5A059]/12 px-3 py-1 flex items-center justify-between font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#e4c27c] hover:bg-[#C5A059]/22 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {displaced.length} displaced · Reschedule
            </span>
            <span className="text-[0.68rem] leading-none">
              {showDisplacedDrawer ? "×" : "›"}
            </span>
          </button>

          {showDisplacedDrawer && (
            <div
              data-testid="schedule-displaced-drawer"
              className="absolute left-[calc(100%+12px)] bottom-0 z-30 w-[304px] smoked-glass rounded-[12px] border border-[#E0B168]/35 bg-[#0b121c]/95 p-3 shadow-2xl space-y-2.5 max-h-[340px] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-[rgba(218,195,152,0.12)] pb-1.5">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[#e4c27c]">
                  Displaced Focus Blocks
                </span>
                <button
                  type="button"
                  onClick={() => setShowDisplacedDrawer(false)}
                  className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {displaced.map((d) => {
                const customVal =
                  customTimeByBlock[d.block.id] ??
                  d.suggestedSlots[0]?.startTime ??
                  "18:00";
                return (
                  <div
                    key={d.block.id}
                    data-testid={`displaced-card-${d.block.id}`}
                    className="rounded-[9px] border border-[#E0B168]/28 bg-[#0e1726]/90 p-2.5 space-y-2"
                  >
                    <div className="font-editorial text-[0.95rem] leading-snug text-[var(--text-ivory)]">
                      {d.block.title}
                    </div>
                    <div className="font-ui text-[0.58rem] tracking-[0.04em] text-[#e4c27c]">
                      Displaced by {d.displacedByTitle}
                    </div>

                    {d.suggestedSlots.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {d.suggestedSlots.map((slot) => (
                          <button
                            key={slot.startTime}
                            type="button"
                            data-testid={`reschedule-gap-${slot.startTime}`}
                            onClick={() =>
                              onRescheduleRecurring(
                                d.block.id,
                                selectedDateIso,
                                slot.startTime,
                                d.block.durationMinutes
                              )
                            }
                            className="cursor-pointer rounded-full border border-[rgba(224,177,104,0.42)] bg-[rgba(224,177,104,0.14)] px-2.5 py-0.5 font-ui tabular-nums text-[0.58rem] text-[var(--text-ivory)] hover:bg-[rgba(224,177,104,0.26)]"
                          >
                            Move to {formatTimeHHMM(slot.startTime, timeFormat)}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        type="time"
                        value={customVal}
                        onChange={(e) =>
                          setCustomTimeByBlock((prev) => ({
                            ...prev,
                            [d.block.id]: e.target.value,
                          }))
                        }
                        className="flex-1 rounded-md border border-[rgba(218,195,152,0.16)] bg-[#09101b] px-1.5 py-0.5 font-ui tabular-nums text-[0.64rem] text-[var(--text-ivory)]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onRescheduleRecurring(
                            d.block.id,
                            selectedDateIso,
                            customVal,
                            d.block.durationMinutes
                          )
                        }
                        className="cursor-pointer rounded-md border border-[#C5A059]/45 bg-[#C5A059]/14 px-2 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.1em] text-[#e4c27c]"
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => onSkipRecurringToday(d.block.id, selectedDateIso)}
                        data-testid={`skip-displaced-${d.block.id}`}
                        className="cursor-pointer bg-transparent border-0 px-1.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                      >
                        Skip Day
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Quick Inline + Block Action */}
      <div className="mt-3.5 border-t border-[rgba(214,224,212,0.08)] pt-2.5">
        {adding ? (
          <form onSubmit={handleQuickAdd} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
                New Block · {isViewingToday ? "Today" : selectedDateIso}
              </span>
              <button
                type="button"
                onClick={() => setAdding(false)}
                aria-label="Cancel adding block"
                className="cursor-pointer bg-transparent border-0 p-0 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Block title..."
              data-testid="quick-block-title"
              className="w-full rounded-md border border-[rgba(218,195,152,0.18)] bg-[#0b1320] px-2.5 py-1 font-reading text-[0.9rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-luminous)] focus:outline-none"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="flex-1 rounded-md border border-[rgba(218,195,152,0.18)] bg-[#0b1320] px-1.5 py-1 font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
              />
              <span className="font-ui text-[0.62rem] text-[var(--text-muted)]">to</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="flex-1 rounded-md border border-[rgba(218,195,152,0.18)] bg-[#0b1320] px-1.5 py-1 font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
              />
              <button
                type="submit"
                data-testid="quick-block-save"
                className="cursor-pointer rounded-md border border-[rgba(224,177,104,0.44)] bg-[rgba(224,177,104,0.16)] px-2.5 py-1 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] hover:bg-[rgba(224,177,104,0.28)]"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-testid="quick-add-block-btn"
              className="flex-1 cursor-pointer rounded-md border border-[rgba(218,195,152,0.16)] bg-[rgba(224,177,104,0.08)] hover:bg-[rgba(224,177,104,0.18)] hover:border-[rgba(224,177,104,0.38)] px-3 py-1.5 flex items-center justify-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] transition-colors"
            >
              <Plus className="h-3 w-3" strokeWidth={1.7} />
              Block
            </button>
            <button
              type="button"
              onClick={onOpenCalendar}
              className="cursor-pointer rounded-md border border-[rgba(218,195,152,0.16)] bg-transparent hover:border-[rgba(224,177,104,0.42)] px-3 py-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[#E0B168] transition-colors"
            >
              Timeline
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
