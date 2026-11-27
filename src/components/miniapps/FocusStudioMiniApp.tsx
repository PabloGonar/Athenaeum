import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Disc3,
  ExternalLink,
  Lightbulb,
  Link2,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  X,
  Youtube,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { FocusRing } from "../FocusRing";
import {
  AMBIENT_SOUNDSCAPES,
  ambientAudio,
  type ActiveAmbientTexture,
  type AmbientTexture,
} from "../../services/ambientAudio";
import { storageService } from "../../services/storage";
import { getLogicalDate } from "../../utils/logicalDate";
import { formatIsoTimestamp, formatSecondsMMSS } from "../../utils/time";
import type {
  AthenaeumConfig,
  FocusSessionItem,
  GoalItem,
  GoalMilestone,
  HaLightCommand,
  MediaSessionState,
  PlaylistPlatform,
  PlaylistShortcut,
  TimeFormat,
} from "../../types/athenaeum";

interface FocusStudioMiniAppProps {
  config: AthenaeumConfig;
  isRunning: boolean;
  targetSeconds: number | null;
  elapsedSeconds: number;
  activeLabel: string;
  activeGoalId: string | null;
  goals: GoalItem[];
  milestones: GoalMilestone[];
  sessions: FocusSessionItem[];
  logicalToday: string;
  dayRolloverHour: number;
  timeFormat: TimeFormat;
  lightStatus: string | null;
  onTargetSecondsChange: (seconds: number | null) => void;
  onActiveTargetChange: (target: { label: string; goalId: string | null; category?: string }) => void;
  onStart: (targetSecondsOverride?: number | null) => void;
  onStopAndSave: (completedNaturally?: boolean) => void;
  onApplyLightCommand: (command: HaLightCommand, presetLabel?: string) => Promise<void>;
  onSaveConfig: (next: AthenaeumConfig) => Promise<void>;
  onOpenSettings: () => void;
  onClose: () => void;
}

interface LightSwatch {
  id: string;
  name: string;
  mode: "rgb" | "kelvin";
  rgbColor: [number, number, number];
  kelvin: number;
  previewHex: string;
}

const LIGHT_SWATCHES: LightSwatch[] = [
  {
    id: "lock_in",
    name: "Lock In",
    mode: "rgb",
    rgbColor: [128, 0, 255],
    kelvin: 2700,
    previewHex: "#8000ff",
  },
  {
    id: "warm_white",
    name: "Warm 2700K",
    mode: "kelvin",
    rgbColor: [255, 200, 140],
    kelvin: 2700,
    previewHex: "#f3c78d",
  },
  {
    id: "warm_amber",
    name: "Warm Amber",
    mode: "rgb",
    rgbColor: [255, 168, 76],
    kelvin: 2400,
    previewHex: "#ffa84c",
  },
  {
    id: "soft_sage",
    name: "Soft Sage",
    mode: "rgb",
    rgbColor: [130, 196, 165],
    kelvin: 4000,
    previewHex: "#82c4a5",
  },
  {
    id: "candlelight",
    name: "Candlelight",
    mode: "rgb",
    rgbColor: [255, 128, 56],
    kelvin: 2100,
    previewHex: "#ff8038",
  },
];

const PLATFORM_OPTIONS: {
  id: PlaylistPlatform;
  label: string;
  shortLabel: string;
  placeholder: string;
  badgeClass: string;
}[] = [
  {
    id: "apple_music",
    label: "Apple Music",
    shortLabel: "Apple Music",
    placeholder: "https://music.apple.com/... or music://...",
    badgeClass: "text-[#f2a6b3] border-[rgba(242,166,179,0.3)] bg-[rgba(242,166,179,0.08)]",
  },
  {
    id: "youtube",
    label: "YouTube",
    shortLabel: "YouTube",
    placeholder: "https://www.youtube.com/watch?v=... or https://youtu.be/...",
    badgeClass: "text-[#f09b8c] border-[rgba(240,155,140,0.3)] bg-[rgba(240,155,140,0.08)]",
  },
  {
    id: "spotify",
    label: "Spotify",
    shortLabel: "Spotify",
    placeholder: "https://open.spotify.com/... or spotify:playlist:...",
    badgeClass: "text-[#9cd4ae] border-[rgba(156,212,174,0.3)] bg-[rgba(156,212,174,0.08)]",
  },
];

function inferPlatform(pl: PlaylistShortcut): PlaylistPlatform {
  if (pl.platform === "apple_music" || pl.platform === "youtube" || pl.platform === "spotify") {
    return pl.platform;
  }
  const u = (pl.url || "").toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("spotify.com") || u.startsWith("spotify:")) return "spotify";
  return "apple_music";
}

function PlatformIcon({
  platform,
  className = "h-3 w-3",
}: {
  platform: PlaylistPlatform;
  className?: string;
}) {
  if (platform === "youtube") return <Youtube className={className} strokeWidth={1.6} />;
  if (platform === "spotify") return <Disc3 className={className} strokeWidth={1.6} />;
  return <Music className={className} strokeWidth={1.6} />;
}

