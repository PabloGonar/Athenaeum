import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatSecondsMMSS,
  formatSmartTimerInput,
  parseDurationSeconds,
} from "../utils/time";
import type { GoalItem, GoalMilestone } from "../types/athenaeum";

interface FocusRingProps {
  isRunning: boolean;
  /** null = OPEN count-up mode; positive integer = CUSTOM countdown duration in seconds */
  targetSeconds: number | null;
  elapsedSeconds: number;
  activeLabel: string;
  activeGoalId?: string | null;
  goals: GoalItem[];
  milestones?: GoalMilestone[];
  webhookStatus: string | null;
  onTargetSecondsChange: (seconds: number | null) => void;
  onActiveTargetChange: (target: {
    label: string;
    goalId: string | null;
    category?: string;
  }) => void;
  onStart: (targetSecondsOverride?: number | null) => void;
  onStopAndSave: (completedNaturally?: boolean) => void;
}

export function FocusRing({
  isRunning,
  targetSeconds,
  elapsedSeconds,
  activeLabel,
  activeGoalId = null,
  goals,
  milestones = [],
  webhookStatus,
  onTargetSecondsChange,
  onActiveTargetChange,
  onStart,
  onStopAndSave,
}: FocusRingProps) {
  const [customMode, setCustomMode] = useState<boolean>(
    targetSeconds !== null && targetSeconds > 0
  );
  const [customInput, setCustomInput] = useState<string>(
    targetSeconds ? formatSecondsMMSS(targetSeconds) : ""
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (targetSeconds !== null && targetSeconds > 0) {
      setCustomMode(true);
      setCustomInput(formatSecondsMMSS(targetSeconds));
    } else if (targetSeconds === null && !document.activeElement?.isSameNode(inputRef.current)) {
      setCustomMode(false);
    }
  }, [targetSeconds]);

  const radius = 64;
  const circumference = 2 * Math.PI * radius;

  const isCountdown = targetSeconds !== null && targetSeconds > 0;
  const displaySeconds = isCountdown
    ? Math.max(0, targetSeconds - elapsedSeconds)
    : elapsedSeconds;

  const progressFraction = isCountdown
    ? Math.max(0, (targetSeconds - elapsedSeconds) / targetSeconds)
    : isRunning
    ? Math.min(1, 0.14 + ((elapsedSeconds % 3600) / 3600) * 0.86)
    : 1;

  const dashOffset = circumference * (1 - progressFraction);

  const commitCustomDuration = (): number | null => {
    const trimmed = customInput.trim();
    if (!trimmed) {
      onTargetSecondsChange(null);
      setCustomMode(false);
      return null;
    }
    const parsed = parseDurationSeconds(trimmed);
    if (parsed !== null) {
      onTargetSecondsChange(parsed);
      setCustomInput(formatSecondsMMSS(parsed));
      setCustomMode(true);
      return parsed;
    } else {
      setCustomInput(targetSeconds ? formatSecondsMMSS(targetSeconds) : "");
      return null;
    }
  };

  const { dailyActive, weeklyActive, longTermActive, milestoneOptions } = useMemo(() => {
    const goalById = new Map(goals.map((g) => [g.id, g]));
    const activeGoals = goals.filter((g) => !g.completed);
    return {
      dailyActive: activeGoals.filter((g) => g.scope === "daily"),
      weeklyActive: activeGoals.filter((g) => g.scope === "weekly"),
      longTermActive: activeGoals.filter((g) => g.scope === "longTerm"),
      milestoneOptions: milestones
        .filter((m) => !m.completed)
        .map((m) => {
          const parent = goalById.get(m.goalId);
          return {
            value: `ms:${m.id}`,
            goalId: m.goalId,
            label: parent ? `${parent.title} · ${m.title}` : m.title,
            category: parent?.category || "deep_work",
          };
        }),
    };
  }, [goals, milestones]);

  const selectedSelectValue = useMemo(() => {
    if (!activeGoalId) return "";
    const matchingMs = milestoneOptions.find(
      (m) => m.goalId === activeGoalId && m.label === activeLabel
    );
    if (matchingMs) return matchingMs.value;
    if (goals.some((g) => g.id === activeGoalId)) return `goal:${activeGoalId}`;
    return "";
  }, [activeGoalId, activeLabel, goals, milestoneOptions]);

  const handleSelectTarget = (rawVal: string) => {
    if (!rawVal) {
      onActiveTargetChange({ label: "", goalId: null, category: "deep_work" });
      return;
    }
    if (rawVal.startsWith("ms:")) {
      const ms = milestoneOptions.find((m) => m.value === rawVal);
      if (ms) {
        onActiveTargetChange({
          label: ms.label,
          goalId: ms.goalId,
          category: ms.category,
        });
      }
      return;
    }
    if (rawVal.startsWith("goal:")) {
      const id = rawVal.slice(5);
      const found = goals.find((g) => g.id === id);
      if (found) {
        onActiveTargetChange({
          label: found.title,
          goalId: found.id,
          category: found.category || "deep_work",
        });
      }
    }
  };

  return (
    <div
      className="flex w-[240px] flex-col items-center text-center select-none"
      data-testid="focus-session-engine"
    >
      {/* Cardless SVG Progress Ring */}
      <button
        type="button"
        onClick={() => (isRunning ? onStopAndSave(false) : onStart())}
        className="group relative flex h-[152px] w-[152px] cursor-pointer items-center justify-center bg-transparent border-0 p-0 focus:outline-none"
        aria-label={isRunning ? "End focus session" : "Start focus session"}
      >
        <svg
          width="152"
          height="152"
          viewBox="0 0 152 152"
          className={`-rotate-90 overflow-visible ${
            isRunning && !isCountdown ? "animate-focus-breathe" : ""
          }`}
        >
          <circle
            cx="76"
            cy="76"
            r={radius}
            fill="none"
            stroke="rgba(237, 234, 224, 0.14)"
            strokeWidth="1.25"
          />
          <circle
            cx="76"
            cy="76"
            r={radius}
            fill="none"
            stroke={isRunning ? "var(--accent-luminous)" : "rgba(237, 234, 224, 0.44)"}
            strokeWidth={isRunning ? "1.8" : "1.25"}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              transition: "stroke-dashoffset 600ms linear, stroke 300ms ease",
              filter: isRunning
                ? "drop-shadow(0 0 10px rgba(224, 177, 104, 0.52))"
                : "none",
            }}
          />
          <line x1="76" y1="6" x2="76" y2="10" stroke="rgba(237,234,224,0.22)" strokeWidth="1" />
          <line x1="146" y1="76" x2="142" y2="76" stroke="rgba(237,234,224,0.22)" strokeWidth="1" />
          <line x1="76" y1="146" x2="76" y2="142" stroke="rgba(237,234,224,0.22)" strokeWidth="1" />
          <line x1="6" y1="76" x2="10" y2="76" stroke="rgba(237,234,224,0.22)" strokeWidth="1" />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          {isRunning ? (
            <>
              <span
                data-testid="focus-active-timer"
                className="font-editorial tabular-nums text-[1.9rem] font-light tracking-[0.04em] text-[var(--text-ivory)] leading-none"
              >
                {formatSecondsMMSS(displaySeconds)}
              </span>
              <span className="mt-1.5 font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[var(--accent-luminous)] opacity-90 group-hover:opacity-100">
                Complete
              </span>
            </>
          ) : (
            <>
              <span className="font-editorial text-[1.06rem] leading-[1.22] tracking-[0.04em] text-[var(--text-ivory-soft)] group-hover:text-[var(--text-ivory)] transition-colors">
                Start Focus
                <br />
                Session
              </span>
              <span
                data-testid="focus-selected-duration"
                className="mt-1 font-ui tabular-nums text-[0.64rem] tracking-[0.16em] uppercase text-[var(--accent-luminous)]/90"
              >
                {isCountdown ? formatSecondsMMSS(targetSeconds) : "Open"}
              </span>
            </>
          )}
        </div>
      </button>

      {/* Strictly Two Modes Only: OPEN and CUSTOM (horizontally centered with the focus circle) */}
      <div
        className="mt-2.5 flex items-center justify-center gap-3.5"
        data-testid="focus-mode-controls"
      >
        <button
          type="button"
          disabled={isRunning}
          data-testid="focus-mode-open"
          onClick={() => {
            setCustomMode(false);
            setCustomInput("");
            onTargetSecondsChange(null);
          }}
          className={`cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.66rem] tracking-[0.16em] uppercase transition-colors disabled:opacity-45 ${
            !customMode && !isCountdown
              ? "text-[var(--text-ivory)] underline decoration-[var(--accent-luminous)]/75 underline-offset-4"
              : "text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
          }`}
        >
          Open
        </button>

        <button
          type="button"
          disabled={isRunning}
          data-testid="focus-mode-custom"
          onClick={() => {
            setCustomMode(true);
            window.setTimeout(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            }, 10);
          }}
          className={`cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.66rem] tracking-[0.16em] uppercase transition-colors disabled:opacity-45 ${
            customMode || isCountdown
              ? "text-[var(--text-ivory)] underline decoration-[var(--accent-luminous)]/75 underline-offset-4"
              : "text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
          }`}
        >
          Custom
        </button>

        {(customMode || isCountdown) && (
          <input
            ref={inputRef}
            type="text"
            disabled={isRunning}
            value={customInput}
            data-testid="focus-custom-duration-input"
            aria-label="Custom focus duration (e.g. 30 for 30m, 1524 for 15:24)"
            placeholder="MM:SS"
            onChange={(e) =>
              setCustomInput((prev) => formatSmartTimerInput(e.target.value, prev))
            }
            onBlur={() => {
              commitCustomDuration();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const parsed = commitCustomDuration();
                inputRef.current?.blur();
                if (parsed !== null && !isRunning) {
                  onStart(parsed);
                }
              } else if (e.key === "Escape") {
                setCustomMode(isCountdown);
                setCustomInput(targetSeconds ? formatSecondsMMSS(targetSeconds) : "");
                inputRef.current?.blur();
              }
            }}
            className="w-[68px] rounded border border-[rgba(218,195,152,0.24)] bg-[rgba(11,18,28,0.62)] px-2 py-0.5 text-center font-ui tabular-nums text-[0.68rem] tracking-[0.08em] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:border-[var(--accent-luminous)] focus:outline-none disabled:opacity-45"
            title="Type minutes (e.g. 30) or digits (e.g. 1524 -> 15:24) and press Enter to start"
          />
        )}
      </div>

      {/* Linked Active Goal / Milestone or Unlinked General Focus */}
      <div className="mt-2 w-full">
        {isRunning ? (
          <div
            data-testid="focus-active-task-label"
            className="font-editorial text-[0.98rem] leading-snug text-[var(--text-ivory)] truncate text-center"
            title={activeLabel || "General Focus"}
          >
            {activeLabel || "General Focus"}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <select
              value={selectedSelectValue}
              onChange={(e) => handleSelectTarget(e.target.value)}
              data-testid="focus-task-selector"
              aria-label="Attach active goal or milestone to focus session"
              className="w-full cursor-pointer border-0 border-b border-[rgba(218,195,152,0.18)] bg-transparent py-0.5 text-center font-reading text-[0.88rem] text-[var(--text-ivory-soft)] focus:border-[var(--accent-luminous)] focus:outline-none"
            >
              <option value="" className="bg-[#0b121c] text-[var(--text-muted)]">
                Unlinked / General Focus
              </option>
              {dailyActive.length > 0 && (
                <optgroup label="Daily Goals" className="bg-[#0b121c] text-[var(--accent-brass)]">
                  {dailyActive.map((g) => (
                    <option
                      key={g.id}
                      value={`goal:${g.id}`}
                      className="bg-[#0b121c] text-[var(--text-ivory)]"
                    >
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {weeklyActive.length > 0 && (
                <optgroup label="Weekly Goals" className="bg-[#0b121c] text-[var(--accent-brass)]">
                  {weeklyActive.map((g) => (
                    <option
                      key={g.id}
                      value={`goal:${g.id}`}
                      className="bg-[#0b121c] text-[var(--text-ivory)]"
                    >
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {longTermActive.length > 0 && (
                <optgroup label="Long-Term Goals" className="bg-[#0b121c] text-[var(--accent-brass)]">
                  {longTermActive.map((g) => (
                    <option
                      key={g.id}
                      value={`goal:${g.id}`}
                      className="bg-[#0b121c] text-[var(--text-ivory)]"
                    >
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {milestoneOptions.length > 0 && (
                <optgroup label="Milestones" className="bg-[#0b121c] text-[var(--accent-brass)]">
                  {milestoneOptions.map((ms) => (
                    <option
                      key={ms.value}
                      value={ms.value}
                      className="bg-[#0b121c] text-[var(--text-ivory)]"
                    >
                      {ms.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <input
              type="text"
              value={activeLabel}
              onChange={(e) =>
                onActiveTargetChange({
                  label: e.target.value,
                  goalId: null,
                  category: "deep_work",
                })
              }
              data-testid="focus-label-input"
              placeholder="Or type custom session label..."
              className="w-full border-0 border-b border-transparent focus:border-[rgba(224,177,104,0.46)] bg-transparent py-0.5 text-center font-ui text-[0.68rem] tracking-[0.06em] text-[var(--text-muted)] focus:text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:outline-none"
            />
          </div>
        )}
      </div>

      {webhookStatus && (
        <div className="mt-1.5 text-center font-ui text-[0.64rem] tracking-[0.06em] text-[var(--accent-luminous)]/75">
          {webhookStatus}
        </div>
      )}
    </div>
  );
}
