import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  Check,
  Clock,
  Compass,
  Database,
  Disc3,
  FolderOpen,
  Lightbulb,
  Music,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { AthenaeumConfig, MusicPlayerPreference, TimeFormat } from "../types/athenaeum";

interface OnboardingWizardProps {
  open: boolean;
  config: AthenaeumConfig;
  defaultLocalNotesPath: string;
  onPickVaultFolder: () => Promise<string | null>;
  onPickBooksFolder: () => Promise<string | null>;
  onComplete: (nextConfig: AthenaeumConfig) => Promise<void>;
}

const STEPS = [
  { id: 0, label: "Identity" },
  { id: 1, label: "Folders" },
  { id: 2, label: "Audio" },
  { id: 3, label: "Quick Tour" },
] as const;

export function OnboardingWizard({
  open,
  config,
  defaultLocalNotesPath,
  onPickVaultFolder,
  onPickBooksFolder,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState<number>(0);
  const [userName, setUserName] = useState<string>(config.userName ?? "");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(config.timeFormat ?? "12h");
  const [dayRolloverHour, setDayRolloverHour] = useState<number>(config.dayRolloverHour ?? 3);
  const [vaultPath, setVaultPath] = useState<string>(config.vaultPath ?? "");
  const [booksFolderPath, setBooksFolderPath] = useState<string>(config.booksFolderPath ?? "");
  const [preferredMusicPlayer, setPreferredMusicPlayer] = useState<MusicPlayerPreference>(
    config.preferredMusicPlayer ?? "none"
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setUserName(config.userName ?? "");
    setTimeFormat(config.timeFormat ?? "12h");
    setDayRolloverHour(config.dayRolloverHour ?? 3);
    setVaultPath(config.vaultPath ?? "");
    setBooksFolderPath(config.booksFolderPath ?? "");
    setPreferredMusicPlayer(config.preferredMusicPlayer ?? "none");
  }, [open, config]);

  const handleUseBuiltInNotes = () => {
    setVaultPath(defaultLocalNotesPath || "Documents/Athenaeum Notes");
  };

  const handleBrowseVault = async () => {
    const picked = await onPickVaultFolder();
    if (picked) setVaultPath(picked);
  };

  const handleBrowseBooks = async () => {
    const picked = await onPickBooksFolder();
    if (picked) setBooksFolderPath(picked);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const resolvedVault = vaultPath.trim() || defaultLocalNotesPath || "";
      await onComplete({
        ...config,
        userName: userName.trim(),
        timeFormat,
        dayRolloverHour,
        vaultPath: resolvedVault,
        booksFolderPath: booksFolderPath.trim(),
        preferredMusicPlayer,
        onboardingCompleted: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="onboarding-wizard-backdrop"
          data-testid="onboarding-wizard"
          data-glass-theme="surface"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24 }}
          className="theme-surface fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(7,11,18,0.84)] px-6 py-8 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="smoked-glass-modal relative w-full max-w-[760px] rounded-[10px] border border-[rgba(226,180,109,0.28)] px-8 py-7 md:px-11 md:py-9 text-[var(--text-ivory)] shadow-[0_28px_80px_rgba(0,0,0,0.68)]"
          >
            {/* Header + Stepper */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(226,180,109,0.16)] pb-5">
              <div>
                <div className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.26em] text-[#E2B46D]">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Athenaeum Setup Guide
                </div>
                <h2 className="mt-1.5 font-editorial text-[1.9rem] font-normal tracking-[0.02em] text-[var(--text-ivory)]">
                  {step === 0 && "Welcome to Athenaeum"}
                  {step === 1 && "Notes & Library Folders"}
                  {step === 2 && "Music & Ambient Soundscapes"}
                  {step === 3 && "Optional Connectors & Quick Tour"}
                </h2>
              </div>

              <div className="flex items-center gap-2" aria-label="Setup steps">
                {STEPS.map((s) => {
                  const isCurrent = step === s.id;
                  const isDone = step > s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStep(s.id)}
                      data-testid={`onboarding-step-dot-${s.id + 1}`}
                      className={`cursor-pointer rounded-[3px] border px-2.5 py-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] transition-colors ${
                        isCurrent
                          ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.18)] text-[var(--text-ivory)]"
                          : isDone
                          ? "border-[rgba(226,180,109,0.3)] bg-[rgba(226,180,109,0.08)] text-[#E2B46D]"
                          : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                      }`}
                    >
                      {s.id + 1}. {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step Body */}
            <div className="mt-6 min-h-[300px]">
              {/* STEP 1: WELCOME & IDENTITY */}
              {step === 0 && (
                <div className="space-y-6" data-testid="onboarding-step-1">
                  <p className="font-reading text-[1rem] leading-relaxed text-[var(--text-ivory-soft)]">
                    Athenaeum is a calm, local-first desktop workspace for deep focus, daily goals,
                    writing, reading, and strategic thinking. Everything is stored locally on your
                    device—no account or cloud subscription required.
                  </p>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start">
                    <label className="block md:col-span-2">
                      <span className="flex h-5 items-center font-ui text-[0.64rem] leading-none uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Display Name (Optional)
                      </span>
                      <input
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="Leave blank for a simple time-of-day greeting"
                        data-testid="onboarding-name-input"
                        autoFocus
                        className="mt-2 h-[42px] w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 font-reading text-[1rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[#E2B46D] focus:outline-none"
                      />
                    </label>

                    <div className="flex flex-col">
                      <span className="flex h-5 items-center gap-1.5 font-ui text-[0.64rem] leading-none uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-[#E2B46D]" strokeWidth={1.6} />
                        Clock Format
                      </span>
                      <div className="mt-2 flex items-center gap-2">
                        {(["12h", "24h"] as const).map((fmt) => {
                          const active = timeFormat === fmt;
                          return (
                            <button
                              key={fmt}
                              type="button"
                              data-testid={`onboarding-time-${fmt}`}
                              onClick={() => setTimeFormat(fmt)}
                              className={`flex h-[42px] flex-1 cursor-pointer items-center justify-center rounded-[3px] border px-3 font-ui text-[0.72rem] uppercase tracking-[0.14em] transition-colors ${
                                active
                                  ? "border-[rgba(226,180,109,0.58)] bg-[rgba(226,180,109,0.16)] text-[var(--text-ivory)]"
                                  : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                              }`}
                            >
                              {fmt === "12h" ? "12-Hour" : "24-Hour"}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex flex-col">
                      <span className="flex h-5 items-center font-ui text-[0.64rem] leading-none uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        Logical Day Rollover
                      </span>
                      <select
                        value={dayRolloverHour}
                        onChange={(e) => setDayRolloverHour(Number(e.target.value))}
                        data-testid="onboarding-rollover-select"
                        className="mt-2 h-[42px] w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 font-ui tabular-nums text-[0.88rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                      >
                        {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00 {h === 3 ? "(Default)" : ""}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1.5 block font-ui text-[0.58rem] tracking-[0.06em] text-[var(--text-muted)]">
                        Late-night sessions before this hour count toward the previous day.
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* STEP 2: NOTES & BOOKS FOLDERS */}
              {step === 1 && (
                <div className="space-y-5" data-testid="onboarding-step-2">
                  <p className="font-reading text-[0.98rem] leading-relaxed text-[var(--text-ivory-soft)]">
                    Your journal entries, reflections, and book highlights are saved as plain
                    Markdown files. Connect an existing Obsidian vault, or let Athenaeum create a
                    clean local folder automatically.
                  </p>

                  {/* Notes Folder */}
                  <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-ui text-[0.64rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                        Notes &amp; Journal Folder
                      </span>
                      <button
                        type="button"
                        onClick={handleUseBuiltInNotes}
                        data-testid="onboarding-use-builtin-notes-btn"
                        className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.42)] bg-[rgba(226,180,109,0.12)] px-3 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#F3EFE6] hover:bg-[rgba(226,180,109,0.22)] transition-colors"
                      >
                        Use Built-In Local Notes Folder
                      </button>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="text"
                        value={vaultPath}
                        onChange={(e) => setVaultPath(e.target.value)}
                        placeholder={defaultLocalNotesPath || "Documents/Athenaeum Notes"}
                        data-testid="onboarding-vault-input"
                        className="flex-1 rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,20,0.55)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[#E2B46D] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleBrowseVault()}
                        data-testid="onboarding-browse-vault-btn"
                        className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-2 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1.5"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[#E2B46D]" />
                        Choose Folder
                      </button>
                    </div>
                    <p className="font-ui text-[0.6rem] tracking-[0.04em] text-[var(--text-muted)]">
                      Obsidian is completely optional—works seamlessly with any local folder.
                    </p>
                  </div>

                  {/* Books Folder */}
                  <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                        <BookOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
                        Books Folder (Optional)
                      </span>
                      <span className="font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        PDF &amp; EPUB
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="text"
                        value={booksFolderPath}
                        onChange={(e) => setBooksFolderPath(e.target.value)}
                        placeholder="Skip for now or choose a folder of PDF/EPUB files"
                        data-testid="onboarding-books-input"
                        className="flex-1 rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,20,0.55)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[#E2B46D] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleBrowseBooks()}
                        data-testid="onboarding-browse-books-btn"
                        className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-2 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1.5"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[#E2B46D]" />
                        Choose Folder
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: MUSIC & AMBIENT AUDIO */}
              {step === 2 && (
                <div className="space-y-5" data-testid="onboarding-step-3">
                  <p className="font-reading text-[0.98rem] leading-relaxed text-[var(--text-ivory-soft)]">
                    Choose your preferred desktop music player for the quick-launch button. Six
                    built-in offline ambient soundscapes (Brown Noise, Rain, Library, Cafe,
                    Fireplace, Soft Wind) and Windows media detection are always available.
                  </p>

                  <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
                    {(
                      [
                        {
                          id: "apple_music" as const,
                          title: "Apple Music",
                          desc: "Quick-launch Apple Music desktop (or web player) with Windows media sync.",
                          Icon: Music,
                        },
                        {
                          id: "spotify" as const,
                          title: "Spotify",
                          desc: "Quick-launch Spotify desktop (or web player) with Windows media sync.",
                          Icon: Disc3,
                        },
                        {
                          id: "none" as const,
                          title: "Soundscapes Only",
                          desc: "Hide external player shortcuts and focus with built-in offline ambient audio.",
                          Icon: Volume2,
                        },
                      ] as const
                    ).map(({ id, title, desc, Icon }) => {
                      const selected = preferredMusicPlayer === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setPreferredMusicPlayer(id)}
                          data-testid={`onboarding-music-${id}`}
                          aria-pressed={selected}
                          className={`cursor-pointer rounded-[6px] border p-4 text-left transition-all flex flex-col justify-between gap-3 ${
                            selected
                              ? "border-[rgba(226,180,109,0.68)] bg-[rgba(226,180,109,0.14)] shadow-[0_0_24px_rgba(226,180,109,0.12)]"
                              : "border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(226,180,109,0.34)]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <Icon
                              className={`h-5 w-5 ${
                                selected ? "text-[#E2B46D]" : "text-[var(--text-muted)]"
                              }`}
                              strokeWidth={1.6}
                            />
                            {selected && (
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(226,180,109,0.22)] text-[#E2B46D]">
                                <Check className="h-3 w-3" strokeWidth={2.2} />
                              </span>
                            )}
                          </div>
                          <div>
                            <div className="font-editorial text-[1.16rem] text-[var(--text-ivory)]">
                              {title}
                            </div>
                            <p className="mt-1 font-reading text-[0.84rem] leading-snug text-[var(--text-muted)]">
                              {desc}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 4: OPTIONAL INTEGRATIONS & QUICK TOUR */}
              {step === 3 && (
                <div className="space-y-5" data-testid="onboarding-step-4">
                  <div className="rounded-[6px] border border-[rgba(226,180,109,0.28)] bg-[rgba(226,180,109,0.08)] px-4 py-3 font-reading text-[0.92rem] text-[var(--text-ivory)]">
                    Everything runs <strong className="font-semibold text-[#E2B46D]">100% locally</strong>{" "}
                    in an automatic SQLite database with zero accounts required. Optional
                    connectors can be turned on anytime in Settings.
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* Optional Connectors */}
                    <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-2.5">
                      <div className="font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#E2B46D]">
                        Optional Connectors (In Settings)
                      </div>
                      <ul className="space-y-2 list-none p-0 m-0 font-reading text-[0.86rem] text-[var(--text-ivory-soft)]">
                        <li className="flex items-start gap-2">
                          <Calendar className="h-3.5 w-3.5 mt-1 shrink-0 text-[#E2B46D]" />
                          <span>
                            <strong className="text-[var(--text-ivory)]">Calendar (.ics):</strong>{" "}
                            Read-only Google, Apple, or Outlook feeds.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Lightbulb className="h-3.5 w-3.5 mt-1 shrink-0 text-[#E2B46D]" />
                          <span>
                            <strong className="text-[var(--text-ivory)]">Home Assistant:</strong>{" "}
                            Auto-dim room lights during focus and reading.
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Database className="h-3.5 w-3.5 mt-1 shrink-0 text-[#E2B46D]" />
                          <span>
                            <strong className="text-[var(--text-ivory)]">
                              External DB / Webhooks:
                            </strong>{" "}
                            Optional n8n webhooks &amp; custom sync URLs.
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* 4-Bullet Quickstart */}
                    <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-2.5">
                      <div className="flex items-center gap-1.5 font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[#E2B46D]">
                        <Compass className="h-3.5 w-3.5" strokeWidth={1.6} />
                        Quick Tour
                      </div>
                      <ul className="space-y-2 list-none p-0 m-0 font-reading text-[0.86rem] text-[var(--text-ivory-soft)]">
                        <li>
                          • <strong className="text-[var(--text-ivory)]">Overview:</strong>{" "}
                          Start Focus timers, log hourly check-ins, and track streaks.
                        </li>
                        <li>
                          • <strong className="text-[var(--text-ivory)]">Scroll Down:</strong>{" "}
                          Open the Workspace for Goals, Journal, Library, TOC Whiteboard, Focus
                          Studio, and Analytics.
                        </li>
                        <li>
                          • <strong className="text-[var(--text-ivory)]">Quick Capture:</strong>{" "}
                          Press <kbd className="font-ui text-[0.74rem] text-[#E2B46D]">Alt+Space</kbd>{" "}
                          anytime to add a task or note.
                        </li>
                        <li>
                          • <strong className="text-[var(--text-ivory)]">Sticky Notes:</strong>{" "}
                          Double-click the background or click{" "}
                          <span className="text-[#E2B46D]">+ New Note</span> to pin thoughts.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="mt-7 flex items-center justify-between gap-4 border-t border-[rgba(226,180,109,0.16)] pt-5">
              <div>
                {step > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    data-testid="onboarding-back-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] flex items-center gap-1.5"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleFinish()}
                    data-testid="onboarding-skip-btn"
                    className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--text-ivory)] transition-colors"
                  >
                    Skip Setup
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    data-testid="onboarding-next-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.16)] px-5 py-2 font-ui text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-ivory)] flex items-center gap-1.5"
                  >
                    Continue
                    <ArrowRight className="h-3.5 w-3.5 text-[#E2B46D]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleFinish()}
                    data-testid="onboarding-launch-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.65)] bg-[rgba(226,180,109,0.22)] px-6 py-2 font-editorial text-[1.04rem] tracking-[0.04em] text-[#F3EFE6] flex items-center gap-2 disabled:opacity-50"
                  >
                    {saving ? "Preparing Workspace..." : "Launch Athenaeum"}
                    <ArrowRight className="h-4 w-4 text-[#E2B46D]" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