function formatDurationHuman(totalSeconds: number): string {
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return [128, 0, 255];
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function formatSourceLabel(appId: string): string {
  const lower = appId.toLowerCase();
  if (lower.includes("applemusic") || lower.includes("appleinc") || lower.includes("itunes")) {
    return "Apple Music";
  }
  if (lower.includes("spotify")) return "Spotify";
  if (!appId) return "Windows Media";
  const cleaned = appId.split("!").pop() || appId;
  return cleaned.replace(/\.exe$/i, "");
}

interface StackedGoalRollup {
  key: string;
  label: string;
  goalId: string | null;
  category: string;
  totalSeconds: number;
  sessionCount: number;
  latestCompletedAt: string;
}

export function FocusStudioMiniApp({
  config,
  isRunning,
  targetSeconds,
  elapsedSeconds,
  activeLabel,
  activeGoalId,
  goals,
  milestones,
  sessions,
  logicalToday,
  dayRolloverHour,
  timeFormat,
  lightStatus,
  onTargetSecondsChange,
  onActiveTargetChange,
  onStart,
  onStopAndSave,
  onApplyLightCommand,
  onSaveConfig,
  onOpenSettings,
  onClose,
}: FocusStudioMiniAppProps) {
  // Lighting studio state (full 1-100% unlocked brightness)
  const [selectedSwatchId, setSelectedSwatchId] = useState<string>(
    isRunning ? "lock_in" : "warm_white"
  );
  const [customHex, setCustomHex] = useState<string>(() =>
    rgbToHex(config.haFocusPreset?.rgbColor ?? [128, 0, 255])
  );
  const [brightnessPct, setBrightnessPct] = useState<number>(() =>
    Math.max(0, Math.min(100, typeof config.haFocusPreset?.brightnessPct === "number" ? config.haFocusPreset.brightnessPct : 45))
  );
  const [lightBusy, setLightBusy] = useState(false);

  // Stacked rollup / raw ledger toggle
  const [showRawLedger, setShowRawLedger] = useState(false);

  // Media SMTC state
  const [media, setMedia] = useState<MediaSessionState>({
    active: false,
    title: "",
    artist: "",
    album: "",
    sourceApp: "",
    isPlaying: false,
    isShuffle: false,
    repeatMode: "none",
    positionSeconds: 0,
    durationSeconds: 0,
  });
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  // Ambient soundscape state (synced with ambientAudio singleton)
  const [ambientTexture, setAmbientTexture] = useState<AmbientTexture>(() =>
    ambientAudio.getTexture()
  );
  const [ambientVolume, setAmbientVolume] = useState<number>(() =>
    ambientAudio.getVolume()
  );

  // Playlist editor state (supports adding new OR editing/linking any existing tile)
  const [playlistFormOpen, setPlaylistFormOpen] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [plTitle, setPlTitle] = useState("");
  const [plPlatform, setPlPlatform] = useState<PlaylistPlatform>("apple_music");
  const [plUrl, setPlUrl] = useState("");
  const [playlistStatus, setPlaylistStatus] = useState<string | null>(null);

  useEffect(() => {
    return ambientAudio.subscribe(() => {
      setAmbientTexture(ambientAudio.getTexture());
      setAmbientVolume(ambientAudio.getVolume());
    });
  }, []);

  const pollMedia = useCallback(async () => {
    const state = await storageService.getMediaState();
    setMedia(state);
  }, []);

  useEffect(() => {
    void pollMedia();
    const id = window.setInterval(() => {
      void pollMedia();
    }, 2500);
    return () => window.clearInterval(id);
  }, [pollMedia]);

  useEffect(() => {
    if (!media.active || !media.isPlaying || media.durationSeconds <= 0) return;
    const tick = window.setInterval(() => {
      setMedia((prev) =>
        prev.active && prev.isPlaying
          ? {
              ...prev,
              positionSeconds: Math.min(prev.durationSeconds, prev.positionSeconds + 1),
            }
          : prev
      );
    }, 1000);
    return () => window.clearInterval(tick);
  }, [media.active, media.isPlaying, media.durationSeconds]);

  // Aggregate today's focus sessions by linked goal (or normalized label) for the current logical day
  const { todayRollups, todayTotalSeconds, todaySessionCount } = useMemo(() => {
    const byKey = new Map<string, StackedGoalRollup>();
    let sumSecs = 0;
    let count = 0;

    for (const s of sessions) {
      const sessionLogicalDate = getLogicalDate(new Date(s.completedAt), dayRolloverHour);
      if (sessionLogicalDate !== logicalToday) continue;

      sumSecs += Math.max(0, s.elapsedSeconds);
      count += 1;

      const cleanLabel = (s.label || "General Focus").trim() || "General Focus";
      const key = s.goalId
        ? `goal:${s.goalId}`
        : `label:${cleanLabel.toLowerCase()}`;

      const existing = byKey.get(key);
      if (existing) {
        existing.totalSeconds += Math.max(0, s.elapsedSeconds);
        existing.sessionCount += 1;
        if (s.completedAt > existing.latestCompletedAt) {
          existing.latestCompletedAt = s.completedAt;
        }
      } else {
        byKey.set(key, {
          key,
          label: cleanLabel,
          goalId: s.goalId ?? null,
          category: s.category || "deep_work",
          totalSeconds: Math.max(0, s.elapsedSeconds),
          sessionCount: 1,
          latestCompletedAt: s.completedAt,
        });
      }
    }

    const rollups = Array.from(byKey.values()).sort(
      (a, b) =>
        b.totalSeconds - a.totalSeconds ||
        b.latestCompletedAt.localeCompare(a.latestCompletedAt)
    );
    return {
      todayRollups: rollups,
      todayTotalSeconds: sumSecs,
      todaySessionCount: count,
    };
  }, [sessions, logicalToday, dayRolloverHour]);

  const targetTotalSeconds = Math.max(60, (config.dailyFocusTargetMinutes || 240) * 60);
  const dailyPct = Math.min(100, Math.round((todayTotalSeconds / targetTotalSeconds) * 100));

  const applySwatch = async (swatch: LightSwatch, overrideBrightness?: number) => {
    const pct = Math.max(0, Math.min(100, overrideBrightness ?? brightnessPct));
    setSelectedSwatchId(swatch.id);
    if (swatch.mode === "rgb") {
      setCustomHex(swatch.previewHex);
    }
    setLightBusy(true);
    try {
      await onApplyLightCommand(
        {
          mode: swatch.mode,
          rgbColor: swatch.rgbColor,
          kelvin: swatch.kelvin,
          brightnessPct: pct,
          entityId: config.haEntityId || "",
        },
        swatch.name
      );
    } finally {
      setLightBusy(false);
    }
  };

  const applyCustomRgb = async (hex: string, overrideBrightness?: number) => {
    const rgb = hexToRgb(hex);
    const pct = Math.max(0, Math.min(100, overrideBrightness ?? brightnessPct));
    setCustomHex(hex);
    setSelectedSwatchId("custom");
    setLightBusy(true);
    try {
      await onApplyLightCommand(
        {
          mode: "rgb",
          rgbColor: rgb,
          brightnessPct: pct,
          entityId: config.haEntityId || "",
        },
        `Custom ${hex.toUpperCase()}`
      );
    } finally {
      setLightBusy(false);
    }
  };

  const commitBrightness = async (nextPct: number) => {
    const clamped = Math.max(0, Math.min(100, nextPct));
    setBrightnessPct(clamped);
    const activeSwatch = LIGHT_SWATCHES.find((s) => s.id === selectedSwatchId);
    if (activeSwatch) {
      await applySwatch(activeSwatch, clamped);
    } else {
      await applyCustomRgb(customHex, clamped);
    }
  };

  const applyScenePreset = async (sceneEntityId: string, label: string) => {
    const clean = sceneEntityId.trim();
    if (!clean) return;
    setSelectedSwatchId(`scene:${clean}`);
    setLightBusy(true);
    try {
      await onApplyLightCommand(
        {
          mode: "scene",
          brightnessPct: 100,
          sceneEntityId: clean,
        },
        label
      );
    } finally {
      setLightBusy(false);
    }
  };

  const handleToggleAutoLight = async () => {
    await onSaveConfig({
      ...config,
      haAutoLight: !config.haAutoLight,
    });
  };

  const handleMediaAction = async (
    action: "previous" | "play_pause" | "next" | "toggle_shuffle" | "cycle_repeat" | `seek:${number}`
  ) => {
    await storageService.sendMediaControl(action);
    const labels: Record<string, string> = {
      previous: "Previous track",
      play_pause: media.isPlaying ? "Paused" : "Play / Pause",
      next: "Next track",
      toggle_shuffle: "Toggled shuffle",
      cycle_repeat: "Cycled loop mode",
    };
    const msg = action.startsWith("seek:") ? "Updated timeline position" : labels[action] || action;
    setMediaNotice(msg);
    window.setTimeout(() => setMediaNotice((p) => (p === msg ? null : p)), 2200);
    window.setTimeout(() => void pollMedia(), 320);
  };

  const openAddPlaylistForm = () => {
    setEditingPlaylistId(null);
    setPlTitle("");
    setPlPlatform("apple_music");
    setPlUrl("");
    setPlaylistFormOpen(true);
  };

  const openEditPlaylistForm = (pl: PlaylistShortcut) => {
    setEditingPlaylistId(pl.id);
    setPlTitle(pl.title);
    setPlPlatform(inferPlatform(pl));
    setPlUrl(pl.url || "");
    setPlaylistFormOpen(true);
  };

  const closePlaylistForm = () => {
    setPlaylistFormOpen(false);
    setEditingPlaylistId(null);
    setPlTitle("");
    setPlUrl("");
  };

  const handleLaunchPlaylist = async (pl: PlaylistShortcut) => {
    const cleanUrl = (pl.url || "").trim();
    if (!cleanUrl) {
      openEditPlaylistForm(pl);
      setPlaylistStatus(`Paste a URL to link "${pl.title}"`);
      window.setTimeout(() => setPlaylistStatus(null), 2800);
      return;
    }
    try {
      await storageService.openExternalUrl(cleanUrl);
      setPlaylistStatus(`Opened ${pl.title}`);
      window.setTimeout(() => setPlaylistStatus(null), 2600);
    } catch (err) {
      setPlaylistStatus(err instanceof Error ? err.message : "Could not open URL");
      window.setTimeout(() => setPlaylistStatus(null), 3200);
    }
  };

  const handleSavePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = plTitle.trim();
    const cleanUrl = plUrl.trim();
    if (!cleanTitle || !cleanUrl) return;

    const platformMeta = PLATFORM_OPTIONS.find((p) => p.id === plPlatform);
    const existingList = config.playlists ?? [];

    let nextList: PlaylistShortcut[];
    if (editingPlaylistId) {
      nextList = existingList.map((item) =>
        item.id === editingPlaylistId
          ? {
              ...item,
              title: cleanTitle,
              subtitle: platformMeta?.shortLabel ?? item.subtitle,
              url: cleanUrl,
              platform: plPlatform,
            }
          : item
      );
    } else {
      const nextItem: PlaylistShortcut = {
        id: `pl-${Date.now()}`,
        title: cleanTitle,
        subtitle: platformMeta?.shortLabel ?? "Playlist",
        url: cleanUrl,
        platform: plPlatform,
      };
      nextList = [...existingList, nextItem];
    }

    await onSaveConfig({
      ...config,
      playlists: nextList,
    });
    closePlaylistForm();
    setPlaylistStatus(editingPlaylistId ? `Updated "${cleanTitle}"` : `Saved "${cleanTitle}"`);
    window.setTimeout(() => setPlaylistStatus(null), 2600);
  };

  const handleRemovePlaylist = async (id: string) => {
    const next = (config.playlists ?? []).filter((p) => p.id !== id);
    await onSaveConfig({ ...config, playlists: next });
    if (editingPlaylistId === id) {
      closePlaylistForm();
    }
  };

  const handleToggleTexture = (target: ActiveAmbientTexture) => {
    ambientAudio.setVolume(ambientVolume);
    const next = ambientAudio.toggleTexture(target);
    setAmbientTexture(next);
  };

  const handleAmbientVolume = (nextVol: number) => {
    setAmbientVolume(nextVol);
    ambientAudio.setVolume(nextVol);
  };

  const progressPct =
    media.durationSeconds > 0
      ? Math.min(100, (media.positionSeconds / media.durationSeconds) * 100)
      : 0;

  const activePlatformMeta =
    PLATFORM_OPTIONS.find((p) => p.id === plPlatform) ?? PLATFORM_OPTIONS[0];

  return (
    <MiniAppShell
      roomId="focus"
      title="Focus & Atmosphere Studio"
      lockScroll
      wide
      onClose={onClose}
    >
      <div
        data-testid="focus-studio-miniapp"
        className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:flex-1 lg:min-h-0 lg:h-full items-start"
      >
        {/* ==================== COLUMN 1 (LEFT): SESSION ENGINE + ATMOSPHERE & PLAYLISTS ==================== */}
        <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full lg:min-h-0">
          {/* 1A. SESSION ENGINE */}
          <section
            data-testid="focus-session-card"
            className="smoked-glass rounded-[14px] p-5 flex flex-col items-center shrink-0"
          >
            <div className="w-full flex items-center justify-between border-b border-[rgba(214,224,212,0.08)] pb-2.5 mb-3.5">
              <span className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                Session Engine
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => ambientAudio.playCompletionChime()}
                  data-testid="focus-studio-test-chime"
                  title="Preview resonant completion chime"
                  className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-transparent px-2.5 py-0.5 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-ivory)] hover:border-[rgba(194,168,120,0.45)] transition-colors"
                >
                  <Bell className="h-2.5 w-2.5 text-[var(--accent-brass)]" />
                  Chime
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleAutoLight()}
                  data-testid="focus-auto-light-toggle"
                  aria-pressed={config.haAutoLight}
                  title="Automatically switch room light when focus starts and finishes"
                  className={`cursor-pointer rounded-[3px] border px-2.5 py-0.5 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] transition-colors ${
                    config.haAutoLight
                      ? "border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.14)] text-[var(--text-ivory)]"
                      : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                  }`}
                >
                  <Lightbulb className="h-2.5 w-2.5" />
                  Auto-Light {config.haAutoLight ? "On" : "Off"}
                </button>
              </div>
            </div>

            <FocusRing
              isRunning={isRunning}
              targetSeconds={targetSeconds}
              elapsedSeconds={elapsedSeconds}
              activeLabel={activeLabel}
              activeGoalId={activeGoalId}
              goals={goals}
              milestones={milestones}
              webhookStatus={null}
              onTargetSecondsChange={onTargetSecondsChange}
              onActiveTargetChange={onActiveTargetChange}
              onStart={onStart}
              onStopAndSave={onStopAndSave}
            />
          </section>

          {/* 1B. ATMOSPHERE & PLAYLISTS */}
          <section
            data-testid="studio-playlists-panel"
            className="smoked-glass rounded-[14px] p-5 flex flex-col gap-3 lg:flex-1 lg:min-h-0 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                Atmosphere &amp; Playlists
              </div>
              <button
                type="button"
                onClick={() =>
                  playlistFormOpen ? closePlaylistForm() : openAddPlaylistForm()
                }
                data-testid="add-playlist-toggle"
                className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
              >
                {playlistFormOpen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {playlistFormOpen ? "Cancel" : "Add Playlist Link"}
              </button>
            </div>

            {playlistFormOpen && (
              <form
                onSubmit={(e) => void handleSavePlaylist(e)}
                data-testid="add-playlist-form"
                className="shrink-0 rounded-[10px] border border-[rgba(226,180,109,0.28)] bg-[var(--surface-inner)] p-3 space-y-2.5"
              >
                <input
                  type="text"
                  value={plTitle}
                  onChange={(e) => setPlTitle(e.target.value)}
                  placeholder="Title (e.g. Lo-Fi Beats, Jazz, Salsa)"
                  data-testid="playlist-title-input"
                  className="w-full rounded-md border border-[var(--glass-border)] bg-[var(--surface-input)] px-2.5 py-1.5 font-reading text-[0.88rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:border-[#E2B46D] focus:outline-none"
                />

                {/* Platform Selector: Apple Music | YouTube | Spotify */}
                <div className="grid grid-cols-3 gap-1.5" data-testid="playlist-platform-picker">
                  {PLATFORM_OPTIONS.map((opt) => {
                    const selected = plPlatform === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPlPlatform(opt.id)}
                        data-testid={`playlist-platform-${opt.id}`}
                        aria-pressed={selected}
                        className={`cursor-pointer rounded-md border px-2 py-1 flex items-center justify-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.1em] transition-colors ${
                          selected
                            ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.16)] text-[#f4efe6]"
                            : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                        }`}
                      >
                        <PlatformIcon platform={opt.id} className="h-3 w-3 shrink-0" />
                        <span className="truncate">{opt.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={plUrl}
                    onChange={(e) => setPlUrl(e.target.value)}
                    placeholder={activePlatformMeta.placeholder}
                    data-testid="playlist-url-input"
                    className="flex-1 min-w-0 rounded-md border border-[var(--glass-border)] bg-[var(--surface-input)] px-2.5 py-1.5 font-ui text-[0.72rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/55 focus:border-[#E2B46D] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!plTitle.trim() || !plUrl.trim()}
                    data-testid="playlist-save-btn"
                    className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.5)] bg-[rgba(226,180,109,0.18)] px-3.5 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#f4efe6] hover:bg-[rgba(226,180,109,0.3)] disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {/* Playlist Cards Grid */}
            <div
              className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5 flex-1 min-h-0 content-start"
              data-testid="playlist-cards-grid"
            >
              {(config.playlists ?? []).map((pl) => {
                const platform = inferPlatform(pl);
                const pMeta =
                  PLATFORM_OPTIONS.find((p) => p.id === platform) ?? PLATFORM_OPTIONS[0];
                const hasUrl = Boolean(pl.url?.trim());

                return (
                  <div
                    key={pl.id}
                    data-testid={`playlist-tile-${pl.id}`}
                    data-platform={platform}
                    className="group relative rounded-[9px] border border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(226,180,109,0.45)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => void handleLaunchPlaylist(pl)}
                      data-testid={`playlist-card-${pl.id}`}
                      className="w-full cursor-pointer bg-transparent border-0 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-editorial text-[0.98rem] leading-snug text-[var(--text-ivory)] truncate pr-2 group-hover:pr-10 group-focus-within:pr-10 transition-[padding]">
                          {pl.title}
                        </span>
                        <span className="shrink-0 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                          {hasUrl ? (
                            <ExternalLink className="h-3 w-3 text-[#E2B46D]/80 opacity-75" />
                          ) : (
                            <Link2 className="h-3 w-3 text-[var(--text-muted)]/60" />
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-ui text-[0.52rem] uppercase tracking-[0.08em] ${pMeta.badgeClass}`}
                        >
                          <PlatformIcon platform={platform} className="h-2.5 w-2.5" />
                          {pMeta.shortLabel}
                        </span>
                        {!hasUrl && (
                          <span className="font-ui text-[0.52rem] uppercase tracking-[0.08em] text-[var(--text-muted)]/75">
                            Attach URL
                          </span>
                        )}
                      </div>
                    </button>

                    <div
                      data-testid={`playlist-actions-${pl.id}`}
                      className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditPlaylistForm(pl);
                        }}
                        aria-label={`Edit ${pl.title}`}
                        className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[#E2B46D]"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRemovePlaylist(pl.id);
                        }}
                        aria-label={`Remove ${pl.title}`}
                        className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {(config.playlists ?? []).length === 0 && (
                <div className="col-span-2 py-6 text-center font-reading text-[0.88rem] text-[var(--text-muted)]">
                  No playlists pinned yet. Click &ldquo;Add Playlist Link&rdquo; above to save your favorite focus streams.
                </div>
              )}
            </div>

            {playlistStatus && (
              <div
                data-testid="playlist-launch-status"
                className="shrink-0 font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[#E2B46D] truncate"
              >
                {playlistStatus}
              </div>
            )}
          </section>
        </div>

        {/* ==================== COLUMN 2 (MIDDLE): TODAY'S FOCUS ROLLUP + AMBIENT SOUNDSCAPES ==================== */}
        <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full lg:min-h-0">
          {/* 2A. TODAY'S FOCUS ROLLUP */}
          <section
            data-testid="focus-rollup-panel"
            className="smoked-glass rounded-[14px] p-5 flex flex-col gap-3.5 lg:flex-1 lg:min-h-0 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[rgba(214,224,212,0.08)] pb-3 shrink-0">
              <div>
                <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                  Today&apos;s Focus Rollup
                </div>
                <div className="mt-1 font-ui text-[0.62rem] tracking-[0.06em] text-[var(--text-muted)]">
                  Logical day {logicalToday}
                </div>
              </div>
              <div className="text-right">
                <div
                  data-testid="focus-rollup-total"
                  className="font-editorial tabular-nums text-[1.5rem] leading-none text-[var(--text-ivory)]"
                >
                  {todayTotalSeconds > 0 ? formatDurationHuman(todayTotalSeconds) : "0m"}
                </div>
                <div className="mt-0.5 font-ui tabular-nums text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)]">
                  {dailyPct}% of target · {todaySessionCount}{" "}
                  {todaySessionCount === 1 ? "session" : "sessions"}
                </div>
              </div>
            </div>

            {/* Daily Target Progress Hairline */}
            <div className="h-[2.5px] w-full shrink-0 rounded-full bg-[rgba(237,234,224,0.12)] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#5a8b77] to-[#c5a059] transition-all duration-700"
                style={{ width: `${dailyPct}%` }}
              />
            </div>

            {/* Stacked Goal Rows */}
            <div
              className="space-y-2.5 flex-1 min-h-0 overflow-y-auto pr-0.5"
              data-testid="focus-rollup-list"
            >
              {todayRollups.map((item) => {
                const sharePct =
                  todayTotalSeconds > 0
                    ? Math.max(8, Math.round((item.totalSeconds / todayTotalSeconds) * 100))
                    : 0;
                return (
                  <div
                    key={item.key}
                    data-testid="focus-rollup-row"
                    className="rounded-[10px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3.5 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-editorial text-[1.04rem] leading-snug text-[var(--text-ivory)] truncate">
                          {item.label}
                        </div>
                        <div className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} ·{" "}
                          {item.category.replace(/_/g, " ")}
                        </div>
                      </div>
                      <div className="font-editorial tabular-nums text-[1.12rem] text-[var(--accent-luminous)] shrink-0">
                        {formatDurationHuman(item.totalSeconds)}
                      </div>
                    </div>
                    <div className="h-[2px] w-full rounded-full bg-[rgba(237,234,224,0.1)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-luminous)]/80"
                        style={{ width: `${sharePct}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              {todayRollups.length === 0 && (
                <div
                  data-testid="focus-rollup-empty"
                  className="py-8 text-center font-reading text-[0.94rem] text-[var(--text-muted)]"
                >
                  No focus sessions logged today.
                </div>
              )}
            </div>

            {/* Collapsible Raw Session Ledger */}
            <div className="border-t border-[rgba(214,224,212,0.08)] pt-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowRawLedger((v) => !v)}
                data-testid="toggle-raw-sessions-btn"
                className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1.5 font-ui text-[0.6rem] uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                {showRawLedger ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Session History ({sessions.length})
              </button>

              {showRawLedger && (
                <div className="mt-2.5 max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                  {sessions.slice(0, 30).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 border-b border-[rgba(214,224,212,0.06)] pb-1"
                    >
                      <div className="min-w-0">
                        <div className="font-reading text-[0.86rem] text-[var(--text-ivory-soft)] truncate">
                          {s.label}
                        </div>
                        <div className="font-ui text-[0.54rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          {s.completedAt.slice(0, 10)} · {formatIsoTimestamp(s.completedAt, timeFormat)}
                        </div>
                      </div>
                      <span className="font-ui tabular-nums text-[0.66rem] text-[var(--accent-luminous)] shrink-0">
                        {formatDurationHuman(s.elapsedSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 2B. AMBIENT SOUNDSCAPES (2x3 Grid, Mutually Exclusive Toggle, ZERO Silence Button) */}
          <section
            data-testid="studio-ambient-panel"
            className="smoked-glass rounded-[14px] p-5 space-y-3 shrink-0"
          >
            <div className="flex items-center justify-between">
              <span className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)] flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.6} />
                Ambient Soundscapes
              </span>
              <span className="font-ui tabular-nums text-[0.62rem] text-[var(--text-muted)]">
                {ambientTexture === "off"
                  ? "Off"
                  : `${Math.round(ambientVolume * 100)}%`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2" data-testid="studio-ambient-grid">
              {AMBIENT_SOUNDSCAPES.map((tex) => {
                const active = ambientTexture === tex.id;
                return (
                  <button
                    key={tex.id}
                    type="button"
                    onClick={() => handleToggleTexture(tex.id)}
                    data-testid={`studio-ambient-${tex.id}`}
                    aria-pressed={active}
                    className={`cursor-pointer rounded-[9px] border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-[rgba(226,180,109,0.68)] bg-[rgba(226,180,109,0.16)] text-[var(--text-ivory)] shadow-[0_0_16px_rgba(226,180,109,0.12)]"
                        : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.36)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] truncate">
                        {tex.label}
                      </span>
                      {active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#E2B46D]" />
                      )}
                    </div>
                    <div className="mt-0.5 font-reading text-[0.76rem] text-[var(--text-muted)] truncate">
                      {tex.detail}
                    </div>
                  </button>
                );
              })}
            </div>

            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(ambientVolume * 100)}
              onChange={(e) => handleAmbientVolume(Number(e.target.value) / 100)}
              aria-label="Studio ambient soundscape volume"
              data-testid="studio-ambient-volume"
              className="h-[2.5px] w-full cursor-pointer appearance-none rounded-full bg-[rgba(237,234,224,0.2)] accent-[#E2B46D]"
            />
          </section>
        </div>

        {/* ==================== COLUMN 3 (RIGHT): ROOM LIGHTING + APPLE MUSIC TRANSPORT ==================== */}
        <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full lg:min-h-0">
          {/* 3A. DIRECT HOME ASSISTANT ROOM LIGHTING (UNLOCKED 1-100%) */}
          <section
            data-testid="ha-lighting-panel"
            className="smoked-glass rounded-[14px] p-5 space-y-4 shrink-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                  Room Lighting Control
                </div>
                <div className="mt-0.5 font-ui text-[0.62rem] tracking-[0.04em] text-[var(--text-muted)]">
                  {config.haEntityId || "Not configured in Settings"}
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:underline"
              >
                HA Settings
              </button>
            </div>

            {/* Interactive Color Swatches + Custom RGB Picker */}
            <div className="grid grid-cols-2 gap-2">
              {LIGHT_SWATCHES.map((swatch) => {
                const active = selectedSwatchId === swatch.id;
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    disabled={lightBusy}
                    data-testid={`ha-swatch-${swatch.id}`}
                    onClick={() => void applySwatch(swatch)}
                    className={`cursor-pointer rounded-[9px] border px-2.5 py-2 flex items-center gap-2 text-left transition-all ${
                      active
                        ? "border-[#C5A059]/75 bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                        : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(214,224,212,0.28)]"
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full shrink-0 border border-white/25"
                      style={{ backgroundColor: swatch.previewHex }}
                    />
                    <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] truncate">
                      {swatch.name}
                    </span>
                  </button>
                );
              })}

              {/* Custom RGB Color Picker Swatch */}
              <label
                data-testid="ha-swatch-custom"
                className={`cursor-pointer rounded-[9px] border px-2.5 py-2 flex items-center gap-2 transition-all ${
                  selectedSwatchId === "custom"
                    ? "border-[#C5A059]/75 bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                    : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(214,224,212,0.28)]"
                }`}
              >
                <input
                  type="color"
                  value={customHex}
                  onChange={(e) => void applyCustomRgb(e.target.value)}
                  aria-label="Pick custom RGB room light color"
                  className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
                />
                <span className="font-ui text-[0.6rem] uppercase tracking-[0.1em] truncate">
                  Custom RGB
                </span>
              </label>
            </div>

            {/* Configured Home Assistant Scene Triggers (if any preset defines a scene.*) */}
            {(config.haFocusPreset?.sceneEntityId?.trim() ||
              config.haNonFocusPreset?.sceneEntityId?.trim() ||
              config.haReadingPreset?.sceneEntityId?.trim()) && (
              <div className="flex flex-wrap gap-1.5" data-testid="ha-scene-quick-triggers">
                {[
                  {
                    label: "Focus Scene",
                    sceneId: config.haFocusPreset?.sceneEntityId?.trim() || "",
                  },
                  {
                    label: "Idle Scene",
                    sceneId: config.haNonFocusPreset?.sceneEntityId?.trim() || "",
                  },
                  {
                    label: "Reading Scene",
                    sceneId: config.haReadingPreset?.sceneEntityId?.trim() || "",
                  },
                ]
                  .filter((s) => Boolean(s.sceneId))
                  .map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={lightBusy}
                      onClick={() => void applyScenePreset(s.sceneId, s.label)}
                      title={s.sceneId}
                      className={`cursor-pointer rounded-[6px] border px-2.5 py-1 font-ui text-[0.56rem] uppercase tracking-[0.12em] transition-colors ${
                        selectedSwatchId === `scene:${s.sceneId}`
                          ? "border-[#E2B46D]/75 bg-[rgba(226,180,109,0.18)] text-[var(--text-ivory)]"
                          : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[#E2B46D] hover:border-[#E2B46D]/50"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
              </div>
            )}

            {/* Full 0-100% Brightness Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Brightness
                </span>
                <span
                  data-testid="ha-brightness-readout"
                  className="font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)]"
                >
                  {brightnessPct}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={brightnessPct}
                data-testid="ha-brightness-slider"
                onChange={(e) => setBrightnessPct(Math.max(0, Math.min(100, Number(e.target.value))))}
                onMouseUp={(e) =>
                  void commitBrightness(Number((e.target as HTMLInputElement).value))
                }
                onKeyUp={(e) =>
                  void commitBrightness(Number((e.target as HTMLInputElement).value))
                }
                aria-label="Room ceiling light brightness percentage"
                className="h-[3px] w-full cursor-pointer appearance-none rounded-full bg-[rgba(237,234,224,0.2)] accent-[#c5a059]"
              />
            </div>

            {lightStatus && (
              <div
                data-testid="ha-light-status"
                className="font-reading text-[0.82rem] leading-snug text-[var(--accent-luminous)] flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span>{lightStatus}</span>
                {lightStatus.toLowerCase().includes("settings") && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    data-testid="ha-status-open-settings"
                    className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[#E2B46D] underline decoration-[rgba(226,180,109,0.45)] underline-offset-4 hover:text-[var(--text-ivory)]"
                  >
                    Open Settings →
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 3B. DESKTOP MEDIA SMTC TRANSPORT & TIMELINE */}
          <section
            data-testid="studio-media-panel"
            className="smoked-glass rounded-[14px] p-5 space-y-3.5 shrink-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-ui text-[0.62rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                {media.active
                  ? formatSourceLabel(media.sourceApp)
                  : config.preferredMusicPlayer === "spotify"
                  ? "Spotify Transport"
                  : config.preferredMusicPlayer === "apple_music"
                  ? "Apple Music Transport"
                  : "Media Transport"}
              </div>
              {config.preferredMusicPlayer !== "none" && (
                <button
                  type="button"
                  onClick={() => void storageService.launchMusicPlayer(config.preferredMusicPlayer)}
                  data-testid="studio-open-music-player"
                  className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                >
                  <Music className="h-3 w-3" />
                  {config.preferredMusicPlayer === "spotify" ? "Open Spotify" : "Open Apple Music"}
                </button>
              )}
            </div>

            <div>
              <div className="font-editorial text-[1.15rem] leading-tight text-[var(--text-ivory)] truncate">
                {media.active ? media.title || "Playing" : "No Media Active"}
              </div>
              <div className="mt-0.5 font-ui text-[0.66rem] tracking-[0.06em] text-[var(--text-muted)] truncate">
                {media.active
                  ? media.artist || media.album || "Windows Media Session"
                  : "Launch a curated playlist or press Play"}
              </div>
            </div>

            {/* Interactive Timeline Progress Bar */}
            <div className="space-y-1">
              <div
                role="slider"
                aria-label="Track timeline"
                aria-valuemin={0}
                aria-valuemax={Math.max(1, Math.round(media.durationSeconds))}
                aria-valuenow={Math.round(media.positionSeconds)}
                tabIndex={0}
                onClick={(e) => {
                  if (media.durationSeconds <= 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  void handleMediaAction(`seek:${Math.round(frac * media.durationSeconds)}`);
                }}
                className="h-[4px] w-full cursor-pointer rounded-full bg-[rgba(237,234,224,0.16)] overflow-hidden"
              >
                <div
                  className="h-full bg-[var(--accent-luminous)] transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between font-ui tabular-nums text-[0.58rem] text-[var(--text-muted)]">
                <span>{formatSecondsMMSS(Math.floor(media.positionSeconds))}</span>
                <span>
                  {media.durationSeconds > 0
                    ? formatSecondsMMSS(Math.floor(media.durationSeconds))
                    : "00:00"}
                </span>
              </div>
            </div>

            {/* Full SMTC Transport Row */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => void handleMediaAction("toggle_shuffle")}
                data-testid="media-shuffle-btn"
                aria-label="Toggle shuffle"
                title="Shuffle"
                className={`cursor-pointer bg-transparent border-0 p-1.5 transition-colors ${
                  media.isShuffle
                    ? "text-[var(--accent-brass)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                }`}
              >
                <Shuffle className="h-3.5 w-3.5" strokeWidth={1.6} />
              </button>

              <button
                type="button"
                onClick={() => void handleMediaAction("previous")}
                data-testid="media-prev-btn"
                aria-label="Previous track"
                title="Previous"
                className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)]"
              >
                <SkipBack className="h-4 w-4" strokeWidth={1.6} />
              </button>

              <button
                type="button"
                onClick={() => void handleMediaAction("play_pause")}
                data-testid="media-play-pause-btn"
                aria-label={media.isPlaying ? "Pause" : "Play"}
                className="cursor-pointer rounded-full border border-[rgba(226,180,109,0.48)] bg-[rgba(226,180,109,0.14)] p-2.5 text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.26)] transition-colors"
              >
                {media.isPlaying ? (
                  <Pause className="h-4 w-4" strokeWidth={1.7} />
                ) : (
                  <Play className="h-4 w-4 translate-x-[0.5px]" strokeWidth={1.7} />
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleMediaAction("next")}
                data-testid="media-next-btn"
                aria-label="Next track"
                title="Next"
                className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)]"
              >
                <SkipForward className="h-4 w-4" strokeWidth={1.6} />
              </button>

              <button
                type="button"
                onClick={() => void handleMediaAction("cycle_repeat")}
                data-testid="media-loop-btn"
                aria-label="Cycle repeat mode"
                title={`Loop mode: ${media.repeatMode}`}
                className={`cursor-pointer bg-transparent border-0 p-1.5 transition-colors ${
                  media.repeatMode !== "none"
                    ? "text-[var(--accent-brass)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                }`}
              >
                {media.repeatMode === "track" ? (
                  <Repeat1 className="h-3.5 w-3.5" strokeWidth={1.6} />
                ) : (
                  <Repeat className="h-3.5 w-3.5" strokeWidth={1.6} />
                )}
              </button>
            </div>

            {mediaNotice && (
              <div
                data-testid="media-action-notice"
                className="text-center font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)]"
              >
                {mediaNotice}
              </div>
            )}
          </section>
        </div>
      </div>
    </MiniAppShell>
  );
}
