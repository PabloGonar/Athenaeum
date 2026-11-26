import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Lock,
  Play,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { formatTimeHHMM } from "../../utils/time";
import { formatLogicalHourTime } from "../../utils/logicalDate";
import {
  addMinutesToHHMM,
  fromLogicalMinutes,
  getIsoWeekdayIndex,
  resolveDaySchedule,
  shiftIsoDate,
  toLogicalMinutes,
  type DisplacedRecurringItem,
  type ResolvedScheduleItem,
} from "../../utils/scheduleEngine";
import type {
  ExternalCalendarEvent,
  GoalItem,
  RecurringBlockCadence,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ScheduleBlock,
  TimeFormat,
} from "../../types/athenaeum";

interface CalendarMiniAppProps {
  logicalToday: string;
  dayRolloverHour: number;
  timeFormat: TimeFormat;
  blocks: ScheduleBlock[];
  recurringBlocks: RecurringFocusBlock[];
  overrides: RecurringBlockOverride[];
  externalEvents: ExternalCalendarEvent[];
  goals: GoalItem[];
  onUpsertBlock: (block: ScheduleBlock) => Promise<void>;
  onDeleteBlock: (id: string) => Promise<void>;
  onUpsertRecurringBlock: (block: RecurringFocusBlock) => Promise<void>;
  onDeleteRecurringBlock: (id: string) => Promise<void>;
  onUpsertOverride: (override: RecurringBlockOverride) => Promise<void>;
  onStartFocusBlock: (title: string, durationMinutes?: number) => void;
  onClose: () => void;
}

type CalendarViewMode = "day" | "3day" | "week";

