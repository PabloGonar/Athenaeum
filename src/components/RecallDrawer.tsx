import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  ExternalLink,
  Feather,
  Network,
  Sparkles,
  X,
} from "lucide-react";
import type { RecallDeckState, RecallReviewResult, RecallSourceCategory } from "../types/athenaeum";

interface RecallDrawerProps {
  open: boolean;
  deck: RecallDeckState | null;
  onRateCard: (cardHash: string, rating: 1 | 2 | 3) => Promise<RecallReviewResult>;
  onOpenInVault: (sourceFile: string, sourceCategory: RecallSourceCategory, sourceFileName: string) => void;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

const CATEGORY_META: Record<
  RecallSourceCategory,
  { label: string; badgeClass: string; icon: typeof BookOpen }
> = {
  book: {
    label: "Book Highlight",
    badgeClass: "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#e4c27c]",
    icon: BookOpen,
  },
  toc: {
    label: "TOC Strategic Insight",
    badgeClass: "border-[rgba(143,184,163,0.45)] bg-[rgba(143,184,163,0.14)] text-[var(--accent-luminous)]",
    icon: Network,
  },
  snippet: {
    label: "Vault Recall Snippet",
    badgeClass: "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)]",
    icon: Feather,
  },
};

export function RecallDrawer({
  open,
  deck,
  onRateCard,
  onOpenInVault,
  onRefresh,
  onClose,
}: RecallDrawerProps) {
  const [revealed, setRevealed] = useState(false);
  const [scratchpad, setScratchpad] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const activeCard = deck?.dueCards[0] ?? null;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (open) {
      setRevealed(false);
      setScratchpad("");
      void onRefreshRef.current();
    }
  }, [open]);

  useEffect(() => {
    setRevealed(false);
    setScratchpad("");
  }, [activeCard?.cardHash]);

  const handleRate = useCallback(
    async (rating: 1 | 2 | 3) => {
      if (!activeCard || submitting) return;
      setSubmitting(true);
      try {
        const res = await onRateCard(activeCard.cardHash, rating);
        const label =
          rating === 1 ? "Reset to 1d" : rating === 2 ? `Shortened (+${res.nextIntervalDays}d)` : `Expanded (+${res.nextIntervalDays}d)`;
        setLastOutcome(`${label} · Next due ${res.nextDueLogicalDate}`);
        setRevealed(false);
        setScratchpad("");
      } finally {
        setSubmitting(false);
      }
    },
    [activeCard, onRateCard, submitting]
  );

  // Keyboard flow: Space reveals source; 1/2/3 rates once revealed; Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (tag === "input" || tag === "textarea") return;
      if (e.code === "Space" && activeCard && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && activeCard && !submitting) {
        if (e.key === "1") {
          e.preventDefault();
          void handleRate(1);
        } else if (e.key === "2") {
          e.preventDefault();
          void handleRate(2);
        } else if (e.key === "3") {
          e.preventDefault();
          void handleRate(3);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeCard, revealed, submitting, handleRate, onClose]);

  const reviewedToday = deck?.reviewedToday ?? 0;
  const dailyLimit = deck?.dailyLimit ?? 5;
  const remainingCount = deck?.dueCards.length ?? 0;
  const totalSessionCards = Math.min(dailyLimit, reviewedToday + remainingCount);
  const progressPct =
    totalSessionCards > 0
      ? Math.min(100, Math.round((reviewedToday / totalSessionCards) * 100))
      : 100;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="recall-drawer-backdrop"
          data-testid="recall-drawer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
          className="theme-surface fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,13,22,0.62)] backdrop-blur-[12px] px-6 py-8"
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="smoked-glass-modal relative w-full max-w-[740px] rounded-[16px] px-8 py-7 md:px-10 md:py-9 text-[var(--text-ivory)] space-y-6"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
              <div>
                <div className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.24em] text-[#C5A059]">
                  <Sparkles className="h-3.5 w-3.5" />
                  3-Minute Daily Active Recall Ritual
                </div>
                <h2 className="mt-1 font-editorial text-[1.85rem] font-light tracking-[0.03em] text-[var(--text-ivory)]">
                  Vault Synthesis & Spaced Retrieval
                </h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close Daily Recall"
                data-testid="recall-close-btn"
                className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Ritual Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-ui tabular-nums text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                <span data-testid="recall-progress-label">
                  {reviewedToday} of {Math.max(1, totalSessionCards)} reviewed today ·{" "}
                  {deck?.totalIndexed ?? 0} Vault cards indexed
                </span>
                {lastOutcome && (
                  <span
                    data-testid="recall-last-outcome"
                    className="text-[var(--accent-luminous)] normal-case tracking-[0.04em]"
                  >
                    {lastOutcome}
                  </span>
                )}
              </div>
              <div className="h-[2.5px] w-full rounded-full bg-[rgba(237,234,224,0.12)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#6ca18c] to-[#C5A059] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Active Card Stage */}
            {activeCard ? (
              <div className="space-y-5" data-testid="recall-active-card">
                {(() => {
                  const meta = CATEGORY_META[activeCard.sourceCategory] ?? CATEGORY_META.snippet;
                  const Icon = meta.icon;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          data-testid="recall-card-category"
                          className={`rounded-full border px-2.5 py-0.5 flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] ${meta.badgeClass}`}
                        >
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <span
                          data-testid="recall-card-context"
                          className="font-ui text-[0.64rem] tracking-[0.06em] text-[var(--text-muted)]"
                        >
                          {activeCard.contextBadge}
                        </span>
                      </div>
                      <span className="font-ui tabular-nums text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]/80">
                        Reviews: {activeCard.reviewCount} · Ease {activeCard.easeFactor.toFixed(2)}
                      </span>
                    </div>
                  );
                })()}

                {/* Cue / Prompt Surface (Shown BEFORE Peek) */}
                <div className="rounded-[12px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-6 space-y-4">
                  <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                    Active Retrieval Cue
                  </div>
                  <p
                    data-testid="recall-card-cue"
                    className="font-editorial text-[1.42rem] leading-snug text-[var(--text-ivory)] m-0"
                  >
                    {activeCard.cue}
                  </p>

                  {/* Optional 1-Line Scratchpad */}
                  <input
                    type="text"
                    value={scratchpad}
                    onChange={(e) => setScratchpad(e.target.value)}
                    data-testid="recall-scratchpad"
                    placeholder="Formulate the idea in your own words before peeking (optional)..."
                    className="w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner-strong)] px-3.5 py-2.5 font-reading text-[0.96rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </div>

                {/* Reveal vs Source Answer + SM-2 Rating Controls */}
                {!revealed ? (
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Press Space to reveal source passage
                    </span>
                    <button
                      type="button"
                      onClick={() => setRevealed(true)}
                      data-testid="recall-reveal-btn"
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-full px-6 py-2.5 border border-[rgba(194,168,120,0.45)] flex items-center gap-2 font-editorial text-[1.05rem] tracking-[0.04em] text-[var(--text-ivory)]"
                    >
                      <Eye className="h-4 w-4 text-[#C5A059]" />
                      Reveal Source
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4" data-testid="recall-source-answer">
                    <div className="rounded-[12px] border border-[rgba(143,184,163,0.3)] bg-[var(--surface-inner)] p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-luminous)]">
                          Original Vault Source
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenInVault(
                              activeCard.sourceFile,
                              activeCard.sourceCategory,
                              activeCard.sourceFileName
                            )
                          }
                          data-testid="recall-open-vault-btn"
                          className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#e4c27c] hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open in Vault
                        </button>
                      </div>

                      <div className="font-reading text-[1.04rem] leading-relaxed text-[var(--text-ivory-soft)] whitespace-pre-wrap">
                        {activeCard.answer}
                      </div>
                    </div>

                    {/* Three SM-2 Effort Rating Buttons */}
                    <div className="grid grid-cols-3 gap-3 pt-1">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleRate(1)}
                        data-testid="recall-rate-1"
                        className="cursor-pointer rounded-[10px] border border-[rgba(219,122,94,0.45)] bg-[rgba(219,122,94,0.12)] px-4 py-2.5 text-center hover:bg-[rgba(219,122,94,0.22)] transition-colors disabled:opacity-50"
                      >
                        <div className="font-editorial text-[1.06rem] text-[var(--text-ivory)]">
                          1 · Forgot
                        </div>
                        <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[#e6a08d]">
                          Reset to 1 day
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleRate(2)}
                        data-testid="recall-rate-2"
                        className="cursor-pointer rounded-[10px] border border-[#C5A059]/45 bg-[#C5A059]/12 px-4 py-2.5 text-center hover:bg-[#C5A059]/24 transition-colors disabled:opacity-50"
                      >
                        <div className="font-editorial text-[1.06rem] text-[var(--text-ivory)]">
                          2 · Hard / Partial
                        </div>
                        <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[#e4c27c]">
                          Shorter interval
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleRate(3)}
                        data-testid="recall-rate-3"
                        className="cursor-pointer rounded-[10px] border border-[rgba(143,184,163,0.5)] bg-[rgba(143,184,163,0.15)] px-4 py-2.5 text-center hover:bg-[rgba(143,184,163,0.28)] transition-colors disabled:opacity-50"
                      >
                        <div className="font-editorial text-[1.06rem] text-[var(--text-ivory)]">
                          3 · Solid
                        </div>
                        <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)]">
                          Expand via SM-2
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Ritual Complete / Empty Vault State */
              <div
                data-testid="recall-complete-state"
                className="rounded-[12px] border border-[rgba(143,184,163,0.22)] bg-[var(--surface-inner)] p-8 text-center space-y-3"
              >
                <CheckCircle2 className="h-8 w-8 text-[var(--accent-luminous)] mx-auto" strokeWidth={1.4} />
                <h3 className="font-editorial text-[1.5rem] text-[var(--text-ivory)]">
                  {(deck?.totalIndexed ?? 0) === 0
                    ? "Your Recall Deck Awaits Source Material"
                    : "Daily Recall Ritual Complete"}
                </h3>
                <p className="font-reading text-[0.96rem] text-[var(--text-muted)] max-w-md mx-auto">
                  {(deck?.totalIndexed ?? 0) === 0
                    ? "Highlight passages in Library books, export a TOC Thinking Tree, or add a #recall snippet in Reflections or Inbox to auto-populate your deck."
                    : `You have reviewed ${reviewedToday} ${
                        reviewedToday === 1 ? "card" : "cards"
                      } today across ${deck?.totalIndexed ?? 0} indexed Vault insights. Fresh cards will surface after the 3:00 rollover.`}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-full px-6 py-2 font-editorial text-[0.98rem] text-[var(--text-ivory)]"
                  >
                    Return to Athenaeum
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
