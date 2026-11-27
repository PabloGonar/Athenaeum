import { useEffect, useState } from "react";
import {
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Compass,
  Copy,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Lightbulb,
  Music,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Sliders,
  Trash2,
  Webhook,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { storageService } from "../../services/storage";
import { formatIsoTimestamp } from "../../utils/time";
import type {
  AthenaeumConfig,
  CalendarFeedConfig,
  HaLightCommand,
  IcsSyncReport,
  IngestServerStatus,
  MediaSessionState,
  QuoteItem,
} from "../../types/athenaeum";

function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return [128, 0, 255];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

type IntegrationBadgeState = "connected" | "ready" | "unconfigured";

function StatusBadge({
  state,
  label,
  testId,
}: {
  state: IntegrationBadgeState;
  label?: string;
  testId?: string;
}) {
  const styles: Record<IntegrationBadgeState, string> = {
    connected:
      "border-[rgba(226,180,109,0.52)] bg-[rgba(226,180,109,0.16)] text-[#F2C464]",
    ready:
      "border-[#C5A059]/45 bg-[#C5A059]/12 text-[#e4c27c]",
    unconfigured:
      "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)]",
  };
  const fallbackText: Record<IntegrationBadgeState, string> = {
    connected: "Connected",
    ready: "Ready",
    unconfigured: "Not Configured",
  };
  return (
    <span
      data-testid={testId}
      className={`rounded-[3px] border px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] ${styles[state]}`}
    >
      {label || fallbackText[state]}
    </span>
  );
}

type SettingsTab = "core" | "integrations";

interface SettingsMiniAppProps {
  config: AthenaeumConfig;
  initialTab?: SettingsTab;
  onSaveConfig: (next: AthenaeumConfig) => Promise<void>;
  onPickVaultFolder: () => Promise<string | null>;
  onPickBooksFolder: () => Promise<string | null>;
  onSyncCalendars: (urls: string[]) => Promise<IcsSyncReport>;
  onTestLightPing: (command: HaLightCommand, label?: string) => Promise<string>;
  onOpenFocusStudio: () => void;
  onReopenBriefing: () => void;
  onRerunOnboarding?: () => void;
  onClose: () => void;
}

export function SettingsMiniApp({
  config,
  initialTab = "core",
  onSaveConfig,
  onPickVaultFolder,
  onPickBooksFolder,
  onSyncCalendars,
  onTestLightPing,
  onOpenFocusStudio,
  onReopenBriefing,
  onRerunOnboarding,
  onClose,
}: SettingsMiniAppProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<AthenaeumConfig>(config);

  // Home Assistant state
  const [showHaToken, setShowHaToken] = useState(false);
  const [haPinging, setHaPinging] = useState(false);
  const [haPingStatus, setHaPingStatus] = useState<string | null>(null);

  // n8n & Local Ingest state (collapsed by default for clean plain-English overview)
  const [showAdvancedBridge, setShowAdvancedBridge] = useState(false);
  const [n8nTesting, setN8nTesting] = useState(false);
  const [n8nTestStatus, setN8nTestStatus] = useState<string | null>(null);
  const [showIngestToken, setShowIngestToken] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<IngestServerStatus | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  // Apple Music SMTC status
  const [mediaState, setMediaState] = useState<MediaSessionState | null>(null);

  // Calendar Feeds state
  const [newFeedLabel, setNewFeedLabel] = useState("");
  const [newIcsUrl, setNewIcsUrl] = useState("");
  const [icsSyncing, setIcsSyncing] = useState(false);
  const [icsStatus, setIcsStatus] = useState<string | null>(null);

  // Core Preferences state
  const [quoteText, setQuoteText] = useState("");
  const [quoteAuthor, setQuoteAuthor] = useState("");
  const [bulkPaste, setBulkPaste] = useState("");
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    void storageService.getIngestServerStatus().then(setIngestStatus);
    void storageService.getMediaState().then(setMediaState);
  }, []);

  const flashCopied = (label: string) => {
    setCopiedNotice(label);
    window.setTimeout(() => setCopiedNotice((prev) => (prev === label ? null : prev)), 2400);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(label);
    } catch {
      flashCopied(`${label} ready`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedQuotes = draft.quotes
      .map((q) => ({ text: q.text.trim(), author: q.author.trim() }))
      .filter((q) => q.text.length > 0);
    const cleanedFeeds = (draft.calendarFeeds ?? []).filter((f) => f.url.trim().length > 0);
    const nextCfg: AthenaeumConfig = {
      ...draft,
      quotes: cleanedQuotes,
      calendarFeeds: cleanedFeeds,
      calendarIcsUrls: cleanedFeeds.map((f) => f.url.trim()),
    };
    await onSaveConfig(nextCfg);
    setDraft(nextCfg);
    setIngestStatus(await storageService.getIngestServerStatus());
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2400);
  };

  const handleTestLightPing = async () => {
    setHaPinging(true);
    setHaPingStatus(null);
    try {
      await onSaveConfig(draft);
      const preset = draft.haFocusPreset;
      const sceneId = preset.sceneEntityId?.trim() || "";
      const msg = await onTestLightPing(
        {
          mode: sceneId ? "scene" : preset.mode,
          rgbColor: preset.rgbColor,
          kelvin: preset.kelvin,
          brightnessPct: Math.max(0, Math.min(100, preset.brightnessPct)),
          entityId: draft.haEntityId || "",
          sceneEntityId: sceneId || undefined,
        },
        "Test Ping"
      );
      setHaPingStatus(msg);
    } catch (err) {
      setHaPingStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setHaPinging(false);
    }
  };

  const handleTestScene = async (sceneEntityId: string, label: string) => {
    const clean = sceneEntityId.trim();
    if (!clean) {
      setHaPingStatus(`${label}: Enter a Scene Entity ID (e.g. scene.deep_focus) first.`);
      return;
    }
    setHaPinging(true);
    setHaPingStatus(null);
    try {
      await onSaveConfig(draft);
      const res = await storageService.triggerHaScene(clean, draft);
      setHaPingStatus(`${label}: ${res.message}`);
    } catch (err) {
      setHaPingStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setHaPinging(false);
    }
  };

  const handleTestN8nWebhook = async () => {
    setN8nTesting(true);
    setN8nTestStatus(null);
    try {
      await onSaveConfig(draft);
      const msg = await storageService.sendN8nEvent(
        "test_ping",
        {
          message: "Athenaeum test webhook ping",
          triggers: {
            weeklySynthesis: draft.n8nTriggerWeeklySynthesis,
            dailyDebrief: draft.n8nTriggerDailyDebrief,
            goalCompleted: draft.n8nTriggerGoalCompleted,
          },
        },
        draft
      );
      setN8nTestStatus(msg);
    } catch (err) {
      setN8nTestStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setN8nTesting(false);
    }
  };

  const handleRegenerateToken = async () => {
    const nextToken = await storageService.regenerateIngestToken();
    const updated = { ...draft, ingestApiToken: nextToken };
    setDraft(updated);
    await onSaveConfig(updated);
    flashCopied("Regenerated 32-byte token");
  };

  const handleSyncFeeds = async () => {
    setIcsSyncing(true);
    setIcsStatus(null);
    try {
      const urls = (draft.calendarFeeds ?? []).map((f) => f.url.trim()).filter(Boolean);
      const syncedAt = new Date().toISOString();
      const updated: AthenaeumConfig = {
        ...draft,
        calendarIcsUrls: urls,
        calendarLastSyncedAt: syncedAt,
      };
      await onSaveConfig(updated);
      const rep = await onSyncCalendars(urls);
      setDraft(updated);
      setIcsStatus(
        rep.errors.length > 0
          ? `Synced ${rep.eventsSynced} events (${rep.errors[0]})`
          : `Synced ${rep.eventsSynced} upcoming events from ${rep.feedsChecked} feed(s)`
      );
    } catch (err) {
      setIcsStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIcsSyncing(false);
    }
  };

  const addQuote = () => {
    if (!quoteText.trim()) return;
    const item: QuoteItem = {
      text: quoteText.trim(),
      author: quoteAuthor.trim(),
    };
    setDraft((prev) => ({ ...prev, quotes: [...prev.quotes, item] }));
    setQuoteText("");
    setQuoteAuthor("");
  };

  const importBulkQuotes = () => {
    const lines = bulkPaste
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const parsed: QuoteItem[] = lines.map((line) => {
      const sepMatch = line.match(/^(.*?)\s*(?:\|| - )\s*(.+)$/);
      if (sepMatch) {
        return {
          text: sepMatch[1].replace(/^["“]|["”]$/g, "").trim(),
          author: sepMatch[2].trim(),
        };
      }
      return { text: line.replace(/^["“]|["”]$/g, "").trim(), author: "" };
    });
    setDraft((prev) => ({ ...prev, quotes: [...prev.quotes, ...parsed] }));
    setBulkPaste("");
    setShowBulkPaste(false);
  };

  const updateQuote = (index: number, patch: Partial<QuoteItem>) => {
    setDraft((prev) => ({
      ...prev,
      quotes: prev.quotes.map((q, idx) => (idx === index ? { ...q, ...patch } : q)),
    }));
  };

  const removeQuote = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      quotes: prev.quotes.filter((_, idx) => idx !== index),
    }));
  };

  const haState: IntegrationBadgeState =
    draft.haBaseUrl.trim() && draft.haToken.trim()
      ? "connected"
      : draft.haBaseUrl.trim()
      ? "ready"
      : "unconfigured";

  const n8nState: IntegrationBadgeState =
    draft.n8nWebhookUrl.trim() && (ingestStatus?.running ?? draft.ingestEnabled)
      ? "connected"
      : ingestStatus?.running || draft.ingestEnabled
      ? "ready"
      : "unconfigured";

  const appleMusicState: IntegrationBadgeState = mediaState?.active ? "connected" : "ready";

  const calendarState: IntegrationBadgeState =
    (draft.calendarFeeds ?? []).length > 0 ? "connected" : "unconfigured";

  const endpointHost = draft.ingestBindLan ? "<YOUR_LAN_OR_TAILSCALE_IP>" : "127.0.0.1";
  const endpointUrl = `http://${endpointHost}:1429/ingest`;

  return (
    <MiniAppShell
      title="Settings"
      opaque
      onClose={onClose}
      rightSlot={
        <div className="flex items-center gap-2.5">
          {onRerunOnboarding && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRerunOnboarding();
              }}
              data-testid="rerun-onboarding-btn"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)]"
            >
              <Compass className="h-3.5 w-3.5 text-[var(--accent-brass)]" />
              Re-run Setup Guide
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onReopenBriefing();
            }}
            data-testid="reopen-briefing-btn"
            className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 font-editorial text-[0.94rem] tracking-[0.04em] text-[var(--accent-brass)] border-[rgba(226,180,109,0.34)]"
          >
            Open Daily Overview
          </button>
        </div>
      }
    >
      <form onSubmit={handleSave} className="space-y-6 pb-12" data-testid="settings-miniapp">
        {/* ==================== TOP TAB SWITCHER (Core Preferences First, Integrations Second) ==================== */}
        <div className="flex flex-wrap items-center justify-between gap-4 smoked-glass rounded-[6px] px-5 py-3">
          <div className="flex items-center gap-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "core"}
              data-testid="settings-tab-core"
              onClick={() => setActiveTab("core")}
              className={`cursor-pointer rounded-[3px] px-4 py-1.5 flex items-center gap-2 font-ui text-[0.66rem] uppercase tracking-[0.16em] border transition-colors ${
                activeTab === "core"
                  ? "border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.16)] text-[var(--text-ivory)]"
                  : "border-transparent bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              Core Preferences
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "integrations"}
              data-testid="settings-tab-integrations"
              onClick={() => setActiveTab("integrations")}
              className={`cursor-pointer rounded-[3px] px-4 py-1.5 flex items-center gap-2 font-ui text-[0.66rem] uppercase tracking-[0.16em] border transition-colors ${
                activeTab === "integrations"
                  ? "border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.16)] text-[var(--text-ivory)]"
                  : "border-transparent bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
              }`}
            >
              <Webhook className="h-3.5 w-3.5" />
              Integrations &amp; Automations
            </button>
          </div>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span
                data-testid="settings-saved-notice"
                className="font-ui text-[0.68rem] tracking-[0.12em] uppercase text-[var(--accent-luminous)]"
              >
                Saved
              </span>
            )}
            <button
              type="submit"
              data-testid="settings-save-btn"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-5 py-1.5 font-editorial text-[0.96rem] tracking-[0.04em] text-[var(--text-ivory)] border-[rgba(226,180,109,0.45)]"
            >
              Save Configuration
            </button>
          </div>
        </div>

        {/* ==================== TAB 1: CORE PREFERENCES ==================== */}
        {activeTab === "core" && (
          <div className="space-y-6" data-testid="core-preferences-panel">
            {/* Identity, Rollover, Clock Format & Startup */}
            <section className="smoked-glass rounded-[8px] p-6 space-y-5">
              <div className="font-ui text-[0.65rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                General Preferences
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <label className="block">
                  <span className="font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Greeting Name
                  </span>
                  <input
                    type="text"
                    value={draft.userName}
                    onChange={(e) => setDraft({ ...draft, userName: e.target.value })}
                    placeholder="Optional (leave blank for greeting only)"
                    data-testid="greeting-name-input"
                    className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-reading text-[1rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Logical Day Rollover
                  </span>
                  <select
                    value={draft.dayRolloverHour}
                    onChange={(e) =>
                      setDraft({ ...draft, dayRolloverHour: Number(e.target.value) })
                    }
                    data-testid="day-rollover-select"
                    className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-ui tabular-nums text-[0.9rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <span className="font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Time Format
                  </span>
                  <div className="mt-1.5 flex items-center gap-2">
                    {(["12h", "24h"] as const).map((fmt) => {
                      const active = draft.timeFormat === fmt;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          data-testid={`time-format-${fmt}`}
                          onClick={() => setDraft({ ...draft, timeFormat: fmt })}
                          className={`flex-1 cursor-pointer rounded-[3px] px-3 py-2 font-ui text-[0.74rem] uppercase tracking-[0.12em] transition-colors ${
                            active
                              ? "border border-[rgba(226,180,109,0.5)] bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                              : "border border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                          }`}
                        >
                          {fmt === "12h" ? "12-Hour" : "24-Hour"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Preferred Music Player & Daily Reading Habit */}
              <div className="grid grid-cols-1 gap-5 border-t border-[rgba(226,180,109,0.12)] pt-4 md:grid-cols-2">
                <div>
                  <span className="font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Preferred Music Player
                  </span>
                  <div className="mt-1.5 flex items-center gap-2">
                    {(
                      [
                        { id: "apple_music", label: "Apple Music" },
                        { id: "spotify", label: "Spotify" },
                        { id: "none", label: "None" },
                      ] as const
                    ).map((opt) => {
                      const active = draft.preferredMusicPlayer === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`music-pref-${opt.id}`}
                          onClick={() =>
                            setDraft({ ...draft, preferredMusicPlayer: opt.id })
                          }
                          className={`flex-1 cursor-pointer rounded-[3px] px-3 py-2 font-ui text-[0.68rem] uppercase tracking-[0.12em] transition-colors ${
                            active
                              ? "border border-[rgba(226,180,109,0.5)] bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                              : "border border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  data-testid="daily-reading-habit-setting"
                  className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-4 py-3 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.dailyReadingHabitEnabled}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            dailyReadingHabitEnabled: e.target.checked,
                          })
                        }
                        data-testid="daily-reading-habit-toggle"
                        className="h-4 w-4 accent-[#E2B46D] cursor-pointer"
                      />
                      <span className="flex items-center gap-1.5 font-editorial text-[1.02rem] text-[var(--text-ivory)]">
                        <BookOpen className="h-3.5 w-3.5 text-[#E2B46D]" />
                        Daily Reading Habit
                      </span>
                    </label>

                    {draft.dailyReadingHabitEnabled && (
                      <label className="inline-flex items-center gap-2">
                        <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          Pages / Day
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={draft.dailyReadingTargetPages}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              dailyReadingTargetPages: Math.max(
                                1,
                                Math.min(500, Number(e.target.value) || 10)
                              ),
                            })
                          }
                          data-testid="daily-reading-target-input"
                          className="w-[70px] rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,20,0.6)] px-2 py-1 text-center font-ui tabular-nums text-[0.8rem] text-[var(--text-ivory)] focus:border-[#E2B46D] focus:outline-none"
                        />
                      </label>
                    )}
                  </div>
                  <p className="font-reading text-[0.8rem] text-[var(--text-muted)] leading-snug">
                    {draft.dailyReadingHabitEnabled
                      ? `Auto-completes a daily reading goal once you read ${draft.dailyReadingTargetPages} unique pages in The Library.`
                      : "Off by default. Enable to track a configurable daily page target in The Library."}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-[rgba(226,180,109,0.12)]">
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.launchOnStartup}
                    onChange={(e) => setDraft({ ...draft, launchOnStartup: e.target.checked })}
                    data-testid="launch-on-startup-checkbox"
                    className="h-4 w-4 accent-[#E2B46D] cursor-pointer"
                  />
                  <span className="font-editorial text-[1.02rem] text-[var(--text-ivory)]">
                    Launch on Startup
                  </span>
                </label>
              </div>
            </section>

            {/* Notes Folder & Library Books Folder */}
            <section className="smoked-glass rounded-[8px] p-6 space-y-5" data-testid="vault-settings-section">
              <div className="font-ui text-[0.65rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                Notes &amp; Library Folders
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Books Folder Path
                  </span>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="text"
                      value={draft.booksFolderPath}
                      onChange={(e) => setDraft({ ...draft, booksFolderPath: e.target.value })}
                      data-testid="books-folder-input"
                      placeholder="~/Documents/Books"
                      className="flex-1 rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await onPickBooksFolder();
                        if (chosen) setDraft((prev) => ({ ...prev, booksFolderPath: chosen }));
                      }}
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1.5"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[var(--accent-brass)]" />
                      Browse
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Notes Folder Path
                  </span>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="text"
                      value={draft.vaultPath}
                      onChange={(e) => setDraft({ ...draft, vaultPath: e.target.value })}
                      data-testid="vault-path-input"
                      placeholder="~/Documents/Athenaeum Notes"
                      className="flex-1 rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await onPickVaultFolder();
                        if (chosen) setDraft((prev) => ({ ...prev, vaultPath: chosen }));
                      }}
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1.5"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[var(--accent-luminous)]" />
                      Browse
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Personal Curated Quotes Editor */}
            <section className="smoked-glass rounded-[8px] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-ui text-[0.65rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                  Personal Curated Quotes ({draft.quotes.length})
                </div>
                <button
                  type="button"
                  onClick={() => setShowBulkPaste((v) => !v)}
                  className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.64rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)] hover:underline"
                >
                  {showBulkPaste ? "Hide Bulk Paste" : "Paste Multiple Quotes"}
                </button>
              </div>

              {showBulkPaste && (
                <div className="space-y-2.5 rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4">
                  <textarea
                    rows={3}
                    value={bulkPaste}
                    onChange={(e) => setBulkPaste(e.target.value)}
                    placeholder="One quote per line, optionally formatted as: Quote text | Author"
                    className="w-full resize-none rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3 font-reading text-[0.94rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={importBulkQuotes}
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)]"
                    >
                      Add All Lines
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {draft.quotes.map((q, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center gap-2.5 border-b border-[rgba(226,180,109,0.1)] pb-2.5"
                  >
                    <input
                      type="text"
                      value={q.text}
                      onChange={(e) => updateQuote(idx, { text: e.target.value })}
                      className="flex-1 min-w-[220px] bg-transparent border-0 font-reading text-[0.96rem] text-[var(--text-ivory)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={q.author}
                      onChange={(e) => updateQuote(idx, { author: e.target.value })}
                      placeholder="Author"
                      className="w-[150px] bg-transparent border-0 border-l border-[var(--glass-border)] pl-3 font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)] focus:text-[var(--text-ivory)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeQuote(idx)}
                      aria-label="Remove quote"
                      className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  placeholder="Add personal quote..."
                  className="flex-1 min-w-[240px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-reading text-[0.96rem] text-[var(--text-ivory)] focus:outline-none"
                />
                <input
                  type="text"
                  value={quoteAuthor}
                  onChange={(e) => setQuoteAuthor(e.target.value)}
                  placeholder="Author"
                  className="w-[170px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-reading text-[0.96rem] text-[var(--text-ivory)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addQuote}
                  className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Quote
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ==================== TAB 2: INTEGRATIONS & AUTOMATIONS ==================== */}
        {activeTab === "integrations" && (
          <div className="space-y-6" data-testid="integrations-hub-panel">
            {/* 1. HOME ASSISTANT ROOM LIGHTING */}
            <section
              className="smoked-glass rounded-[8px] p-6 space-y-5"
              data-testid="ha-rest-settings-section"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(226,180,109,0.12)] pb-4">
                <div className="flex items-center gap-3">
                  <Lightbulb className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-editorial text-[1.28rem] text-[var(--text-ivory)]">
                        Home Assistant Lighting
                      </span>
                      <StatusBadge state={haState} testId="badge-ha-status" />
                    </div>
                    <p className="font-reading text-[0.88rem] text-[var(--text-muted)]">
                      Control {draft.haEntityId || "your room lighting"} directly from Athenaeum during focus and reading sessions.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.haAutoLight}
                      onChange={(e) => setDraft({ ...draft, haAutoLight: e.target.checked })}
                      className="h-4 w-4 accent-[#E2B46D] cursor-pointer"
                    />
                    <span className="font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)]">
                      Auto-Light
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={haPinging}
                    onClick={() => void handleTestLightPing()}
                    data-testid="ha-test-light-ping-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] border-[rgba(226,180,109,0.4)] disabled:opacity-50"
                  >
                    {haPinging ? "Pinging..." : "Test Light Ping"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Home Assistant Base URL
                  </span>
                  <input
                    type="url"
                    value={draft.haBaseUrl}
                    onChange={(e) => setDraft({ ...draft, haBaseUrl: e.target.value })}
                    data-testid="ha-base-url-input"
                    placeholder="http://homeassistant.local:8123"
                    className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-ui text-[0.82rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Light Entity ID
                  </span>
                  <input
                    type="text"
                    value={draft.haEntityId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        haEntityId: e.target.value,
                        haReadingLightEntity: e.target.value,
                      })
                    }
                    data-testid="ha-entity-id-input"
                    placeholder="light.desk_lamp"
                    className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-ui text-[0.82rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-ui text-[0.66rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Long-Lived Access Token
                  </span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type={showHaToken ? "text" : "password"}
                      value={draft.haToken}
                      onChange={(e) => setDraft({ ...draft, haToken: e.target.value })}
                      data-testid="ha-token-input"
                      placeholder="eyJ... (stored locally only)"
                      className="flex-1 rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2 font-ui text-[0.82rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHaToken((v) => !v)}
                      aria-label={showHaToken ? "Hide HA token" : "Reveal HA token"}
                      className="cursor-pointer rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-2 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                    >
                      {showHaToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
              </div>

              {/* Three Lighting Presets: Focus, Non-Focus, Reading (Full 0-100% Brightness + Optional HA Scenes) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-3">
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--accent-luminous)]">
                    Focus Preset ({draft.haFocusPreset.name})
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={rgbToHex(draft.haFocusPreset.rgbColor)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haFocusPreset: {
                            ...draft.haFocusPreset,
                            mode: "rgb",
                            rgbColor: hexToRgb(e.target.value),
                          },
                        })
                      }
                      className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span className="font-ui tabular-nums text-[0.7rem] text-[var(--text-ivory)]">
                      RGB [{draft.haFocusPreset.rgbColor.join(", ")}]
                    </span>
                  </div>
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Brightness ({draft.haFocusPreset.brightnessPct}%)
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.max(0, Math.min(100, draft.haFocusPreset.brightnessPct))}
                      data-testid="ha-focus-brightness-slider"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haFocusPreset: {
                            ...draft.haFocusPreset,
                            brightnessPct: Math.max(0, Math.min(100, Number(e.target.value))),
                          },
                        })
                      }
                      className="mt-1 h-[3px] w-full cursor-pointer accent-[#E2B46D]"
                    />
                  </label>
                  <div className="pt-2 border-t border-[rgba(226,180,109,0.1)] space-y-1.5">
                    <span className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Scene Entity ID (Optional)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={draft.haFocusPreset.sceneEntityId ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            haFocusPreset: {
                              ...draft.haFocusPreset,
                              sceneEntityId: e.target.value,
                            },
                          })
                        }
                        data-testid="ha-focus-scene-input"
                        placeholder="scene.deep_focus"
                        className="flex-1 min-w-0 rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,22,0.75)] px-2.5 py-1.5 font-ui text-[0.74rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#E2B46D] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={haPinging}
                        onClick={() =>
                          void handleTestScene(draft.haFocusPreset.sceneEntityId ?? "", "Focus Scene")
                        }
                        data-testid="ha-focus-test-scene-btn"
                        className="shrink-0 cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[rgba(226,180,109,0.1)] px-2.5 py-1.5 font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.2)] disabled:opacity-45"
                      >
                        Test Scene
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-3">
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                    Non-Focus Preset ({draft.haNonFocusPreset.name})
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Kelvin
                    </span>
                    <input
                      type="number"
                      min={2000}
                      max={6500}
                      step={100}
                      value={draft.haNonFocusPreset.kelvin}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haNonFocusPreset: {
                            ...draft.haNonFocusPreset,
                            mode: "kelvin",
                            kelvin: Math.max(2000, Math.min(6500, Number(e.target.value) || 2700)),
                          },
                        })
                      }
                      className="w-[88px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-2 py-1 font-ui tabular-nums text-[0.76rem] text-[var(--text-ivory)]"
                    />
                  </div>
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Brightness ({draft.haNonFocusPreset.brightnessPct}%)
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.max(0, Math.min(100, draft.haNonFocusPreset.brightnessPct))}
                      data-testid="ha-nonfocus-brightness-slider"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haNonFocusPreset: {
                            ...draft.haNonFocusPreset,
                            brightnessPct: Math.max(0, Math.min(100, Number(e.target.value))),
                          },
                        })
                      }
                      className="mt-1 h-[3px] w-full cursor-pointer accent-[#E2B46D]"
                    />
                  </label>
                  <div className="pt-2 border-t border-[rgba(226,180,109,0.1)] space-y-1.5">
                    <span className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Scene Entity ID (Optional)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={draft.haNonFocusPreset.sceneEntityId ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            haNonFocusPreset: {
                              ...draft.haNonFocusPreset,
                              sceneEntityId: e.target.value,
                            },
                          })
                        }
                        data-testid="ha-nonfocus-scene-input"
                        placeholder="scene.evening_relax"
                        className="flex-1 min-w-0 rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,22,0.75)] px-2.5 py-1.5 font-ui text-[0.74rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#E2B46D] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={haPinging}
                        onClick={() =>
                          void handleTestScene(draft.haNonFocusPreset.sceneEntityId ?? "", "Non-Focus Scene")
                        }
                        data-testid="ha-nonfocus-test-scene-btn"
                        className="shrink-0 cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[rgba(226,180,109,0.1)] px-2.5 py-1.5 font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.2)] disabled:opacity-45"
                      >
                        Test Scene
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 space-y-3">
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--accent-luminous)]">
                    Reading Light Preset ({draft.haReadingPreset.name})
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Kelvin
                    </span>
                    <input
                      type="number"
                      min={2000}
                      max={6500}
                      step={100}
                      value={draft.haReadingPreset.kelvin}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haReadingPreset: {
                            ...draft.haReadingPreset,
                            mode: "kelvin",
                            kelvin: Math.max(2000, Math.min(6500, Number(e.target.value) || 2700)),
                          },
                        })
                      }
                      className="w-[88px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-2 py-1 font-ui tabular-nums text-[0.76rem] text-[var(--text-ivory)]"
                    />
                  </div>
                  <label className="block">
                    <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Brightness ({draft.haReadingPreset.brightnessPct}%)
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.max(0, Math.min(100, draft.haReadingPreset.brightnessPct))}
                      data-testid="ha-reading-brightness-slider"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          haReadingPreset: {
                            ...draft.haReadingPreset,
                            brightnessPct: Math.max(0, Math.min(100, Number(e.target.value))),
                          },
                        })
                      }
                      className="mt-1 h-[3px] w-full cursor-pointer accent-[#E2B46D]"
                    />
                  </label>
                  <div className="pt-2 border-t border-[rgba(226,180,109,0.1)] space-y-1.5">
                    <span className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      Scene Entity ID (Optional)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={draft.haReadingPreset.sceneEntityId ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            haReadingPreset: {
                              ...draft.haReadingPreset,
                              sceneEntityId: e.target.value,
                            },
                          })
                        }
                        data-testid="ha-reading-scene-input"
                        placeholder="scene.evening_reading"
                        className="flex-1 min-w-0 rounded-[4px] border border-[var(--glass-border)] bg-[rgba(10,14,22,0.75)] px-2.5 py-1.5 font-ui text-[0.74rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#E2B46D] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={haPinging}
                        onClick={() =>
                          void handleTestScene(draft.haReadingPreset.sceneEntityId ?? "", "Reading Scene")
                        }
                        data-testid="ha-reading-test-scene-btn"
                        className="shrink-0 cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[rgba(226,180,109,0.1)] px-2.5 py-1.5 font-ui text-[0.56rem] uppercase tracking-[0.12em] text-[#E2B46D] hover:bg-[rgba(226,180,109,0.2)] disabled:opacity-45"
                      >
                        Test Scene
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {haPingStatus && (
                <div
                  data-testid="ha-test-light-status"
                  className="font-ui text-[0.68rem] tracking-[0.06em] text-[var(--accent-luminous)]"
                >
                  {haPingStatus}
                </div>
              )}
            </section>

            {/* 2. n8n & AI AGENT BRIDGE (Simplified Plain-English Card with Collapsible Advanced Details) */}
            <section
              className="smoked-glass rounded-[8px] p-6 space-y-4"
              data-testid="n8n-ingest-settings-section"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Shield className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-editorial text-[1.28rem] text-[var(--text-ivory)]">
                        n8n &amp; AI Agent Bridge
                      </span>
                      <StatusBadge state={n8nState} testId="badge-n8n-status" />
                    </div>
                    <p className="font-reading text-[0.88rem] text-[var(--text-muted)]">
                      Send completed goals or debriefs to your own automations, and let external tools add tasks or notes into Athenaeum.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvancedBridge((v) => !v)}
                  data-testid="n8n-advanced-toggle"
                  aria-expanded={showAdvancedBridge}
                  className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)]"
                >
                  {showAdvancedBridge ? "Hide Advanced Setup" : "Advanced Setup"}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      showAdvancedBridge ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>

              {showAdvancedBridge && (
                <div
                  data-testid="n8n-advanced-panel"
                  className="grid grid-cols-1 gap-5 border-t border-[rgba(226,180,109,0.12)] pt-5 lg:grid-cols-2"
                >
                  {/* Outbound Webhook */}
                  <div className="space-y-3.5">
                    <div className="font-ui text-[0.62rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                      Outbound Webhook
                    </div>
                    <label className="block">
                      <span className="font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Webhook URL
                      </span>
                      <input
                        type="url"
                        value={draft.n8nWebhookUrl}
                        onChange={(e) => setDraft({ ...draft, n8nWebhookUrl: e.target.value })}
                        data-testid="n8n-webhook-url-input"
                        placeholder="http://localhost:5678/webhook/athenaeum"
                        className="mt-1.5 w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                      />
                    </label>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.n8nTriggerDailyDebrief}
                          onChange={(e) =>
                            setDraft({ ...draft, n8nTriggerDailyDebrief: e.target.checked })
                          }
                          className="h-3.5 w-3.5 accent-[#E2B46D] cursor-pointer"
                        />
                        <span className="font-ui text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-ivory-soft)]">
                          Daily Debrief
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.n8nTriggerGoalCompleted}
                          onChange={(e) =>
                            setDraft({ ...draft, n8nTriggerGoalCompleted: e.target.checked })
                          }
                          className="h-3.5 w-3.5 accent-[#E2B46D] cursor-pointer"
                        />
                        <span className="font-ui text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-ivory-soft)]">
                          Goal Completed
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={n8nTesting}
                        onClick={() => void handleTestN8nWebhook()}
                        data-testid="n8n-test-webhook-btn"
                        className="ml-auto cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.4)] bg-[rgba(226,180,109,0.12)] px-3 py-1 flex items-center gap-1.5 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] disabled:opacity-50"
                      >
                        <Send className="h-3 w-3 text-[#E2B46D]" />
                        {n8nTesting ? "Sending..." : "Test Webhook"}
                      </button>
                    </div>
                    {n8nTestStatus && (
                      <div
                        data-testid="n8n-test-webhook-status"
                        className="font-ui text-[0.66rem] text-[var(--accent-luminous)]"
                      >
                        {n8nTestStatus}
                      </div>
                    )}
                  </div>

                  {/* Local Inbound Listener & Bearer Token */}
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-ui text-[0.62rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                        Local Ingest Listener
                      </span>
                      <span
                        data-testid="ingest-bind-status"
                        className="font-ui tabular-nums text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]"
                      >
                        {draft.ingestEnabled ? endpointUrl : "Paused"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.ingestEnabled}
                          onChange={(e) => setDraft({ ...draft, ingestEnabled: e.target.checked })}
                          className="h-3.5 w-3.5 accent-[#E2B46D] cursor-pointer"
                        />
                        <span className="font-ui text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-ivory-soft)]">
                          Enable Listener
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.ingestBindLan}
                          onChange={(e) => setDraft({ ...draft, ingestBindLan: e.target.checked })}
                          data-testid="ingest-lan-toggle"
                          className="h-3.5 w-3.5 accent-[#E2B46D] cursor-pointer"
                        />
                        <span className="font-ui text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-ivory-soft)]">
                          Allow Local Network
                        </span>
                      </label>
                    </div>

                    <div>
                      <span className="font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Bearer Token
                      </span>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input
                          type={showIngestToken ? "text" : "password"}
                          readOnly
                          value={draft.ingestApiToken}
                          data-testid="ingest-token-input"
                          className="flex-1 min-w-[160px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowIngestToken((v) => !v)}
                          aria-label="Reveal ingest token"
                          className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                        >
                          {showIngestToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyText(draft.ingestApiToken, "Copied token")}
                          data-testid="copy-ingest-token-btn"
                          className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.4)] bg-[rgba(226,180,109,0.12)] px-2.5 py-1 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-ivory)]"
                        >
                          <Copy className="h-3 w-3" />
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRegenerateToken()}
                          data-testid="regenerate-ingest-token-btn"
                          className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-transparent px-2.5 py-1 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Reset
                        </button>
                      </div>
                      {copiedNotice && (
                        <div
                          data-testid="ingest-copied-notice"
                          className="mt-1.5 flex items-center gap-1.5 font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--accent-luminous)]"
                        >
                          <Check className="h-3 w-3" />
                          {copiedNotice}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Opt-In External Database / Sync URL */}
                  <div className="lg:col-span-2 border-t border-[rgba(226,180,109,0.12)] pt-4 space-y-2">
                    <div className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                      <Database className="h-3.5 w-3.5" />
                      Optional External Database / Sync URL
                    </div>
                    <input
                      type="text"
                      value={draft.externalDbUrl}
                      onChange={(e) => setDraft({ ...draft, externalDbUrl: e.target.value })}
                      data-testid="external-db-url-input"
                      placeholder="Leave blank to use built-in local SQLite (recommended)"
                      className="w-full rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.8rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                    <p className="font-reading text-[0.8rem] text-[var(--text-muted)]">
                      Athenaeum stores all data locally in an automatic SQLite database out of the box. Only enter a connection URL if you maintain an external sync endpoint.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* 3. DESKTOP MUSIC PLAYER (SMTC) & 4. CALENDAR FEEDS (.ICS) */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Desktop Music Player SMTC */}
              <section
                className="lg:col-span-5 smoked-glass rounded-[8px] p-6 space-y-4 flex flex-col justify-between"
                data-testid="apple-music-settings-section"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 border-b border-[rgba(226,180,109,0.12)] pb-3">
                    <div className="flex items-center gap-2.5">
                      <Music className="h-4 w-4 text-[var(--accent-luminous)]" strokeWidth={1.6} />
                      <span className="font-editorial text-[1.22rem] text-[var(--text-ivory)]">
                        {draft.preferredMusicPlayer === "spotify"
                          ? "Spotify (SMTC)"
                          : draft.preferredMusicPlayer === "apple_music"
                          ? "Apple Music (SMTC)"
                          : "Desktop Media (SMTC)"}
                      </span>
                    </div>
                    <StatusBadge
                      state={appleMusicState}
                      label={mediaState?.active ? "Connected" : "Ready"}
                      testId="badge-apple-music-status"
                    />
                  </div>

                  <p className="font-reading text-[0.9rem] text-[var(--text-muted)]">
                    Syncs Windows media playback controls automatically alongside your saved focus playlists and built-in offline soundscapes.
                  </p>

                  <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-3.5">
                    <div className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Current Session
                    </div>
                    <div className="mt-1 font-editorial text-[1.02rem] text-[var(--text-ivory)] truncate">
                      {mediaState?.active
                        ? `${mediaState.title} · ${mediaState.artist || "Playing"}`
                        : "Waiting for desktop media playback"}
                    </div>
                    <div className="mt-0.5 font-ui text-[0.6rem] text-[var(--accent-luminous)]">
                      {(draft.playlists ?? []).length} saved playlist links
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  {draft.preferredMusicPlayer !== "none" && (
                    <button
                      type="button"
                      onClick={() =>
                        void storageService.launchMusicPlayer(draft.preferredMusicPlayer)
                      }
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory)]"
                    >
                      {draft.preferredMusicPlayer === "spotify"
                        ? "Open Spotify"
                        : "Open Apple Music"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenFocusStudio}
                    data-testid="settings-manage-playlists-btn"
                    className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.4)] bg-[rgba(226,180,109,0.12)] px-4 py-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[#e4c27c] hover:bg-[rgba(226,180,109,0.22)]"
                  >
                    Manage Playlists
                  </button>
                </div>
              </section>

              {/* Read-Only .ics Calendar Feeds */}
              <section
                className="lg:col-span-7 smoked-glass rounded-[8px] p-6 space-y-4"
                data-testid="ics-settings-section"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(226,180,109,0.12)] pb-3">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="h-4 w-4 text-[#E2B46D]" strokeWidth={1.6} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-editorial text-[1.22rem] text-[var(--text-ivory)]">
                          Calendar Feeds (.ics)
                        </span>
                        <StatusBadge
                          state={calendarState}
                          label={
                            (draft.calendarFeeds ?? []).length > 0
                              ? `Connected (${draft.calendarFeeds.length})`
                              : "Not Configured"
                          }
                          testId="badge-calendar-status"
                        />
                      </div>
                      <div
                        data-testid="ics-last-synced"
                        className="font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]"
                      >
                        {draft.calendarLastSyncedAt
                          ? `Last synced ${draft.calendarLastSyncedAt.slice(0, 10)} · ${formatIsoTimestamp(
                              draft.calendarLastSyncedAt,
                              draft.timeFormat
                            )}`
                          : "Read-only Google, Outlook, and Apple private .ics feeds"}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={icsSyncing}
                    onClick={() => void handleSyncFeeds()}
                    data-testid="sync-ics-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${icsSyncing ? "animate-spin" : ""}`} />
                    Sync Feeds Now
                  </button>
                </div>

                <div className="space-y-2">
                  {(draft.calendarFeeds ?? []).map((feed, idx) => (
                    <div
                      key={feed.id || `${feed.url}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#e4c27c]">
                          {feed.label || `Calendar ${idx + 1}`}
                        </div>
                        <div className="font-ui text-[0.74rem] text-[var(--text-ivory-soft)] truncate">
                          {feed.url}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) => {
                            const nextFeeds = (prev.calendarFeeds ?? []).filter((_, i) => i !== idx);
                            return {
                              ...prev,
                              calendarFeeds: nextFeeds,
                              calendarIcsUrls: nextFeeds.map((f) => f.url),
                            };
                          })
                        }
                        aria-label="Remove ICS feed"
                        className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {(draft.calendarFeeds ?? []).length === 0 && (
                    <div className="py-2 font-reading text-[0.9rem] text-[var(--text-muted)]">
                      No private .ics feeds configured yet. Add a labeled calendar URL below.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <input
                    type="text"
                    value={newFeedLabel}
                    onChange={(e) => setNewFeedLabel(e.target.value)}
                    data-testid="ics-label-input"
                    placeholder="Label (e.g. Work)"
                    className="w-[150px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.78rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={newIcsUrl}
                    onChange={(e) => setNewIcsUrl(e.target.value)}
                    data-testid="ics-url-input"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    className="flex-1 min-w-[200px] rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-2 font-ui text-[0.78rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cleanUrl = newIcsUrl.trim();
                      if (!cleanUrl) return;
                      const feed: CalendarFeedConfig = {
                        id: `cal-${Date.now()}`,
                        label:
                          newFeedLabel.trim() ||
                          `Calendar ${(draft.calendarFeeds ?? []).length + 1}`,
                        url: cleanUrl,
                      };
                      setDraft((prev) => {
                        const nextFeeds = [...(prev.calendarFeeds ?? []), feed];
                        return {
                          ...prev,
                          calendarFeeds: nextFeeds,
                          calendarIcsUrls: nextFeeds.map((f) => f.url),
                        };
                      });
                      setNewFeedLabel("");
                      setNewIcsUrl("");
                    }}
                    data-testid="add-ics-url-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Feed
                  </button>
                </div>

                {icsStatus && (
                  <div
                    data-testid="ics-sync-status"
                    className="font-ui text-[0.68rem] tracking-[0.06em] text-[var(--accent-luminous)]"
                  >
                    {icsStatus}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Quiet Centered Attribution Footer */}
        <footer
          data-testid="settings-attribution-footer"
          className="pt-4 text-center font-ui text-[0.64rem] tracking-[0.12em] text-[var(--text-muted)]/75"
        >
          Athenaeum v0.1.0 · Designed &amp; built by{" "}
          <a
            href="https://pablogonzalez.framer.website"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              void storageService.openExternalUrl("https://pablogonzalez.framer.website");
            }}
            className="text-[var(--text-ivory-soft)] hover:text-[#E2B46D] underline decoration-[rgba(226,180,109,0.35)] underline-offset-4 transition-colors"
          >
            Pablo Gonzalez
          </a>
        </footer>
      </form>
    </MiniAppShell>
  );
}
