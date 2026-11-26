import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Flame,
  Target,
  TrendingUp,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { DayLogHourly } from "../DayLogHourly";
import { computeAdvancedAnalytics } from "../../utils/analyticsEngine";
import type {
  ActivityBlockHourly,
  AnalyticsDataset,
  AnalyticsTimeframe,
  GoalItem,
  GoalMilestone,
  TimeFormat,
} from "../../types/athenaeum";

interface AnalyticsMiniAppProps {
  dataset: AnalyticsDataset;
  goals: GoalItem[];
  milestones: GoalMilestone[];
  dayLogDate: string;
  dayLogBlocks: ActivityBlockHourly[];
  timeFormat: TimeFormat;
  dayRolloverHour: number;
  onDayLogDateChange: (date: string) => void;
  onUpsertDayLogBlock: (block: ActivityBlockHourly) => void;
  onDeleteDayLogBlock: (date: string, slotIndex: number) => void;
  onClose: () => void;
}

const TIMEFRAMES: { id: AnalyticsTimeframe; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "all", label: "All-Time" },
];

const CATEGORY_SWATCH_HEX: Record<
  "deep_work" | "strategy" | "reading" | "operations",
  string
> = {
  deep_work: "#F2C464",
  strategy: "#D96B43",
  reading: "#DFC9A6",
  operations: "#8A7968",
};

