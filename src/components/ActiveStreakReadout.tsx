import { Flame } from "lucide-react";
import type { ConsistencyStreakSummary } from "../utils/analyticsEngine";

interface ActiveStreakReadoutProps {
  streak: ConsistencyStreakSummary;
  todayDebriefDone: boolean;
  onOpenAnalytics: () => void;
  onOpenDailyDebrief: () => void;
}

export function ActiveStreakReadout({
  streak,
  todayDebriefDone,
  onOpenAnalytics,
  onOpenDailyDebrief,
}: ActiveStreakReadoutProps) {
  const isWarm = streak.currentStreak > 0;
  const todayLocked = streak.todayHasGoal && todayDebriefDone;

  return (
    <div
      data-testid="active-streak-readout"
      className="smoked-glass flex w-[320px] flex-col items-stretch rounded-[6px] px-4 py-3 text-left select-none"
    >
      <button
        type="button"
        onClick={onOpenAnalytics}
        title="Open Analytics"
        className="group flex w-full flex-col items-stretch bg-transparent border-0 p-0 text-left cursor-pointer focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#E2B46D]/90">
            Active Streak
          </span>
          {todayLocked && (
            <span className="rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.16)] px-1.5 py-0.5 font-ui text-[0.55rem] uppercase tracking-[0.14em] text-[#F2C464]">
              Locked
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2.5">
          <Flame
            className={`h-5 w-5 shrink-0 transition-colors duration-300 ${
              todayLocked
                ? "text-[#F2C464]"
                : isWarm
                ? "text-[#E2B46D]"
                : "text-[#B8C6D6] group-hover:text-[#F3EFE6]"
            }`}
            strokeWidth={1.7}
          />
          <span
            data-testid="active-streak-count"
            className="font-editorial tabular-nums text-[1.72rem] font-normal leading-none tracking-[0.02em] text-[#F3EFE6] group-hover:text-[#F2C464] transition-colors"
          >
            {streak.currentStreak}d Streak
          </span>
        </div>
      </button>

      {/* Unambiguous Daily Debrief indicator (filled dot = content logged, empty ring = none yet) */}
      <div className="mt-2.5 flex items-center justify-between border-t border-[rgba(226,180,109,0.14)] pt-2">
        <button
          type="button"
          onClick={onOpenDailyDebrief}
          data-testid="streak-debrief-status"
          data-done={todayDebriefDone ? "true" : "false"}
          title={
            todayDebriefDone
              ? "Today's Daily Debrief has been logged — click to open"
              : "No debrief logged today yet — click to write today's Daily Debrief"
          }
          className={`inline-flex items-center gap-2 cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.62rem] font-medium uppercase tracking-[0.14em] transition-colors hover:text-[#F3EFE6] focus:outline-none ${
            todayDebriefDone ? "text-[#F2C464]" : "text-[#B8C6D6]"
          }`}
        >
          <span
            data-testid="streak-debrief-indicator"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              todayDebriefDone
                ? "bg-[#F2C464] shadow-[0_0_8px_rgba(242,196,100,0.55)]"
                : "border border-[#8FA0B3] bg-transparent"
            }`}
          />
          {todayDebriefDone ? "Debrief Done" : "No Debrief Yet"}
        </button>
      </div>
    </div>
  );
}
