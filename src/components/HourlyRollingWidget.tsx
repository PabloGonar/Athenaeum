import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  ActivityBlockCategory,
  ActivityBlockHourly,
  ExternalCalendarEvent,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ScheduleBlock,
  TimeFormat,
} from "../types/athenaeum";
import {
  formatLogicalHourTime,
  getLogicalHourSlotIndex,
} from "../utils/logicalDate";
import { resolveDaySchedule } from "../utils/scheduleEngine";

interface HourlyRollingWidgetProps {
  date: string;
  blocks: ActivityBlockHourly[];
  scheduleBlocks: ScheduleBlock[];
  recurringBlocks: RecurringFocusBlock[];
  overrides: RecurringBlockOverride[];
  externalEvents: ExternalCalendarEvent[];
  timeFormat: TimeFormat;
  dayRolloverHour?: number;
  onUpsertBlock: (block: ActivityBlockHourly) => void;
  onDeleteBlock: (date: string, slotIndex: number) => void;
}

export function HourlyRollingWidget({
  date,
  blocks,
  scheduleBlocks,
  recurringBlocks,
  overrides,
  externalEvents,
  timeFormat,
  dayRolloverHour = 3,
  onUpsertBlock,
  onDeleteBlock,
}: HourlyRollingWidgetProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const wheelCooldownUntilRef = useRef<number>(0);
  const debounceTimerRef = useRef<number | null>(null);

  const [nowSlot, setNowSlot] = useState<number>(() =>
    getLogicalHourSlotIndex(new Date(), dayRolloverHour)
  );
  const [selectedSlot, setSelectedSlot] = useState<number>(() =>
    getLogicalHourSlotIndex(new Date(), dayRolloverHour)
  );

  // Keep current logical hour live (auto-advances selectedSlot if user was pinned on "now")
  useEffect(() => {
    const syncNow = () => {
      const next = getLogicalHourSlotIndex(new Date(), dayRolloverHour);
      setNowSlot((prevNow) => {
        if (prevNow !== next) {
          setSelectedSlot((prevSel) => (prevSel === prevNow ? next : prevSel));
        }
        return next;
      });
    };
    syncNow();
    const id = window.setInterval(syncNow, 30000);
    return () => window.clearInterval(id);
  }, [dayRolloverHour]);

  const blockBySlot = useMemo(
    () => new Map<number, ActivityBlockHourly>(blocks.map((b) => [b.slotIndex, b])),
    [blocks]
  );

  // Resolve today's scheduled events by logical hour slot for gentle preview in unlogged upcoming rows
  const scheduledTitleBySlot = useMemo(() => {
    const map = new Map<number, string>();
    const resolved = resolveDaySchedule(
      date,
      scheduleBlocks,
      recurringBlocks,
      overrides,
      externalEvents,
      dayRolloverHour,
      false
    );
    for (const item of resolved.items) {
      if (item.allDay) continue;
      const startSlot = Math.max(0, Math.min(23, Math.floor(item.startLogicalMin / 60)));
      const endSlot = Math.max(
        startSlot,
        Math.min(23, Math.floor(Math.max(item.startLogicalMin, item.endLogicalMin - 1) / 60))
      );
      for (let s = startSlot; s <= endSlot; s++) {
        if (!map.has(s)) {
          map.set(s, item.title);
        }
      }
    }
    return map;
  }, [date, scheduleBlocks, recurringBlocks, overrides, externalEvents, dayRolloverHour]);

  const activeBlock = blockBySlot.get(selectedSlot);
  const [draftLabel, setDraftLabel] = useState<string>(activeBlock?.label ?? "");
  const [draftCategory, setDraftCategory] = useState<ActivityBlockCategory>(
    activeBlock?.category ?? "deep_work"
  );
  const isEditingRef = useRef(false);

  // Sync draft state when stepping to another hour OR when Focus Session auto-updates SQLite
  useEffect(() => {
    if (isEditingRef.current) return;
    const blk = blockBySlot.get(selectedSlot);
    setDraftLabel(blk?.label ?? "");
    setDraftCategory(blk?.category ?? "deep_work");
  }, [selectedSlot, blockBySlot]);

  const commitSlot = useCallback(
    (slot: number, rawLabel: string, category: ActivityBlockCategory) => {
      const trimmed = rawLabel.trim();
      const existing = blockBySlot.get(slot);
      if (!trimmed) {
        if (existing) {
          onDeleteBlock(date, slot);
        }
        return;
      }
      if (
        existing &&
        existing.label === trimmed &&
        existing.category === category
      ) {
        return;
      }
      onUpsertBlock({
        date,
        slotIndex: slot,
        label: trimmed,
        category,
        source: "manual",
        updatedAt: new Date().toISOString(),
      });
    },
    [blockBySlot, date, onDeleteBlock, onUpsertBlock]
  );

  // Flush any pending debounced edit when switching hours
  const stepToSlot = useCallback(
    (nextSlot: number) => {
      const clamped = Math.max(0, Math.min(23, nextSlot));
      if (clamped === selectedSlot) return;
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        commitSlot(selectedSlot, draftLabel, draftCategory);
      }
      isEditingRef.current = false;
      setSelectedSlot(clamped);
    },
    [commitSlot, draftCategory, draftLabel, selectedSlot]
  );

  // Local non-passive wheel handler so scrolling through all 24 logical hours never scrolls the full page
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (Math.abs(e.deltaY) < 4) return;
      const now = Date.now();
      if (now < wheelCooldownUntilRef.current) return;
      wheelCooldownUntilRef.current = now + 85;
      const delta = e.deltaY > 0 ? 1 : -1;
      setSelectedSlot((prev) => {
        const next = Math.max(0, Math.min(23, prev + delta));
        if (next !== prev) {
          isEditingRef.current = false;
        }
        return next;
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleLabelChange = (value: string) => {
    isEditingRef.current = true;
    setDraftLabel(value);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    const targetSlot = selectedSlot;
    const targetCat = draftCategory;
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      commitSlot(targetSlot, value, targetCat);
    }, 420);
  };

  const prevSlot = selectedSlot > 0 ? selectedSlot - 1 : null;
  const nextSlot = selectedSlot < 23 ? selectedSlot + 1 : null;
  const prevBlock = prevSlot !== null ? blockBySlot.get(prevSlot) : undefined;
  const nextBlock = nextSlot !== null ? blockBySlot.get(nextSlot) : undefined;
  const nextScheduled = nextSlot !== null ? scheduledTitleBySlot.get(nextSlot) : undefined;

  const isViewingNow = selectedSlot === nowSlot;

  return (
    <div
      ref={cardRef}
      data-local-scroll="true"
      data-testid="hourly-rolling-widget"
      data-selected-slot={selectedSlot}
      className="smoked-glass w-[320px] rounded-[6px] p-3.5 text-left select-none"
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[rgba(226,180,109,0.14)]">
        <div className="flex items-center gap-2">
          <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[#E2B46D]/90">
            Hourly Check-In
          </span>
          <span className="font-ui tabular-nums text-[0.56rem] uppercase tracking-[0.12em] text-[var(--text-muted)]/85">
            {blocks.length}/24h
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {!isViewingNow && (
            <button
              type="button"
              onClick={() => stepToSlot(nowSlot)}
              data-testid="hourly-now-btn"
              className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.42)] bg-[rgba(226,180,109,0.14)] px-2 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.24)] transition-colors"
            >
              Now
            </button>
          )}
          <button
            type="button"
            disabled={selectedSlot <= 0}
            onClick={() => stepToSlot(selectedSlot - 1)}
            data-testid="hourly-prev-btn"
            aria-label="Previous hour"
            className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] disabled:opacity-25 transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            disabled={selectedSlot >= 23}
            onClick={() => stepToSlot(selectedSlot + 1)}
            data-testid="hourly-next-btn"
            aria-label="Next hour"
            className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] disabled:opacity-25 transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* 3-Row Rolling Vertical Hour Stack */}
      <div className="mt-2.5 flex flex-col gap-1.5">
        {/* ROW 1: Previous Hour (~42% opacity) */}
        <button
          type="button"
          disabled={prevSlot === null}
          onClick={() => prevSlot !== null && stepToSlot(prevSlot)}
          data-testid="hourly-row-prev"
          className="flex items-center justify-between gap-2.5 rounded-[8px] border border-transparent bg-transparent px-2.5 py-1.5 text-left opacity-[0.44] hover:border-[rgba(218,195,152,0.14)] disabled:cursor-default disabled:hover:border-transparent cursor-pointer focus:outline-none"
        >
          {prevSlot !== null ? (
            <>
              <span className="w-[46px] shrink-0 font-ui tabular-nums text-[0.64rem] tracking-[0.06em] text-[var(--text-muted)]">
                {formatLogicalHourTime(prevSlot, dayRolloverHour, timeFormat)}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`truncate font-reading text-[0.84rem] ${
                    prevBlock
                      ? "text-[var(--text-ivory-soft)]"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {prevBlock ? prevBlock.label : "Unlogged"}
                </span>
              </div>
            </>
          ) : (
            <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Start of Logical Day · {formatLogicalHourTime(0, dayRolloverHour, timeFormat)}
            </span>
          )}
        </button>

        {/* ROW 2: Active / Selected Hour (100% opacity + warm antique-brass border) */}
        <div
          data-testid="hourly-row-active"
          className="rounded-[9px] border border-[rgba(224,177,104,0.46)] bg-[rgba(224,177,104,0.07)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(243,239,230,0.07)]"
        >
          <div className="flex items-center gap-2">
            <div className="flex w-[46px] shrink-0 items-center gap-1.5">
              <span
                data-testid="hourly-active-label"
                className="font-ui tabular-nums text-[0.68rem] font-medium tracking-[0.06em] text-[#E0B168]"
              >
                {formatLogicalHourTime(selectedSlot, dayRolloverHour, timeFormat)}
              </span>
              {isViewingNow && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[#E0B168]"
                  title="Current hour"
                />
              )}
            </div>

            <input
              type="text"
              value={draftLabel}
              onChange={(e) => handleLabelChange(e.target.value)}
              onFocus={() => {
                isEditingRef.current = true;
              }}
              onBlur={() => {
                if (debounceTimerRef.current !== null) {
                  window.clearTimeout(debounceTimerRef.current);
                  debounceTimerRef.current = null;
                }
                isEditingRef.current = false;
                commitSlot(selectedSlot, draftLabel, draftCategory);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (debounceTimerRef.current !== null) {
                    window.clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = null;
                  }
                  commitSlot(selectedSlot, draftLabel, draftCategory);
                  (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  stepToSlot(selectedSlot - 1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  stepToSlot(selectedSlot + 1);
                }
              }}
              data-testid="hourly-checkin-input"
              aria-label={`Log activity for ${formatLogicalHourTime(selectedSlot, dayRolloverHour, timeFormat)}`}
              placeholder="What did you work on?"
              className="min-w-0 flex-1 bg-transparent border-0 p-0 font-reading text-[0.92rem] text-[#F3EFE6] placeholder:text-[#9FB0C3]/65 focus:outline-none"
            />
          </div>
        </div>

        {/* ROW 3: Next Hour (~42% opacity) */}
        <button
          type="button"
          disabled={nextSlot === null}
          onClick={() => nextSlot !== null && stepToSlot(nextSlot)}
          data-testid="hourly-row-next"
          className="flex items-center justify-between gap-2.5 rounded-[8px] border border-transparent bg-transparent px-2.5 py-1.5 text-left opacity-[0.44] hover:border-[rgba(218,195,152,0.14)] disabled:cursor-default disabled:hover:border-transparent cursor-pointer focus:outline-none"
        >
          {nextSlot !== null ? (
            <>
              <span className="w-[46px] shrink-0 font-ui tabular-nums text-[0.64rem] tracking-[0.06em] text-[var(--text-muted)]">
                {formatLogicalHourTime(nextSlot, dayRolloverHour, timeFormat)}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={`truncate font-reading text-[0.84rem] ${
                    nextBlock || nextScheduled
                      ? "text-[var(--text-ivory-soft)]"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {nextBlock
                    ? nextBlock.label
                    : nextScheduled
                    ? `Up next: ${nextScheduled}`
                    : "Unlogged"}
                </span>
              </div>
            </>
          ) : (
            <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              End of Logical Day · {formatLogicalHourTime(23, dayRolloverHour, timeFormat)}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
