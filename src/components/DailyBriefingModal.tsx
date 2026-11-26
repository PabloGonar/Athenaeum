import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Compass, Target } from "lucide-react";
import type {
  DailyDebriefRecord,
  GoalItem,
  ScheduleBlock,
  TimeFormat,
} from "../types/athenaeum";
import { formatTimeHHMM } from "../utils/time";

interface DailyBriefingModalProps {
  open: boolean;
  userName: string;
  timeFormat: TimeFormat;
  logicalToday: string;
  goals: GoalItem[];
  schedule: ScheduleBlock[];
  yesterdayFocusMinutes: number;
  yesterdayDebrief: DailyDebriefRecord | null;
  onOpenDailyDebrief?: () => void;
  onDismiss: () => void;
}

const PRIORITY_RANK: Record<GoalItem["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function formatFocusDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function DailyBriefingModal({
  open,
  userName,
  timeFormat,
  logicalToday,
  goals,
  schedule,
  yesterdayFocusMinutes,
  yesterdayDebrief,
  onOpenDailyDebrief,
  onDismiss,
}: DailyBriefingModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onDismiss]);

  // 1. Today's Top Priorities: Up to 4 active Daily goals (High -> Medium -> Low)
  const topDailyPriorities = useMemo(() => {
    return goals
      .filter((g) => g.scope === "daily" && !g.completed)
      .sort((a, b) => {
        const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.sortOrder - b.sortOrder;
      })
      .slice(0, 4);
  }, [goals]);

  // Today's next scheduled calendar blocks
  const todaySchedule = useMemo(() => {
    const forToday = schedule.filter((b) => !b.date || b.date === logicalToday);
    const list = forToday.length > 0 ? forToday : schedule;
    return [...list].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 2);
  }, [schedule, logicalToday]);

  // 2. Yesterday's Carryover: unfinished daily tasks created before today (excluding auto-generated debrief task)
  const carryoverDailyTasks = useMemo(() => {
    return goals
      .filter(
        (g) =>
          g.scope === "daily" &&
          !g.completed &&
          !g.id.startsWith("daily-debrief-") &&
          Boolean(g.createdAt) &&
          g.createdAt.slice(0, 10) < logicalToday
      )
      .slice(0, 3);
  }, [goals, logicalToday]);

  // 3. Morning Anchor from yesterday's Daily Debrief closingThought / tomorrow's priority
  const morningAnchorText = yesterdayDebrief?.closingThought?.trim() ?? "";

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="daily-briefing-backdrop"
          data-testid="daily-briefing-modal"
          data-glass-theme="surface"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
          className="theme-surface fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,11,18,0.72)] px-6 py-8"
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="smoked-glass-modal relative w-full max-w-[740px] rounded-[8px] px-9 py-8 md:px-11 md:py-10 text-[var(--text-ivory)]"
          >
            {/* Header */}
            <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(226,180,109,0.16)] pb-4">
              <div>
                <div className="font-ui text-[0.62rem] uppercase tracking-[0.26em] text-[#E2B46D]">
                  Daily Briefing
                </div>
                <h2 className="mt-1.5 font-editorial text-[2rem] font-normal tracking-[0.03em] text-[var(--text-ivory)]">
                  {userName.trim() ? `Daily Overview, ${userName.trim()}` : "Daily Overview"}
                </h2>
              </div>
              <div className="font-ui text-[0.72rem] uppercase tracking-[0.14em] text-[var(--text-muted)] shrink-0">
                {dateLabel}
              </div>
            </div>

            {/* Two-Column High-Signal Briefing Body */}
            <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
              {/* 1. Today's Top Priorities + Next Calendar Block */}
              <div data-testid="briefing-top-priorities">
                <div className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                  <Target className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Today&apos;s Top Priorities
                </div>
                <ul className="mt-3 space-y-2 list-none p-0 m-0">
                  {topDailyPriorities.length > 0 ? (
                    topDailyPriorities.map((g) => (
                      <li
                        key={g.id}
                        className="flex items-baseline justify-between gap-3 border-b border-[rgba(226,180,109,0.1)] pb-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                g.priority === "high"
                                  ? "#D96B52"
                                  : g.priority === "medium"
                                  ? "#E2B46D"
                                  : "#8C8275",
                            }}
                            title={`${g.priority} priority`}
                          />
                          <span className="font-reading text-[0.98rem] text-[var(--text-ivory)] truncate">
                            {g.title}
                          </span>
                        </div>
                        {g.durationMinutes > 0 && (
                          <span className="font-ui tabular-nums text-[0.66rem] text-[var(--text-muted)] shrink-0">
                            {g.durationMinutes}m
                          </span>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="font-reading text-[0.95rem] text-[var(--text-muted)]">
                      All daily priorities are clear.
                    </li>
                  )}
                </ul>

                {todaySchedule.length > 0 && (
                  <div className="mt-4 border-t border-[rgba(226,180,109,0.12)] pt-3">
                    <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                      Next Scheduled
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {todaySchedule.map((blk) => (
                        <div
                          key={blk.id}
                          className="font-ui tabular-nums text-[0.72rem] text-[var(--text-ivory-soft)]"
                        >
                          {formatTimeHHMM(blk.startTime, timeFormat)} to{" "}
                          {formatTimeHHMM(blk.endTime, timeFormat)} · {blk.title}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Yesterday's Carryover & Focus */}
              <div data-testid="briefing-yesterday-carryover">
                <div className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Yesterday&apos;s Carryover &amp; Focus
                </div>

                <div className="mt-3 rounded-[4px] border border-[rgba(226,180,109,0.16)] bg-[rgba(12,18,28,0.62)] px-4 py-3">
                  <div className="font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Focus Logged Yesterday
                  </div>
                  <div className="mt-1 font-editorial tabular-nums text-[1.55rem] leading-none text-[#F2C464]">
                    {yesterdayFocusMinutes > 0
                      ? formatFocusDuration(yesterdayFocusMinutes)
                      : "0m"}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                    Carryover Daily Tasks
                  </div>
                  <ul className="mt-2 space-y-2 list-none p-0 m-0">
                    {carryoverDailyTasks.length > 0 ? (
                      carryoverDailyTasks.map((g) => (
                        <li
                          key={g.id}
                          className="border-l-2 border-[rgba(226,180,109,0.45)] pl-3 font-reading text-[0.95rem] text-[var(--text-ivory-soft)] truncate"
                        >
                          {g.title}
                        </li>
                      ))
                    ) : (
                      <li className="font-reading text-[0.92rem] text-[var(--text-muted)]">
                        Clean slate with no unfinished daily tasks carried over.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            {/* 3. Morning Anchor (from Yesterday's Daily Debrief — never repeating Observatory quote) */}
            <div
              data-testid="briefing-morning-anchor"
              className="mt-6 border-t border-[rgba(226,180,109,0.14)] pt-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-ui text-[0.6rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                  <Compass className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Morning Anchor
                </div>
                {!morningAnchorText && onOpenDailyDebrief && (
                  <button
                    type="button"
                    onClick={onOpenDailyDebrief}
                    className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[#E2B46D] transition-colors"
                  >
                    Open Daily Debrief
                  </button>
                )}
              </div>

              {morningAnchorText ? (
                <p className="mt-2 font-reading text-[1.04rem] leading-relaxed text-[var(--text-ivory)]">
                  {morningAnchorText}
                </p>
              ) : (
                <p className="mt-2 font-reading text-[0.98rem] leading-relaxed text-[var(--text-muted)]">
                  No closing priority was logged in yesterday&apos;s Daily Debrief. Choose one decisive outcome to anchor your focus today.
                </p>
              )}
            </div>

            {/* Centered Enter Athenaeum CTA (no Daily Recall button) */}
            <div className="mt-8 flex flex-col items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onDismiss}
                data-testid="enter-athenaeum-btn"
                className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-9 py-2.5 font-editorial text-[1.06rem] tracking-[0.06em] text-[var(--text-ivory)] border-[rgba(226,180,109,0.42)] transition-colors duration-200 focus:outline-none"
              >
                Enter Athenaeum
              </button>
              <span className="font-ui text-[0.58rem] tracking-[0.16em] uppercase text-[var(--text-muted)]/70">
                Press Esc to close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
