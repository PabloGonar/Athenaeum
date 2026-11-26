import { invoke } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  getLogicalDate,
  getLogicalHourSlotIndex,
  getLogicalOffsetDate,
  getLogicalWeekStartDate,
  resolveGoalRecurrence,
} from "../utils/logicalDate";
import type {
  ActivityBlockCategory,
  ActivityBlockHourly,
  AnalyticsDataset,
  AthenaeumConfig,
  BacklinkMention,
  BookHighlight,
  CalendarFeedConfig,
  DailyDebriefPayload,
  DailyDebriefRecord,
  DailyReadingProgress,
  DeviceTelemetryRecord,
  ExternalCalendarEvent,
  FocusSessionItem,
  GoalCompletionLog,
  GoalItem,
  GoalMilestone,
  HaLightCommand,
  HaLightPreset,
  HaLightResult,
  HeatmapDay,
  IcsSyncReport,
  ImportReport,
  IngestServerStatus,
  JournalEntry,
  LibraryBook,
  MediaSessionState,
  MusicPlayerPreference,
  PlaylistShortcut,
  QuickCaptureResult,
  QuoteItem,
  RecallCardItem,
  RecallDeckState,
  RecallReviewLog,
  RecallReviewResult,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ReflectionSaveInput,
  ScheduleBlock,
  StickyNoteItem,
  TocNode,
  TocTreeRecord,
  VaultFileEntry,
  VaultFolder,
  VaultIndexedNote,
  VaultSearchResult,
  WeeklySynthesisReport,
} from "../types/athenaeum";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function computeLevel(focusMinutes: number, goalsCompleted: number): number {
  const score = Math.max(0, focusMinutes) + Math.max(0, goalsCompleted) * 15;
  if (score <= 0) return 0;
  if (score < 60) return 1;
  if (score < 120) return 2;
  if (score < 180) return 3;
  return 4;
}

const DEFAULT_VAULT_PATH = "";
const DEFAULT_BOOKS_PATH = "";

export const DEFAULT_HA_FOCUS_PRESET: HaLightPreset = {
  name: "Lock In",
  mode: "rgb",
  rgbColor: [128, 0, 255],
  kelvin: 2700,
  brightnessPct: 45,
};

export const DEFAULT_HA_NON_FOCUS_PRESET: HaLightPreset = {
  name: "Warm White",
  mode: "kelvin",
  rgbColor: [255, 200, 140],
  kelvin: 2700,
  brightnessPct: 45,
};

export const DEFAULT_HA_READING_PRESET: HaLightPreset = {
  name: "Reading Warm",
  mode: "kelvin",
  rgbColor: [255, 198, 132],
  kelvin: 2700,
  brightnessPct: 45,
};

function generateBrowserToken32Bytes(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const LEGACY_BROKEN_PLAYLIST_URLS = new Set([
  "https://music.apple.com/us/station/lo-fi-chill/ra.1500918786",
  "https://music.apple.com/us/station/jazz/ra.985484166",
  "https://music.apple.com/us/station/salsa/ra.1128588743",
  "https://music.apple.com/us/station/italian-classics/ra.1489397731",
  "https://music.apple.com/us/station/holiday/ra.1059954614",
]);

function sanitizePlaylists(list: PlaylistShortcut[]): PlaylistShortcut[] {
  return list.map((p) => {
    const trimmedUrl = (p.url ?? "").trim();
    const cleanedUrl = LEGACY_BROKEN_PLAYLIST_URLS.has(trimmedUrl.toLowerCase()) ? "" : trimmedUrl;
    return {
      ...p,
      url: cleanedUrl,
    };
  });
}

export const DEFAULT_PLAYLISTS: PlaylistShortcut[] = [];

export const DEFAULT_QUOTES: QuoteItem[] = [
  {
    text: "We suffer more often in imagination than in reality.",
    author: "Seneca",
  },
  {
    text: "It is not the accumulation of knowledge that matters, but the ability to apply it to new and changing circumstances.",
    author: "Lee Kuan Yew",
  },
  {
    text: "How we spend our days is, of course, how we spend our lives.",
    author: "Annie Dillard",
  },
  {
    text: "Order and simplification are the first steps toward mastery of a subject.",
    author: "Thomas Mann",
  },
  {
    text: "First say to yourself what you would be; then do what you have to do.",
    author: "Epictetus",
  },
];

function sanitizeQuotes(list: QuoteItem[]): QuoteItem[] {
  return list.map((q) => {
    const author = (q.author ?? "").trim();
    const text = (q.text ?? "").trim();
    if (
      author.toLowerCase() === "athenaeum notebook" ||
      text.toLowerCase() === "stillness is where clarity gathers before action begins."
    ) {
      return {
        text: "It is not the accumulation of knowledge that matters, but the ability to apply it to new and changing circumstances.",
        author: "Lee Kuan Yew",
      };
    }
    return q;
  });
}

function mapGoalCategoryToHourly(raw?: string): ActivityBlockCategory {
  const lower = (raw ?? "").trim().toLowerCase();
  if (lower.includes("strategy") || lower.includes("plan") || lower.includes("toc")) {
    return "strategy";
  }
  if (lower.includes("admin") || lower.includes("ops") || lower.includes("chore")) {
    return "admin";
  }
  if (lower.includes("break") || lower.includes("rest") || lower.includes("health")) {
    return "break";
  }
  return "deep_work";
}

const DEFAULT_CONFIG: AthenaeumConfig = {
  userName: "",
  timeFormat: "12h",
  dayRolloverHour: 3,
  vaultPath: DEFAULT_VAULT_PATH,
  booksFolderPath: DEFAULT_BOOKS_PATH,
  upperBackgroundPath: "/backgrounds/top-main.webp",
  lowerBackgroundPath: "/backgrounds/bottom.webp",
  quotes: DEFAULT_QUOTES,
  homeAssistantWebhookUrl: "",
  homeAssistantToken: "",
  homeAssistantFocusEntity: "",
  haBaseUrl: "",
  haToken: "",
  haEntityId: "",
  haFocusPreset: DEFAULT_HA_FOCUS_PRESET,
  haNonFocusPreset: DEFAULT_HA_NON_FOCUS_PRESET,
  haReadingPreset: DEFAULT_HA_READING_PRESET,
  haAutoLight: false,
  playlists: [],
  haReadingWebhookUrl: "",
  haReadingLightEntity: "",
  n8nWebhookUrl: "",
  n8nTriggerWeeklySynthesis: true,
  n8nTriggerDailyDebrief: true,
  n8nTriggerGoalCompleted: false,
  ingestEnabled: false,
  ingestBindLan: false,
  ingestApiToken: "",
  audioBridgeUrl: "",
  activityTrackerPath: "",
  calendarIcsUrls: [],
  calendarFeeds: [],
  calendarLastSyncedAt: null,
  quickCaptureShortcut: "Alt+Space",
  autoWeeklySynthesis: true,
  launchOnStartup: false,
  focusDimOpacity: 0.35,
  dailyFocusTargetMinutes: 240,
  onboardingCompleted: false,
  preferredMusicPlayer: "none",
  dailyReadingHabitEnabled: false,
  dailyReadingTargetPages: 10,
  externalDbUrl: "",
};

const EMPTY_MEDIA: MediaSessionState = {
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
};

function readLocal<T>(key: string, fallback: () => T): T {
  try {
    const raw = window.localStorage.getItem(`athenaeum_${key}`);
    if (!raw) return fallback();
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`athenaeum_${key}`, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

function getLocalRolloverHour(): number {
  const cfg = readLocal<Partial<AthenaeumConfig>>("config", () => DEFAULT_CONFIG);
  return typeof cfg.dayRolloverHour === "number" ? cfg.dayRolloverHour : 3;
}

function getLocalVaultPath(): string {
  const cfg = readLocal<Partial<AthenaeumConfig>>("config", () => DEFAULT_CONFIG);
  return cfg.vaultPath?.trim() || DEFAULT_VAULT_PATH;
}

async function devVaultPost<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/__dev/vault${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaultPath: getLocalVaultPath(), ...payload }),
  });
  if (!res.ok) {
    throw new Error(`Vault bridge error (${res.status})`);
  }
  return (await res.json()) as T;
}

function purgeLegacyLocalMockData(): void {
  if (typeof window === "undefined" || isTauriRuntime()) return;
  if (window.localStorage.getItem("athenaeum_mock_purged_v1") === "1") return;

  const mockGoalIds = new Set([
    "g-d-1", "g-d-2", "g-d-3", "g-d-4",
    "g-w-1", "g-w-2", "g-w-3", "g-w-4", "g-w-5",
    "g-l-1", "g-l-2", "g-l-3",
  ]);
  const goals = readLocal<GoalItem[]>("goals", () => []);
  const hadMockGoals = goals.some((g) => mockGoalIds.has(g.id));
  if (hadMockGoals) {
    writeLocal("goals", goals.filter((g) => !mockGoalIds.has(g.id)));
  }

  const notes = readLocal<StickyNoteItem[]>("notes", () => []);
  writeLocal("notes", notes.filter((n) => n.id !== "note-1" && n.id !== "note-2"));

  const schedule = readLocal<ScheduleBlock[]>("schedule", () => []);
  writeLocal(
    "schedule",
    schedule.filter((b) => !["sb-1", "sb-2", "sb-3", "sb-4"].includes(b.id))
  );

  const books = readLocal<LibraryBook[]>("books", () => []);
  writeLocal(
    "books",
    books.filter((b) => !["bk-1", "bk-2", "bk-3", "bk-4"].includes(b.id))
  );

  const journal = readLocal<JournalEntry[]>("journal", () => []);
  writeLocal("journal", journal.filter((j) => j.id !== "j-1"));

  const toc = readLocal<TocNode[]>("toc", () => []);
  writeLocal("toc", toc.filter((t) => !["toc-1", "toc-2", "toc-3"].includes(t.id)));

  const sessions = readLocal<FocusSessionItem[]>("focus_sessions", () => []);
  const cleanSessions = sessions.filter(
    (s) => s.id !== "fs-seed-1" && s.id !== "fs-seed-2"
  );
  writeLocal("focus_sessions", cleanSessions);

  if (hadMockGoals && cleanSessions.length === 0) {
    window.localStorage.removeItem("athenaeum_daily_activity");
    window.localStorage.removeItem("athenaeum_heatmap");
  }

  window.localStorage.setItem("athenaeum_mock_purged_v1", "1");
}

interface RawActivityLedger {
  activeDate?: string;
  activeWeek?: string;
  dailyTasks?: Array<{
    id: string;
    date: string;
    title: string;
    completed?: boolean;
    createdAt?: string;
    order?: number;
  }>;
  weeklyGoals?: Array<{
    id: string;
    weekKey: string;
    title: string;
    targetCount?: number;
    currentCount?: number;
    completed?: boolean;
    createdAt?: string;
    order?: number;
  }>;
  longTermGoals?: Array<{
    id: string;
    title: string;
    milestones?: Array<{ completed?: boolean }>;
    completed?: boolean;
    createdAt?: string;
    order?: number;
  }>;
  activityLog?: Array<{
    id?: string;
    date: string;
    sourceType?: string;
    sourceId?: string;
    label?: string;
    timestamp?: string;
    points?: number;
  }>;
  journalEntries?: Array<{
    id: string;
    date: string;
    title?: string;
    content?: string;
    body?: string;
    mood?: string;
    updatedAt?: string;
  }>;
  focusSessions?: Array<{
    id: string;
    date: string;
    taskTitle?: string;
    minutes?: number;
    completedAt?: string;
  }>;
}

