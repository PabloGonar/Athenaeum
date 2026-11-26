import { AnimatePresence, motion } from "framer-motion";
import type { GoalScope } from "../types/athenaeum";

interface ScopeCount {
  done: number;
  total: number;
}

interface BottomDockZoneProps {
  counts: Record<GoalScope, ScopeCount>;
  isDraggingNote: boolean;
  isHoveringTrash: boolean;
  trashZoneRef: React.RefObject<HTMLDivElement | null>;
  onOpenGoalsTab: (scope: GoalScope) => void;
  onDescend: () => void;
}

const PILLS: { scope: GoalScope; label: string }[] = [
  { scope: "daily", label: "Daily" },
  { scope: "weekly", label: "Weekly" },
  { scope: "longTerm", label: "Long-Term" },
];

export function BottomDockZone({
  counts,
  isDraggingNote,
  isHoveringTrash,
  trashZoneRef,
  onOpenGoalsTab,
  onDescend,
}: BottomDockZoneProps) {
  return (
    <div className="flex flex-col items-center select-none">
      {/* Dynamic Swap: Goal Pills <-> Glowing Sticky-Note Trash Dissipation Ring */}
      <div className="relative flex h-[78px] items-center justify-center">
        <AnimatePresence mode="wait">
          {isDraggingNote ? (
            <motion.div
              key="trash-vortex"
              ref={trashZoneRef}
              data-testid="sticky-trash-vortex"
              initial={{ opacity: 0, scale: 0.72 }}
              animate={{
                opacity: 1,
                scale: isHoveringTrash ? 1.14 : 1,
              }}
              exit={{ opacity: 0, scale: 0.72 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full"
              style={{
                border: isHoveringTrash
                  ? "1.5px solid rgba(207, 114, 97, 0.85)"
                  : "1.2px solid rgba(224, 177, 104, 0.56)",
                background: isHoveringTrash
                  ? "radial-gradient(circle, rgba(207,114,97,0.28) 0%, rgba(18,16,22,0.58) 75%)"
                  : "radial-gradient(circle, rgba(224,177,104,0.18) 0%, rgba(11,18,28,0.58) 75%)",
                boxShadow: isHoveringTrash
                  ? "0 0 36px rgba(207, 114, 97, 0.48), inset 0 0 18px rgba(207, 114, 97, 0.25)"
                  : "0 0 26px rgba(224, 177, 104, 0.28), inset 0 0 12px rgba(224, 177, 104, 0.14)",
              }}
            >
              <span
                className={`font-ui text-[0.68rem] font-medium tracking-[0.14em] uppercase text-center leading-tight ${
                  isHoveringTrash ? "text-[#f2c4ba]" : "text-[var(--text-ivory-soft)]"
                }`}
              >
                Delete
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="goal-pills"
              data-testid="goal-navigation-pills"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22 }}
              className="flex items-center gap-3"
            >
              {PILLS.map((pill) => {
                const c = counts[pill.scope];
                return (
                  <button
                    key={pill.scope}
                    type="button"
                    onClick={() => onOpenGoalsTab(pill.scope)}
                    data-testid={`goal-pill-${pill.scope}`}
                    className="cursor-pointer rounded-full border border-[rgba(226,180,109,0.2)] bg-[rgba(11,16,24,0.52)] hover:bg-[rgba(18,24,36,0.72)] hover:border-[rgba(226,180,109,0.42)] backdrop-blur-[8px] px-4 py-1.5 flex items-center gap-2 transition-colors duration-200 focus:outline-none"
                  >
                    <span className="font-editorial text-[0.95rem] tracking-[0.03em] text-[var(--text-ivory)]">
                      {pill.label}
                    </span>
                    <span className="font-ui tabular-nums text-[0.7rem] font-medium tracking-[0.06em] text-[var(--accent-luminous)]">
                      {c.done}/{c.total}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Borderless Understated Workspace Cue at bottom center */}
      <button
        type="button"
        onClick={onDescend}
        data-testid="descent-cue"
        className="mt-1.5 group flex flex-col items-center bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
      >
        <span
          className="font-editorial text-[0.88rem] tracking-[0.12em] text-[#F3EFE6]/82 group-hover:text-[#F3EFE6] transition-colors duration-200"
          style={{
            textShadow: "0 1px 4px rgba(4, 8, 16, 0.95), 0 2px 14px rgba(4, 8, 16, 0.85)",
          }}
        >
          Open Workspace
        </span>
        <span className="mt-1.5 h-5 w-[1px] bg-gradient-to-b from-[rgba(226,180,109,0.55)] to-transparent group-hover:h-6 transition-all duration-300" />
      </button>
    </div>
  );
}
