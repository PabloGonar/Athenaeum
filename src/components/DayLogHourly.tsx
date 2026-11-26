import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import type {
  ActivityBlockCategory,
  ActivityBlockHourly,
  TimeFormat,
} from "../types/athenaeum";
import { formatLogicalHourTime } from "../utils/logicalDate";

interface DayLogHourlyProps {
  date: string;
  blocks: ActivityBlockHourly[];
  timeFormat: TimeFormat;
  dayRolloverHour?: number;
  compact?: boolean;
  onDateChange?: (nextIso: string) => void;
  onUpsertBlock: (block: ActivityBlockHourly) => void;
  onDeleteBlock: (date: string, slotIndex: number) => void;
}

function shiftDateIso(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

function formatReadableDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function DayLogHourly({
  date,
  blocks,
  timeFormat,
  dayRolloverHour = 3,
  compact = false,
  onDateChange,
  onUpsertBlock,
  onDeleteBlock,
}: DayLogHourlyProps) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCategory, setDraftCategory] = useState<ActivityBlockCategory>("deep_work");
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const blockBySlot = useMemo(() => {
    return new Map<number, ActivityBlockHourly>(blocks.map((b) => [b.slotIndex, b]));
  }, [blocks]);

  const openSlotEditor = (slot: number) => {
    const existing = blockBySlot.get(slot);
    setSelectedSlot(slot);
    setDraftLabel(existing?.label ?? "");
    setDraftCategory(existing?.category ?? "deep_work");
  };

  const handleSaveSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSlot === null) return;
    const trimmed = draftLabel.trim();
    if (!trimmed) {
      if (blockBySlot.has(selectedSlot)) {
        onDeleteBlock(date, selectedSlot);
      }
      setSelectedSlot(null);
      return;
    }
    onUpsertBlock({
      date,
      slotIndex: selectedSlot,
      label: trimmed,
      category: draftCategory,
      source: "manual",
      updatedAt: new Date().toISOString(),
    });
    setSelectedSlot(null);
  };

  const hoveredBlock = hoveredSlot !== null ? blockBySlot.get(hoveredSlot) : null;

  return (
    <div
      data-testid="day-log-hourly"
      className={`smoked-glass rounded-[12px] ${compact ? "px-5 py-4" : "p-6"}`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
            Hourly Day Log
          </span>
          <span className="text-[var(--text-muted)]/40">·</span>
          <span
            data-testid="day-log-hourly-summary"
            className="font-editorial tabular-nums text-[0.98rem] text-[var(--text-ivory)]"
          >
            {blocks.length}h logged ({blocks.length}/24 hours)
          </span>
        </div>

        <div className="flex items-center gap-4">
          {hoveredSlot !== null && (
            <div className="font-editorial text-[0.88rem] text-[var(--text-ivory-soft)]">
              {formatLogicalHourTime(hoveredSlot, dayRolloverHour, timeFormat)} to{" "}
              {formatLogicalHourTime(hoveredSlot + 1, dayRolloverHour, timeFormat)}
              {hoveredBlock ? ` · ${hoveredBlock.label}` : " · Click to log"}
            </div>
          )}

          {onDateChange && (
            <div className="flex items-center gap-1.5 border-l border-[var(--glass-border)] pl-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedSlot(null);
                  onDateChange(shiftDateIso(date, -1));
                }}
                aria-label="Previous day"
                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="font-ui tabular-nums text-[0.68rem] tracking-[0.1em] text-[var(--text-ivory-soft)] min-w-[92px] text-center">
                {formatReadableDate(date)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedSlot(null);
                  onDateChange(shiftDateIso(date, 1));
                }}
                aria-label="Next day"
                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Hour Block Editor */}
      {selectedSlot !== null && (
        <form
          onSubmit={handleSaveSlot}
          data-testid="day-log-slot-editor"
          className="mt-3.5 rounded-[10px] border border-[rgba(194,168,120,0.28)] bg-[var(--surface-inner)] px-4 py-3 flex flex-wrap items-center gap-3"
        >
          <span className="font-ui tabular-nums text-[0.72rem] tracking-[0.1em] text-[var(--accent-luminous)] shrink-0">
            {formatLogicalHourTime(selectedSlot, dayRolloverHour, timeFormat)} to{" "}
            {formatLogicalHourTime(selectedSlot + 1, dayRolloverHour, timeFormat)}
          </span>

          <input
            type="text"
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="What did you focus on this hour?"
            data-testid="day-log-label-input"
            className="flex-1 min-w-[180px] rounded-[3px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1 font-reading text-[0.95rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-luminous)] focus:outline-none"
          />

          <div className="flex items-center gap-2 ml-auto">
            {blockBySlot.has(selectedSlot) && (
              <button
                type="button"
                onClick={() => {
                  onDeleteBlock(date, selectedSlot);
                  setSelectedSlot(null);
                }}
                aria-label="Clear hour block"
                className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="submit"
              data-testid="day-log-save-btn"
              className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.16)] px-4 py-1 font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.28)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setSelectedSlot(null)}
              aria-label="Close slot editor"
              className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      )}

      {/* 24 Clean 1-Hour Logical Day Blocks (3:00 through 2:00 next morning) */}
      <div className="mt-3.5">
        <div
          className="grid gap-[5px]"
          style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
          data-testid="day-log-slots-grid"
        >
          {Array.from({ length: 24 }, (_, slot) => {
            const entry = blockBySlot.get(slot);
            const isSelected = selectedSlot === slot;
            const startLbl = formatLogicalHourTime(slot, dayRolloverHour, timeFormat);
            const endLbl = formatLogicalHourTime(slot + 1, dayRolloverHour, timeFormat);
            return (
              <button
                key={slot}
                type="button"
                data-testid={`day-log-slot-${slot}`}
                onMouseEnter={() => setHoveredSlot(slot)}
                onMouseLeave={() => setHoveredSlot(null)}
                onClick={() => openSlotEditor(slot)}
                aria-label={`${startLbl} to ${endLbl}${entry ? `: ${entry.label}` : " (empty)"}`}
                title={`${startLbl} to ${endLbl}${entry ? ` · ${entry.label}` : ""}`}
                className={`h-8 cursor-pointer rounded-[3px] border transition-colors duration-150 focus:outline-none flex items-center justify-center overflow-hidden px-0.5 ${
                  entry
                    ? "bg-[rgba(226,180,109,0.28)] border-[rgba(226,180,109,0.52)]"
                    : "bg-[rgba(226,180,109,0.05)] border-[var(--glass-border)] hover:border-[rgba(226,180,109,0.42)]"
                } ${
                  isSelected
                    ? "ring-1 ring-[var(--text-ivory)]"
                    : ""
                }`}
              >
                {entry && (
                  <span className="font-ui text-[0.52rem] text-[var(--text-ivory)]/90 truncate">
                    {entry.label.slice(0, 4)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Clean 3-Hour Axis Ticks (3:00 -> 6:00 -> 9:00 -> 12:00 -> 3:00 -> 6:00 -> 9:00 -> 12:00 -> 2:00) */}
        <div
          className="mt-1.5 flex items-center justify-between font-ui tabular-nums text-[0.58rem] tracking-[0.08em] text-[var(--text-muted)]/85"
          data-testid="day-log-hour-axis"
        >
          {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((slot) => (
            <span key={slot}>
              {formatLogicalHourTime(slot, dayRolloverHour, timeFormat)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
