import { useEffect, useMemo, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import {
  BookOpen,
  Check,
  Clock,
  Crosshair,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Repeat,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import {
  getLogicalWeekdayIndex,
  isGoalActiveForTab,
  resolveGoalRecurrence,
} from "../../utils/logicalDate";
import type {
  GoalItem,
  GoalMilestone,
  GoalRecurrence,
  GoalScope,
} from "../../types/athenaeum";

interface GoalsMiniAppProps {
  initialScope: GoalScope;
  goals: GoalItem[];
  milestones: GoalMilestone[];
  logicalDate: string;
  dayRolloverHour: number;
  onUpsertGoal: (goal: GoalItem) => void;
  onDeleteGoal: (id: string) => void;
  onReorderScope: (scope: GoalScope, ordered: GoalItem[]) => void;
  onUpsertMilestone: (milestone: GoalMilestone) => void;
  onDeleteMilestone: (id: string) => void;
  onReorderMilestones: (goalId: string, ordered: GoalMilestone[]) => void;
  onFocusOnGoal: (title: string) => void;
  onOpenDailyDebrief: () => void;
  onClose: () => void;
}

const TABS: { scope: GoalScope; label: string }[] = [
  { scope: "daily", label: "Daily" },
  { scope: "weekly", label: "Weekly" },
  { scope: "longTerm", label: "Long-Term" },
];

const RECURRENCE_OPTIONS: { id: GoalRecurrence; label: string; hint: string }[] = [
  { id: "once", label: "Once", hint: "Single task" },
  { id: "daily", label: "Daily", hint: "Resets 3:00 AM" },
  { id: "weekly", label: "Weekly", hint: "Resets Mon 3:00 AM" },
  { id: "specific_days", label: "Specific Days", hint: "Selected weekdays" },
  { id: "long_term", label: "Long-Term", hint: "With milestones" },
];

const WEEKDAY_PILLS: { idx: number; short: string }[] = [
  { idx: 0, short: "Mon" },
  { idx: 1, short: "Tue" },
  { idx: 2, short: "Wed" },
  { idx: 3, short: "Thu" },
  { idx: 4, short: "Fri" },
  { idx: 5, short: "Sat" },
  { idx: 6, short: "Sun" },
];

function parseEstimateMinutes(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (!s || s === "none" || s === "-" || s === "0") return 0;

  // "1:30" -> 90 minutes
  const colonMatch = s.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (colonMatch) {
    const hrs = Number.parseInt(colonMatch[1], 10) || 0;
    const mins = Number.parseInt(colonMatch[2], 10) || 0;
    return Math.max(0, hrs * 60 + mins);
  }

  // "1h 30m", "2h", "1.5h"
  const hmMatch = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:ins?|inutes?)?)?$/);
  if (hmMatch) {
    const hrs = Number.parseFloat(hmMatch[1]) || 0;
    const extraMins = hmMatch[2] ? Number.parseInt(hmMatch[2], 10) || 0 : 0;
    return Math.max(0, Math.round(hrs * 60) + extraMins);
  }

  // "45m", "45 min", or plain integer "45"
  const mMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:m(?:ins?|inutes?)?)?$/);
  if (mMatch) {
    return Math.max(0, Math.round(Number.parseFloat(mMatch[1]) || 0));
  }

  return 0;
}