function applyLedgerImportToLocalStorage(
  ledger: RawActivityLedger,
  sourcePath: string
): ImportReport {
  const dailyTasks = ledger.dailyTasks ?? [];
  const weeklyGoals = ledger.weeklyGoals ?? [];
  const longTermGoals = ledger.longTermGoals ?? [];
  const focusSessions = ledger.focusSessions ?? [];
  const activityLog = ledger.activityLog ?? [];
  const journalEntries = ledger.journalEntries ?? [];

  const activeDate =
    ledger.activeDate ??
    dailyTasks.map((t) => t.date).sort().slice(-1)[0] ??
    null;
  const activeWeek =
    ledger.activeWeek ??
    weeklyGoals.map((w) => w.weekKey).sort().slice(-1)[0] ??
    null;

  const existingGoals = readLocal<GoalItem[]>("goals", () => []).filter((g) => {
    if (g.id.startsWith("dtask_") && activeDate && g.dueDate !== activeDate) {
      return false;
    }
    if (g.id.startsWith("wgoal_") && activeWeek && g.dueDate !== activeWeek) {
      return false;
    }
    return true;
  });

  const goalMap = new Map<string, GoalItem>(existingGoals.map((g) => [g.id, g]));

  let dailyCount = 0;
  dailyTasks.forEach((task, idx) => {
    if (activeDate && task.date !== activeDate) return;
    goalMap.set(task.id, {
      id: task.id,
      scope: "daily",
      title: task.title,
      durationMinutes: 30,
      completed: Boolean(task.completed),
      priority: "medium",
      dueDate: task.date,
      sortOrder: task.order ?? idx,
      createdAt: task.createdAt ?? `${task.date}T00:00:00Z`,
    });
    dailyCount += 1;
  });

  let weeklyCount = 0;
  weeklyGoals.forEach((goal, idx) => {
    if (activeWeek && goal.weekKey !== activeWeek) return;
    const target = goal.targetCount ?? 1;
    const current = goal.currentCount ?? 0;
    const title = target > 1 ? `${goal.title} (${current}/${target})` : goal.title;
    goalMap.set(goal.id, {
      id: goal.id,
      scope: "weekly",
      title,
      durationMinutes: 45,
      completed: Boolean(goal.completed),
      priority: "medium",
      dueDate: goal.weekKey,
      sortOrder: goal.order ?? idx,
      createdAt: goal.createdAt ?? new Date().toISOString(),
    });
    weeklyCount += 1;
  });

  let longTermCount = 0;
  longTermGoals.forEach((lt, idx) => {
    const ms = lt.milestones ?? [];
    const doneMs = ms.filter((m) => m.completed).length;
    const title =
      ms.length > 0 ? `${lt.title} (${doneMs}/${ms.length} milestones)` : lt.title;
    goalMap.set(lt.id, {
      id: lt.id,
      scope: "longTerm",
      title,
      durationMinutes: 120,
      completed: Boolean(lt.completed),
      priority: "high",
      dueDate: null,
      sortOrder: lt.order ?? idx,
      createdAt: lt.createdAt ?? new Date().toISOString(),
    });
    longTermCount += 1;
  });

  writeLocal("goals", Array.from(goalMap.values()));

  const existingSessions = readLocal<FocusSessionItem[]>("focus_sessions", () => []);
  const sessionMap = new Map<string, FocusSessionItem>(
    existingSessions.map((s) => [s.id, s])
  );
  const focusByDate = new Map<string, number>();

  for (const fs of focusSessions) {
    const mins = Math.max(1, fs.minutes ?? 25);
    const completedAt = fs.completedAt ?? `${fs.date}T12:00:00Z`;
    const completedMs = Date.parse(completedAt);
    const startedAt = Number.isNaN(completedMs)
      ? completedAt
      : new Date(completedMs - mins * 60_000).toISOString();
    sessionMap.set(fs.id, {
      id: fs.id,
      mode: "countdown",
      targetMinutes: mins,
      elapsedSeconds: mins * 60,
      startedAt,
      completedAt,
      label: fs.taskTitle?.trim() || "Focus Session",
    });
    focusByDate.set(fs.date, (focusByDate.get(fs.date) ?? 0) + mins);
  }
  const allSessions = Array.from(sessionMap.values()).sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt)
  );
  writeLocal("focus_sessions", allSessions);

  const existingJournal = readLocal<JournalEntry[]>("journal", () => []);
  const journalMap = new Map<string, JournalEntry>(
    existingJournal.map((j) => [j.id, j])
  );
  for (const entry of journalEntries) {
    journalMap.set(entry.id, {
      id: entry.id,
      date: entry.date,
      title: entry.title || "Reflection",
      body: entry.content ?? entry.body ?? "",
      mood: entry.mood || "Clear",
      updatedAt: entry.updatedAt ?? `${entry.date}T12:00:00Z`,
    });
  }
  writeLocal(
    "journal",
    Array.from(journalMap.values()).sort((a, b) => b.date.localeCompare(a.date))
  );

  const goalsByDate = new Map<string, number>();
  for (const act of activityLog) {
    goalsByDate.set(act.date, (goalsByDate.get(act.date) ?? 0) + Math.max(1, act.points ?? 1));
  }
  const completedDailyByDate = new Map<string, number>();
  for (const t of dailyTasks) {
    if (t.completed) {
      completedDailyByDate.set(t.date, (completedDailyByDate.get(t.date) ?? 0) + 1);
    }
  }
  for (const [date, cnt] of completedDailyByDate.entries()) {
    if (cnt > (goalsByDate.get(date) ?? 0)) {
      goalsByDate.set(date, cnt);
    }
  }

  const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
    "daily_activity",
    () => ({})
  );
  const nativeFocusByDate = new Map<string, number>();
  for (const s of allSessions) {
    if (!s.id.startsWith("focus_")) {
      const d = s.completedAt.slice(0, 10);
      nativeFocusByDate.set(
        d,
        (nativeFocusByDate.get(d) ?? 0) + Math.max(1, Math.ceil(s.elapsedSeconds / 60))
      );
    }
  }

  const importedDates = new Set<string>([...focusByDate.keys(), ...goalsByDate.keys()]);
  for (const date of importedDates) {
    const impMins = focusByDate.get(date) ?? 0;
    const impGoals = goalsByDate.get(date) ?? 0;
    const nativeMins = nativeFocusByDate.get(date) ?? 0;
    const prevGoals = dailyMap[date]?.goalsCompleted ?? 0;
    dailyMap[date] = {
      focusMinutes: impMins + nativeMins,
      goalsCompleted: Math.max(prevGoals, impGoals),
    };
  }
  writeLocal("daily_activity", dailyMap);

  backfillLegacyCompletionsToLocalStorage(ledger);

  return {
    sourcePath,
    dailyGoalsImported: dailyCount,
    weeklyGoalsImported: weeklyCount,
    longTermGoalsImported: longTermCount,
    focusSessionsImported: focusSessions.length,
    activityDaysImported: importedDates.size,
    journalEntriesImported: journalEntries.length,
    activeDate,
    activeWeek,
  };
}

function backfillLegacyCompletionsToLocalStorage(ledger: RawActivityLedger): void {
  const existing = readLocal<GoalCompletionLog[]>("goal_completions", () => []);
  const byId = new Map<string, GoalCompletionLog>(existing.map((c) => [c.id, c]));

  for (const t of ledger.dailyTasks ?? []) {
    if (!t.completed) continue;
    const title = (t.title || "").trim();
    const date = (t.date || "").trim();
    if (!title || !date) continue;
    const rowId = `at-dtask-${t.id}`;
    byId.set(rowId, {
      id: rowId,
      goalId: t.id,
      goalTitle: title,
      category: "daily",
      logicalDate: date,
      periodKey: `legacy:${date}`,
      loggedValue: 1,
      targetValue: 1,
      completedAt: t.createdAt || `${date}T12:00:00Z`,
    });
  }

  for (const [idx, act] of (ledger.activityLog ?? []).entries()) {
    const srcType = (act.sourceType || "").trim().toLowerCase();
    if (srcType === "focus") continue;
    const label = (act.label || "").trim();
    const date = (act.date || "").trim();
    if (!label || !date) continue;
    const actId = act.id?.trim() || `${date}-${idx}`;
    const rowId = `at-act-${actId}`;
    byId.set(rowId, {
      id: rowId,
      goalId: act.sourceId?.trim() || actId,
      goalTitle: label,
      category: srcType || "daily",
      logicalDate: date,
      periodKey: `legacy:${date}`,
      loggedValue: 1,
      targetValue: 1,
      completedAt: act.timestamp || `${date}T12:00:00Z`,
    });
  }

  const merged = Array.from(byId.values()).sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt)
  );
  writeLocal("goal_completions", merged);
}

