import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
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

export interface InitialCalendarEventDraft {
  title: string;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
}

interface CalendarMiniAppProps {
  logicalToday: string;
  dayRolloverHour: number;
  timeFormat: TimeFormat;
  blocks: ScheduleBlock[];
  recurringBlocks: RecurringFocusBlock[];
  overrides: RecurringBlockOverride[];
  externalEvents: ExternalCalendarEvent[];
  goals: GoalItem[];
  initialCreateEvent?: InitialCalendarEventDraft | null;
  onConsumeInitialCreateEvent?: () => void;
  onUpsertBlock: (block: ScheduleBlock) => Promise<void>;
  onDeleteBlock: (id: string) => Promise<void>;
  onUpsertRecurringBlock: (block: RecurringFocusBlock) => Promise<void>;
  onDeleteRecurringBlock: (id: string) => Promise<void>;
  onUpsertOverride: (override: RecurringBlockOverride) => Promise<void>;
  onStartFocusBlock: (title: string, durationMinutes?: number) => void;
  onClose: () => void;
}

type CalendarViewMode = "day" | "3day" | "week";

interface EventModalState {
  mode: "create" | "edit_manual" | "edit_recurring";
  blockId?: string;
  recurringBlockId?: string;
  origDate?: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  category: string;
}

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

function diffMinutesBetweenHHMM(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const startTotal = (sh || 0) * 60 + (sm || 0);
  let endTotal = (eh || 0) * 60 + (em || 0);
  if (endTotal <= startTotal) endTotal += 24 * 60;
  return Math.max(5, Math.min(720, endTotal - startTotal));
}