function formatDurationBadge(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

function defaultRecurrenceForScope(scope: GoalScope): GoalRecurrence {
  if (scope === "weekly") return "weekly";
  if (scope === "longTerm") return "long_term";
  return "daily";
}

function formatRecurrenceBadge(goal: GoalItem, activeScope: GoalScope): string | null {
  const rec = resolveGoalRecurrence(goal);
  // Never repeat the active tab name (DAILY inside Daily, WEEKLY inside Weekly, LONG-TERM inside Long-Term)
  if (rec === "daily" && activeScope === "daily") return null;
  if (rec === "weekly" && activeScope === "weekly") return null;
  if (rec === "long_term" && activeScope === "longTerm") return null;

  if (rec === "once") return "Once";
  if (rec === "specific_days") {
    const days = (goal.specificDays ?? []).filter((d) => d >= 0 && d <= 6);
    if (days.length === 0) return "Specific Days";
    return days.map((d) => WEEKDAY_PILLS[d]?.short ?? "").join(" · ");
  }
  return null;
}

export function GoalsMiniApp({
  initialScope,
  goals,
  milestones,
  logicalDate,
  dayRolloverHour,
  onUpsertGoal,
  onDeleteGoal,
  onReorderScope,
  onUpsertMilestone,
  onDeleteMilestone,
  onReorderMilestones,
  onFocusOnGoal,
  onOpenDailyDebrief,
  onClose,
}: GoalsMiniAppProps) {
  const [activeScope, setActiveScope] = useState<GoalScope>(initialScope);
  const [showCompleted, setShowCompleted] = useState<boolean>(false);

  // Rich creation / editing form state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const [titleInput, setTitleInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [recurrenceInput, setRecurrenceInput] = useState<GoalRecurrence>(
    defaultRecurrenceForScope(initialScope)
  );
  const [specificDaysInput, setSpecificDaysInput] = useState<number[]>([0, 2, 4]);
  const [targetCountInput, setTargetCountInput] = useState<string>("1");
  const [unitLabelInput, setUnitLabelInput] = useState<string>("");
  // Optional time estimate text input (empty = None / 0 minutes)
  const [durationDraft, setDurationDraft] = useState<string>("");
  const [priorityInput, setPriorityInput] = useState<"high" | "medium" | "low">("medium");

  // Inline uncapped multi-step counter editor state
  const [editingCounterGoalId, setEditingCounterGoalId] = useState<string | null>(null);
  const [counterDraft, setCounterDraft] = useState<string>("");
  const counterInputRef = useRef<HTMLInputElement | null>(null);

  // Milestone drafts per Long-Term goal
  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<string, string>>({});

  // Only enable Framer Motion layout projection while actively dragging (eliminates milestone save/toggle jump)
  const [draggingGoalId, setDraggingGoalId] = useState<string | null>(null);
  const [draggingMilestoneId, setDraggingMilestoneId] = useState<string | null>(null);

  const logicalWeekday = useMemo(
    () => getLogicalWeekdayIndex(new Date(), dayRolloverHour),
    [dayRolloverHour]
  );

  useEffect(() => {
    if (!editingGoalId) {
      setRecurrenceInput(defaultRecurrenceForScope(activeScope));
    }
  }, [activeScope, editingGoalId]);

  useEffect(() => {
    if (editingCounterGoalId) {
      window.setTimeout(() => {
        counterInputRef.current?.focus();
        counterInputRef.current?.select();
      }, 15);
    }
  }, [editingCounterGoalId]);

  // Goals active in the current horizon tab (unified single queue for Daily)
  const tabGoalsAll = useMemo(
    () =>
      goals
        .filter((g) => isGoalActiveForTab(g, activeScope, logicalWeekday))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [goals, activeScope, logicalWeekday]
  );

  const activeIncompleteGoals = useMemo(
    () => tabGoalsAll.filter((g) => !g.completed),
    [tabGoalsAll]
  );

  const completedTabGoals = useMemo(
    () => tabGoalsAll.filter((g) => g.completed),
    [tabGoalsAll]
  );

  const visibleGoals = showCompleted ? tabGoalsAll : activeIncompleteGoals;

  const totalMinutes = activeIncompleteGoals.reduce(
    (acc, g) => acc + (g.durationMinutes > 0 ? g.durationMinutes : 0),
    0
  );

  const resetForm = (scopeOverride?: GoalScope) => {
    setEditingGoalId(null);
    setTitleInput("");
    setDescriptionInput("");
    setCategoryInput("");
    setRecurrenceInput(defaultRecurrenceForScope(scopeOverride ?? activeScope));
    setSpecificDaysInput([logicalWeekday]);
    setTargetCountInput("1");
    setUnitLabelInput("");
    setDurationDraft("");
    setPriorityInput("medium");
  };

  const beginEditGoal = (goal: GoalItem) => {
    setEditingGoalId(goal.id);
    setShowOptions(true);
    setTitleInput(goal.title);
    setDescriptionInput(goal.description ?? "");
    setCategoryInput(goal.category ?? "");
    const rec = resolveGoalRecurrence(goal);
    setRecurrenceInput(rec);
    setSpecificDaysInput(
      goal.specificDays && goal.specificDays.length > 0 ? goal.specificDays : [logicalWeekday]
    );
    setTargetCountInput(String(Math.max(1, goal.targetCount ?? 1)));
    setUnitLabelInput(goal.unitLabel ?? "");
    setDurationDraft(goal.durationMinutes > 0 ? formatDurationBadge(goal.durationMinutes) : "");
    setPriorityInput(goal.priority);
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = titleInput.trim();
    if (!trimmed) return;

    const parsedTarget = Math.max(1, Number.parseInt(targetCountInput, 10) || 1);
    const parsedDuration = parseEstimateMinutes(durationDraft);
    const derivedScope: GoalScope =
      recurrenceInput === "weekly"
        ? "weekly"
        : recurrenceInput === "long_term"
        ? "longTerm"
        : "daily";
    const cleanDays =
      recurrenceInput === "specific_days"
        ? specificDaysInput.length > 0
          ? [...specificDaysInput].sort((a, b) => a - b)
          : [logicalWeekday]
        : [];

    if (editingGoalId) {
      const existing = goals.find((g) => g.id === editingGoalId);
      if (existing) {
        const cur = existing.currentCount ?? (existing.completed ? parsedTarget : 0);
        const nextCompleted =
          parsedTarget > 1 ? cur >= parsedTarget : existing.completed;
        onUpsertGoal({
          ...existing,
          scope: derivedScope,
          title: trimmed,
          description: descriptionInput.trim(),
          category: categoryInput.trim(),
          recurrence: recurrenceInput,
          specificDays: cleanDays,
          targetCount: parsedTarget,
          currentCount: cur,
          unitLabel: unitLabelInput.trim(),
          durationMinutes: parsedDuration,
          priority: priorityInput,
          completed: nextCompleted,
        });
      }
      resetForm(derivedScope);
      setShowOptions(false);
      return;
    }

    const item: GoalItem = {
      id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      scope: derivedScope,
      title: trimmed,
      description: descriptionInput.trim(),
      category: categoryInput.trim(),
      recurrence: recurrenceInput,
      specificDays: cleanDays,
      targetCount: parsedTarget,
      currentCount: 0,
      unitLabel: unitLabelInput.trim(),
      durationMinutes: parsedDuration,
      completed: false,
      priority: priorityInput,
      dueDate: derivedScope === "daily" ? logicalDate : null,
      sortOrder: tabGoalsAll.length,
      createdAt: new Date().toISOString(),
    };
    onUpsertGoal(item);
    if (derivedScope !== activeScope) {
      setActiveScope(derivedScope);
    }
    resetForm(derivedScope);
    setShowOptions(false);
  };

  const toggleGoalComplete = (goal: GoalItem) => {
    const target = Math.max(1, goal.targetCount ?? 1);
    const nextCompleted = !goal.completed;
    const nextCount = nextCompleted
      ? Math.max(target, goal.currentCount ?? 0)
      : 0;
    onUpsertGoal({
      ...goal,
      completed: nextCompleted,
      currentCount: nextCount,
    });
  };

  const startCounterEdit = (goal: GoalItem) => {
    setEditingCounterGoalId(goal.id);
    setCounterDraft(String(goal.currentCount ?? 0));
  };

  const commitCounterEdit = (goal: GoalItem) => {
    const raw = counterDraft.trim();
    setEditingCounterGoalId(null);
    if (!raw) return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const target = Math.max(1, goal.targetCount ?? 1);
    onUpsertGoal({
      ...goal,
      currentCount: parsed,
      completed: parsed >= target,
    });
  };

  // Preserve full ordering across hidden completed/off-day goals when dragging visible rows
  const handleVisibleReorder = (reorderedVisible: GoalItem[]) => {
    const visibleIds = new Set(reorderedVisible.map((g) => g.id));
    const hiddenSameScope = goals
      .filter((g) => g.scope === activeScope && !visibleIds.has(g.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    onReorderScope(activeScope, [...reorderedVisible, ...hiddenSameScope]);
  };

  const toggleSpecificDay = (dayIdx: number) => {
    setSpecificDaysInput((prev) =>
      prev.includes(dayIdx) ? prev.filter((d) => d !== dayIdx) : [...prev, dayIdx].sort()
    );
  };

  const handleAddMilestone = (goalId: string) => {
    const text = (milestoneDrafts[goalId] ?? "").trim();
    if (!text) return;
    const existingCount = milestones.filter((m) => m.goalId === goalId).length;
    onUpsertMilestone({
      id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      goalId,
      title: text,
      completed: false,
      completedAt: null,
      sortOrder: existingCount,
      createdAt: new Date().toISOString(),
    });
    setMilestoneDrafts((prev) => ({ ...prev, [goalId]: "" }));
  };

  return (
    <MiniAppShell
      roomId="goals"
      title="Goals & Tasks"
      onClose={onClose}
      rightSlot={
        <div className="flex items-center gap-4 font-ui tabular-nums text-[0.72rem] tracking-[0.14em] uppercase text-[var(--text-muted)]">
          <span>
            {completedTabGoals.length}/{tabGoalsAll.length} Completed
          </span>
          {totalMinutes > 0 && (
            <>
              <span>·</span>
              <span data-testid="goals-remaining-hours">
                {(totalMinutes / 60).toFixed(1)}h Remaining
              </span>
            </>
          )}
        </div>
      }
    >
      {/* Horizon Tabs + Completed Visibility Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-3">
        <div className="flex items-center gap-6">
          {TABS.map((tab) => {
            const countAll = goals.filter((g) =>
              isGoalActiveForTab(g, tab.scope, logicalWeekday)
            );
            const countDone = countAll.filter((g) => g.completed).length;
            const active = activeScope === tab.scope;
            return (
              <button
                key={tab.scope}
                type="button"
                onClick={() => setActiveScope(tab.scope)}
                data-testid={`goals-tab-${tab.scope}`}
                className={`cursor-pointer bg-transparent border-0 border-b-2 px-1 pb-2 -mb-[13px] font-editorial text-[1.08rem] tracking-[0.04em] transition-colors ${
                  active
                    ? "border-[#E2B46D] text-[var(--text-ivory)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                }`}
              >
                {tab.label}
                <span className="ml-2 font-ui tabular-nums text-[0.72rem] text-[var(--accent-luminous)]">
                  {countDone}/{countAll.length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            data-testid="toggle-completed-goals"
            aria-pressed={showCompleted}
            className={`cursor-pointer rounded-[3px] px-3 py-1.5 flex items-center gap-1.5 font-ui text-[0.65rem] uppercase tracking-[0.14em] transition-colors border ${
              showCompleted
                ? "border-[rgba(226,180,109,0.52)] bg-[rgba(226,180,109,0.14)] text-[var(--text-ivory)]"
                : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:border-[rgba(226,180,109,0.34)] hover:text-[var(--text-ivory-soft)]"
            }`}
          >
            {showCompleted ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-[var(--accent-brass)]" />
                Hide Completed
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 text-[var(--accent-luminous)]" />
                Show Completed ({completedTabGoals.length})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Rich Goal Creation / Edit Form */}
      <form
        onSubmit={handleSubmitForm}
        data-testid="goal-composer-form"
        className="mt-6 smoked-glass rounded-[12px] px-5 py-4 space-y-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            data-testid="goal-title-input"
            placeholder={
              editingGoalId
                ? "Edit goal title..."
                : `Add a ${activeScope === "longTerm" ? "long-term" : activeScope} goal or habit...`
            }
            className="flex-1 min-w-[240px] bg-transparent border-0 font-reading text-[1.06rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              data-testid="goal-options-toggle"
              aria-expanded={showOptions}
              className={`cursor-pointer rounded-[3px] px-3 py-1.5 flex items-center gap-1.5 font-ui text-[0.65rem] uppercase tracking-[0.14em] border transition-colors ${
                showOptions
                  ? "border-[rgba(194,168,120,0.45)] bg-[rgba(194,168,120,0.14)] text-[var(--text-ivory)]"
                  : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              }`}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {showOptions ? "Less" : "Options"}
            </button>

            {editingGoalId && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowOptions(false);
                }}
                className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                aria-label="Cancel editing"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <button
              type="submit"
              data-testid="goal-submit-btn"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 flex items-center gap-1.5 border border-[rgba(226,180,109,0.42)] font-ui text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-ivory)]"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--accent-luminous)]" strokeWidth={1.7} />
              {editingGoalId ? "Save" : "Add"}
            </button>
          </div>
        </div>

        {/* Expandable Details, Recurrence Cadence & Multi-Step Counter Config */}
        {showOptions && (
          <div
            data-testid="goal-composer-options"
            className="pt-4 border-t border-[rgba(214,224,212,0.08)] space-y-4"
          >
            {/* Recurrence Cadence Pills */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
                <Repeat className="h-3 w-3" />
                Recurrence Cadence
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {RECURRENCE_OPTIONS.map((opt) => {
                  const selected = recurrenceInput === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRecurrenceInput(opt.id)}
                      data-testid={`recurrence-opt-${opt.id}`}
                      aria-pressed={selected}
                      className={`cursor-pointer rounded-[3px] px-3 py-1 font-ui text-[0.64rem] uppercase tracking-[0.12em] border transition-colors ${
                        selected
                          ? "border-[rgba(194,168,120,0.55)] bg-[rgba(194,168,120,0.16)] text-[var(--text-ivory)]"
                          : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Specific Days of Week Selector */}
              {recurrenceInput === "specific_days" && (
                <div
                  data-testid="specific-days-picker"
                  className="pt-1.5 flex flex-wrap items-center gap-1.5"
                >
                  {WEEKDAY_PILLS.map((day) => {
                    const active = specificDaysInput.includes(day.idx);
                    return (
                      <button
                        key={day.idx}
                        type="button"
                        onClick={() => toggleSpecificDay(day.idx)}
                        data-testid={`weekday-pill-${day.idx}`}
                        aria-pressed={active}
                        className={`cursor-pointer rounded-md px-2.5 py-1 font-ui text-[0.64rem] uppercase tracking-[0.1em] border transition-colors ${
                          active
                            ? "border-[rgba(143,184,163,0.55)] bg-[rgba(143,184,163,0.18)] text-[var(--text-ivory)]"
                            : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                        }`}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Category, Multi-Step Target Count + Unit, Duration, Priority */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <label className="md:col-span-4 block">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Category / Tag
                </span>
                <input
                  type="text"
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  data-testid="goal-category-input"
                  placeholder="e.g. Health, Strategy, Deep Work"
                  className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-ui text-[0.76rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                />
              </label>

              <label className="md:col-span-2 block">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Target Count
                </span>
                <input
                  type="number"
                  min={1}
                  value={targetCountInput}
                  onChange={(e) => setTargetCountInput(e.target.value)}
                  data-testid="goal-target-count-input"
                  className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-ui tabular-nums text-[0.78rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                />
              </label>

              <label className="md:col-span-3 block">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Unit Label (Optional)
                </span>
                <input
                  type="text"
                  value={unitLabelInput}
                  onChange={(e) => setUnitLabelInput(e.target.value)}
                  data-testid="goal-unit-label-input"
                  placeholder="pushups, pages, batches..."
                  className="mt-1 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-ui text-[0.76rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                />
              </label>

              <div className="md:col-span-3 flex items-end gap-2">
                <label className="flex-1 block">
                  <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)] flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Est. Time
                  </span>
                  <input
                    type="text"
                    value={durationDraft}
                    onChange={(e) => setDurationDraft(e.target.value)}
                    data-testid="goal-duration-input"
                    placeholder="None (e.g. 25m, 1.5h)"
                    className="mt-1 w-full bg-[var(--surface-inner)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </label>
                <label className="w-[96px] shrink-0 block">
                  <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Priority
                  </span>
                  <select
                    value={priorityInput}
                    onChange={(e) =>
                      setPriorityInput(e.target.value as "high" | "medium" | "low")
                    }
                    className="mt-1 w-full bg-[var(--surface-inner)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 font-ui text-[0.72rem] uppercase text-[var(--text-ivory)] focus:outline-none"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Optional Note / Description */}
            <label className="block">
              <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Note / Description (Optional)
              </span>
              <textarea
                rows={2}
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                data-testid="goal-description-input"
                placeholder="Context, criteria for done, or strategic reasoning..."
                className="mt-1 w-full resize-y rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
              />
            </label>
          </div>
        )}
      </form>

      {/* Single Unified Drag-and-Drop Reorderable Goals List (keyed per tab for instant zero-bounce switch) */}
      <Reorder.Group
        key={activeScope}
        axis="y"
        values={visibleGoals}
        onReorder={handleVisibleReorder}
        data-testid="goals-unified-list"
        className="mt-6 space-y-2.5 list-none p-0 m-0 pb-10"
      >
        {visibleGoals.map((goal) => {
          const isDebriefGoal =
            goal.id.startsWith("daily-debrief-") ||
            goal.title.trim().toLowerCase() === "complete daily debrief";
          const target = Math.max(1, goal.targetCount ?? 1);
          const current = Math.max(0, goal.currentCount ?? (goal.completed ? target : 0));
          const isMultiStep = target > 1;
          const recBadge = formatRecurrenceBadge(goal, activeScope);
          const hasNote = Boolean(goal.description?.trim());
          const hasDuration = goal.durationMinutes > 0;
          const childMilestones =
            activeScope === "longTerm"
              ? milestones
                  .filter((m) => m.goalId === goal.id)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
              : [];
          const msDone = childMilestones.filter((m) => m.completed).length;

          return (
            <Reorder.Item
              key={goal.id}
              value={goal}
              layout="position"
              initial={false}
              transition={
                draggingGoalId !== null
                  ? { layout: { duration: 0.14, ease: [0.22, 1, 0.36, 1] } }
                  : { duration: 0, layout: { duration: 0 } }
              }
              onDragStart={() => setDraggingGoalId(goal.id)}
              onDragEnd={() => setDraggingGoalId(null)}
              data-testid={
                isDebriefGoal ? "goal-row-daily-debrief" : `goal-row-${goal.id}`
              }
              data-goal-title={goal.title}
              className={`group smoked-glass rounded-[10px] px-4 py-3.5 transition-colors hover:border-[var(--glass-border-hover)] ${
                goal.completed ? "opacity-75" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <GripVertical
                    className="mt-[3px] h-4 w-4 text-[var(--text-muted)]/45 group-hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing shrink-0"
                    strokeWidth={1.5}
                  />

                  <button
                    type="button"
                    onClick={() => toggleGoalComplete(goal)}
                    data-testid={`goal-check-${goal.id}`}
                    aria-label={goal.completed ? "Mark incomplete" : "Mark completed"}
                    className={`mt-[2px] flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                      goal.completed
                        ? "border-[var(--accent-luminous)] bg-[var(--accent-luminous)]/25 text-[var(--text-ivory)]"
                        : "border-[rgba(214,224,212,0.3)] bg-transparent hover:border-[var(--accent-luminous)]"
                    }`}
                  >
                    {goal.completed && <Check className="h-3 w-3" strokeWidth={2.2} />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isDebriefGoal ? (
                        <button
                          type="button"
                          onClick={onOpenDailyDebrief}
                          data-testid="open-daily-debrief-from-goal"
                          className={`cursor-pointer bg-transparent border-0 p-0 text-left flex items-center gap-2.5 font-reading text-[1.06rem] leading-snug hover:text-[var(--accent-luminous)] transition-colors ${
                            goal.completed
                              ? "line-through text-[var(--text-muted)]"
                              : "text-[var(--text-ivory)]"
                          }`}
                        >
                          <span className="truncate">{goal.title}</span>
                          <span className="inline-flex items-center gap-1 rounded-[3px] border border-[rgba(194,168,120,0.34)] bg-[rgba(194,168,120,0.1)] px-2 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-brass)] no-underline shrink-0">
                            <BookOpen className="h-2.5 w-2.5" strokeWidth={1.7} />
                            Open Debrief →
                          </span>
                        </button>
                      ) : (
                        <span
                          className={`font-reading text-[1.06rem] leading-snug ${
                            goal.completed
                              ? "line-through text-[var(--text-muted)]"
                              : "text-[var(--text-ivory)]"
                          }`}
                        >
                          {goal.title}
                        </span>
                      )}

                      {goal.category && (
                        <span className="rounded-[3px] bg-[rgba(226,180,109,0.12)] px-2 py-0.5 font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[var(--accent-luminous)]">
                          {goal.category}
                        </span>
                      )}

                      {recBadge && (
                        <span
                          data-testid={`goal-rec-badge-${goal.id}`}
                          className="font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[var(--text-muted)]/85"
                        >
                          {recBadge}
                        </span>
                      )}
                    </div>

                    {/* Always-Visible Goal Note / Description beneath title (no accordion squishing) */}
                    {hasNote && (
                      <p
                        data-testid={`goal-note-${goal.id}`}
                        className="mt-1 font-reading text-[0.92rem] leading-relaxed text-[#b8aa96]"
                      >
                        {goal.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right Side: Uncapped Typed Multi-Step Counter + Hover Focus/Edit/Delete + Priority/Optional Est */}
                <div className="mt-[2px] flex items-center gap-3.5 shrink-0">
                    {/* Uncapped Typed Multi-Step Progress Counter (NO +1/+5 stepper buttons) */}
                    {isMultiStep && (
                      <div className="flex items-center">
                        {editingCounterGoalId === goal.id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              commitCounterEdit(goal);
                            }}
                            className="flex items-center gap-1"
                          >
                            <input
                              ref={counterInputRef}
                              type="number"
                              min={0}
                              value={counterDraft}
                              onChange={(e) => setCounterDraft(e.target.value)}
                              onBlur={() => commitCounterEdit(goal)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setEditingCounterGoalId(null);
                                }
                              }}
                              data-testid={`goal-counter-input-${goal.id}`}
                              aria-label={`Enter progress count for ${goal.title}`}
                              className="w-[62px] rounded-md border border-[var(--accent-brass)] bg-[var(--surface-inner)] px-2 py-0.5 text-center font-ui tabular-nums text-[0.76rem] text-[var(--text-ivory)] focus:outline-none"
                            />
                            <span className="font-ui tabular-nums text-[0.72rem] text-[var(--text-muted)]">
                              / {target}
                              {goal.unitLabel ? ` ${goal.unitLabel}` : ""}
                            </span>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startCounterEdit(goal)}
                            data-testid={`goal-counter-btn-${goal.id}`}
                            title="Click to type any exact count (uncapped)"
                            className={`cursor-pointer rounded-[3px] border px-2.5 py-0.5 font-ui tabular-nums text-[0.72rem] tracking-[0.04em] transition-colors ${
                              current >= target
                                ? "border-[rgba(194,168,120,0.48)] bg-[rgba(194,168,120,0.14)] text-[var(--accent-brass)]"
                                : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[var(--accent-luminous)]"
                            }`}
                          >
                            {current} / {target}
                            {goal.unitLabel ? ` ${goal.unitLabel}` : ""}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Secondary Row Actions Strictly Hidden Until Hover: Focus, Edit, Delete */}
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                      <button
                        type="button"
                        onClick={() => onFocusOnGoal(goal.title)}
                        data-testid={`goal-focus-btn-${goal.id}`}
                        className="cursor-pointer rounded-[3px] border border-[rgba(194,168,120,0.38)] bg-[rgba(194,168,120,0.1)] px-2.5 py-0.5 flex items-center gap-1 font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--accent-brass)] hover:bg-[rgba(194,168,120,0.22)] hover:text-[var(--text-ivory)]"
                      >
                        <Crosshair className="h-3 w-3" />
                        Focus
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEditGoal(goal)}
                        data-testid={`goal-edit-btn-${goal.id}`}
                        aria-label={`Edit ${goal.title}`}
                        className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.6} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteGoal(goal.id)}
                        aria-label={`Delete ${goal.title}`}
                        className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                      </button>
                    </div>

                    <span
                      data-testid={`goal-priority-dot-${goal.id}`}
                      data-priority={goal.priority}
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          goal.priority === "high"
                            ? "#D96B52"
                            : goal.priority === "medium"
                            ? "#E2B46D"
                            : "#8C8275",
                      }}
                      title={`Priority: ${goal.priority}`}
                    />

                    {hasDuration && (
                      <span
                        data-testid={`goal-duration-${goal.id}`}
                        className="font-ui tabular-nums text-[0.72rem] tracking-[0.08em] text-[var(--text-muted)] min-w-[2.4rem] text-right"
                      >
                        {formatDurationBadge(goal.durationMinutes)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Nested Milestones Panel for Long-Term Goals */}
                {activeScope === "longTerm" && (
                  <div
                    data-testid={`milestones-section-${goal.id}`}
                    className="mt-4 ml-8 pl-4 border-l border-[rgba(194,168,120,0.22)] space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span
                        data-testid={`milestones-count-${goal.id}`}
                        className="font-ui tabular-nums text-[0.6rem] uppercase tracking-[0.16em] text-[var(--accent-brass)]"
                      >
                        {msDone} / {childMilestones.length} milestones
                      </span>
                      {childMilestones.length > 0 && (
                        <div className="flex-1 max-w-[220px] h-[2px] bg-[rgba(237,234,224,0.12)] overflow-hidden rounded-full">
                          <div
                            className="h-full bg-[var(--accent-luminous)] transition-all duration-300"
                            style={{
                              width: `${Math.round(
                                (msDone / Math.max(1, childMilestones.length)) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {childMilestones.length > 0 && (
                      <Reorder.Group
                        axis="y"
                        values={childMilestones}
                        onReorder={(ordered) => onReorderMilestones(goal.id, ordered)}
                        className="space-y-1.5 list-none p-0 m-0"
                      >
                        {childMilestones.map((ms) => (
                          <Reorder.Item
                            key={ms.id}
                            value={ms}
                            layout="position"
                            initial={false}
                            transition={
                              draggingMilestoneId !== null
                                ? { layout: { duration: 0.14, ease: [0.22, 1, 0.36, 1] } }
                                : { duration: 0, layout: { duration: 0 } }
                            }
                            onDragStart={() => setDraggingMilestoneId(ms.id)}
                            onDragEnd={() => setDraggingMilestoneId(null)}
                            data-testid={`milestone-row-${ms.id}`}
                            className="group/ms flex items-center justify-between gap-3 rounded-[8px] border border-[rgba(214,224,212,0.08)] bg-[var(--surface-inner)] px-3 py-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <GripVertical className="h-3.5 w-3.5 text-[var(--text-muted)]/35 group-hover/ms:text-[var(--text-muted)] cursor-grab shrink-0" />
                              <button
                                type="button"
                                onClick={() =>
                                  onUpsertMilestone({
                                    ...ms,
                                    completed: !ms.completed,
                                    completedAt: !ms.completed
                                      ? new Date().toISOString()
                                      : null,
                                  })
                                }
                                data-testid={`milestone-check-${ms.id}`}
                                aria-label={
                                  ms.completed
                                    ? "Mark milestone incomplete"
                                    : "Mark milestone completed"
                                }
                                className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border transition-colors ${
                                  ms.completed
                                    ? "border-[var(--accent-luminous)] bg-[var(--accent-luminous)]/25 text-[var(--text-ivory)]"
                                    : "border-[rgba(214,224,212,0.3)] bg-transparent hover:border-[var(--accent-luminous)]"
                                }`}
                              >
                                {ms.completed && <Check className="h-2.5 w-2.5" strokeWidth={2.4} />}
                              </button>
                              <span
                                className={`font-reading text-[0.94rem] truncate ${
                                  ms.completed
                                    ? "line-through text-[var(--text-muted)]"
                                    : "text-[var(--text-ivory-soft)]"
                                }`}
                              >
                                {ms.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 opacity-0 group-hover/ms:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={() => onFocusOnGoal(ms.title)}
                                data-testid={`milestone-focus-${ms.id}`}
                                className="cursor-pointer rounded-[3px] border border-[rgba(194,168,120,0.34)] bg-[rgba(194,168,120,0.1)] px-2 py-0.5 flex items-center gap-1 font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[var(--accent-brass)] hover:text-[var(--text-ivory)]"
                              >
                                <Crosshair className="h-2.5 w-2.5" />
                                Focus
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteMilestone(ms.id)}
                                aria-label={`Delete milestone ${ms.title}`}
                                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </Reorder.Item>
                        ))}
                      </Reorder.Group>
                    )}

                    {/* Inline Add Milestone Input */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={milestoneDrafts[goal.id] ?? ""}
                        onChange={(e) =>
                          setMilestoneDrafts((prev) => ({
                            ...prev,
                            [goal.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddMilestone(goal.id);
                          }
                        }}
                        data-testid={`add-milestone-input-${goal.id}`}
                        placeholder="+ Add milestone step..."
                        className="flex-1 bg-transparent border-0 border-b border-[var(--glass-border)] py-1 font-reading text-[0.9rem] text-[var(--text-ivory-soft)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddMilestone(goal.id)}
                        data-testid={`add-milestone-btn-${goal.id}`}
                        className="cursor-pointer bg-transparent border-0 px-2 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </Reorder.Item>
            );
          })}

        {visibleGoals.length === 0 && (
          <div className="py-12 text-center font-reading text-[1.05rem] text-[var(--text-muted)]">
            {completedTabGoals.length > 0 && !showCompleted
              ? `All ${completedTabGoals.length} active item(s) completed for this horizon. Click Show Completed above to review.`
              : "No tasks added here yet."}
          </div>
        )}
      </Reorder.Group>
    </MiniAppShell>
  );
}