export const storageService = {
  getLogicalToday(cutoffHour?: number): string {
    return getLogicalDate(new Date(), cutoffHour ?? getLocalRolloverHour());
  },

  async initialize(): Promise<void> {
    purgeLegacyLocalMockData();
    if (isTauriRuntime()) return;

    try {
      await devVaultPost("/init", {});
    } catch {
      // Dev bridge unavailable outside Vite dev server
    }
  },

  async getDefaultLocalNotesPath(): Promise<string> {
    if (isTauriRuntime()) {
      try {
        return await invoke<string>("get_default_local_notes_path");
      } catch {
        return "";
      }
    }
    try {
      const res = await devVaultPost<{ ok: boolean; vaultPath?: string }>("/init", {});
      if (res.vaultPath) return res.vaultPath;
    } catch {
      // Dev bridge unavailable outside dev server
    }
    return "Documents/Athenaeum Notes";
  },

  async getConfig(): Promise<AthenaeumConfig> {
    if (isTauriRuntime()) {
      const cfg = await invoke<AthenaeumConfig>("get_config");
      try {
        cfg.launchOnStartup = await isAutostartEnabled();
      } catch {
        // Keep stored flag
      }
      if (typeof cfg.userName !== "string") cfg.userName = "";
      if (!cfg.timeFormat) cfg.timeFormat = "12h";
      if (typeof cfg.dayRolloverHour !== "number") cfg.dayRolloverHour = 3;
      if (typeof cfg.vaultPath !== "string") cfg.vaultPath = "";
      if (typeof cfg.booksFolderPath !== "string") cfg.booksFolderPath = "";
      if (typeof cfg.haReadingWebhookUrl !== "string") cfg.haReadingWebhookUrl = "";
      if (typeof cfg.haReadingLightEntity !== "string") cfg.haReadingLightEntity = "";
      if (typeof cfg.haBaseUrl !== "string") cfg.haBaseUrl = "";
      if (typeof cfg.haToken !== "string") cfg.haToken = "";
      if (typeof cfg.haEntityId !== "string") cfg.haEntityId = "";
      if (!cfg.haFocusPreset) cfg.haFocusPreset = { ...DEFAULT_HA_FOCUS_PRESET };
      if (!cfg.haNonFocusPreset) cfg.haNonFocusPreset = { ...DEFAULT_HA_NON_FOCUS_PRESET };
      if (!cfg.haReadingPreset) cfg.haReadingPreset = { ...DEFAULT_HA_READING_PRESET };
      cfg.haFocusPreset.brightnessPct = Math.max(1, Math.min(100, cfg.haFocusPreset.brightnessPct || 45));
      cfg.haNonFocusPreset.brightnessPct = Math.max(1, Math.min(100, cfg.haNonFocusPreset.brightnessPct || 45));
      cfg.haReadingPreset.brightnessPct = Math.max(1, Math.min(100, cfg.haReadingPreset.brightnessPct || 45));
      if (typeof cfg.haAutoLight !== "boolean") cfg.haAutoLight = false;
      if (typeof cfg.n8nTriggerWeeklySynthesis !== "boolean") cfg.n8nTriggerWeeklySynthesis = true;
      if (typeof cfg.n8nTriggerDailyDebrief !== "boolean") cfg.n8nTriggerDailyDebrief = true;
      if (typeof cfg.n8nTriggerGoalCompleted !== "boolean") cfg.n8nTriggerGoalCompleted = false;
      if (typeof cfg.ingestEnabled !== "boolean") cfg.ingestEnabled = false;
      if (typeof cfg.ingestBindLan !== "boolean") cfg.ingestBindLan = false;
      if (!Array.isArray(cfg.calendarFeeds)) cfg.calendarFeeds = [];
      if (!Array.isArray(cfg.playlists)) {
        cfg.playlists = [];
      } else {
        cfg.playlists = sanitizePlaylists(cfg.playlists);
      }
      if (!Array.isArray(cfg.quotes)) {
        cfg.quotes = DEFAULT_QUOTES;
      } else {
        cfg.quotes = sanitizeQuotes(cfg.quotes);
      }
      if (!Array.isArray(cfg.calendarIcsUrls)) cfg.calendarIcsUrls = [];
      if (!cfg.quickCaptureShortcut) cfg.quickCaptureShortcut = "Alt+Space";
      if (typeof cfg.autoWeeklySynthesis !== "boolean") cfg.autoWeeklySynthesis = true;
      if (typeof cfg.onboardingCompleted !== "boolean") cfg.onboardingCompleted = false;
      if (
        cfg.preferredMusicPlayer !== "apple_music" &&
        cfg.preferredMusicPlayer !== "spotify" &&
        cfg.preferredMusicPlayer !== "none"
      ) {
        cfg.preferredMusicPlayer = "none";
      }
      if (typeof cfg.dailyReadingHabitEnabled !== "boolean") cfg.dailyReadingHabitEnabled = false;
      if (typeof cfg.dailyReadingTargetPages !== "number" || cfg.dailyReadingTargetPages < 1) {
        cfg.dailyReadingTargetPages = 10;
      }
      if (typeof cfg.externalDbUrl !== "string") cfg.externalDbUrl = "";
      return cfg;
    }
    const stored = readLocal<Partial<AthenaeumConfig>>("config", () => DEFAULT_CONFIG);
    const mergedFocusPreset: HaLightPreset = {
      ...DEFAULT_HA_FOCUS_PRESET,
      ...(stored.haFocusPreset ?? {}),
      brightnessPct: Math.max(
        1,
        Math.min(100, stored.haFocusPreset?.brightnessPct ?? DEFAULT_HA_FOCUS_PRESET.brightnessPct)
      ),
    };
    const mergedNonFocusPreset: HaLightPreset = {
      ...DEFAULT_HA_NON_FOCUS_PRESET,
      ...(stored.haNonFocusPreset ?? {}),
      brightnessPct: Math.max(
        1,
        Math.min(100, stored.haNonFocusPreset?.brightnessPct ?? DEFAULT_HA_NON_FOCUS_PRESET.brightnessPct)
      ),
    };
    const mergedReadingPreset: HaLightPreset = {
      ...DEFAULT_HA_READING_PRESET,
      ...(stored.haReadingPreset ?? {}),
      brightnessPct: Math.max(
        1,
        Math.min(100, stored.haReadingPreset?.brightnessPct ?? DEFAULT_HA_READING_PRESET.brightnessPct)
      ),
    };
    const storedUrls = Array.isArray(stored.calendarIcsUrls) ? stored.calendarIcsUrls : [];
    const storedFeeds: CalendarFeedConfig[] =
      Array.isArray(stored.calendarFeeds) && stored.calendarFeeds.length > 0
        ? stored.calendarFeeds
        : storedUrls.map((url, idx) => ({
            id: `cal-${idx + 1}`,
            label: `Calendar ${idx + 1}`,
            url,
          }));
    let token = stored.ingestApiToken?.trim() || "";
    if (!token) {
      token = generateBrowserToken32Bytes();
      writeLocal("config", { ...stored, ingestApiToken: token });
    }
    const preferredMusicPlayer: MusicPlayerPreference =
      stored.preferredMusicPlayer === "apple_music" ||
      stored.preferredMusicPlayer === "spotify" ||
      stored.preferredMusicPlayer === "none"
        ? stored.preferredMusicPlayer
        : "none";
    const merged: AthenaeumConfig = {
      ...DEFAULT_CONFIG,
      ...stored,
      userName: typeof stored.userName === "string" ? stored.userName : "",
      dayRolloverHour:
        typeof stored.dayRolloverHour === "number" ? stored.dayRolloverHour : 3,
      vaultPath: typeof stored.vaultPath === "string" ? stored.vaultPath.trim() : "",
      booksFolderPath:
        typeof stored.booksFolderPath === "string" ? stored.booksFolderPath.trim() : "",
      haBaseUrl: typeof stored.haBaseUrl === "string" ? stored.haBaseUrl.trim() : "",
      haToken: stored.haToken ?? "",
      haEntityId: typeof stored.haEntityId === "string" ? stored.haEntityId.trim() : "",
      haFocusPreset: mergedFocusPreset,
      haNonFocusPreset: mergedNonFocusPreset,
      haReadingPreset: mergedReadingPreset,
      haAutoLight: typeof stored.haAutoLight === "boolean" ? stored.haAutoLight : false,
      n8nTriggerWeeklySynthesis:
        typeof stored.n8nTriggerWeeklySynthesis === "boolean"
          ? stored.n8nTriggerWeeklySynthesis
          : true,
      n8nTriggerDailyDebrief:
        typeof stored.n8nTriggerDailyDebrief === "boolean"
          ? stored.n8nTriggerDailyDebrief
          : true,
      n8nTriggerGoalCompleted:
        typeof stored.n8nTriggerGoalCompleted === "boolean"
          ? stored.n8nTriggerGoalCompleted
          : false,
      ingestEnabled: typeof stored.ingestEnabled === "boolean" ? stored.ingestEnabled : false,
      ingestBindLan: typeof stored.ingestBindLan === "boolean" ? stored.ingestBindLan : false,
      ingestApiToken: token,
      playlists: Array.isArray(stored.playlists) ? sanitizePlaylists(stored.playlists) : [],
      haReadingWebhookUrl: stored.haReadingWebhookUrl ?? "",
      haReadingLightEntity:
        typeof stored.haReadingLightEntity === "string"
          ? stored.haReadingLightEntity.trim()
          : "",
      quotes: Array.isArray(stored.quotes) ? sanitizeQuotes(stored.quotes) : DEFAULT_QUOTES,
      calendarIcsUrls: storedFeeds.map((f) => f.url),
      calendarFeeds: storedFeeds,
      calendarLastSyncedAt: stored.calendarLastSyncedAt ?? null,
      quickCaptureShortcut: stored.quickCaptureShortcut?.trim() || "Alt+Space",
      autoWeeklySynthesis:
        typeof stored.autoWeeklySynthesis === "boolean" ? stored.autoWeeklySynthesis : true,
      timeFormat: stored.timeFormat === "24h" ? "24h" : "12h",
      onboardingCompleted:
        typeof stored.onboardingCompleted === "boolean" ? stored.onboardingCompleted : false,
      preferredMusicPlayer,
      dailyReadingHabitEnabled:
        typeof stored.dailyReadingHabitEnabled === "boolean"
          ? stored.dailyReadingHabitEnabled
          : false,
      dailyReadingTargetPages:
        typeof stored.dailyReadingTargetPages === "number" && stored.dailyReadingTargetPages >= 1
          ? Math.round(stored.dailyReadingTargetPages)
          : 10,
      externalDbUrl: typeof stored.externalDbUrl === "string" ? stored.externalDbUrl.trim() : "",
    };
    return merged;
  },

  async saveConfig(config: AthenaeumConfig): Promise<AthenaeumConfig> {
    if (isTauriRuntime()) {
      try {
        if (config.launchOnStartup) {
          await enableAutostart();
        } else {
          await disableAutostart();
        }
      } catch {
        // Ignore if unpackaged dev lacks registry permission
      }
      return invoke<AthenaeumConfig>("save_config", { config });
    }
    writeLocal("config", config);
    try {
      await devVaultPost("/init", { vaultPath: config.vaultPath });
    } catch {
      // Ignore outside dev server
    }
    return config;
  },

  async pickVaultFolder(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("pick_vault_folder");
    }
    return null;
  },

  async promoteNoteToVault(note: StickyNoteItem, cutoffHour: number): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("promote_note_to_vault", {
        noteId: note.id,
        title: note.title,
        content: note.content,
      });
    }
    const logicalDate = getLogicalDate(new Date(), cutoffHour);
    const res = await devVaultPost<{ ok: boolean; filePath: string }>("/promote", {
      logicalDate,
      title: note.title,
      content: note.content,
    });
    await this.deleteNote(note.id);
    return res.filePath;
  },

  async ensureDailyDebriefGoal(cutoffHour: number): Promise<GoalItem> {
    if (isTauriRuntime()) {
      return invoke<GoalItem>("ensure_daily_debrief_goal");
    }
    const logicalDate = getLogicalDate(new Date(), cutoffHour);
    const goalId = `daily-debrief-${logicalDate}`;
    const goals = readLocal<GoalItem[]>("goals", () => []).filter(
      (g) => !g.id.startsWith("daily-debrief-") || g.id === goalId
    );
    const existing = goals.find((g) => g.id === goalId);
    if (existing) {
      writeLocal("goals", goals);
      return existing;
    }
    const dailyMax = goals
      .filter((g) => g.scope === "daily")
      .reduce((acc, g) => Math.max(acc, g.sortOrder), -1);
    const created: GoalItem = {
      id: goalId,
      scope: "daily",
      title: "Complete Daily Debrief",
      durationMinutes: 15,
      completed: false,
      priority: "high",
      dueDate: logicalDate,
      sortOrder: dailyMax + 1,
      createdAt: new Date().toISOString(),
    };
    goals.push(created);
    writeLocal("goals", goals);
    return created;
  },

  async getDailyDebrief(logicalDate: string): Promise<DailyDebriefRecord | null> {
    if (isTauriRuntime()) {
      return invoke<DailyDebriefRecord | null>("get_daily_debrief", { logicalDate });
    }
    const map = readLocal<Record<string, DailyDebriefRecord>>("daily_debriefs", () => ({}));
    return map[logicalDate] ?? null;
  },

  async saveDailyDebriefDraft(record: DailyDebriefRecord): Promise<DailyDebriefRecord> {
    if (isTauriRuntime()) {
      return invoke<DailyDebriefRecord>("save_daily_debrief_draft", { record });
    }
    const map = readLocal<Record<string, DailyDebriefRecord>>("daily_debriefs", () => ({}));
    map[record.logicalDate] = record;
    writeLocal("daily_debriefs", map);
    return record;
  },

  async publishDailyDebrief(payload: DailyDebriefPayload): Promise<DailyDebriefRecord> {
    if (isTauriRuntime()) {
      return invoke<DailyDebriefRecord>("publish_daily_debrief", { payload });
    }
    const res = await devVaultPost<{ ok: boolean; filePath: string }>("/daily/publish", {
      ...payload,
    });
    const record: DailyDebriefRecord = {
      logicalDate: payload.logicalDate,
      memories: payload.memories,
      gratitude1: payload.gratitude1,
      gratitude2: payload.gratitude2,
      gratitude3: payload.gratitude3,
      closingThought: payload.closingThought,
      published: true,
      vaultFilePath: res.filePath,
      updatedAt: new Date().toISOString(),
    };
    const map = readLocal<Record<string, DailyDebriefRecord>>("daily_debriefs", () => ({}));
    map[payload.logicalDate] = record;
    writeLocal("daily_debriefs", map);

    // Mark Complete Daily Debrief daily goal as completed
    const goalId = `daily-debrief-${payload.logicalDate}`;
    const goals = readLocal<GoalItem[]>("goals", () => []).map((g) =>
      g.id === goalId || (g.scope === "daily" && g.title === "Complete Daily Debrief")
        ? { ...g, completed: true }
        : g
    );
    writeLocal("goals", goals);

    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    const dailyDone = goals.filter((g) => g.scope === "daily" && g.completed).length;
    const prev = dailyMap[payload.logicalDate];
    dailyMap[payload.logicalDate] = {
      focusMinutes: prev?.focusMinutes ?? 0,
      goalsCompleted: Math.max(prev?.goalsCompleted ?? 0, dailyDone),
    };
    writeLocal("daily_activity", dailyMap);

    return record;
  },

  async listDailyDebriefArchive(): Promise<string[]> {
    if (isTauriRuntime()) {
      return invoke<string[]>("list_daily_debrief_archive");
    }
    try {
      const res = await devVaultPost<{ dates: string[] }>("/daily/list", {});
      return res.dates;
    } catch {
      const map = readLocal<Record<string, DailyDebriefRecord>>("daily_debriefs", () => ({}));
      return Object.keys(map).sort().reverse();
    }
  },

  async readDailyDebriefFile(logicalDate: string): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("read_daily_debrief_file", { logicalDate });
    }
    try {
      const res = await devVaultPost<{ content: string | null }>("/daily/read", { logicalDate });
      return res.content;
    } catch {
      return null;
    }
  },

  async listReflections(): Promise<VaultFileEntry[]> {
    if (isTauriRuntime()) {
      return invoke<VaultFileEntry[]>("list_reflections");
    }
    try {
      const res = await devVaultPost<{ entries: VaultFileEntry[] }>("/reflections/list", {});
      return res.entries;
    } catch {
      return [];
    }
  },

  async saveReflection(input: ReflectionSaveInput): Promise<VaultFileEntry> {
    if (isTauriRuntime()) {
      return invoke<VaultFileEntry>("save_reflection", { input });
    }
    const res = await devVaultPost<{ entry: VaultFileEntry }>("/reflections/save", { ...input });
    return res.entry;
  },

  async deleteReflection(fileName: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_reflection", { fileName });
      return;
    }
    await devVaultPost("/reflections/delete", { fileName });
  },

  async listVaultIndex(): Promise<VaultIndexedNote[]> {
    if (isTauriRuntime()) {
      return invoke<VaultIndexedNote[]>("list_vault_index");
    }
    try {
      const res = await devVaultPost<{ notes?: VaultIndexedNote[] }>("/index", {});
      return res.notes ?? [];
    } catch {
      return [];
    }
  },

  async searchVaultNotes(query: string, tagFilter?: string | null): Promise<VaultSearchResult[]> {
    if (isTauriRuntime()) {
      return invoke<VaultSearchResult[]>("search_vault_notes", {
        query,
        tagFilter: tagFilter || null,
      });
    }
    try {
      const res = await devVaultPost<{ results?: VaultSearchResult[] }>("/search", {
        query,
        tagFilter: tagFilter || "",
      });
      return res.results ?? [];
    } catch {
      return [];
    }
  },

  async findVaultBacklinks(
    targetTitle: string,
    excludeFileName?: string | null
  ): Promise<BacklinkMention[]> {
    if (!targetTitle.trim()) return [];
    if (isTauriRuntime()) {
      return invoke<BacklinkMention[]>("find_vault_backlinks", {
        targetTitle,
        excludeFileName: excludeFileName || null,
      });
    }
    try {
      const res = await devVaultPost<{ mentions?: BacklinkMention[] }>("/backlinks", {
        targetTitle,
        excludeFileName: excludeFileName || "",
      });
      return res.mentions ?? [];
    } catch {
      return [];
    }
  },

  async saveVaultNoteBody(
    folder: VaultFolder,
    fileName: string,
    body: string
  ): Promise<VaultIndexedNote> {
    if (isTauriRuntime()) {
      return invoke<VaultIndexedNote>("save_vault_note_body", { folder, fileName, body });
    }
    const res = await devVaultPost<{ note: VaultIndexedNote }>("/note-save", {
      folder,
      fileName,
      body,
    });
    return res.note;
  },

  async getDetectedActivityTrackerPath(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("get_detected_activity_tracker_path");
    }
    try {
      const res = await fetch("/__dev/activitytracker?meta=1");
      if (res.ok) {
        const data = (await res.json()) as { found: boolean; path?: string };
        return data.found && data.path ? data.path : null;
      }
    } catch {
      // Ignore outside dev server
    }
    return null;
  },

  async importActivityTracker(path?: string): Promise<ImportReport> {
    if (isTauriRuntime()) {
      return invoke<ImportReport>("import_activity_tracker", {
        path: path && path.trim() ? path.trim() : null,
      });
    }
    const query = path && path.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
    const res = await fetch(`/__dev/activitytracker${query}`);
    if (!res.ok) {
      throw new Error("ActivityTracker file could not be read from the local dev bridge");
    }
    const payload = (await res.json()) as {
      found: boolean;
      path?: string;
      error?: string;
      ledger?: RawActivityLedger;
    };
    if (!payload.found || !payload.ledger || !payload.path) {
      throw new Error(payload.error || "ActivityTracker ledger-v1.json not found");
    }
    return applyLedgerImportToLocalStorage(payload.ledger, payload.path);
  },

  async getBriefingDismissedDate(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("get_briefing_dismissed_date");
    }
    return window.localStorage.getItem("athenaeum_briefing_dismissed_date");
  },

  async setBriefingDismissedDate(date: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("set_briefing_dismissed_date", { date });
      return;
    }
    window.localStorage.setItem("athenaeum_briefing_dismissed_date", date);
  },

  async listGoals(): Promise<GoalItem[]> {
    if (isTauriRuntime()) {
      return invoke<GoalItem[]>("list_goals");
    }
    const cutoff = getLocalRolloverHour();
    const today = getLogicalDate(new Date(), cutoff);
    const weekStart = getLogicalWeekStartDate(new Date(), cutoff);
    let dirty = false;
    const items = readLocal<GoalItem[]>("goals", () => []).map((g) => {
      const rec = resolveGoalRecurrence(g);
      const targetCount = Math.max(1, g.targetCount ?? 1);
      let currentCount = Math.max(0, g.currentCount ?? (g.completed ? targetCount : 0));
      let completed = g.completed;
      let lastReset = g.lastResetPeriod ?? "";

      if (rec === "daily" || rec === "specific_days") {
        if (lastReset && lastReset !== today) {
          completed = false;
          currentCount = 0;
          lastReset = today;
          dirty = true;
        } else if (!lastReset) {
          lastReset = today;
          dirty = true;
        }
      } else if (rec === "weekly") {
        if (lastReset && lastReset !== weekStart) {
          completed = false;
          currentCount = 0;
          lastReset = weekStart;
          dirty = true;
        } else if (!lastReset) {
          lastReset = weekStart;
          dirty = true;
        }
      }

      return {
        ...g,
        description: g.description ?? "",
        category: g.category ?? "",
        recurrence: rec,
        specificDays: Array.isArray(g.specificDays) ? g.specificDays : [],
        targetCount,
        currentCount,
        unitLabel: g.unitLabel ?? "",
        lastResetPeriod: lastReset,
        completed,
      };
    });
    if (dirty) writeLocal("goals", items);
    return items;
  },

  async upsertGoal(goal: GoalItem): Promise<GoalItem> {
    const cutoff = getLocalRolloverHour();
    const today = getLogicalDate(new Date(), cutoff);
    const weekStart = getLogicalWeekStartDate(new Date(), cutoff);
    const rec = resolveGoalRecurrence(goal);
    const scope: GoalItem["scope"] =
      rec === "weekly" ? "weekly" : rec === "long_term" ? "longTerm" : "daily";
    const targetCount = Math.max(1, Math.floor(goal.targetCount ?? 1));
    let currentCount = Math.max(0, Math.floor(goal.currentCount ?? 0));
    let completed = goal.completed;

    if (targetCount > 1) {
      completed = currentCount >= targetCount;
    } else if (completed && currentCount === 0) {
      currentCount = 1;
    } else if (!completed) {
      currentCount = 0;
    }

    const normalized: GoalItem = {
      ...goal,
      scope,
      recurrence: rec,
      description: goal.description ?? "",
      category: goal.category ?? "",
      specificDays: Array.isArray(goal.specificDays) ? goal.specificDays : [],
      targetCount,
      currentCount,
      unitLabel: goal.unitLabel ?? "",
      completed,
      lastResetPeriod:
        goal.lastResetPeriod ||
        (rec === "weekly" ? weekStart : rec === "daily" || rec === "specific_days" ? today : ""),
    };

    if (isTauriRuntime()) {
      return invoke<GoalItem>("upsert_goal", { goal: normalized });
    }

    const items = readLocal<GoalItem[]>("goals", () => []);
    const idx = items.findIndex((g) => g.id === normalized.id);
    if (idx >= 0) items[idx] = normalized;
    else items.push(normalized);
    writeLocal("goals", items);

    // Maintain timestamped goal_completions log in localStorage
    const periodKey =
      rec === "weekly" ? `week:${weekStart}` : rec === "long_term" ? "long_term" : today;
    const logs = readLocal<GoalCompletionLog[]>("goal_completions", () => []);
    const logId = `gc_${normalized.id}_${periodKey}`;
    const filtered = logs.filter(
      (l) => !(l.goalId === normalized.id && l.periodKey === periodKey)
    );
    if (normalized.completed) {
      filtered.unshift({
        id: logId,
        goalId: normalized.id,
        goalTitle: normalized.title,
        category: normalized.category ?? "",
        logicalDate: today,
        periodKey,
        loggedValue: Math.max(1, normalized.currentCount ?? 1),
        targetValue: normalized.targetCount ?? 1,
        completedAt: new Date().toISOString(),
      });
    }
    writeLocal("goal_completions", filtered.slice(0, 500));

    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    const dailyDone = items.filter((g) => g.scope === "daily" && g.completed).length;
    dailyMap[today] = {
      focusMinutes: dailyMap[today]?.focusMinutes ?? 0,
      goalsCompleted: dailyDone,
    };
    writeLocal("daily_activity", dailyMap);
    return normalized;
  },

  async deleteGoal(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_goal", { id });
      return;
    }
    const items = readLocal<GoalItem[]>("goals", () => []).filter((g) => g.id !== id);
    writeLocal("goals", items);
    const milestones = readLocal<GoalMilestone[]>("goal_milestones", () => []).filter(
      (m) => m.goalId !== id
    );
    writeLocal("goal_milestones", milestones);
  },

  async reorderGoals(orderedIds: string[]): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("reorder_goals", { orderedIds });
      return;
    }
    const items = readLocal<GoalItem[]>("goals", () => []);
    const rank = new Map(orderedIds.map((id, idx) => [id, idx]));
    for (const item of items) {
      const nextOrder = rank.get(item.id);
      if (nextOrder !== undefined) item.sortOrder = nextOrder;
    }
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    writeLocal("goals", items);
  },

  async listGoalMilestones(goalId?: string): Promise<GoalMilestone[]> {
    if (isTauriRuntime()) {
      return invoke<GoalMilestone[]>("list_goal_milestones", { goalId: goalId ?? null });
    }
    const all = readLocal<GoalMilestone[]>("goal_milestones", () => []);
    const filtered = goalId ? all.filter((m) => m.goalId === goalId) : all;
    return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async upsertGoalMilestone(milestone: GoalMilestone): Promise<GoalMilestone> {
    const nowIso = new Date().toISOString();
    const next: GoalMilestone = {
      ...milestone,
      completedAt: milestone.completed ? milestone.completedAt || nowIso : null,
    };
    if (isTauriRuntime()) {
      return invoke<GoalMilestone>("upsert_goal_milestone", { milestone: next });
    }
    const all = readLocal<GoalMilestone[]>("goal_milestones", () => []);
    const idx = all.findIndex((m) => m.id === next.id);
    if (idx >= 0) all[idx] = next;
    else all.push(next);
    writeLocal("goal_milestones", all);

    // Record/remove timestamped milestone completion
    const today = this.getLogicalToday();
    const periodKey = `milestone:${next.id}`;
    const logs = readLocal<GoalCompletionLog[]>("goal_completions", () => []).filter(
      (l) => !(l.goalId === next.goalId && l.periodKey === periodKey)
    );
    if (next.completed) {
      const parent = readLocal<GoalItem[]>("goals", () => []).find((g) => g.id === next.goalId);
      logs.unshift({
        id: `gc_ms_${next.id}`,
        goalId: next.goalId,
        goalTitle: next.title,
        category: parent?.category ?? "",
        logicalDate: today,
        periodKey,
        loggedValue: 1,
        targetValue: 1,
        completedAt: next.completedAt || nowIso,
      });
    }
    writeLocal("goal_completions", logs.slice(0, 500));
    return next;
  },

  async deleteGoalMilestone(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_goal_milestone", { id });
      return;
    }
    const all = readLocal<GoalMilestone[]>("goal_milestones", () => []).filter((m) => m.id !== id);
    writeLocal("goal_milestones", all);
  },

  async reorderGoalMilestones(orderedIds: string[]): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("reorder_goal_milestones", { orderedIds });
      return;
    }
    const all = readLocal<GoalMilestone[]>("goal_milestones", () => []);
    const rank = new Map(orderedIds.map((id, idx) => [id, idx]));
    for (const item of all) {
      const order = rank.get(item.id);
      if (order !== undefined) item.sortOrder = order;
    }
    writeLocal("goal_milestones", all);
  },

  async listGoalCompletions(limit = 120): Promise<GoalCompletionLog[]> {
    if (isTauriRuntime()) {
      return invoke<GoalCompletionLog[]>("list_goal_completions", { limit });
    }
    return readLocal<GoalCompletionLog[]>("goal_completions", () => []).slice(0, limit);
  },

  async listCompletedTasksByDate(logicalDate: string): Promise<string[]> {
    const target = logicalDate.trim();
    if (!target) return [];
    if (isTauriRuntime()) {
      return invoke<string[]>("list_completed_tasks_by_date", { logicalDate: target });
    }

    // Ensure one-time historical completions backfill for existing browser dev profiles
    if (window.localStorage.getItem("athenaeum_legacy_completions_v1") !== "1") {
      try {
        const res = await fetch("/__dev/activitytracker");
        if (res.ok) {
          const payload = (await res.json()) as {
            found: boolean;
            ledger?: RawActivityLedger;
          };
          if (payload.found && payload.ledger) {
            backfillLegacyCompletionsToLocalStorage(payload.ledger);
          }
        }
      } catch {
        // Non-fatal outside dev server
      }
      window.localStorage.setItem("athenaeum_legacy_completions_v1", "1");
    }

    const goals = readLocal<GoalItem[]>("goals", () => []);
    const goalTitleById = new Map(goals.map((g) => [g.id, g.title]));
    const completions = readLocal<GoalCompletionLog[]>("goal_completions", () => []);
    const milestones = readLocal<GoalMilestone[]>("goal_milestones", () => []);

    const seen = new Set<string>();
    const out: string[] = [];
    const pushUnique = (raw?: string | null) => {
      const clean = (raw || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(clean);
      }
    };

    const matchingCompletions = completions
      .filter((c) => c.logicalDate === target)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    for (const c of matchingCompletions) {
      pushUnique(goalTitleById.get(c.goalId) || c.goalTitle);
    }

    for (const g of goals) {
      if (
        g.completed &&
        g.scope === "daily" &&
        (g.dueDate === target ||
          g.lastResetPeriod === target ||
          (g.createdAt && g.createdAt.slice(0, 10) === target))
      ) {
        pushUnique(g.title);
      }
    }

    for (const m of milestones) {
      if (m.completed && m.completedAt && m.completedAt.slice(0, 10) === target) {
        const parent = goalTitleById.get(m.goalId);
        pushUnique(parent ? `${parent} · ${m.title}` : m.title);
      }
    }

    return out;
  },

  async listNotes(): Promise<StickyNoteItem[]> {
    if (isTauriRuntime()) {
      return invoke<StickyNoteItem[]>("list_notes");
    }
    return readLocal<StickyNoteItem[]>("notes", () => []);
  },

  async upsertNote(note: StickyNoteItem): Promise<StickyNoteItem> {
    if (isTauriRuntime()) {
      return invoke<StickyNoteItem>("upsert_note", { note });
    }
    const notes = readLocal<StickyNoteItem[]>("notes", () => []);
    const idx = notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) notes[idx] = note;
    else notes.push(note);
    writeLocal("notes", notes);
    return note;
  },

  async deleteNote(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_note", { id });
      return;
    }
    const notes = readLocal<StickyNoteItem[]>("notes", () => []).filter((n) => n.id !== id);
    writeLocal("notes", notes);
  },

  async logFocusSession(session: FocusSessionItem): Promise<FocusSessionItem> {
    if (isTauriRuntime()) {
      return invoke<FocusSessionItem>("log_focus_session", { session });
    }
    const cutoff = getLocalRolloverHour();
    const sessions = readLocal<FocusSessionItem[]>("focus_sessions", () => []);
    const enriched: FocusSessionItem = {
      ...session,
      goalId: session.goalId ?? null,
      category: session.category?.trim() || "deep_work",
    };
    sessions.unshift(enriched);
    writeLocal("focus_sessions", sessions.slice(0, 200));

    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    const today = getLogicalDate(new Date(), cutoff);
    const addedMinutes = Math.max(1, Math.ceil(enriched.elapsedSeconds / 60));
    dailyMap[today] = {
      focusMinutes: (dailyMap[today]?.focusMinutes ?? 0) + addedMinutes,
      goalsCompleted: dailyMap[today]?.goalsCompleted ?? 0,
    };
    writeLocal("daily_activity", dailyMap);

    // Mirror auto-paint of matching 1-hour logical-day block(s) (0..23 starting at cutoff:00)
    // whenever session runs >= 5 minutes OR completes a custom countdown target
    const reachedCountdown =
      enriched.mode === "countdown" &&
      typeof enriched.targetMinutes === "number" &&
      enriched.elapsedSeconds >= 5;
    if (enriched.elapsedSeconds >= 300 || reachedCountdown) {
      const startDt = new Date(enriched.startedAt);
      const endDt = new Date(enriched.completedAt);
      const firstSlot = getLogicalHourSlotIndex(startDt, cutoff);
      const lastSlot = Math.max(firstSlot, getLogicalHourSlotIndex(endDt, cutoff));
      const allHourly = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
      const dayBlocks = [...(allHourly[today] ?? [])];
      const hourlyCategory = mapGoalCategoryToHourly(enriched.category);
      for (let slot = firstSlot; slot <= lastSlot; slot++) {
        const existingIdx = dayBlocks.findIndex((b) => b.slotIndex === slot);
        if (existingIdx < 0) {
          dayBlocks.push({
            date: today,
            slotIndex: slot,
            label: enriched.label || "Deep Focus",
            category: hourlyCategory,
            source: "focus_timer",
            updatedAt: new Date().toISOString(),
          });
        } else if (!dayBlocks[existingIdx].label) {
          dayBlocks[existingIdx] = {
            ...dayBlocks[existingIdx],
            label: enriched.label || "Deep Focus",
            category: hourlyCategory,
            updatedAt: new Date().toISOString(),
          };
        }
      }
      dayBlocks.sort((a, b) => a.slotIndex - b.slotIndex);
      allHourly[today] = dayBlocks;
      writeLocal("blocks_hourly", allHourly);
    }

    return enriched;
  },

  async listFocusSessions(): Promise<FocusSessionItem[]> {
    if (isTauriRuntime()) {
      return invoke<FocusSessionItem[]>("list_focus_sessions");
    }
    return readLocal<FocusSessionItem[]>("focus_sessions", () => []);
  },

  async getHeatmap60Days(cutoffHour?: number): Promise<HeatmapDay[]> {
    if (isTauriRuntime()) {
      return invoke<HeatmapDay[]>("get_heatmap_60_days");
    }
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    const out: HeatmapDay[] = [];
    for (let offset = 62; offset >= 0; offset--) {
      const date = getLogicalOffsetDate(offset, cutoff);
      const rec = dailyMap[date];
      const focusMinutes = rec?.focusMinutes ?? 0;
      const goalsCompleted = rec?.goalsCompleted ?? 0;
      out.push({
        date,
        focusMinutes,
        goalsCompleted,
        level: computeLevel(focusMinutes, goalsCompleted),
      });
    }
    return out;
  },

  async getAnalyticsDataset(cutoffHour?: number): Promise<AnalyticsDataset> {
    if (isTauriRuntime()) {
      return invoke<AnalyticsDataset>("get_analytics_dataset");
    }
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const logicalToday = getLogicalDate(new Date(), cutoff);

    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    const dailyActivity = Object.entries(dailyMap)
      .map(([date, v]) => ({
        date,
        focusMinutes: v.focusMinutes ?? 0,
        goalsCompleted: v.goalsCompleted ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const focusSessions = readLocal<FocusSessionItem[]>("focus_sessions", () => []);
    const hourlyMap = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
    const hourlyBlocks: ActivityBlockHourly[] = [];
    for (const list of Object.values(hourlyMap)) {
      hourlyBlocks.push(...list);
    }
    hourlyBlocks.sort(
      (a, b) => a.date.localeCompare(b.date) || a.slotIndex - b.slotIndex
    );

    const goalCompletions = readLocal<GoalCompletionLog[]>("goal_completions", () => []);

    const readingPagesMap = readLocal<Record<string, string[]>>("reading_pages_v1", () => ({}));
    const dailyReadingPages = Object.entries(readingPagesMap)
      .map(([logicalDate, keys]) => ({
        logicalDate,
        uniquePages: Array.isArray(keys) ? keys.length : 0,
      }))
      .sort((a, b) => a.logicalDate.localeCompare(b.logicalDate));

    const debriefSet = new Set<string>();
    const debriefMap = readLocal<Record<string, DailyDebriefRecord>>("daily_debriefs", () => ({}));
    for (const rec of Object.values(debriefMap)) {
      if (rec.published && rec.logicalDate) debriefSet.add(rec.logicalDate);
    }
    try {
      const vaultDates = await this.listDailyDebriefArchive();
      for (const d of vaultDates) debriefSet.add(d);
    } catch {
      // Dev bridge offline
    }

    return {
      logicalToday,
      dayRolloverHour: cutoff,
      dailyActivity,
      focusSessions,
      hourlyBlocks,
      goalCompletions,
      dailyReadingPages,
      publishedDebriefDates: Array.from(debriefSet).sort(),
      deviceTelemetry: readLocal<DeviceTelemetryRecord[]>("device_telemetry", () => []).sort(
        (a, b) => a.logicalDate.localeCompare(b.logicalDate)
      ),
      recallReviews: readLocal<RecallReviewLog[]>("recall_reviews", () => []),
    };
  },

  async regenerateIngestToken(): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("regenerate_ingest_token");
    }
    const cfg = await this.getConfig();
    const nextToken = generateBrowserToken32Bytes();
    writeLocal("config", { ...cfg, ingestApiToken: nextToken });
    return nextToken;
  },

  async getIngestServerStatus(): Promise<IngestServerStatus> {
    if (isTauriRuntime()) {
      return invoke<IngestServerStatus>("get_ingest_server_status");
    }
    const cfg = await this.getConfig();
    return {
      running: cfg.ingestEnabled,
      bindAddress: cfg.ingestBindLan ? "0.0.0.0:1429" : "127.0.0.1:1429",
      port: 1429,
      lanEnabled: cfg.ingestBindLan,
    };
  },

  async sendN8nEvent(
    eventName: string,
    payload: Record<string, unknown>,
    config?: AthenaeumConfig
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("send_n8n_event", { eventName, payload });
    }
    const cfg = config ?? (await this.getConfig());
    const url = (cfg.n8nWebhookUrl || "").trim();
    if (!url) return "n8n webhook URL not configured in Settings";
    try {
      const res = await fetch("/__dev/n8n-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, eventName, payload }),
      });
      if (res.ok) {
        const data = (await res.json()) as { message?: string };
        return data.message || "n8n webhook dispatched";
      }
    } catch {
      // Dev bridge unavailable
    }
    return "n8n webhook staged (use Tauri runtime for direct dispatch)";
  },

  async listDeviceTelemetry(): Promise<DeviceTelemetryRecord[]> {
    if (isTauriRuntime()) {
      return invoke<DeviceTelemetryRecord[]>("list_device_telemetry");
    }
    return readLocal<DeviceTelemetryRecord[]>("device_telemetry", () => []).sort((a, b) =>
      b.logicalDate.localeCompare(a.logicalDate)
    );
  },

  async upsertDeviceTelemetry(
    record: DeviceTelemetryRecord
  ): Promise<DeviceTelemetryRecord> {
    if (isTauriRuntime()) {
      return invoke<DeviceTelemetryRecord>("upsert_device_telemetry", { record });
    }
    const all = readLocal<DeviceTelemetryRecord[]>("device_telemetry", () => []);
    const idx = all.findIndex((r) => r.logicalDate === record.logicalDate);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        sleepHours: record.sleepHours ?? all[idx].sleepHours ?? null,
        screenTimeMinutes: record.screenTimeMinutes ?? all[idx].screenTimeMinutes ?? null,
        source: record.source || all[idx].source,
        updatedAt: record.updatedAt,
      };
    } else {
      all.push(record);
    }
    writeLocal("device_telemetry", all);
    return record;
  },

  async getRecallDeck(cutoffHour?: number): Promise<RecallDeckState> {
    if (isTauriRuntime()) {
      return invoke<RecallDeckState>("get_recall_deck");
    }
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const logicalToday = getLogicalDate(new Date(), cutoff);
    const weekAgo = getLogicalOffsetDate(6, cutoff);

    type ScannedItem = Omit<
      RecallCardItem,
      "easeFactor" | "intervalDays" | "nextDueLogicalDate" | "reviewCount"
    >;
    let parsedItems: ScannedItem[] = [];
    try {
      const res = await devVaultPost<{ items: ScannedItem[] }>("/recall-scan", {});
      parsedItems = res.items ?? [];
    } catch {
      parsedItems = [];
    }

    type StoredMeta = {
      sourceFile: string;
      sourceCategory: string;
      easeFactor: number;
      intervalDays: number;
      nextDueLogicalDate: string;
      reviewCount: number;
      lastReviewedAt?: string;
    };
    const metaMap = readLocal<Record<string, StoredMeta>>("recall_cards", () => ({}));
    let dirty = false;
    for (const item of parsedItems) {
      if (!metaMap[item.cardHash]) {
        metaMap[item.cardHash] = {
          sourceFile: item.sourceFile,
          sourceCategory: item.sourceCategory,
          easeFactor: 2.5,
          intervalDays: 0,
          nextDueLogicalDate: logicalToday,
          reviewCount: 0,
        };
        dirty = true;
      }
    }
    if (dirty) writeLocal("recall_cards", metaMap);

    const reviews = readLocal<RecallReviewLog[]>("recall_reviews", () => []);
    const reviewedToday = reviews.filter((r) => r.logicalDate === logicalToday).length;
    const weeklyReviewsCount = reviews.filter((r) => r.logicalDate >= weekAgo).length;

    const allDue: RecallCardItem[] = [];
    for (const item of parsedItems) {
      const m = metaMap[item.cardHash] ?? {
        easeFactor: 2.5,
        intervalDays: 0,
        nextDueLogicalDate: logicalToday,
        reviewCount: 0,
      };
      if (m.nextDueLogicalDate <= logicalToday) {
        allDue.push({
          ...item,
          easeFactor: m.easeFactor,
          intervalDays: m.intervalDays,
          nextDueLogicalDate: m.nextDueLogicalDate,
          reviewCount: m.reviewCount,
        });
      }
    }
    allDue.sort(
      (a, b) =>
        a.nextDueLogicalDate.localeCompare(b.nextDueLogicalDate) ||
        a.reviewCount - b.reviewCount ||
        a.cardHash.localeCompare(b.cardHash)
    );

    const dailyLimit = 5;
    const remainingSlots = Math.max(0, dailyLimit - reviewedToday);
    return {
      logicalToday,
      totalIndexed: parsedItems.length,
      totalDue: allDue.length,
      dailyLimit,
      reviewedToday,
      dueCards: allDue.slice(0, remainingSlots),
      weeklyReviewsCount,
    };
  },

  async reviewRecallCard(
    cardHash: string,
    rating: 1 | 2 | 3,
    cutoffHour?: number
  ): Promise<RecallReviewResult> {
    if (isTauriRuntime()) {
      return invoke<RecallReviewResult>("review_recall_card", { cardHash, rating });
    }
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const logicalToday = getLogicalDate(new Date(), cutoff);

    type StoredMeta = {
      sourceFile: string;
      sourceCategory: string;
      easeFactor: number;
      intervalDays: number;
      nextDueLogicalDate: string;
      reviewCount: number;
      lastReviewedAt?: string;
    };
    const metaMap = readLocal<Record<string, StoredMeta>>("recall_cards", () => ({}));
    const prev = metaMap[cardHash] ?? {
      sourceFile: "",
      sourceCategory: "snippet",
      easeFactor: 2.5,
      intervalDays: 0,
      nextDueLogicalDate: logicalToday,
      reviewCount: 0,
    };

    let nextEase = prev.easeFactor;
    let nextInterval = 1;
    if (rating === 1) {
      nextEase = Math.max(1.3, Number((prev.easeFactor - 0.25).toFixed(2)));
      nextInterval = 1;
    } else if (rating === 2) {
      nextEase = Math.max(1.3, Number((prev.easeFactor - 0.14).toFixed(2)));
      nextInterval =
        prev.intervalDays <= 1
          ? 2
          : Math.min(180, Math.max(2, Math.round(prev.intervalDays * 1.2)));
    } else {
      nextEase = Math.min(3.0, Number((prev.easeFactor + 0.1).toFixed(2)));
      if (prev.reviewCount === 0 || prev.intervalDays <= 0) nextInterval = 3;
      else if (prev.reviewCount === 1 || prev.intervalDays <= 3) nextInterval = 6;
      else nextInterval = Math.min(365, Math.max(3, Math.round(prev.intervalDays * prev.easeFactor)));
    }

    const [y, m, d] = logicalToday.split("-").map(Number);
    const dueDt = new Date(y, (m || 1) - 1, (d || 1) + nextInterval);
    const nextDue = `${dueDt.getFullYear()}-${String(dueDt.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(dueDt.getDate()).padStart(2, "0")}`;
    const nowIso = new Date().toISOString();
    const nextCount = prev.reviewCount + 1;

    metaMap[cardHash] = {
      ...prev,
      easeFactor: nextEase,
      intervalDays: nextInterval,
      nextDueLogicalDate: nextDue,
      reviewCount: nextCount,
      lastReviewedAt: nowIso,
    };
    writeLocal("recall_cards", metaMap);

    const reviews = readLocal<RecallReviewLog[]>("recall_reviews", () => []);
    reviews.unshift({
      id: `rr-${Date.now()}-${cardHash}`,
      cardHash,
      sourceCategory: prev.sourceCategory,
      rating,
      logicalDate: logicalToday,
      reviewedAt: nowIso,
    });
    writeLocal("recall_reviews", reviews.slice(0, 1000));

    const deck = await this.getRecallDeck(cutoff);
    return {
      cardHash,
      rating,
      nextEaseFactor: nextEase,
      nextIntervalDays: nextInterval,
      nextDueLogicalDate: nextDue,
      reviewCount: nextCount,
      deck,
    };
  },

  async openVaultFile(filePath: string): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("open_vault_file", { filePath });
    }
    return `Vault file: ${filePath}`;
  },

  async listActivityBlocksHourly(date: string): Promise<ActivityBlockHourly[]> {
    if (isTauriRuntime()) {
      return invoke<ActivityBlockHourly[]>("list_activity_blocks_hourly", { date });
    }
    // Migrate any legacy browser blocks_30m entries cleanly once
    if (window.localStorage.getItem("athenaeum_hourly_migrated_v1") !== "1") {
      const legacy = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_30m", () => ({}));
      const target = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
      for (const [d, list] of Object.entries(legacy)) {
        const map = new Map<number, ActivityBlockHourly>((target[d] ?? []).map((b) => [b.slotIndex, b]));
        for (const item of list) {
          const hourSlot = Math.max(0, Math.min(23, Math.floor(item.slotIndex / 2)));
          if (!map.has(hourSlot)) {
            map.set(hourSlot, { ...item, slotIndex: hourSlot });
          }
        }
        target[d] = Array.from(map.values()).sort((a, b) => a.slotIndex - b.slotIndex);
      }
      writeLocal("blocks_hourly", target);
      window.localStorage.setItem("athenaeum_hourly_migrated_v1", "1");
    }

    const all = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
    return (all[date] ?? []).sort((a, b) => a.slotIndex - b.slotIndex);
  },

  async upsertActivityBlockHourly(block: ActivityBlockHourly): Promise<ActivityBlockHourly> {
    if (isTauriRuntime()) {
      return invoke<ActivityBlockHourly>("upsert_activity_block_hourly", { block });
    }
    const all = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
    const list = [...(all[block.date] ?? [])];
    const clamped: ActivityBlockHourly = {
      ...block,
      slotIndex: Math.max(0, Math.min(23, block.slotIndex)),
    };
    const idx = list.findIndex((b) => b.slotIndex === clamped.slotIndex);
    if (idx >= 0) list[idx] = clamped;
    else list.push(clamped);
    list.sort((a, b) => a.slotIndex - b.slotIndex);
    all[block.date] = list;
    writeLocal("blocks_hourly", all);
    return clamped;
  },

  async deleteActivityBlockHourly(date: string, slotIndex: number): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_activity_block_hourly", { date, slotIndex });
      return;
    }
    const all = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
    all[date] = (all[date] ?? []).filter((b) => b.slotIndex !== slotIndex);
    writeLocal("blocks_hourly", all);
  },

  async listExternalCalendarEvents(): Promise<ExternalCalendarEvent[]> {
    if (isTauriRuntime()) {
      return invoke<ExternalCalendarEvent[]>("list_external_calendar_events");
    }
    return readLocal<ExternalCalendarEvent[]>("external_calendar_events", () => []);
  },

  async syncIcsCalendars(urlsOverride?: string[]): Promise<IcsSyncReport> {
    if (isTauriRuntime()) {
      return invoke<IcsSyncReport>("sync_ics_calendars");
    }
    const cfg = await this.getConfig();
    const urls = (urlsOverride ?? cfg.calendarIcsUrls ?? []).filter((u) => u.trim());
    if (urls.length === 0) {
      writeLocal("external_calendar_events", []);
      return { feedsChecked: 0, eventsSynced: 0, errors: [] };
    }
    const res = await fetch("/__dev/ics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const payload = (await res.json()) as {
      events: ExternalCalendarEvent[];
      report: IcsSyncReport;
    };
    writeLocal("external_calendar_events", payload.events ?? []);
    return payload.report;
  },

  async generateWeeklySynthesis(endOffsetDays = 0): Promise<WeeklySynthesisReport> {
    if (isTauriRuntime()) {
      return invoke<WeeklySynthesisReport>("generate_weekly_synthesis");
    }
    const cfg = await this.getConfig();
    const cutoff = cfg.dayRolloverHour ?? 3;
    const dates = Array.from({ length: 7 }, (_, i) =>
      getLogicalOffsetDate(endOffsetDays + (6 - i), cutoff)
    );
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // ISO week calculation
    const [y, m, d] = endDate.split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const weekKey = `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;

    const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
      "daily_activity",
      () => ({})
    );
    let totalFocusMinutes = 0;
    let activityGoalsDone = 0;
    for (const dayIso of dates) {
      totalFocusMinutes += dailyMap[dayIso]?.focusMinutes ?? 0;
      activityGoalsDone += dailyMap[dayIso]?.goalsCompleted ?? 0;
    }

    const goals = await this.listGoals();
    const planned = goals.filter((g) => g.scope === "daily" || g.scope === "weekly").length;
    const done = Math.max(
      activityGoalsDone,
      goals.filter((g) => (g.scope === "daily" || g.scope === "weekly") && g.completed).length
    );

    const allHourly = readLocal<Record<string, ActivityBlockHourly[]>>("blocks_hourly", () => ({}));
    const categoryHours: Record<string, number> = {};
    for (const dayIso of dates) {
      for (const blk of allHourly[dayIso] ?? []) {
        categoryHours[blk.category] = (categoryHours[blk.category] ?? 0) + 1;
      }
    }

    const res = await devVaultPost<{ report: WeeklySynthesisReport }>("/weekly", {
      weekKey,
      startDate,
      endDate,
      dates,
      totalFocusMinutes,
      goalsCompleted: done,
      goalsPlanned: Math.max(planned, done),
      categoryHours,
      n8nWebhookUrl: cfg.n8nWebhookUrl,
    });
    window.localStorage.setItem("athenaeum_weekly_synthesis_last_week", weekKey);
    return res.report;
  },

  async checkAutoWeeklySynthesis(): Promise<WeeklySynthesisReport | null> {
    if (isTauriRuntime()) {
      return invoke<WeeklySynthesisReport | null>("check_auto_weekly_synthesis");
    }
    const cfg = await this.getConfig();
    if (!cfg.autoWeeklySynthesis) return null;
    const cutoff = cfg.dayRolloverHour ?? 3;
    const now = new Date();
    const logicalToday = getLogicalDate(now, cutoff);
    const [ly, lm, ld] = logicalToday.split("-").map(Number);
    const logicalDow = new Date(ly, (lm || 1) - 1, ld || 1).getDay(); // 0=Sun, 1=Mon

    let endOffsetDays: number | null = null;
    if (logicalDow === 0 && now.getHours() >= 18) {
      endOffsetDays = 0;
    } else if (logicalDow === 1) {
      endOffsetDays = 1;
    } else {
      return null;
    }

    const targetEnd = getLogicalOffsetDate(endOffsetDays, cutoff);
    const [y, m, d] = targetEnd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const weekKey = `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;

    if (window.localStorage.getItem("athenaeum_weekly_synthesis_last_week") === weekKey) {
      return null;
    }
    const reflections = await this.listReflections();
    const expectedName = `${weekKey}-Weekly-Review.md`.toLowerCase();
    if (reflections.some((r) => r.fileName.toLowerCase() === expectedName)) {
      window.localStorage.setItem("athenaeum_weekly_synthesis_last_week", weekKey);
      return null;
    }
    return this.generateWeeklySynthesis(endOffsetDays);
  },

  async executeQuickCapture(input: string): Promise<QuickCaptureResult> {
    if (isTauriRuntime()) {
      return invoke<QuickCaptureResult>("execute_quick_capture", { input });
    }
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Empty command");
    const cutoff = getLocalRolloverHour();
    const logicalToday = getLogicalDate(new Date(), cutoff);
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("n:")) {
      const thought = trimmed.slice(2).trim();
      const title = thought.split(/\s+/).slice(0, 5).join(" ") || "Quick Note";
      const res = await devVaultPost<{ ok: boolean; filePath: string }>("/promote", {
        logicalDate: logicalToday,
        title,
        content: thought,
      });
      return { kind: "inbox", message: `Captured to Vault /Inbox (${res.filePath})` };
    }

    if (lower.startsWith("s:")) {
      const noteText = trimmed.slice(2).trim();
      const note: StickyNoteItem = {
        id: `note-${Date.now()}`,
        title: "Quick Note",
        content: noteText,
        collapsed: false,
        x: 5,
        y: 12,
        updatedAt: new Date().toISOString(),
      };
      await this.upsertNote(note);
      return { kind: "sticky", message: "Sticky note added to Overview" };
    }

    if (lower.startsWith("f:")) {
      const spec = trimmed.slice(2).trim().toLowerCase();
      if (!spec || spec === "open") {
        return { kind: "focus", message: "Started Open Focus Session", focusOpen: true, focusSeconds: null };
      }
      let secs: number | null = null;
      if (spec.includes(":")) {
        const [m, s] = spec.split(":").map((x) => Number(x.trim()));
        if (Number.isFinite(m) && Number.isFinite(s) && m * 60 + s > 0) {
          secs = Math.floor(m) * 60 + Math.floor(s);
        }
      } else {
        const mins = Number(spec.replace(/m$/, "").trim());
        if (Number.isFinite(mins) && mins > 0) {
          secs = Math.round(mins * 60);
        }
      }
      return {
        kind: "focus",
        message: secs ? `Started Focus Session (${secs}s)` : "Started Open Focus Session",
        focusOpen: !secs,
        focusSeconds: secs,
      };
    }

    const taskTitle = lower.startsWith("t:") ? trimmed.slice(2).trim() : trimmed;
    const goals = await this.listGoals();
    const maxOrder = goals
      .filter((g) => g.scope === "daily")
      .reduce((acc, g) => Math.max(acc, g.sortOrder), -1);
    await this.upsertGoal({
      id: `g-qc-${Date.now()}`,
      scope: "daily",
      title: taskTitle,
      durationMinutes: 30,
      completed: false,
      priority: "medium",
      dueDate: logicalToday,
      sortOrder: maxOrder + 1,
      createdAt: new Date().toISOString(),
    });
    return { kind: "task", message: `Added Daily Goal: ${taskTitle}` };
  },

  async hideQuickCapture(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("hide_quick_capture");
    }
  },

  async listScheduleBlocks(): Promise<ScheduleBlock[]> {
    if (isTauriRuntime()) {
      return invoke<ScheduleBlock[]>("list_schedule_blocks");
    }
    return readLocal<ScheduleBlock[]>("schedule", () => []);
  },

  async upsertScheduleBlock(block: ScheduleBlock): Promise<ScheduleBlock> {
    if (isTauriRuntime()) {
      return invoke<ScheduleBlock>("upsert_schedule_block", { block });
    }
    const items = readLocal<ScheduleBlock[]>("schedule", () => []);
    const idx = items.findIndex((b) => b.id === block.id);
    if (idx >= 0) items[idx] = block;
    else items.push(block);
    items.sort((a, b) => a.startTime.localeCompare(b.startTime));
    writeLocal("schedule", items);
    return block;
  },

  async deleteScheduleBlock(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_schedule_block", { id });
      return;
    }
    const items = readLocal<ScheduleBlock[]>("schedule", () => []).filter((b) => b.id !== id);
    writeLocal("schedule", items);
  },

  async listRecurringFocusBlocks(): Promise<RecurringFocusBlock[]> {
    if (isTauriRuntime()) {
      return invoke<RecurringFocusBlock[]>("list_recurring_focus_blocks");
    }
    return readLocal<RecurringFocusBlock[]>("recurring_focus_blocks", () => []).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
  },

  async upsertRecurringFocusBlock(block: RecurringFocusBlock): Promise<RecurringFocusBlock> {
    const normalized: RecurringFocusBlock = {
      ...block,
      durationMinutes: Math.max(15, Math.min(480, Math.round(block.durationMinutes))),
      createdAt: block.createdAt || new Date().toISOString(),
    };
    if (isTauriRuntime()) {
      return invoke<RecurringFocusBlock>("upsert_recurring_focus_block", { block: normalized });
    }
    const items = readLocal<RecurringFocusBlock[]>("recurring_focus_blocks", () => []);
    const idx = items.findIndex((b) => b.id === normalized.id);
    if (idx >= 0) items[idx] = normalized;
    else items.push(normalized);
    items.sort((a, b) => a.startTime.localeCompare(b.startTime));
    writeLocal("recurring_focus_blocks", items);
    return normalized;
  },

  async deleteRecurringFocusBlock(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_recurring_focus_block", { id });
      return;
    }
    const items = readLocal<RecurringFocusBlock[]>("recurring_focus_blocks", () => []).filter(
      (b) => b.id !== id
    );
    writeLocal("recurring_focus_blocks", items);
    const ov = readLocal<RecurringBlockOverride[]>("recurring_block_overrides", () => []).filter(
      (o) => o.blockId !== id
    );
    writeLocal("recurring_block_overrides", ov);
  },

  async listRecurringBlockOverrides(): Promise<RecurringBlockOverride[]> {
    if (isTauriRuntime()) {
      return invoke<RecurringBlockOverride[]>("list_recurring_block_overrides");
    }
    return readLocal<RecurringBlockOverride[]>("recurring_block_overrides", () => []);
  },

  async upsertRecurringBlockOverride(
    item: RecurringBlockOverride
  ): Promise<RecurringBlockOverride> {
    const normalized: RecurringBlockOverride = {
      ...item,
      updatedAt: new Date().toISOString(),
    };
    if (isTauriRuntime()) {
      return invoke<RecurringBlockOverride>("upsert_recurring_block_override", {
        item: normalized,
      });
    }
    const items = readLocal<RecurringBlockOverride[]>("recurring_block_overrides", () => []);
    const idx = items.findIndex(
      (o) => o.blockId === normalized.blockId && o.logicalDate === normalized.logicalDate
    );
    if (idx >= 0) items[idx] = normalized;
    else items.push(normalized);
    writeLocal("recurring_block_overrides", items);
    return normalized;
  },

  async deleteRecurringBlockOverride(blockId: string, logicalDate: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_recurring_block_override", { blockId, logicalDate });
      return;
    }
    const items = readLocal<RecurringBlockOverride[]>("recurring_block_overrides", () => []).filter(
      (o) => !(o.blockId === blockId && o.logicalDate === logicalDate)
    );
    writeLocal("recurring_block_overrides", items);
  },

  async listJournalEntries(): Promise<JournalEntry[]> {
    if (isTauriRuntime()) {
      return invoke<JournalEntry[]>("list_journal_entries");
    }
    return readLocal<JournalEntry[]>("journal", () => []);
  },

  async upsertJournalEntry(entry: JournalEntry): Promise<JournalEntry> {
    if (isTauriRuntime()) {
      return invoke<JournalEntry>("upsert_journal_entry", { entry });
    }
    const items = readLocal<JournalEntry[]>("journal", () => []);
    const idx = items.findIndex((e) => e.id === entry.id);
    if (idx >= 0) items[idx] = entry;
    else items.unshift(entry);
    writeLocal("journal", items);
    return entry;
  },

  async listLibraryBooks(): Promise<LibraryBook[]> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook[]>("list_library_books");
    }
    const items = readLocal<LibraryBook[]>("books", () => []);
    return items.sort((a, b) => {
      if (a.lastOpenedAt && b.lastOpenedAt) {
        return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      }
      if (a.lastOpenedAt) return -1;
      if (b.lastOpenedAt) return 1;
      return a.title.localeCompare(b.title);
    });
  },

  async upsertLibraryBook(book: LibraryBook): Promise<LibraryBook> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook>("upsert_library_book", { book });
    }
    const items = readLocal<LibraryBook[]>("books", () => []);
    const idx = items.findIndex((b) => b.id === book.id);
    if (idx >= 0) items[idx] = book;
    else items.push(book);
    writeLocal("books", items);
    return book;
  },

  async saveBookCoverThumbnail(
    bookId: string,
    coverThumbnail: string
  ): Promise<LibraryBook | null> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook>("save_book_cover_thumbnail", {
        bookId,
        coverThumbnail,
      });
    }
    const items = readLocal<LibraryBook[]>("books", () => []);
    const idx = items.findIndex((b) => b.id === bookId);
    if (idx < 0) return null;
    const updated: LibraryBook = { ...items[idx], coverThumbnail };
    items[idx] = updated;
    writeLocal("books", items);
    return updated;
  },

  async scanBooksFolder(folderOverride?: string): Promise<LibraryBook[]> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook[]>("scan_books_folder");
    }
    const cfg = await this.getConfig();
    const folder = (folderOverride ?? cfg.booksFolderPath ?? "").trim();
    if (!folder) {
      return this.listLibraryBooks();
    }
    try {
      const res = await fetch(`/__dev/books/scan?folder=${encodeURIComponent(folder)}`);
      if (!res.ok) return this.listLibraryBooks();
      const payload = (await res.json()) as {
        files?: { filePath: string; title: string; author: string; format: "pdf" | "epub" }[];
      };
      const existing = readLocal<LibraryBook[]>("books", () => []);
      const byPath = new Map(
        existing
          .filter((b) => b.filePath)
          .map((b) => [b.filePath.toLowerCase(), b])
      );
      for (const f of payload.files ?? []) {
        const key = f.filePath.toLowerCase();
        if (byPath.has(key)) continue;
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) {
          hash ^= key.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        const id = `book-${(hash >>> 0).toString(16).padStart(8, "0")}`;
        existing.push({
          id,
          title: f.title,
          author: f.author,
          status: "queued",
          progressPercent: 0,
          notes: "",
          filePath: f.filePath,
          format: f.format,
          currentPage: 1,
          totalPages: 0,
          scrollOffset: 0,
          lastOpenedAt: null,
          epubCfi: "",
        });
      }
      writeLocal("books", existing);
    } catch {
      // Dev bridge unavailable
    }
    return this.listLibraryBooks();
  },

  async pickBooksFolder(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("pick_books_folder");
    }
    return null;
  },

  async pickAndAddBook(): Promise<LibraryBook | null> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook | null>("pick_and_add_book");
    }
    return null;
  },

  async readBookBytes(filePath: string): Promise<ArrayBuffer> {
    if (isTauriRuntime()) {
      try {
        const raw = await invoke<ArrayBuffer | Uint8Array | number[]>("read_book_file", {
          filePath,
        });
        if (raw instanceof ArrayBuffer) return raw;
        if (raw instanceof Uint8Array) {
          return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        }
        return new Uint8Array(raw).buffer;
      } catch {
        // Fallback to standard JSON-safe base64 IPC if WebView2 binary response fetch fails
        const b64 = await invoke<string>("read_book_file_base64", { filePath });
        return decodeBase64ToArrayBuffer(b64);
      }
    }
    try {
      const res = await fetch(`/__dev/books/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        throw new Error(`Unable to load book file (${res.status})`);
      }
      return await res.arrayBuffer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("failed to fetch")) {
        throw new Error("Could not read this book file. Restart Athenaeum or check the Books folder in Settings.");
      }
      throw err;
    }
  },

  async updateBookProgress(
    bookId: string,
    currentPage: number,
    totalPages: number,
    scrollOffset: number,
    epubCfi?: string
  ): Promise<LibraryBook> {
    if (isTauriRuntime()) {
      return invoke<LibraryBook>("update_book_progress", {
        bookId,
        currentPage,
        totalPages,
        scrollOffset,
        epubCfi: epubCfi ?? "",
      });
    }
    const items = readLocal<LibraryBook[]>("books", () => []);
    const page = Math.max(1, Math.floor(currentPage));
    const nowIso = new Date().toISOString();
    let updated: LibraryBook | null = null;
    const next = items.map((b) => {
      if (b.id !== bookId) return b;
      const total = totalPages > 0 ? totalPages : b.totalPages;
      const pct = total > 0 ? Math.min(100, Math.round((page / total) * 100)) : b.progressPercent;
      const status: LibraryBook["status"] = total > 0 && page >= total ? "finished" : "reading";
      updated = {
        ...b,
        currentPage: page,
        totalPages: total,
        progressPercent: pct,
        scrollOffset,
        lastOpenedAt: nowIso,
        status,
        epubCfi: epubCfi || b.epubCfi || "",
      };
      return updated;
    });
    writeLocal("books", next);
    if (!updated) throw new Error("Book not found");
    return updated;
  },

  async getDailyReadingProgress(cutoffHour?: number): Promise<DailyReadingProgress> {
    if (isTauriRuntime()) {
      return invoke<DailyReadingProgress>("get_daily_reading_progress");
    }
    const cfg = readLocal<Partial<AthenaeumConfig>>("config", () => DEFAULT_CONFIG);
    const habitEnabled = Boolean(cfg.dailyReadingHabitEnabled);
    const targetPages =
      typeof cfg.dailyReadingTargetPages === "number" && cfg.dailyReadingTargetPages >= 1
        ? Math.round(cfg.dailyReadingTargetPages)
        : 10;
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const logicalDate = getLogicalDate(new Date(), cutoff);
    const map = readLocal<Record<string, string[]>>("daily_reading_pages", () => ({}));
    const pagesReadToday = (map[logicalDate] ?? []).length;
    return {
      logicalDate,
      pagesReadToday,
      targetPages,
      goalCompleted: habitEnabled && pagesReadToday >= targetPages,
      goalAutoCheckedNow: false,
    };
  },

  async recordReadingPage(
    bookId: string,
    pageNumber: number,
    cutoffHour?: number
  ): Promise<DailyReadingProgress> {
    if (isTauriRuntime()) {
      return invoke<DailyReadingProgress>("record_reading_page", { bookId, pageNumber });
    }
    const cfg = readLocal<Partial<AthenaeumConfig>>("config", () => DEFAULT_CONFIG);
    const habitEnabled = Boolean(cfg.dailyReadingHabitEnabled);
    const targetPages =
      typeof cfg.dailyReadingTargetPages === "number" && cfg.dailyReadingTargetPages >= 1
        ? Math.round(cfg.dailyReadingTargetPages)
        : 10;
    const cutoff = cutoffHour ?? getLocalRolloverHour();
    const logicalDate = getLogicalDate(new Date(), cutoff);
    const map = readLocal<Record<string, string[]>>("daily_reading_pages", () => ({}));
    const key = `${bookId}::${Math.max(1, Math.floor(pageNumber))}`;
    const set = new Set(map[logicalDate] ?? []);
    set.add(key);
    map[logicalDate] = Array.from(set);
    writeLocal("daily_reading_pages", map);

    const pagesReadToday = set.size;
    const goalCompleted = habitEnabled && pagesReadToday >= targetPages;
    let goalAutoCheckedNow = false;

    if (goalCompleted) {
      const goals = readLocal<GoalItem[]>("goals", () => []);
      const readingGoalId = `daily-reading-${logicalDate}`;
      let targetGoal = goals.find((g) => g.scope === "daily" && g.id === readingGoalId);
      if (!targetGoal) {
        const maxOrder = goals
          .filter((g) => g.scope === "daily")
          .reduce((acc, g) => Math.max(acc, g.sortOrder), -1);
        targetGoal = {
          id: readingGoalId,
          scope: "daily",
          title: `Daily Reading (${targetPages} pages)`,
          durationMinutes: 20,
          completed: false,
          priority: "medium",
          dueDate: logicalDate,
          sortOrder: maxOrder + 1,
          createdAt: new Date().toISOString(),
        };
        goals.push(targetGoal);
      }
      if (!targetGoal.completed) {
        targetGoal.completed = true;
        goalAutoCheckedNow = true;
        writeLocal("goals", goals);

        const dailyMap = readLocal<Record<string, { focusMinutes: number; goalsCompleted: number }>>(
          "daily_activity",
          () => ({})
        );
        dailyMap[logicalDate] = {
          focusMinutes: dailyMap[logicalDate]?.focusMinutes ?? 0,
          goalsCompleted: (dailyMap[logicalDate]?.goalsCompleted ?? 0) + 1,
        };
        writeLocal("daily_activity", dailyMap);
      }
    }

    return {
      logicalDate,
      pagesReadToday,
      targetPages,
      goalCompleted,
      goalAutoCheckedNow,
    };
  },

  async listBookHighlights(bookId: string): Promise<BookHighlight[]> {
    if (isTauriRuntime()) {
      return invoke<BookHighlight[]>("list_book_highlights", { bookId });
    }
    const all = readLocal<Record<string, BookHighlight[]>>("book_highlights", () => ({}));
    return (all[bookId] ?? []).sort(
      (a, b) => a.pageNumber - b.pageNumber || b.createdAt.localeCompare(a.createdAt)
    );
  },

  async addBookHighlight(
    highlight: BookHighlight,
    bookTitle: string,
    bookAuthor: string
  ): Promise<{ highlight: BookHighlight; vaultFilePath: string }> {
    if (isTauriRuntime()) {
      return invoke<{ highlight: BookHighlight; vaultFilePath: string }>("add_book_highlight", {
        highlight,
        bookTitle,
        bookAuthor,
      });
    }
    const all = readLocal<Record<string, BookHighlight[]>>("book_highlights", () => ({}));
    const list = [...(all[highlight.bookId] ?? []).filter((h) => h.id !== highlight.id), highlight];
    list.sort((a, b) => a.pageNumber - b.pageNumber || b.createdAt.localeCompare(a.createdAt));
    all[highlight.bookId] = list;
    writeLocal("book_highlights", all);

    let vaultFilePath = `${DEFAULT_VAULT_PATH}\\Books\\${bookTitle}.md`;
    try {
      const res = await devVaultPost<{ ok: boolean; filePath: string }>("/book-note", {
        bookTitle,
        bookAuthor,
        pageNumber: highlight.pageNumber,
        quote: highlight.quote,
        note: highlight.note,
        createdAt: highlight.createdAt,
      });
      if (res.filePath) vaultFilePath = res.filePath;
    } catch {
      // Dev bridge unavailable outside dev server
    }
    return { highlight, vaultFilePath };
  },

  async deleteBookHighlight(bookId: string, id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_book_highlight", { id });
      return;
    }
    const all = readLocal<Record<string, BookHighlight[]>>("book_highlights", () => ({}));
    all[bookId] = (all[bookId] ?? []).filter((h) => h.id !== id);
    writeLocal("book_highlights", all);
  },

  async triggerReadingLightWebhook(
    enabled: boolean,
    config: AthenaeumConfig
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("trigger_reading_light_webhook", { enabled });
    }
    const url = (config.haReadingWebhookUrl || config.homeAssistantWebhookUrl || "").trim();
    if (!url) {
      return `Reading light ${enabled ? "on" : "off"} (configure HA webhook in Settings)`;
    }
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.homeAssistantToken.trim()) {
        headers.Authorization = `Bearer ${config.homeAssistantToken.trim()}`;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "athenaeum",
          event: "reading_light",
          state: enabled ? "on" : "off",
          entity_id: config.haReadingLightEntity || config.haEntityId || "",
          color_temp_kelvin: 2700,
          brightness_pct: enabled ? 45 : 0,
        }),
      });
      return `Reading light ${enabled ? "on" : "off"} (HTTP ${res.status})`;
    } catch {
      return `Reading light ${enabled ? "on" : "off"} (queued for Tauri LAN dispatch)`;
    }
  },

  async listTocNodes(): Promise<TocNode[]> {
    if (isTauriRuntime()) {
      return invoke<TocNode[]>("list_toc_nodes");
    }
    return readLocal<TocNode[]>("toc", () => []);
  },

  async upsertTocNode(node: TocNode): Promise<TocNode> {
    if (isTauriRuntime()) {
      return invoke<TocNode>("upsert_toc_node", { node });
    }
    const items = readLocal<TocNode[]>("toc", () => []);
    const idx = items.findIndex((n) => n.id === node.id);
    if (idx >= 0) items[idx] = node;
    else items.push(node);
    writeLocal("toc", items);
    return node;
  },

  async listTocTrees(): Promise<TocTreeRecord[]> {
    if (isTauriRuntime()) {
      return invoke<TocTreeRecord[]>("list_toc_trees");
    }
    const items = readLocal<TocTreeRecord[]>("toc_trees", () => []);
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async upsertTocTree(tree: TocTreeRecord, cutoffHour?: number): Promise<TocTreeRecord> {
    if (isTauriRuntime()) {
      return invoke<TocTreeRecord>("upsert_toc_tree", { tree });
    }
    const nowIso = new Date().toISOString();
    const logicalDate = getLogicalDate(new Date(), cutoffHour ?? getLocalRolloverHour());
    let vaultFilePath = tree.vaultFilePath ?? `${DEFAULT_VAULT_PATH}\\TOC\\${logicalDate} - ${tree.title}.md`;
    try {
      const res = await devVaultPost<{ ok: boolean; filePath: string }>("/toc-save", {
        logicalDate,
        title: tree.title,
        frameworkType: tree.frameworkType,
        tags: tree.tags,
        graphJson: tree.graphJson,
      });
      if (res.filePath) vaultFilePath = res.filePath;
    } catch {
      // Dev bridge unavailable outside dev server
    }

    const saved: TocTreeRecord = {
      ...tree,
      createdAt: tree.createdAt || nowIso,
      updatedAt: nowIso,
      vaultFilePath,
    };
    const items = readLocal<TocTreeRecord[]>("toc_trees", () => []);
    const idx = items.findIndex((t) => t.id === saved.id);
    if (idx >= 0) items[idx] = saved;
    else items.unshift(saved);
    writeLocal("toc_trees", items);
    return saved;
  },

  async deleteTocTree(id: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("delete_toc_tree", { id });
      return;
    }
    const items = readLocal<TocTreeRecord[]>("toc_trees", () => []).filter((t) => t.id !== id);
    writeLocal("toc_trees", items);
  },

  async triggerHomeAssistantWebhook(
    event: string,
    mode: string,
    config: AthenaeumConfig
  ): Promise<string> {
    if (isTauriRuntime()) {
      return invoke<string>("trigger_ha_webhook", { event, mode });
    }
    if (!config.homeAssistantWebhookUrl.trim()) {
      return "Home Assistant webhook not configured in Settings";
    }
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.homeAssistantToken.trim()) {
        headers.Authorization = `Bearer ${config.homeAssistantToken.trim()}`;
      }
      const res = await fetch(config.homeAssistantWebhookUrl.trim(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "athenaeum",
          event,
          mode,
          entity_id: config.homeAssistantFocusEntity,
        }),
      });
      return `Webhook dispatched (HTTP ${res.status})`;
    } catch {
      return "Webhook queued (configure local Tauri runtime for direct LAN dispatch)";
    }
  },

  async setHaLightState(
    command: HaLightCommand,
    config: AthenaeumConfig
  ): Promise<HaLightResult> {
    const safeBrightness = Math.max(1, Math.min(100, Math.round(command.brightnessPct || 45)));
    const safeCmd: HaLightCommand = {
      ...command,
      brightnessPct: safeBrightness,
      entityId: command.entityId?.trim() || config.haEntityId?.trim() || "",
    };

    if (isTauriRuntime()) {
      return invoke<HaLightResult>("set_ha_light_state", { command: safeCmd });
    }

    const baseUrl = (config.haBaseUrl || "").trim().replace(/\/+$/, "");
    const token = (config.haToken || config.homeAssistantToken || "").trim();
    if (!baseUrl || !safeCmd.entityId) {
      return {
        ok: false,
        endpoint: "",
        entityId: safeCmd.entityId ?? "",
        appliedBrightnessPct: safeBrightness,
        message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.",
      };
    }
    const endpoint = `${baseUrl}/api/services/light/turn_on`;

    try {
      const res = await fetch("/__dev/ha-light", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          token,
          command: safeCmd,
        }),
      });
      if (res.ok) {
        return (await res.json()) as HaLightResult;
      }
    } catch {
      // Dev bridge unavailable outside Vite dev server
    }

    return {
      ok: false,
      endpoint,
      entityId: safeCmd.entityId ?? "",
      appliedBrightnessPct: safeBrightness,
      message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.",
    };
  },

  async openExternalUrl(url: string): Promise<string> {
    const trimmed = url.trim();
    if (!trimmed) return "No playlist URL set";
    if (isTauriRuntime()) {
      return invoke<string>("open_external_url", { url: trimmed });
    }
    try {
      window.open(trimmed, "_blank", "noopener,noreferrer");
    } catch {
      // Ignore popup blocker in headless browser
    }
    return `Opened ${trimmed}`;
  },

  async getMediaState(): Promise<MediaSessionState> {
    if (isTauriRuntime()) {
      try {
        return await invoke<MediaSessionState>("get_media_state");
      } catch {
        return EMPTY_MEDIA;
      }
    }
    return EMPTY_MEDIA;
  },

  async sendMediaControl(
    action: "previous" | "play_pause" | "next" | "toggle_shuffle" | "cycle_repeat" | `seek:${number}`
  ): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke("media_control", { action });
      } catch {
        // Ignore if SMTC unavailable
      }
    }
  },

  async launchAppleMusic(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke("launch_apple_music");
      } catch {
        // Fallback already handled in Rust; ignore runtime errors
      }
      return;
    }
    try {
      window.open("https://music.apple.com", "_blank", "noopener,noreferrer");
    } catch {
      // Ignore popup blocker
    }
  },

  async launchSpotify(): Promise<void> {
    if (isTauriRuntime()) {
      try {
        await invoke("launch_spotify");
      } catch {
        // Fallback already handled in Rust; ignore runtime errors
      }
      return;
    }
    try {
      window.open("https://open.spotify.com", "_blank", "noopener,noreferrer");
    } catch {
      // Ignore popup blocker
    }
  },

  async launchMusicPlayer(preference: MusicPlayerPreference): Promise<void> {
    if (preference === "spotify") {
      await this.launchSpotify();
    } else if (preference === "apple_music") {
      await this.launchAppleMusic();
    }
  },
};