function getDefaultNextHourHHMM(): string {
  const now = new Date();
  const nextHour = (now.getHours() + 1) % 24;
  return `${String(nextHour).padStart(2, "0")}:00`;
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
  initialCreateEvent,
  onConsumeInitialCreateEvent,
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

  // Unified Create / Edit Event Modal state
  const [eventModal, setEventModal] = useState<EventModalState | null>(null);

  // Recurring Soft Block template creator inside side drawer
  const [recTitle, setRecTitle] = useState("");
  const [recLinkedGoalId, setRecLinkedGoalId] = useState<string>("");
  const [recStartTime, setRecStartTime] = useState("19:30");
  const [recDuration, setRecDuration] = useState<number>(60);
  const [recCadence, setRecCadence] = useState<RecurringBlockCadence>("daily");
  const [recSpecificDays, setRecSpecificDays] = useState<number[]>([0, 2, 4]);

  // Cross-day Drag / Resize live preview state
  const [dragPreview, setDragPreview] = useState<{
    itemId: string;
    mode: "move" | "resize";
    targetDate: string;
    startMin: number;
    durationMin: number;
  } | null>(null);
  const dragMetaRef = useRef<{
    item: ResolvedScheduleItem;
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    origDate: string;
    origStartMin: number;
    origDurationMin: number;
    hasMoved: boolean;
  } | null>(null);

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const dayColumnsGridRef = useRef<HTMLDivElement | null>(null);

  // Open pre-filled Create Event Modal when triggered from Goals -> "Add to Calendar"
  useEffect(() => {
    if (!initialCreateEvent) return;
    const start = initialCreateEvent.startTime || getDefaultNextHourHHMM();
    const dur = Math.max(5, Math.min(720, initialCreateEvent.durationMinutes ?? 60));
    const date = initialCreateEvent.date || logicalToday;
    setAnchorDate(date);
    setEventModal({
      mode: "create",
      title: initialCreateEvent.title,
      date,
      startTime: start,
      endTime: addMinutesToHHMM(start, dur),
      durationMinutes: dur,
      category: "Focus Block",
    });
    onConsumeInitialCreateEvent?.();
  }, [initialCreateEvent, logicalToday, onConsumeInitialCreateEvent]);

  // Auto-scroll vertical timeline cleanly to ~07:00 AM on initial open
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const sevenAmMin = toLogicalMinutes("07:00", dayRolloverHour);
    el.scrollTop = Math.max(0, (sevenAmMin / 60) * HOUR_HEIGHT - 24);
  }, [dayRolloverHour]);

  // Close event modal on Escape without dismissing the whole Calendar first
  useEffect(() => {
    if (!eventModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setEventModal(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [eventModal]);

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

  // Helper to resolve pointer X to target day column ISO date
  const resolveTargetDateFromClientX = useCallback(
    (clientX: number, fallbackDate: string): string => {
      const gridEl = dayColumnsGridRef.current;
      if (!gridEl || visibleDates.length <= 1) return fallbackDate;
      const rect = gridEl.getBoundingClientRect();
      if (rect.width <= 0) return fallbackDate;
      const relX = clientX - rect.left;
      const colWidth = rect.width / visibleDates.length;
      const idx = Math.max(0, Math.min(visibleDates.length - 1, Math.floor(relX / colWidth)));
      return visibleDates[idx] ?? fallbackDate;
    },
    [visibleDates]
  );

  // Global pointer listeners for cross-day drag & vertical resize (with 4px threshold so double-click works cleanly)
  const [pointerTracking, setPointerTracking] = useState(false);

  useEffect(() => {
    if (!pointerTracking) return;

    const onPointerMove = (e: PointerEvent) => {
      const meta = dragMetaRef.current;
      if (!meta) return;

      const dist = Math.hypot(e.clientX - meta.startClientX, e.clientY - meta.startClientY);
      if (!meta.hasMoved && dist < 4) return;
      meta.hasMoved = true;

      const deltaMinRaw = ((e.clientY - meta.startClientY) / HOUR_HEIGHT) * 60;
      const snappedDelta = Math.round(deltaMinRaw / 15) * 15;

      if (meta.mode === "move") {
        const nextStart = Math.max(
          0,
          Math.min(1440 - meta.origDurationMin, meta.origStartMin + snappedDelta)
        );
        const targetDate = resolveTargetDateFromClientX(e.clientX, meta.origDate);
        setDragPreview({
          itemId: meta.item.id,
          mode: "move",
          targetDate,
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
          targetDate: meta.origDate,
          startMin: meta.origStartMin,
          durationMin: nextDur,
        });
      }
    };

    const onPointerUp = () => {
      const meta = dragMetaRef.current;
      dragMetaRef.current = null;
      setPointerTracking(false);

      setDragPreview((currentPreview) => {
        if (meta && meta.hasMoved && currentPreview) {
          const nextStartHHMM = fromLogicalMinutes(currentPreview.startMin, dayRolloverHour);
          const nextEndHHMM = addMinutesToHHMM(nextStartHHMM, currentPreview.durationMin);

          if (meta.item.kind === "manual") {
            const orig = blocks.find((b) => b.id === meta.item.sourceId);
            if (orig) {
              void onUpsertBlock({
                ...orig,
                date: currentPreview.targetDate,
                startTime: nextStartHHMM,
                endTime: nextEndHHMM,
              });
            }
          } else if (meta.item.kind === "recurring") {
            if (currentPreview.targetDate === meta.origDate) {
              void onUpsertOverride({
                blockId: meta.item.sourceId,
                logicalDate: meta.item.date,
                status: "rescheduled",
                overrideStartTime: nextStartHHMM,
                overrideDurationMinutes: currentPreview.durationMin,
                updatedAt: new Date().toISOString(),
              });
            } else {
              // Moving a recurring occurrence to another day skips original day & creates a moved manual block
              void onUpsertOverride({
                blockId: meta.item.sourceId,
                logicalDate: meta.item.date,
                status: "skipped",
                overrideStartTime: null,
                overrideDurationMinutes: null,
                updatedAt: new Date().toISOString(),
              });
              void onUpsertBlock({
                id: `sb-${Date.now()}`,
                title: meta.item.title,
                startTime: nextStartHHMM,
                endTime: nextEndHHMM,
                category: meta.item.category || "Focus Block",
                date: currentPreview.targetDate,
              });
            }
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
  }, [
    pointerTracking,
    dayRolloverHour,
    blocks,
    onUpsertBlock,
    onUpsertOverride,
    resolveTargetDateFromClientX,
  ]);

  const openCreateModalAt = (dateIso: string, startHHMM: string, defaultDuration = 60) => {
    setEventModal({
      mode: "create",
      title: "",
      date: dateIso,
      startTime: startHHMM,
      endTime: addMinutesToHHMM(startHHMM, defaultDuration),
      durationMinutes: defaultDuration,
      category: "Focus Block",
    });
  };

  const openEditModalForItem = (item: ResolvedScheduleItem) => {
    if (item.kind === "external_ics") return;
    if (item.kind === "manual") {
      const orig = blocks.find((b) => b.id === item.sourceId);
      const start = orig?.startTime || item.startTime;
      const end = orig?.endTime || item.endTime;
      setEventModal({
        mode: "edit_manual",
        blockId: item.sourceId,
        origDate: orig?.date || item.date,
        title: orig?.title || item.title,
        date: orig?.date || item.date,
        startTime: start,
        endTime: end,
        durationMinutes: diffMinutesBetweenHHMM(start, end),
        category: orig?.category || item.category || "Focus Block",
      });
    } else if (item.kind === "recurring") {
      setEventModal({
        mode: "edit_recurring",
        recurringBlockId: item.sourceId,
        origDate: item.date,
        title: item.title,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        durationMinutes: item.durationMinutes,
        category: item.category || "Focus Block",
      });
    }
  };

  const handleSaveEventModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventModal) return;
    const trimmedTitle = eventModal.title.trim();
    if (!trimmedTitle) return;

    const safeDuration = Math.max(5, Math.min(720, Math.round(eventModal.durationMinutes || 60)));
    const resolvedEnd = addMinutesToHHMM(eventModal.startTime, safeDuration);

    if (eventModal.mode === "create") {
      await onUpsertBlock({
        id: `sb-${Date.now()}`,
        title: trimmedTitle,
        date: eventModal.date,
        startTime: eventModal.startTime,
        endTime: resolvedEnd,
        category: eventModal.category.trim() || "Focus Block",
      });
    } else if (eventModal.mode === "edit_manual" && eventModal.blockId) {
      await onUpsertBlock({
        id: eventModal.blockId,
        title: trimmedTitle,
        date: eventModal.date,
        startTime: eventModal.startTime,
        endTime: resolvedEnd,
        category: eventModal.category.trim() || "Focus Block",
      });
    } else if (eventModal.mode === "edit_recurring" && eventModal.recurringBlockId) {
      if (eventModal.date === eventModal.origDate) {
        await onUpsertOverride({
          blockId: eventModal.recurringBlockId,
          logicalDate: eventModal.date,
          status: "rescheduled",
          overrideStartTime: eventModal.startTime,
          overrideDurationMinutes: safeDuration,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await onUpsertOverride({
          blockId: eventModal.recurringBlockId,
          logicalDate: eventModal.origDate || eventModal.date,
          status: "skipped",
          overrideStartTime: null,
          overrideDurationMinutes: null,
          updatedAt: new Date().toISOString(),
        });
        await onUpsertBlock({
          id: `sb-${Date.now()}`,
          title: trimmedTitle,
          date: eventModal.date,
          startTime: eventModal.startTime,
          endTime: resolvedEnd,
          category: eventModal.category.trim() || "Focus Block",
        });
      }
    }
    setEventModal(null);
  };

  const handleDeleteEventModal = async () => {
    if (!eventModal) return;
    if (eventModal.mode === "edit_manual" && eventModal.blockId) {
      await onDeleteBlock(eventModal.blockId);
    } else if (eventModal.mode === "edit_recurring" && eventModal.recurringBlockId) {
      await onUpsertOverride({
        blockId: eventModal.recurringBlockId,
        logicalDate: eventModal.origDate || eventModal.date,
        status: "skipped",
        overrideStartTime: null,
        overrideDurationMinutes: null,
        updatedAt: new Date().toISOString(),
      });
    }
    setEventModal(null);
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
      durationMinutes: Math.max(5, Math.min(720, Math.round(recDuration || 60))),
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
      opaque
      wide
      onClose={onClose}
      rightSlot={
        <div className="flex items-center gap-3">
          {/* Day / 3-Day / Week Switcher */}
          <div className="flex items-center rounded-[4px] border border-[var(--glass-border)] bg-[#111724] p-0.5">
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
                className={`cursor-pointer rounded-[3px] px-3.5 py-1 font-ui text-[0.62rem] uppercase tracking-[0.14em] border-0 transition-colors ${
                  viewMode === m
                    ? "bg-[rgba(226,180,109,0.18)] text-[var(--text-ivory)]"
                    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openCreateModalAt(anchorDate, getDefaultNextHourHHMM(), 60)}
            data-testid="calendar-new-event-btn"
            className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.48)] bg-[rgba(226,180,109,0.14)] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.24)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5 text-[#E2B46D]" />
            New Event
          </button>

          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            data-testid="calendar-recurring-drawer-btn"
            aria-pressed={drawerOpen}
            className={`cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] border transition-colors ${
              drawerOpen
                ? "border-[#C5A059]/60 bg-[#C5A059]/14 text-[#e4c27c]"
                : "border-[var(--glass-border)] bg-[#111724] text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.38)]"
            }`}
          >
            <Repeat className="h-3.5 w-3.5 text-[#C5A059]" />
            Recurring ({recurringBlocks.length})
          </button>
        </div>
      }
    >
      <div data-testid="calendar-overlay-view" className="space-y-4 pb-8">
        {/* Top Bar: Date Navigation + Subtle Interaction Hint */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAnchorDate((d) => shiftIsoDate(d, -stepDays))}
              aria-label="Previous range"
              className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-[#111724] p-1.5 text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.4)] hover:text-[var(--text-ivory)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(logicalToday)}
              className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[#111724] px-3.5 py-1 font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.14)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate((d) => shiftIsoDate(d, stepDays))}
              aria-label="Next range"
              className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-[#111724] p-1.5 text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.4)] hover:text-[var(--text-ivory)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="font-ui text-[0.62rem] tracking-[0.08em] text-[var(--text-muted)]">
            Double-click any slot to create · Double-click an event to edit · Drag across days to reschedule
          </div>
        </div>

        {/* Displaced Conflicts Banner across visible days */}
        {allDisplaced.length > 0 && (
          <div
            data-testid="calendar-displaced-banner"
            className="rounded-[8px] border border-[#C5A059]/40 bg-[#121824] px-5 py-3.5 space-y-2"
          >
            <div className="flex items-center gap-2 font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#e4c27c]">
              <AlertTriangle className="h-3.5 w-3.5" />
              Recurring Focus Blocks Displaced by Read-Only Calendar Events ({allDisplaced.length})
            </div>
            <div className="flex flex-wrap gap-3">
              {allDisplaced.map((d) => (
                <div
                  key={`${d.block.id}-${d.logicalDate}`}
                  className="rounded-[6px] border border-[var(--glass-border)] bg-[#0E1420] px-3.5 py-2 flex flex-wrap items-center gap-3"
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
                        className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.4)] bg-[rgba(226,180,109,0.12)] px-2.5 py-0.5 font-ui tabular-nums text-[0.58rem] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.24)]"
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

        {/* Main Workspace: Unified Scroll Container (Sticky Headers + 24h Time Grid) + Optional Recurring Drawer */}
        <div className="flex gap-5 items-start">
          <div className="flex-1 min-w-0 rounded-[10px] overflow-hidden border border-[var(--glass-border)] bg-[#0E131D]">
            {/* Unified scroll container with scrollbar-gutter: stable so day headers and vertical dividers align pixel-for-pixel */}
            <div
              ref={timelineScrollRef}
              data-testid="calendar-timeline-grid"
              style={{ scrollbarGutter: "stable" }}
              className="relative h-[68vh] min-h-[500px] overflow-y-auto overflow-x-auto select-none"
            >
              {/* Sticky Day Column Headers INSIDE the exact same scroll container */}
              <div
                data-testid="calendar-sticky-header"
                className="sticky top-0 z-30 flex border-b border-[var(--glass-border)] bg-[#0B0F17]"
              >
                <div className="w-[64px] shrink-0 py-3 text-center font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {String(dayRolloverHour).padStart(2, "0")}:00+
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
                          isToday ? "bg-[rgba(226,180,109,0.1)]" : "bg-[#0B0F17]"
                        }`}
                      >
                        <span
                          className={`font-editorial text-[1.06rem] ${
                            isToday ? "text-[#E2B46D]" : "text-[var(--text-ivory-soft)]"
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

              {/* 24-Hour Logical Day Vertical Grid Body */}
              <div className="flex relative">
                {/* Left Hour Axis */}
                <div
                  className="w-[64px] shrink-0 relative bg-[#0B0F17]"
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
                  ref={dayColumnsGridRef}
                  className="flex-1 grid relative"
                  style={{
                    height: 24 * HOUR_HEIGHT,
                    gridTemplateColumns: `repeat(${visibleDates.length}, minmax(0, 1fr))`,
                  }}
                >
                  {resolvedColumns.map((col) => {
                    const isDropTarget =
                      dragPreview &&
                      dragPreview.mode === "move" &&
                      dragPreview.targetDate === col.dateIso;

                    // Render items belonging to this column OR a cross-day dragged item hovering over this column
                    const columnItems = col.items
                      .filter((it) => !it.allDay)
                      .filter((it) => {
                        if (
                          dragPreview &&
                          dragPreview.itemId === it.id &&
                          dragPreview.targetDate !== col.dateIso
                        ) {
                          return false;
                        }
                        return true;
                      });

                    // Check if a dragged item from another column is hovering over this column
                    const incomingDragItem =
                      dragPreview && dragPreview.targetDate === col.dateIso
                        ? resolvedColumns
                            .flatMap((c) => c.items)
                            .find(
                              (it) =>
                                it.id === dragPreview.itemId && it.date !== col.dateIso
                            ) ?? null
                        : null;

                    const itemsToRender = incomingDragItem
                      ? [...columnItems, incomingDragItem]
                      : columnItems;

                    return (
                      <div
                        key={col.dateIso}
                        data-testid={`calendar-col-${col.dateIso}`}
                        onDoubleClick={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest("[data-calendar-event='true']")) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const relY = Math.max(0, e.clientY - rect.top);
                          const clickedMinRaw = (relY / HOUR_HEIGHT) * 60;
                          const snappedMin = Math.max(
                            0,
                            Math.min(1425, Math.floor(clickedMinRaw / 15) * 15)
                          );
                          const startHHMM = fromLogicalMinutes(snappedMin, dayRolloverHour);
                          openCreateModalAt(col.dateIso, startHHMM, 60);
                        }}
                        className={`relative border-l border-[rgba(214,224,212,0.08)] transition-colors ${
                          isDropTarget ? "bg-[rgba(226,180,109,0.06)]" : ""
                        }`}
                        style={{ height: 24 * HOUR_HEIGHT }}
                      >
                        {/* Subtle hourly gridlines */}
                        {Array.from({ length: 24 }, (_, slot) => (
                          <div
                            key={slot}
                            style={{ top: slot * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                            className="pointer-events-none absolute inset-x-0 border-t border-[rgba(214,224,212,0.05)]"
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
                        {itemsToRender.map((item) => {
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
                              data-calendar-event="true"
                              data-testid={
                                isExternal ? "calendar-ics-block" : "calendar-focus-block"
                              }
                              style={{ top: topPx, height: heightPx }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (!isExternal) {
                                  openEditModalForItem(item);
                                }
                              }}
                              onPointerDown={(e) => {
                                if (isExternal || e.button !== 0) return;
                                const target = e.target as HTMLElement;
                                if (target.closest("button")) return;
                                e.stopPropagation();
                                dragMetaRef.current = {
                                  item,
                                  mode: "move",
                                  startClientX: e.clientX,
                                  startClientY: e.clientY,
                                  origDate: item.date,
                                  origStartMin: item.startLogicalMin,
                                  origDurationMin: item.durationMinutes,
                                  hasMoved: false,
                                };
                                setPointerTracking(true);
                              }}
                              className={`group absolute left-1.5 right-1.5 z-10 rounded-[6px] border px-2.5 py-1.5 overflow-hidden transition-shadow ${
                                isExternal
                                  ? "border-[#C5A059]/50 bg-[#1B1810] cursor-default"
                                  : "border-[rgba(226,180,109,0.38)] bg-[#151E2E] hover:border-[#E2B46D] cursor-grab active:cursor-grabbing"
                              } ${previewing ? "ring-1 ring-[#E2B46D] shadow-xl z-25 opacity-95" : ""}`}
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
                                      ? " · Recurring"
                                      : ""}
                                  </div>
                                </div>

                                {isExternal ? (
                                  <span title="Read-only imported .ics event">
                                    <Lock className="h-3 w-3 shrink-0 text-[#C5A059]/80" />
                                  </span>
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
                                      className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.16)] px-2 py-0.5 flex items-center gap-1 font-ui text-[0.54rem] uppercase tracking-[0.1em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.28)]"
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

                              {/* Bottom Resize Handle for App Events */}
                              {!isExternal && (
                                <div
                                  onPointerDown={(e) => {
                                    e.stopPropagation();
                                    dragMetaRef.current = {
                                      item,
                                      mode: "resize",
                                      startClientX: e.clientX,
                                      startClientY: e.clientY,
                                      origDate: item.date,
                                      origStartMin: item.startLogicalMin,
                                      origDurationMin: item.durationMinutes,
                                      hasMoved: false,
                                    };
                                    setPointerTracking(true);
                                  }}
                                  title="Drag to resize duration"
                                  className="absolute inset-x-3 bottom-0 h-2 cursor-ns-resize flex items-center justify-center"
                                >
                                  <span className="h-[2px] w-7 rounded-full bg-[rgba(226,180,109,0.45)] opacity-0 group-hover:opacity-100" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Recurring Focus Block Templates Side Drawer */}
          {drawerOpen && (
            <aside
              data-testid="recurring-blocks-drawer"
              className="w-[330px] shrink-0 rounded-[10px] border border-[#C5A059]/35 bg-[#101622] p-5 space-y-5 max-h-[68vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
                <div>
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#C5A059]">
                    Recurring Soft Blocks
                  </div>
                  <div className="font-reading text-[0.86rem] text-[var(--text-muted)]">
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
                    className="mt-1 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-1.5 font-ui text-[0.72rem] text-[var(--text-ivory)] focus:outline-none"
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
                    placeholder="e.g. Deep Work, Reading, Weekly Review..."
                    className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-3 py-1.5 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[#E2B46D] focus:outline-none"
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
                      className="mt-1 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)]"
                    />
                  </label>
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Duration (min)
                    </span>
                    <input
                      type="number"
                      min={5}
                      max={720}
                      value={recDuration}
                      onChange={(e) =>
                        setRecDuration(Math.max(5, Math.min(720, Number(e.target.value) || 60)))
                      }
                      data-testid="recurring-block-duration-input"
                      className="mt-1 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)]"
                    />
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
                        className={`cursor-pointer rounded-[3px] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.12em] border ${
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
                            className={`cursor-pointer rounded-[3px] px-2 py-0.5 font-ui text-[0.58rem] border ${
                              on
                                ? "border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.18)] text-[var(--text-ivory)]"
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
                  className="w-full cursor-pointer rounded-[3px] py-2 border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.14)] font-ui text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.24)] flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5 text-[#E2B46D]" />
                  Save Recurring Block
                </button>
              </form>

              {/* Existing Recurring Templates List */}
              <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
                {recurringBlocks.map((rb) => (
                  <div
                    key={rb.id}
                    data-testid={`recurring-template-${rb.id}`}
                    className="rounded-[6px] border border-[var(--glass-border)] bg-[#0B0F17] px-3 py-2.5 flex items-center justify-between gap-2"
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
                  <div className="py-4 text-center font-reading text-[0.88rem] text-[var(--text-muted)]">
                    No recurring Focus Blocks defined yet.
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ==================== CREATE / EDIT EVENT MODAL ==================== */}
      {eventModal && (
        <div
          data-testid="calendar-event-modal"
          onClick={() => setEventModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,8,14,0.78)] px-4"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void handleSaveEventModal(e)}
            className="w-full max-w-[460px] rounded-[8px] border border-[rgba(226,180,109,0.34)] bg-[#0F1521] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[rgba(226,180,109,0.14)] pb-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
                <h3 className="font-editorial text-[1.28rem] font-normal text-[var(--text-ivory)]">
                  {eventModal.mode === "create"
                    ? "Create Event"
                    : eventModal.mode === "edit_recurring"
                    ? "Reschedule Occurrence"
                    : "Edit Event"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEventModal(null)}
                aria-label="Close modal"
                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block">
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Event Title
              </span>
              <input
                type="text"
                autoFocus
                required
                value={eventModal.title}
                onChange={(e) => setEventModal({ ...eventModal, title: e.target.value })}
                data-testid="event-modal-title-input"
                placeholder="e.g. Deep Work Session, Design Review..."
                className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-3 py-2 font-reading text-[0.98rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#E2B46D] focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Date
                </span>
                <input
                  type="date"
                  required
                  value={eventModal.date}
                  onChange={(e) => setEventModal({ ...eventModal, date: e.target.value })}
                  data-testid="event-modal-date-input"
                  className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-3 py-2 font-ui tabular-nums text-[0.78rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Category
                </span>
                <input
                  type="text"
                  value={eventModal.category}
                  onChange={(e) => setEventModal({ ...eventModal, category: e.target.value })}
                  data-testid="event-modal-category-input"
                  placeholder="Focus Block"
                  className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-3 py-2 font-ui text-[0.78rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Start Time
                </span>
                <input
                  type="time"
                  required
                  value={eventModal.startTime}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setEventModal({
                      ...eventModal,
                      startTime: nextStart,
                      endTime: addMinutesToHHMM(nextStart, eventModal.durationMinutes),
                    });
                  }}
                  data-testid="event-modal-start-input"
                  className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-2 font-ui tabular-nums text-[0.78rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  End Time
                </span>
                <input
                  type="time"
                  required
                  value={eventModal.endTime}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    const nextDur = diffMinutesBetweenHHMM(eventModal.startTime, nextEnd);
                    setEventModal({
                      ...eventModal,
                      endTime: nextEnd,
                      durationMinutes: nextDur,
                    });
                  }}
                  data-testid="event-modal-end-input"
                  className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-2 font-ui tabular-nums text-[0.78rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Duration (min)
                </span>
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={eventModal.durationMinutes}
                  onChange={(e) => {
                    const nextDur = Math.max(5, Math.min(720, Number(e.target.value) || 5));
                    setEventModal({
                      ...eventModal,
                      durationMinutes: nextDur,
                      endTime: addMinutesToHHMM(eventModal.startTime, nextDur),
                    });
                  }}
                  data-testid="event-modal-duration-input"
                  className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[#0B0F17] px-2.5 py-2 font-ui tabular-nums text-[0.78rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[rgba(226,180,109,0.14)] pt-4">
              <div>
                {eventModal.mode !== "create" && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteEventModal()}
                    data-testid="event-modal-delete-btn"
                    className="cursor-pointer rounded-[3px] border border-[rgba(207,114,97,0.4)] bg-[rgba(207,114,97,0.12)] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[#f0a599] hover:bg-[rgba(207,114,97,0.22)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {eventModal.mode === "edit_recurring" ? "Skip Day" : "Delete"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setEventModal(null)}
                  className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-transparent px-4 py-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="event-modal-save-btn"
                  className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.58)] bg-[rgba(226,180,109,0.2)] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.3)]"
                >
                  {eventModal.mode === "create" ? "Create Event" : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </MiniAppShell>
  );
}
