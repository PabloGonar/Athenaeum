import { BookOpen, X } from "lucide-react";

interface TocFieldGuideDrawerProps {
  open: boolean;
  onClose: () => void;
}

const GUIDE_SECTIONS: {
  title: string;
  whenToUse: string;
  summary: string;
  example: string;
}[] = [
  {
    title: "Current Reality Tree",
    whenToUse: "When the same problems keep returning",
    summary:
      "Write the frustrating symptoms at the top of the board and connect what causes each one underneath. Keep asking why until the arrows converge on one root issue that drives everything else.",
    example:
      "Example: Late project handoffs, tense standups, and constant rework all trace back to starting tasks before anyone writes down what 'done' looks like.",
  },
  {
    title: "Evaporating Cloud",
    whenToUse: "When you feel stuck in a trade-off",
    summary:
      "Map the shared goal on the left, the two needs in the middle, and the two clashing options on the right. Then challenge the hidden assumption making those two options feel incompatible.",
    example:
      "Example: Shipping fast vs. testing thoroughly. The hidden belief is that thorough testing has to be slow and manual. Adding a 3-minute automated check lets you do both.",
  },
  {
    title: "Future Reality Tree",
    whenToUse: "Before committing to a big change",
    summary:
      "Put your proposed change at the bottom and trace what happens next, including both the wins you want and the side effects you did not plan for. Add a simple safeguard for any side effect before rolling it out.",
    example:
      "Example: Switching to async updates frees up three hours a day, but could leave teammates waiting on quick answers. Safeguard: keep a 15-minute noon office-hours slot.",
  },
  {
    title: "Prerequisite Tree",
    whenToUse: "When a goal feels blocked from every angle",
    summary:
      "List every obstacle standing between you and the goal, then pair each one with a concrete milestone that removes it. Order the milestones so earlier wins unlock the later ones.",
    example:
      "Example: Obstacle: client assets arrive late -> Milestone: send a one-page checklist at kickoff. Obstacle: unclear approval owner -> Milestone: name one final reviewer up front.",
  },
  {
    title: "Transition Tree",
    whenToUse: "When you need a step-by-step execution plan",
    summary:
      "Break a milestone into small, verifiable moves. For each step, note the current need, the exact action you will take, and the visible result that proves it worked before moving to the next step.",
    example:
      "Example: Need: clean onboarding handoff -> Action: draft a 5-bullet handoff template and test it on Friday's launch -> Result: zero follow-up clarification emails on Monday.",
  },
  {
    title: "Five Focusing Steps",
    whenToUse: "When a workflow or routine feels jammed",
    summary:
      "Every system moves only as fast as its single tightest bottleneck. Spot that constraint, stop wasting its capacity, align the rest of your routine around it, and only then invest in expanding it.",
    example:
      "Example: If morning deep work is your bottleneck because meetings break up your focus, protect 9–11 AM first, move admin to the afternoon, and watch daily output jump before working longer hours.",
  },
];

export function TocFieldGuideDrawer({ open, onClose }: TocFieldGuideDrawerProps) {
  if (!open) return null;

  return (
    <div
      data-testid="toc-field-guide-drawer"
      style={{
        background: "rgba(34, 34, 36, 0.62)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      className="theme-chamber fixed inset-y-0 right-0 z-[70] w-full max-w-[440px] border-l border-[rgba(222,188,132,0.24)] shadow-[-24px_0_60px_rgba(0,0,0,0.65)] flex flex-col text-[var(--text-ivory)]"
    >
      <div className="shrink-0 flex items-center justify-between border-b border-[rgba(226,180,109,0.14)] px-6 py-4">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
          <div className="font-editorial text-[1.25rem] leading-none text-[var(--text-ivory)]">
            TOC Field Guide
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="toc-field-guide-close"
          aria-label="Close TOC Field Guide"
          className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {GUIDE_SECTIONS.map((sec) => (
          <section
            key={sec.title}
            className="border-b border-[rgba(226,180,109,0.12)] pb-5 last:border-b-0 space-y-2"
          >
            <div>
              <h3 className="font-editorial text-[1.18rem] leading-snug text-[var(--text-ivory)]">
                {sec.title}
              </h3>
              <div className="mt-0.5 font-ui text-[0.58rem] uppercase tracking-[0.15em] text-[#E2B46D]">
                {sec.whenToUse}
              </div>
            </div>
            <p className="font-reading text-[0.95rem] leading-relaxed text-[var(--text-ivory-soft)]/92">
              {sec.summary}
            </p>
            <p className="font-reading text-[0.89rem] leading-relaxed text-[var(--text-muted)]">
              {sec.example}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