const HOUR_HEIGHT = 56; // px per hour (24h logical day = 1344px)
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatColumnDate(iso: string): { weekday: string; day: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    weekday: dt.toLocaleDateString("en-US", { weekday: "short" }),
    day: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

export function CalendarMiniApp({
  logicalToday,
  dayRolloverHour,
  timeFormat,
  blocks,
  recurringBlocks,
  overrides,
  externalEvents,
  goals,
  onUpsertBlock,
  onDeleteBlock,
  onUpsertRecurringBlock,
  onDeleteRecurringBlock,
  onUpsertOverride,
  onStartFocusBlock,
  onClose,
}: CalendarMiniAppProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("3day");
  const [anchorDate, setAnchorDate] = useState<string>(logicalToday);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Quick one-off block creator
  const [newOneOffTitle, setNewOneOffTitle] = useState("");
  const [newOneOffDate, setNewOneOffDate] = useState(logicalToday);
  const [newOneOffStart, setNewOneOffStart] = useState("15:00");
  const [newOneOffDuration, setNewOneOffDuration] = useState<number>(60);

  // Recurring Soft Block template creator inside side drawer
  const [recTitle, setRecTitle] = useState("");
  const [recLinkedGoalId, setRecLinkedGoalId] = useState<string>("");
  const [recStartTime, setRecStartTime] = useState("19:30");
  const [recDuration, setRecDuration] = useState<number>(60);
  const [recCadence, setRecCadence] = useState<RecurringBlockCadence>("daily");
  const [recSpecificDays, setRecSpecificDays] = useState<number[]>([0, 2, 4]);

  // Drag / Resize live preview state
  const [dragPreview, setDragPreview] = useState<{
    itemId: string;
    mode: "move" | "resize";
    startMin: number;
    durationMin: number;
  } | null>(null);
  const dragMetaRef = useRef<{
    item: ResolvedScheduleItem;
    mode: "move" | "resize";
    startClientY: number;
    origStartMin: number;
    origDurationMin: number;
  } | null>(null);

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll vertical timeline cleanly to ~07:00 AM on initial open
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const sevenAmMin = toLogicalMinutes("07:00", dayRolloverHour);
    el.scrollTop = Math.max(0, (sevenAmMin / 60) * HOUR_HEIGHT - 24);
  }, [dayRolloverHour]);

  const visibleDates = useMemo(() => {
    if (viewMode === "day") return [anchorDate];
    if (viewMode === "3day") {
      return [anchorDate, shiftIsoDate(anchorDate, 1), shiftIsoDate(anchorDate, 2)];
    }
    const dow = getIsoWeekdayIndex(anchorDate);
    const monday = shiftIsoDate(anchorDate, -dow);
    return Array.from({ length: 7 }, (_, i) => shiftIsoDate(monday, i));
  }, [viewMode, anchorDate]);

  const resolvedColumns = useMemo(
    () =>
      visibleDates.map((d) =>
        resolveDaySchedule(
          d,
          blocks,
          recurringBlocks,
          overrides,
          externalEvents,
          dayRolloverHour,
          d === logicalToday
        )
      ),
    [visibleDates, blocks, recurringBlocks, overrides, externalEvents, dayRolloverHour, logicalToday]
  );

  const allDisplaced: DisplacedRecurringItem[] = useMemo(
    () => resolvedColumns.flatMap((c) => c.displaced),
    [resolvedColumns]
  );

  // Current time indicator position on today's column
  const nowIndicatorTop = useMemo(() => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    return (toLogicalMinutes(hhmm, dayRolloverHour) / 60) * HOUR_HEIGHT;
  }, [dayRolloverHour]);

  // Global pointer listeners while dragging or resizing a Focus Block on the timeline
  useEffect(() => {
    if (!dragPreview) return;

    const onPointerMove = (e: PointerEvent) => {
      const meta = dragMetaRef.current;
      if (!meta) return;
      const deltaMinRaw = ((e.clientY - meta.startClientY) / HOUR_HEIGHT) * 60;
      const snappedDelta = Math.round(deltaMinRaw / 15) * 15;

      if (meta.mode === "move") {
        const nextStart = Math.max(
          0,
          Math.min(1440 - meta.origDurationMin, meta.origStartMin + snappedDelta)
        );
        setDragPreview({
          itemId: meta.item.id,
          mode: "move",
          startMin: nextStart,
          durationMin: meta.origDurationMin,
        });
      } else {
        const nextDur = Math.max(
          15,
          Math.min(1440 - meta.origStartMin, meta.origDurationMin + snappedDelta)
        );
        setDragPreview({
          itemId: meta.item.id,
          mode: "resize",
          startMin: meta.origStartMin,
          durationMin: nextDur,
        });
      }
    };

    const onPointerUp = () => {
      const meta = dragMetaRef.current;
      dragMetaRef.current = null;
      setDragPreview((currentPreview) => {
        if (meta && currentPreview) {
          const nextStartHHMM = fromLogicalMinutes(currentPreview.startMin, dayRolloverHour);
          const nextEndHHMM = addMinutesToHHMM(nextStartHHMM, currentPreview.durationMin);

          if (meta.item.kind === "manual") {
            const orig = blocks.find((b) => b.id === meta.item.sourceId);
            if (orig) {
              void onUpsertBlock({
                ...orig,
                startTime: nextStartHHMM,
                endTime: nextEndHHMM,
              });
            }
          } else if (meta.item.kind === "recurring") {
            void onUpsertOverride({
              blockId: meta.item.sourceId,
              logicalDate: meta.item.date,
              status: "rescheduled",
              overrideStartTime: nextStartHHMM,
              overrideDurationMinutes: currentPreview.durationMin,
              updatedAt: new Date().toISOString(),
            });
          }
        }
        return null;
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragPreview, dayRolloverHour, blocks, onUpsertBlock, onUpsertOverride]);

  const handleCreateOneOff = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newOneOffTitle.trim();
    if (!trimmed) return;
    await onUpsertBlock({
      id: `sb-${Date.now()}`,
      title: trimmed,
      startTime: newOneOffStart,
      endTime: addMinutesToHHMM(newOneOffStart, newOneOffDuration),
      category: "Focus Block",
      date: newOneOffDate,
    });
    setNewOneOffTitle("");
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recTitle.trim();
    if (!trimmed) return;
    await onUpsertRecurringBlock({
      id: `rfb-${Date.now()}`,
      title: trimmed,
      linkedGoalId: recLinkedGoalId || null,
      category: "Focus Block",
      startTime: recStartTime,
      durationMinutes: recDuration,
      cadence: recCadence,
      specificDays: recCadence === "specific_days" ? recSpecificDays : [],
      active: true,
      createdAt: new Date().toISOString(),
    });
    setRecTitle("");
    setRecLinkedGoalId("");
  };

  const stepDays = viewMode === "day" ? 1 : viewMode === "3day" ? 3 : 7;

  return (
    <MiniAppShell
      title="Full Calendar"
      subtitle={`Logical day timeline (${String(dayRolloverHour).padStart(2, "0")}:00 rollover) · Read-only .ics events + conflict-aware Focus Blocks`}
      onClose={onClose}
      rightSlot={
        <div className="flex items-center gap-3">
          {/* Day / 3-Day / Week Switcher */}
          <div className="flex items-center rounded-full border border-[var(--glass-border)] bg-[var(--surface-inner)] p-0.5">
            {(
              [
                ["day", "Day"],
                ["3day", "3-Day"],
                ["week", "Week"],
              ] as const
            ).map(([m, lbl]) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                data-testid={`calendar-view-${m}`}
                aria-pressed={viewMode === m}
                className={`cursor-pointer rounded-full px-3.5 py-1 font-ui text-[0.62rem] uppercase tracking-[0.14em] border-0 transition-colors ${
                  viewMode === m
                    ? "bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            data-testid="calendar-recurring-drawer-btn"
            aria-pressed={drawerOpen}
            className={`smoked-glass smoked-glass-hover cursor-pointer rounded-full px-4 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] border ${
              drawerOpen
                ? "border-[#C5A059]/60 text-[#e4c27c]"
                : "border-[var(--glass-border)] text-[var(--text-ivory-soft)]"
            }`}
          >
            <Repeat className="h-3.5 w-3.5 text-[#C5A059]" />
            Recurring Blocks ({recurringBlocks.length})
          </button>
        </div>
      }
    >
      <div data-testid="calendar-overlay-view" className="space-y-4 pb-8">
        {/* Top Bar: Date Navigation + Quick One-Off Block Form */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAnchorDate((d) => shiftIsoDate(d, -stepDays))}
              aria-label="Previous range"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-full p-1.5 text-[var(--text-ivory-soft)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(logicalToday)}
              className="cursor-pointer rounded-full border border-[rgba(143,184,163,0.32)] bg-transparent px-3.5 py-1 font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate((d) => shiftIsoDate(d, stepDays))}
              aria-label="Next range"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-full p-1.5 text-[var(--text-ivory-soft)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <form
            onSubmit={(e) => void handleCreateOneOff(e)}
            className="smoked-glass rounded-full px-4 py-1.5 flex flex-wrap items-center gap-2.5"
          >
            <input
              type="text"
              value={newOneOffTitle}
              onChange={(e) => setNewOneOffTitle(e.target.value)}
              placeholder="Quick one-off Focus Block..."
              className="w-[190px] bg-transparent border-0 font-reading text-[0.92rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
            <input
              type="date"
              value={newOneOffDate}
              onChange={(e) => setNewOneOffDate(e.target.value)}
              className="bg-[var(--surface-inner)] border border-[var(--glass-border)] rounded-md px-2 py-0.5 font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
            />
            <input
              type="time"
              value={newOneOffStart}
              onChange={(e) => setNewOneOffStart(e.target.value)}
              className="bg-[var(--surface-inner)] border border-[var(--glass-border)] rounded-md px-2 py-0.5 font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
            />
            <select
              value={newOneOffDuration}
              onChange={(e) => setNewOneOffDuration(Number(e.target.value))}
              className="bg-[var(--surface-inner)] border border-[var(--glass-border)] rounded-md px-2 py-0.5 font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
            >
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m}m
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="cursor-pointer rounded-full border border-[rgba(143,184,163,0.4)] bg-[rgba(143,184,163,0.14)] px-3 py-0.5 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </form>
        </div>

        {/* Displaced Conflicts Banner across visible days */}
        {allDisplaced.length > 0 && (
          <div
            data-testid="calendar-displaced-banner"
            className="smoked-glass rounded-[12px] border border-[#C5A059]/40 px-5 py-3.5 space-y-2"
          >
            <div className="flex items-center gap-2 font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#e4c27c]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Recurring Focus Blocks Displaced by Read-Only Calendar Events ({allDisplaced.length})
            </div>
            <div className="flex flex-wrap gap-3">
              {allDisplaced.map((d) => (
                <div
                  key={`${d.block.id}-${d.logicalDate}`}
                  className="rounded-[9px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 flex flex-wrap items-center gap-3"
                >
                  <div>
                    <div className="font-editorial text-[0.98rem] text-[var(--text-ivory)]">
                      {d.block.title}{" "}
                      <span className="font-ui text-[0.6rem] text-[var(--text-muted)]">
                        ({d.logicalDate})
                      </span>
                    </div>
                    <div className="font-ui text-[0.58rem] text-[#e4c27c]">
                      Displaced by {d.displacedByTitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {d.suggestedSlots.slice(0, 2).map((s) => (
                      <button
                        key={s.startTime}
                        type="button"
                        onClick={() =>
                          void onUpsertOverride({
                            blockId: d.block.id,
                            logicalDate: d.logicalDate,
                            status: "rescheduled",
                            overrideStartTime: s.startTime,
                            overrideDurationMinutes: d.block.durationMinutes,
                            updatedAt: new Date().toISOString(),
                          })
                        }
                        className="cursor-pointer rounded-full border border-[rgba(143,184,163,0.4)] bg-[rgba(143,184,163,0.12)] px-2.5 py-0.5 font-ui tabular-nums text-[0.58rem] text-[var(--text-ivory)] hover:bg-[rgba(143,184,163,0.24)]"
                      >
                        Move to {formatTimeHHMM(s.startTime, timeFormat)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        void onUpsertOverride({
                          blockId: d.block.id,
                          logicalDate: d.logicalDate,
                          status: "skipped",
                          overrideStartTime: null,
                          overrideDurationMinutes: null,
                          updatedAt: new Date().toISOString(),
                        })
                      }
                      className="cursor-pointer bg-transparent border-0 px-2 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Workspace: Vertical Time-Block Timeline + Optional Recurring Blocks Side Drawer */}
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0 smoked-glass rounded-[14px] overflow-hidden border border-[var(--glass-border)]">
            {/* Day Column Headers */}
            <div className="flex border-b border-[var(--glass-border)] bg-[var(--surface-inner)]">
              <div className="w-[64px] shrink-0 py-3 text-center font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                3:00+
              </div>
              <div
                className="flex-1 grid"
                style={{ gridTemplateColumns: `repeat(${visibleDates.length}, minmax(0, 1fr))` }}
              >
                {visibleDates.map((d) => {
                  const lbl = formatColumnDate(d);
                  const isToday = d === logicalToday;
                  return (
                    <div
                      key={d}
                      className={`py-2.5 px-3 border-l border-[rgba(214,224,212,0.08)] flex items-baseline justify-between ${
                        isToday ? "bg-[rgba(143,184,163,0.09)]" : ""
                      }`}
                    >
                      <span
                        className={`font-editorial text-[1.06rem] ${
                          isToday ? "text-[var(--text-ivory)]" : "text-[var(--text-ivory-soft)]"
                        }`}
                      >
                        {lbl.weekday}
                      </span>
                      <span className="font-ui tabular-nums text-[0.64rem] text-[var(--text-muted)]">
                        {lbl.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scrollable 24-Hour Logical Day Vertical Grid */}
            <div
              ref={timelineScrollRef}
              data-testid="calendar-timeline-grid"
              className="relative h-[64vh] min-h-[480px] overflow-y-auto flex select-none"
            >
              {/* Left Hour Axis (3:00 through 2:00 next morning) */}
              <div
                className="w-[64px] shrink-0 relative bg-[var(--surface-inner)]"
                style={{ height: 24 * HOUR_HEIGHT }}
              >
                {Array.from({ length: 24 }, (_, slot) => (
                  <div
                    key={slot}
                    style={{ top: slot * HOUR_HEIGHT }}
                    className="absolute inset-x-0 pr-2.5 -translate-y-2 text-right font-ui tabular-nums text-[0.6rem] text-[var(--text-muted)]"
                  >
                    {formatLogicalHourTime(slot, dayRolloverHour, timeFormat)}
                  </div>
                ))}
              </div>

              {/* Day Columns */}
              <div
                className="flex-1 grid relative"
                style={{
                  height: 24 * HOUR_HEIGHT,
                  gridTemplateColumns: `repeat(${visibleDates.length}, minmax(0, 1fr))`,
                }}
              >
                {resolvedColumns.map((col) => (
                  <div
                    key={col.dateIso}
                    className="relative border-l border-[rgba(214,224,212,0.08)]"
                    style={{ height: 24 * HOUR_HEIGHT }}
                  >
                    {/* Subtle hourly gridlines */}
                    {Array.from({ length: 24 }, (_, slot) => (
                      <div
                        key={slot}
                        style={{ top: slot * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                        className="absolute inset-x-0 border-t border-[rgba(214,224,212,0.05)]"
                      />
                    ))}

                    {/* Live current time line on Today */}
                    {col.dateIso === logicalToday && (
                      <div
                        style={{ top: nowIndicatorTop }}
                        className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                      >
                        <span className="h-2 w-2 -ml-1 rounded-full bg-[#C5A059]" />
                        <span className="h-[1.5px] flex-1 bg-[#C5A059]/75" />
                      </div>
                    )}

                    {/* Placed Events & Draggable/Resizable Focus Blocks */}
                    {col.items
                      .filter((it) => !it.allDay)
                      .map((item) => {
                        const isExternal = item.kind === "external_ics";
                        const previewing =
                          dragPreview && dragPreview.itemId === item.id ? dragPreview : null;
                        const effStartMin = previewing
                          ? previewing.startMin
                          : item.startLogicalMin;
                        const effDuration = previewing
                          ? previewing.durationMin
                          : item.durationMinutes;
                        const topPx = (effStartMin / 60) * HOUR_HEIGHT;
                        const heightPx = Math.max(26, (effDuration / 60) * HOUR_HEIGHT);
                        const effStartLabel = formatTimeHHMM(
                          fromLogicalMinutes(effStartMin, dayRolloverHour),
                          timeFormat
                        );

                        return (
                          <div
                            key={item.id}
                            data-testid={
                              isExternal ? "calendar-ics-block" : "calendar-focus-block"
                            }
                            style={{ top: topPx, height: heightPx }}
                            onPointerDown={(e) => {
                              if (isExternal) return;
                              const target = e.target as HTMLElement;
                              if (target.closest("button")) return;
                              e.stopPropagation();
                              dragMetaRef.current = {
                                item,
                                mode: "move",
                                startClientY: e.clientY,
                                origStartMin: item.startLogicalMin,
                                origDurationMin: item.durationMinutes,
                              };
                              setDragPreview({
                                itemId: item.id,
                                mode: "move",
                                startMin: item.startLogicalMin,
                                durationMin: item.durationMinutes,
                              });
                            }}
                            className={`group absolute left-1.5 right-1.5 z-10 rounded-[8px] border px-2.5 py-1.5 overflow-hidden transition-shadow ${
                              isExternal
                                ? "border-[#C5A059]/50 bg-[#1a1a12]/88 cursor-default"
                                : "border-[rgba(143,184,163,0.45)] bg-[var(--surface-panel-hover)] hover:border-[var(--accent-luminous)] cursor-grab active:cursor-grabbing"
                            } ${previewing ? "ring-1 ring-[#C5A059] shadow-xl z-30" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`font-editorial leading-tight text-[var(--text-ivory)] truncate ${
                                    viewMode === "week" ? "text-[0.8rem]" : "text-[0.94rem]"
                                  }`}
                                >
                                  {item.title}
                                </div>
                                <div className="font-ui tabular-nums text-[0.58rem] text-[var(--text-muted)] truncate">
                                  {effStartLabel} · {effDuration}m
                                  {item.kind === "recurring" && viewMode !== "week"
                                    ? " · Soft Block"
                                    : ""}
                                </div>
                              </div>

                              {isExternal ? (
                                <Lock className="h-3 w-3 shrink-0 text-[#C5A059]/75" />
                              ) : (
                                <div
                                  className={`items-center gap-1 shrink-0 transition-opacity ${
                                    viewMode === "week"
                                      ? "hidden group-hover:flex"
                                      : "flex opacity-80 group-hover:opacity-100"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onStartFocusBlock(item.title, effDuration);
                                    }}
                                    data-testid="calendar-start-focus-btn"
                                    title="Start Focus Session"
                                    className="cursor-pointer rounded-full border border-[rgba(143,184,163,0.45)] bg-[rgba(143,184,163,0.18)] px-2 py-0.5 flex items-center gap-1 font-ui text-[0.54rem] uppercase tracking-[0.1em] text-[var(--text-ivory)] hover:bg-[rgba(143,184,163,0.32)]"
                                  >
                                    <Play className="h-2.5 w-2.5 fill-current" />
                                    {viewMode === "week" ? "" : "Focus"}
                                  </button>
                                  {item.kind === "manual" && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onDeleteBlock(item.sourceId);
                                      }}
                                      aria-label={`Remove ${item.title}`}
                                      className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Bottom Resize Handle for Focus Blocks */}
                            {!isExternal && (
                              <div
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  dragMetaRef.current = {
                                    item,
                                    mode: "resize",
                                    startClientY: e.clientY,
                                    origStartMin: item.startLogicalMin,
                                    origDurationMin: item.durationMinutes,
                                  };
                                  setDragPreview({
                                    itemId: item.id,
                                    mode: "resize",
                                    startMin: item.startLogicalMin,
                                    durationMin: item.durationMinutes,
                                  });
                                }}
                                title="Drag to resize duration"
                                className="absolute inset-x-3 bottom-0 h-2 cursor-ns-resize flex items-center justify-center"
                              >
                                <span className="h-[2px] w-7 rounded-full bg-[rgba(143,184,163,0.35)] opacity-0 group-hover:opacity-100" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recurring Focus Block Templates Side Drawer */}
          {drawerOpen && (
            <aside
              data-testid="recurring-blocks-drawer"
              className="w-[330px] shrink-0 smoked-glass rounded-[14px] border border-[#C5A059]/35 p-5 space-y-5 max-h-[72vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <div>
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#C5A059]">
                    Recurring Soft Blocks
                  </div>
                  <div className="font-reading italic text-[0.86rem] text-[var(--text-muted)]">
                    Auto-yield when an .ics meeting overlaps
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close recurring blocks drawer"
                  className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* New Recurring Soft Block Form */}
              <form onSubmit={(e) => void handleCreateRecurring(e)} className="space-y-3">
                <div>
                  <label className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Link Goal or Custom Label
                  </label>
                  <select
                    value={recLinkedGoalId}
                    onChange={(e) => {
                      const gid = e.target.value;
                      setRecLinkedGoalId(gid);
                      const found = goals.find((g) => g.id === gid);
                      if (found) setRecTitle(found.title);
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-2.5 py-1.5 font-ui text-[0.72rem] text-[var(--text-ivory)] focus:outline-none"
                  >
                    <option value="">Custom Focus Label...</option>
                    {goals
                      .filter((g) => g.scope === "daily" || g.scope === "weekly")
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                  </select>
                  <input
                    type="text"
                    value={recTitle}
                    onChange={(e) => setRecTitle(e.target.value)}
                    data-testid="recurring-block-title-input"
                    placeholder="e.g. Read Book, Deep Work, Weekly Review..."
                    className="mt-1.5 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Start Time
                    </span>
                    <input
                      type="time"
                      value={recStartTime}
                      onChange={(e) => setRecStartTime(e.target.value)}
                      data-testid="recurring-block-start-input"
                      className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-2.5 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)]"
                    />
                  </label>
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Duration
                    </span>
                    <select
                      value={recDuration}
                      onChange={(e) => setRecDuration(Number(e.target.value))}
                      data-testid="recurring-block-duration-select"
                      className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-2.5 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)]"
                    >
                      {[30, 45, 60, 90, 120, 180].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="space-y-1.5">
                  <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Cadence
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["daily", "Daily"],
                        ["weekdays", "Weekdays"],
                        ["weekends", "Weekends"],
                        ["specific_days", "Specific Days"],
                      ] as const
                    ).map(([cad, lbl]) => (
                      <button
                        key={cad}
                        type="button"
                        onClick={() => setRecCadence(cad)}
                        data-testid={`recurring-cadence-${cad}`}
                        className={`cursor-pointer rounded-full px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.12em] border ${
                          recCadence === cad
                            ? "border-[#C5A059]/60 bg-[#C5A059]/16 text-[var(--text-ivory)]"
                            : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)]"
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {recCadence === "specific_days" && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {WEEKDAY_LABELS.map((d, idx) => {
                        const on = recSpecificDays.includes(idx);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              setRecSpecificDays((prev) =>
                                prev.includes(idx)
                                  ? prev.filter((x) => x !== idx)
                                  : [...prev, idx].sort()
                              )
                            }
                            className={`cursor-pointer rounded-md px-2 py-0.5 font-ui text-[0.58rem] border ${
                              on
                                ? "border-[rgba(143,184,163,0.5)] bg-[rgba(143,184,163,0.18)] text-[var(--text-ivory)]"
                                : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)]"
                            }`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  data-testid="recurring-block-save-btn"
                  className="w-full smoked-glass smoked-glass-hover cursor-pointer rounded-full py-2 border border-[rgba(143,184,163,0.4)] font-ui text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-ivory)] flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--accent-luminous)]" />
                  Save Recurring Block
                </button>
              </form>

              {/* Existing Recurring Templates List */}
              <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
                {recurringBlocks.map((rb) => (
                  <div
                    key={rb.id}
                    data-testid={`recurring-template-${rb.id}`}
                    className="rounded-[9px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-editorial text-[0.98rem] text-[var(--text-ivory)] truncate">
                        {rb.title}
                      </div>
                      <div className="font-ui tabular-nums text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {formatTimeHHMM(rb.startTime, timeFormat)} · {rb.durationMinutes}m ·{" "}
                        {rb.cadence.replace("_", " ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDeleteRecurringBlock(rb.id)}
                      aria-label={`Delete ${rb.title}`}
                      className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {recurringBlocks.length === 0 && (
                  <div className="py-4 text-center font-reading italic text-[0.88rem] text-[var(--text-muted)]">
                    No recurring Focus Blocks defined yet.
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </MiniAppShell>
  );
}
