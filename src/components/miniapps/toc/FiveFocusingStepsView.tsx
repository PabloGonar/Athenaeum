import type { FiveFocusingStepsData } from "../../../types/athenaeum";

interface FiveFocusingStepsViewProps {
  data: FiveFocusingStepsData;
  onChange: (next: FiveFocusingStepsData) => void;
}

const STEP_DEFS: {
  key: keyof FiveFocusingStepsData["steps"];
  roman: string;
  num: string;
  title: string;
  prompt: string;
  accent?: boolean;
}[] = [
  {
    key: "identify",
    roman: "I",
    num: "1",
    title: "Identify the Constraint",
    prompt: "Which single resource, policy, or step currently caps total system throughput?",
    accent: true,
  },
  {
    key: "exploit",
    roman: "II",
    num: "2",
    title: "Exploit the Constraint",
    prompt: "How do we get 100% effective output from the bottleneck right now without spending new capital?",
  },
  {
    key: "subordinate",
    roman: "III",
    num: "3",
    title: "Subordinate Everything Else",
    prompt: "How must every non-constraint adjust its pace, rules, and buffers to protect the bottleneck?",
  },
  {
    key: "elevate",
    roman: "IV",
    num: "4",
    title: "Elevate the Constraint",
    prompt: "Only after Steps 2 and 3 are exhausted: what targeted investment or capacity expansion breaks it?",
    accent: true,
  },
  {
    key: "repeat",
    roman: "V",
    num: "5",
    title: "Repeat & Prevent Inertia",
    prompt: "Once the constraint moves, which old rules or habits must be dismantled so inertia doesn't become the next constraint?",
  },
];

export function FiveFocusingStepsView({ data, onChange }: FiveFocusingStepsViewProps) {
  const updateField = <K extends keyof FiveFocusingStepsData>(
    key: K,
    val: FiveFocusingStepsData[K]
  ) => {
    onChange({ ...data, [key]: val });
  };

  const updateStep = (key: keyof FiveFocusingStepsData["steps"], val: string) => {
    onChange({
      ...data,
      steps: { ...data.steps, [key]: val },
    });
  };

  return (
    <div
      data-testid="five-focusing-steps-view"
      className="mx-auto w-full max-w-[980px] space-y-6 px-6 pt-6 pb-28"
    >
      {/* System Definition, Throughput Accounting (T / I / OE) & DBR */}
      <section className="smoked-glass rounded-[12px] p-6 space-y-5">
        <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
          System Definition · Throughput Accounting (T / I / OE) & Drum-Buffer-Rope
        </div>

        <label className="block">
          <span className="font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            System Scope & Ultimate Goal
          </span>
          <input
            type="text"
            value={data.systemGoal}
            onChange={(e) => updateField("systemGoal", e.target.value)}
            data-testid="five-steps-goal-input"
            placeholder="Define the workflow, team, or personal system and its primary goal..."
            className="mt-1.5 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-4 py-2.5 font-reading text-[1.02rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/65 focus:border-[var(--accent-luminous)] focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)]">
              Throughput (T)
            </span>
            <textarea
              rows={2}
              value={data.throughputT}
              onChange={(e) => updateField("throughputT", e.target.value)}
              data-testid="five-steps-t-input"
              placeholder="Rate of completed high-value output..."
              className="mt-1.5 w-full resize-none rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--accent-brass)]">
              Inventory / WIP (I)
            </span>
            <textarea
              rows={2}
              value={data.inventoryI}
              onChange={(e) => updateField("inventoryI", e.target.value)}
              data-testid="five-steps-i-input"
              placeholder="Stalled work-in-progress, queues, or tied-up capital..."
              className="mt-1.5 w-full resize-none rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-brass)] focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Operating Expense (OE)
            </span>
            <textarea
              rows={2}
              value={data.operatingExpenseOE}
              onChange={(e) => updateField("operatingExpenseOE", e.target.value)}
              data-testid="five-steps-oe-input"
              placeholder="Recurring effort, time, or cost to run the system..."
              className="mt-1.5 w-full resize-none rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3 font-reading text-[0.94rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Drum-Buffer-Rope (DBR) & Pull Notes
          </span>
          <input
            type="text"
            value={data.dbrNotes}
            onChange={(e) => updateField("dbrNotes", e.target.value)}
            data-testid="five-steps-dbr-input"
            placeholder="Drum cadence, protective time/queue buffer before constraint, and WIP release rope..."
            className="mt-1.5 w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-4 py-2 font-reading text-[0.96rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
          />
        </label>
      </section>

      {/* Five Sequential Step Cards */}
      <div className="space-y-4">
        {STEP_DEFS.map((step) => (
          <section
            key={step.key}
            data-testid={`five-step-card-${step.key}`}
            className={`smoked-glass rounded-[12px] p-5 border transition-colors ${
              step.accent
                ? "border-[rgba(197,160,89,0.34)]"
                : "border-[var(--glass-border)]"
            }`}
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <span className="font-editorial text-[1.45rem] text-[#C5A059]">
                  {step.num}.
                </span>
                <h3 className="font-editorial text-[1.25rem] font-normal text-[var(--text-ivory)]">
                  {step.title}
                </h3>
              </div>
              <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                Step {step.roman}
              </span>
            </div>
            <p className="mt-1 font-reading text-[0.92rem] text-[var(--text-muted)]">
              {step.prompt}
            </p>
            <textarea
              rows={3}
              value={data.steps[step.key]}
              onChange={(e) => updateStep(step.key, e.target.value)}
              data-testid={`five-step-input-${step.key}`}
              placeholder={`Document concrete actions for Step ${step.num}...`}
              className="mt-3 w-full resize-y rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3.5 font-reading text-[0.98rem] leading-relaxed text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#C5A059] focus:outline-none"
            />
          </section>
        ))}
      </div>
    </div>
  );
}