export function AnalyticsMiniApp({
  dataset,
  goals,
  milestones,
  dayLogDate,
  dayLogBlocks,
  timeFormat,
  dayRolloverHour,
  onDayLogDateChange,
  onUpsertDayLogBlock,
  onDeleteDayLogBlock,
  onClose,
}: AnalyticsMiniAppProps) {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>("30d");
  const [showDayLog, setShowDayLog] = useState(false);

  const report = useMemo(
    () => computeAdvancedAnalytics(dataset, goals, milestones, timeframe, timeFormat),
    [dataset, goals, milestones, timeframe, timeFormat]
  );

  const hasSleepTelemetry = useMemo(
    () =>
      (dataset.deviceTelemetry ?? []).some(
        (t) =>
          (typeof t.sleepHours === "number" && Number.isFinite(t.sleepHours)) ||
          (typeof t.screenTimeMinutes === "number" &&
            Number.isFinite(t.screenTimeMinutes))
      ),
    [dataset.deviceTelemetry]
  );

  const maxCircadianMins = Math.max(
    30,
    ...report.circadianHours.map((h) => h.focusMinutes)
  );
  const maxWeeklyFocus = Math.max(
    1,
    ...report.weeklyTrends.map((w) => w.focusHours)
  );
  const maxWeeklyPages = Math.max(
    5,
    ...report.weeklyTrends.map((w) => w.uniquePagesRead)
  );
  const maxWeeklyMilestones = Math.max(
    1,
    ...report.weeklyTrends.map((w) => w.milestonesCompleted)
  );

  const topMomentum = report.strongestMomentum.slice(0, 3);
  const topFriction = report.slippageAlerts.slice(0, 3);

  return (
    <MiniAppShell
      roomId="analytics"
      title="Advanced Analytics"
      wide
      onClose={onClose}
    >
      <div data-testid="analytics-miniapp" className="space-y-5 -mt-3">
        {/* ==================== 1. MINIMALIST TOP FILTER STRIP (UNBOXED) ==================== */}
        <div
          data-testid="analytics-filter-strip"
          className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(226,180,109,0.14)] pb-3.5"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="flex items-center gap-1.5"
              role="tablist"
              aria-label="Analytics timeframe selector"
            >
              {TIMEFRAMES.map((tf) => {
                const active = timeframe === tf.id;
                return (
                  <button
                    key={tf.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`analytics-tf-${tf.id}`}
                    onClick={() => setTimeframe(tf.id)}
                    className={`cursor-pointer rounded-[3px] px-3 py-1 font-ui text-[0.64rem] uppercase tracking-[0.16em] transition-colors ${
                      active
                        ? "border border-[rgba(226,180,109,0.42)] bg-[rgba(226,180,109,0.16)] text-[#E2B46D]"
                        : "border border-transparent bg-transparent text-[var(--text-muted)] hover:border-[rgba(226,180,109,0.22)] hover:text-[var(--text-ivory)]"
                    }`}
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>

            <span className="h-3.5 w-[1px] bg-[rgba(226,180,109,0.16)] hidden sm:inline-block" />

            <span
              data-testid="analytics-date-span"
              className="font-ui tabular-nums text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)]"
            >
              {report.startDate} to {report.endDate} ({report.totalDays}d)
            </span>
          </div>

          <div
            data-testid="analytics-streak-pill"
            className="rounded-[3px] border border-[rgba(226,180,109,0.32)] bg-[rgba(226,180,109,0.10)] px-3 py-1 flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.15em] text-[#E2B46D]"
          >
            <Flame className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.7} />
            <span>{report.streak.currentStreak}d Active</span>
            <span className="opacity-45">·</span>
            <span>Best {report.streak.longestStreak}d</span>
          </div>
        </div>

        {/* ==================== 2. 4 OPEN KPI STAT PILLARS WITH READABILITY SCRIM ==================== */}
        <section
          data-testid="analytics-kpi-strip"
          style={{
            background: "rgba(14, 11, 9, 0.58)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
          className="grid grid-cols-2 gap-y-4 lg:grid-cols-4 rounded-[6px] border border-[rgba(226,180,109,0.14)] px-5 py-4 lg:divide-x lg:divide-[rgba(226,180,109,0.14)]"
        >
          <div className="pr-4 lg:pr-6">
            <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Focus Logged ({timeframe.toUpperCase()})
            </div>
            <div
              data-testid="analytics-kpi-focus"
              className="mt-1.5 font-editorial tabular-nums text-[2.2rem] leading-none font-light text-[var(--text-ivory)]"
            >
              {report.totalFocusHours.toFixed(1)}h
            </div>
            <div className="mt-1.5 font-ui tabular-nums text-[0.64rem] text-[#E2B46D]">
              {(report.totalFocusHours / Math.max(1, report.totalDays)).toFixed(2)}h daily average
            </div>
          </div>

          <div className="pl-4 lg:px-6">
            <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Unique Pages Read
            </div>
            <div
              data-testid="analytics-kpi-pages"
              className="mt-1.5 font-editorial tabular-nums text-[2.2rem] leading-none font-light text-[var(--text-ivory)]"
            >
              {report.totalUniquePagesRead}
            </div>
            <div className="mt-1.5 font-ui text-[0.64rem] text-[#C88246] flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 shrink-0" />
              Tracked across Library
            </div>
          </div>

          <div className="pr-4 lg:px-6">
            <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Streak Consistency
            </div>
            <div
              data-testid="analytics-kpi-consistency"
              className="mt-1.5 font-editorial tabular-nums text-[2.2rem] leading-none font-light text-[var(--text-ivory)]"
            >
              {report.qualifyingConsistencyPct}%
            </div>
            <div className="mt-1.5 font-ui text-[0.64rem] text-[#E2B46D]">
              Goal + Debrief locked days
            </div>
          </div>

          <div className="pl-4 lg:pl-6">
            <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Milestones &amp; Recall
            </div>
            <div
              data-testid="analytics-kpi-milestones"
              className="mt-1.5 font-editorial tabular-nums text-[2.2rem] leading-none font-light text-[var(--text-ivory)]"
            >
              {report.milestonesCompleted}
            </div>
            <div className="mt-1.5 font-ui text-[0.64rem] text-[#C88246] flex items-center gap-1.5">
              <Target className="h-3 w-3 shrink-0" />
              {report.recallReviewsCompleted} recall reviews ({report.recallActiveDays}d)
            </div>
          </div>
        </section>

        {/* ==================== 3. PRIMARY CHARTS ROW (ABOVE THE FOLD) ==================== */}
        <section
          data-testid="analytics-primary-charts"
          className="grid grid-cols-1 gap-5 lg:grid-cols-12"
        >
          {/* Left (~58%): 24-Hour Logical Day Focus Distribution */}
          <div
            data-testid="analytics-circadian-section"
            className="lg:col-span-7 smoked-glass rounded-[14px] p-5 flex flex-col justify-between gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(226,180,109,0.14)] pb-3">
              <div>
                <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                  24-Hour Logical Day Focus Distribution
                </div>
                <div className="mt-0.5 font-ui text-[0.62rem] text-[var(--text-muted)]">
                  Anchored to {String(dayRolloverHour).padStart(2, "0")}:00 rollover · Focus minutes &amp; completion cadence
                </div>
              </div>
              <div
                data-testid="analytics-peak-window"
                className="rounded-[3px] border border-[rgba(226,180,109,0.34)] bg-[rgba(226,180,109,0.10)] px-2.5 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#E2B46D] flex items-center gap-1.5"
              >
                <Clock className="h-3 w-3 text-[#E2B46D]" />
                Peak Window: {report.peakWindowLabel}
              </div>
            </div>

            <div className="pt-2 flex items-end justify-between gap-1.5 h-[196px]">
              {report.circadianHours.map((h) => {
                const heightPct =
                  h.focusMinutes > 0
                    ? Math.max(8, Math.round((h.focusMinutes / maxCircadianMins) * 100))
                    : 4;
                const showTick = h.slotIndex % 3 === 0;
                return (
                  <div
                    key={h.slotIndex}
                    title={`${h.label}: ${h.focusMinutes}m focus · ${h.goalCompletions} goal completions`}
                    className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 group"
                  >
                    {h.goalCompletions > 0 && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[#C88246] ring-1 ring-[#E2B46D]/60"
                        aria-label={`${h.goalCompletions} completions`}
                      />
                    )}
                    <div
                      className={`w-full rounded-t-[3px] transition-colors ${
                        h.focusMinutes > 0
                          ? "bg-gradient-to-t from-[#9E7037] to-[#E2B46D] group-hover:to-[#F0CB8A]"
                          : "bg-[rgba(226,180,109,0.10)]"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="font-ui tabular-nums text-[0.54rem] text-[var(--text-muted)] h-3">
                      {showTick ? h.label : ""}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[rgba(226,180,109,0.10)] text-[0.58rem] font-ui uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-xs bg-[#E2B46D]" />
                Focus Minutes
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#C88246]" />
                Goal Completion Timestamps
              </span>
            </div>
          </div>

          {/* Right (~42%): Category Time Allocation Horizontal Progress Breakdown */}
          <div
            data-testid="analytics-category-allocation"
            className="lg:col-span-5 smoked-glass rounded-[14px] p-5 flex flex-col justify-between gap-4"
          >
            <div className="border-b border-[rgba(226,180,109,0.14)] pb-3">
              <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                Category Time Allocation
              </div>
              <div className="mt-0.5 font-ui text-[0.62rem] text-[var(--text-muted)]">
                Stacked Focus Sessions &amp; 24-hour Day Log
              </div>
            </div>

            {/* Combined Proportional Overview Strip */}
            <div className="h-2.5 w-full rounded-full bg-[rgba(226,180,109,0.10)] overflow-hidden flex">
              {report.categoryBreakdown.map((cat) =>
                cat.percent > 0 ? (
                  <div
                    key={cat.id}
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${cat.percent}%`,
                      backgroundColor: CATEGORY_SWATCH_HEX[cat.id],
                    }}
                    title={`${cat.label}: ${cat.hours}h (${cat.percent}%)`}
                  />
                ) : null
              )}
            </div>

            {/* Per-Category Horizontal Progress Bars */}
            <div className="flex-1 flex flex-col justify-center space-y-3.5">
              {report.categoryBreakdown.map((cat) => {
                const fillColor = CATEGORY_SWATCH_HEX[cat.id];
                return (
                  <div
                    key={cat.id}
                    data-testid={`category-row-${cat.id}`}
                    className="space-y-1.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: fillColor }}
                        />
                        <span className="font-reading text-[0.95rem] text-[var(--text-ivory-soft)] truncate">
                          {cat.label}
                        </span>
                      </div>
                      <div className="font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)] shrink-0">
                        {cat.hours.toFixed(1)}h{" "}
                        <span className="text-[var(--text-muted)]">({cat.percent}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[rgba(226,180,109,0.10)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${cat.percent > 0 ? Math.max(3, cat.percent) : 0}%`,
                          backgroundColor: fillColor,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ==================== 4. SECONDARY CHARTS ROW: COMPOUNDING WEEKLY VELOCITY ==================== */}
        <section
          data-testid="analytics-output-trends"
          className="smoked-glass rounded-[14px] p-6 space-y-4"
        >
          <div className="border-b border-[rgba(226,180,109,0.14)] pb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                Compounding Weekly Output &amp; Reading Velocity
              </div>
              <div className="mt-0.5 font-ui text-[0.62rem] text-[var(--text-muted)]">
                Focus hours, unique pages read, streak consistency, and milestones by logical week
              </div>
            </div>
            <span className="font-ui tabular-nums text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {report.weeklyTrends.length}{" "}
              {report.weeklyTrends.length === 1 ? "week" : "weeks"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Focus Hours / Week */}
            <div className="pb-5 md:pr-6 border-b border-[rgba(226,180,109,0.12)] md:border-r">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[#F2C464]">
                Focus Hours / Week
              </div>
              <div className="mt-3 flex items-end justify-between gap-2 h-[92px]">
                {report.weeklyTrends.map((w) => {
                  const hasVal = w.focusHours > 0;
                  const pct = hasVal
                    ? Math.max(10, Math.round((w.focusHours / maxWeeklyFocus) * 100))
                    : 6;
                  return (
                    <div
                      key={`wf-${w.weekStart}`}
                      className="flex-1 flex flex-col items-center justify-end h-full gap-1"
                      title={`Week of ${w.label}: ${w.focusHours}h`}
                    >
                      <span className="font-ui tabular-nums text-[0.54rem] text-[var(--text-muted)]">
                        {hasVal ? `${w.focusHours}h` : ""}
                      </span>
                      <div
                        className={`w-full max-w-[24px] rounded-t-[3px] ${
                          hasVal
                            ? "bg-gradient-to-t from-[#A87D2D] to-[#F2C464]"
                            : "bg-[rgba(226,180,109,0.10)]"
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="font-ui text-[0.52rem] text-[var(--text-muted)] truncate max-w-full">
                        {w.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Unique Book Pages / Week */}
            <div className="py-5 md:pt-0 md:pb-5 md:pl-6 border-b border-[rgba(226,180,109,0.12)]">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[#DFC9A6]">
                Unique Book Pages / Week
              </div>
              <div className="mt-3 flex items-end justify-between gap-2 h-[92px]">
                {report.weeklyTrends.map((w) => {
                  const hasVal = w.uniquePagesRead > 0;
                  const pct = hasVal
                    ? Math.max(10, Math.round((w.uniquePagesRead / maxWeeklyPages) * 100))
                    : 6;
                  return (
                    <div
                      key={`wp-${w.weekStart}`}
                      className="flex-1 flex flex-col items-center justify-end h-full gap-1"
                      title={`Week of ${w.label}: ${w.uniquePagesRead} unique pages`}
                    >
                      <span className="font-ui tabular-nums text-[0.54rem] text-[var(--text-muted)]">
                        {hasVal ? w.uniquePagesRead : ""}
                      </span>
                      <div
                        className={`w-full max-w-[24px] rounded-t-[3px] ${
                          hasVal
                            ? "bg-gradient-to-t from-[#8F7C60] to-[#DFC9A6]"
                            : "bg-[rgba(226,180,109,0.10)]"
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="font-ui text-[0.52rem] text-[var(--text-muted)] truncate max-w-full">
                        {w.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Streak Consistency % / Week */}
            <div className="py-5 md:pb-0 md:pr-6 border-b md:border-b-0 border-[rgba(226,180,109,0.12)] md:border-r">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[#D96B43]">
                Streak Consistency % / Week
              </div>
              <div className="mt-3 flex items-end justify-between gap-2 h-[92px]">
                {report.weeklyTrends.map((w) => {
                  const hasVal = w.consistencyPct > 0;
                  const pct = hasVal ? Math.max(10, w.consistencyPct) : 6;
                  return (
                    <div
                      key={`wc-${w.weekStart}`}
                      className="flex-1 flex flex-col items-center justify-end h-full gap-1"
                      title={`Week of ${w.label}: ${w.consistencyPct}% qualifying days`}
                    >
                      <span className="font-ui tabular-nums text-[0.54rem] text-[var(--text-muted)]">
                        {hasVal ? `${w.consistencyPct}%` : ""}
                      </span>
                      <div
                        className={`w-full max-w-[24px] rounded-t-[3px] ${
                          hasVal
                            ? "bg-gradient-to-t from-[#914024] to-[#D96B43]"
                            : "bg-[rgba(226,180,109,0.10)]"
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="font-ui text-[0.52rem] text-[var(--text-muted)] truncate max-w-full">
                        {w.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Long-Term Milestones / Week */}
            <div className="pt-5 md:pl-6">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[#A99784]">
                Long-Term Milestones / Week
              </div>
              <div className="mt-3 flex items-end justify-between gap-2 h-[92px]">
                {report.weeklyTrends.map((w) => {
                  const hasVal = w.milestonesCompleted > 0;
                  const pct = hasVal
                    ? Math.max(
                        10,
                        Math.round((w.milestonesCompleted / maxWeeklyMilestones) * 100)
                      )
                    : 6;
                  return (
                    <div
                      key={`wm-${w.weekStart}`}
                      className="flex-1 flex flex-col items-center justify-end h-full gap-1"
                      title={`Week of ${w.label}: ${w.milestonesCompleted} milestones`}
                    >
                      <span className="font-ui tabular-nums text-[0.54rem] text-[var(--text-muted)]">
                        {hasVal ? w.milestonesCompleted : ""}
                      </span>
                      <div
                        className={`w-full max-w-[24px] rounded-t-[3px] ${
                          hasVal
                            ? "bg-gradient-to-t from-[#5C5044] to-[#8A7968]"
                            : "bg-[rgba(226,180,109,0.10)]"
                        }`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="font-ui text-[0.52rem] text-[var(--text-muted)] truncate max-w-full">
                        {w.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ==================== 5. CONDENSED MOMENTUM & FRICTION PANEL (SINGLE 2-COL GLASS PANEL) ==================== */}
        <section
          data-testid="analytics-diagnostic-digest"
          className="smoked-glass rounded-[14px] p-6"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-[rgba(226,180,109,0.14)]">
            {/* Left: Strongest Momentum (Top 3) */}
            <div className="lg:pr-6">
              <div className="flex items-center justify-between border-b border-[rgba(226,180,109,0.14)] pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
                  <span className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                    Strongest Momentum
                  </span>
                </div>
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {timeframe.toUpperCase()}
                </span>
              </div>

              <div>
                {topMomentum.map((item, idx) => (
                  <div
                    key={`${item.title}-${idx}`}
                    data-testid="analytics-momentum-row"
                    className="py-3 border-b border-[rgba(226,180,109,0.10)] last:border-b-0 flex items-baseline justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-editorial text-[1.06rem] text-[var(--text-ivory)]">
                        {item.title}
                      </div>
                      <div className="mt-0.5 font-reading text-[0.88rem] text-[var(--text-muted)]">
                        {item.detail}
                      </div>
                    </div>
                    <span className="font-editorial tabular-nums text-[1.18rem] text-[#E2B46D] shrink-0">
                      {item.metric}
                    </span>
                  </div>
                ))}
                {topMomentum.length === 0 && (
                  <div className="py-5 font-reading text-[0.92rem] text-[var(--text-muted)]">
                    Log focus sessions and recurring habit completions to surface your strongest momentum drivers.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Friction Alerts (Top 3) */}
            <div className="lg:pl-6">
              <div className="flex items-center justify-between border-b border-[rgba(226,180,109,0.14)] pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#C88246]" strokeWidth={1.6} />
                  <span className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#C88246]">
                    Friction Alerts
                  </span>
                </div>
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Diagnostic
                </span>
              </div>

              <div>
                {topFriction.map((item, idx) => (
                  <div
                    key={`${item.title}-${idx}`}
                    data-testid="analytics-friction-row"
                    className="py-3 border-b border-[rgba(226,180,109,0.10)] last:border-b-0 flex items-baseline justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="font-editorial text-[1.06rem] text-[var(--text-ivory)]">
                        {item.title}
                      </div>
                      <div className="mt-0.5 font-reading text-[0.88rem] text-[var(--text-muted)]">
                        {item.detail}
                      </div>
                    </div>
                    <span className="font-editorial tabular-nums text-[1.15rem] text-[#C88246] shrink-0">
                      {item.metric}
                    </span>
                  </div>
                ))}
                {topFriction.length === 0 && (
                  <div className="py-5 font-reading text-[0.92rem] text-[var(--text-muted)]">
                    No major habit slippage or weekday focus dips detected across this window.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ==================== 6. CONDITIONAL SLEEP & SCREEN TIME TELEMETRY (ONLY WHEN DATA EXISTS) ==================== */}
        {hasSleepTelemetry && report.sleepCorrelation.sampleDays > 0 && (
          <section
            data-testid="analytics-sleep-correlation"
            className="smoked-glass rounded-[14px] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(226,180,109,0.14)] pb-3">
              <div>
                <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[#E2B46D]">
                  Sleep Hours vs. Focus Output &amp; Screen Time
                </div>
                <div className="mt-0.5 font-ui text-[0.62rem] text-[var(--text-muted)]">
                  Apple Health sleep &amp; screen time telemetry correlated with daily focus output
                </div>
              </div>
              <span className="font-ui tabular-nums text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {report.sleepCorrelation.sampleDays}{" "}
                {report.sleepCorrelation.sampleDays === 1 ? "day" : "days"} logged
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
              <div className="lg:col-span-5 grid grid-cols-2 divide-y divide-[rgba(226,180,109,0.12)]">
                <div className="pb-3 pr-4 border-r border-[rgba(226,180,109,0.12)]">
                  <div className="font-ui text-[0.56rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Average Sleep
                  </div>
                  <div
                    data-testid="analytics-avg-sleep"
                    className="mt-1 font-editorial tabular-nums text-[1.65rem] leading-none text-[#E2B46D]"
                  >
                    {report.sleepCorrelation.avgSleepHours != null
                      ? `${report.sleepCorrelation.avgSleepHours.toFixed(1)}h`
                      : "N/A"}
                  </div>
                </div>

                <div className="pb-3 pl-4">
                  <div className="font-ui text-[0.56rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Avg Screen Time
                  </div>
                  <div
                    data-testid="analytics-avg-screentime"
                    className="mt-1 font-editorial tabular-nums text-[1.65rem] leading-none text-[#C88246]"
                  >
                    {report.sleepCorrelation.avgScreenTimeMinutes != null
                      ? `${Math.floor(report.sleepCorrelation.avgScreenTimeMinutes / 60)}h ${
                          report.sleepCorrelation.avgScreenTimeMinutes % 60
                        }m`
                      : "N/A"}
                  </div>
                </div>

                <div className="pt-3 pr-4 border-r border-[rgba(226,180,109,0.12)]">
                  <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[#E2B46D]">
                    7h+ Sleep Focus Avg
                  </div>
                  <div className="mt-1 font-editorial tabular-nums text-[1.5rem] leading-none text-[var(--text-ivory)]">
                    {report.sleepCorrelation.wellRestedFocusHours != null
                      ? `${report.sleepCorrelation.wellRestedFocusHours.toFixed(1)}h`
                      : "0.0h"}
                  </div>
                </div>

                <div className="pt-3 pl-4">
                  <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[#C88246]">
                    Under 7h Focus Avg
                  </div>
                  <div className="mt-1 font-editorial tabular-nums text-[1.5rem] leading-none text-[var(--text-ivory)]">
                    {report.sleepCorrelation.lowSleepFocusHours != null
                      ? `${report.sleepCorrelation.lowSleepFocusHours.toFixed(1)}h`
                      : "0.0h"}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 lg:border-l lg:border-[rgba(226,180,109,0.14)] lg:pl-6 space-y-2">
                <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Daily Sleep &amp; Focus Pairing
                </div>
                <div className="max-h-[155px] overflow-y-auto pr-1">
                  {report.sleepCorrelation.pairedDays.map((day) => (
                    <div
                      key={day.date}
                      className="flex items-center justify-between gap-3 border-b border-[rgba(226,180,109,0.10)] last:border-b-0 py-1.5 font-ui tabular-nums text-[0.68rem]"
                    >
                      <span className="text-[var(--text-muted)] w-[88px]">{day.date}</span>
                      <span className="text-[#E2B46D]">
                        Sleep {day.sleepHours != null ? `${day.sleepHours.toFixed(1)}h` : "n/a"}
                      </span>
                      <span className="text-[#C88246]">
                        Screen{" "}
                        {day.screenTimeMinutes != null
                          ? `${Math.floor(day.screenTimeMinutes / 60)}h ${
                              day.screenTimeMinutes % 60
                            }m`
                          : "n/a"}
                      </span>
                      <span className="text-[var(--text-ivory)]">
                        Focus {day.focusHours.toFixed(1)}h
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ==================== 7. COLLAPSIBLE 24-HOUR DAY LOG INSPECTOR ==================== */}
        <div className="border-t border-[rgba(226,180,109,0.14)] pt-4">
          <button
            type="button"
            onClick={() => setShowDayLog((v) => !v)}
            data-testid="analytics-toggle-daylog"
            className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-2 font-ui text-[0.64rem] uppercase tracking-[0.18em] text-[var(--text-muted)] hover:text-[#E2B46D] transition-colors"
          >
            {showDayLog ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#E2B46D]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#E2B46D]" />
            )}
            Inspect &amp; Edit 24-Hour Logical Day Log ({dayLogDate})
          </button>

          {showDayLog && (
            <div className="mt-4 smoked-glass rounded-[14px] p-5">
              <DayLogHourly
                date={dayLogDate}
                blocks={dayLogBlocks}
                timeFormat={timeFormat}
                dayRolloverHour={dayRolloverHour}
                onDateChange={onDayLogDateChange}
                onUpsertBlock={onUpsertDayLogBlock}
                onDeleteBlock={onDeleteDayLogBlock}
              />
            </div>
          )}
        </div>
      </div>
    </MiniAppShell>
  );
}
