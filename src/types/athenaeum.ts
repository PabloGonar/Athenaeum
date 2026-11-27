export type GoalScope = "daily" | "weekly" | "longTerm";

export type GoalRecurrence =
  | "once"
  | "daily"
  | "weekly"
  | "specific_days"
  | "long_term";

export type TimeFormat = "12h" | "24h";

export type JournalMode = "debrief" | "reflections";

export type ActivityBlockCategory =
  | "deep_work"
  | "strategy"
  | "admin"
  | "break"
  | "custom";

export type MiniAppId =
  | null
  | "goals"
  | "focus"
  | "calendar"
  | "library"
  | "toc"
  | "analytics"
  | "journal"
  | "automations"
  | "settings";

export interface QuoteItem {
  text: string;
  author: string;
}

export interface HaLightPreset {
  name: string;
  mode: "rgb" | "kelvin" | "scene";
  rgbColor: [number, number, number];
  kelvin: number;
  brightnessPct: number; // 0..100%
  sceneEntityId?: string;
}

export interface HaLightCommand {
  mode: "rgb" | "kelvin" | "scene";
  rgbColor?: [number, number, number];
  kelvin?: number;
  brightnessPct: number;
  entityId?: string;
  sceneEntityId?: string;
  transition?: number;
}

export interface HaLightResult {
  ok: boolean;
  endpoint: string;
  entityId: string;
  appliedBrightnessPct: number;
  message: string;
}

export type PlaylistPlatform = "apple_music" | "youtube" | "spotify";

export type MusicPlayerPreference = "apple_music" | "spotify" | "none";

export interface PlaylistShortcut {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  platform?: PlaylistPlatform;
}

export interface CalendarFeedConfig {
  id: string;
  label: string;
  url: string;
}

export interface DeviceTelemetryRecord {
  logicalDate: string;
  sleepHours?: number | null;
  screenTimeMinutes?: number | null;
  source: string;
  updatedAt: string;
}

export interface IngestServerStatus {
  running: boolean;
  bindAddress: string;
  port: number;
  lanEnabled: boolean;
}

export interface AthenaeumConfig {
  userName: string;
  timeFormat: TimeFormat;
  dayRolloverHour: number;
  vaultPath: string;
  booksFolderPath: string;
  upperBackgroundPath: string;
  lowerBackgroundPath: string;
  quotes: QuoteItem[];
  homeAssistantWebhookUrl: string;
  homeAssistantToken: string;
  homeAssistantFocusEntity: string;
  haBaseUrl: string;
  haToken: string;
  haEntityId: string;
  haFocusPreset: HaLightPreset;
  haNonFocusPreset: HaLightPreset;
  haReadingPreset: HaLightPreset;
  haAutoLight: boolean;
  playlists: PlaylistShortcut[];
  haReadingWebhookUrl: string;
  haReadingLightEntity: string;
  n8nWebhookUrl: string;
  n8nTriggerWeeklySynthesis: boolean;
  n8nTriggerDailyDebrief: boolean;
  n8nTriggerGoalCompleted: boolean;
  ingestEnabled: boolean;
  ingestBindLan: boolean;
  ingestApiToken: string;
  audioBridgeUrl: string;
  activityTrackerPath: string;
  calendarIcsUrls: string[];
  calendarFeeds: CalendarFeedConfig[];
  calendarLastSyncedAt?: string | null;
  quickCaptureShortcut: string;
  autoWeeklySynthesis: boolean;
  launchOnStartup: boolean;
  focusDimOpacity: number;
  dailyFocusTargetMinutes: number;
  onboardingCompleted: boolean;
  preferredMusicPlayer: MusicPlayerPreference;
  dailyReadingHabitEnabled: boolean;
  dailyReadingTargetPages: number;
  externalDbUrl: string;
}

export interface ImportReport {
  sourcePath: string;
  dailyGoalsImported: number;
  weeklyGoalsImported: number;
  longTermGoalsImported: number;
  focusSessionsImported: number;
  activityDaysImported: number;
  journalEntriesImported: number;
  activeDate?: string | null;
  activeWeek?: string | null;
}

export interface GoalItem {
  id: string;
  scope: GoalScope;
  title: string;
  durationMinutes: number;
  completed: boolean;
  priority: "high" | "medium" | "low";
  dueDate?: string | null;
  sortOrder: number;
  createdAt: string;
  description?: string;
  category?: string;
  recurrence?: GoalRecurrence;
  specificDays?: number[]; // 0 = Mon .. 6 = Sun
  targetCount?: number;
  currentCount?: number;
  unitLabel?: string;
  lastResetPeriod?: string;
}

export interface GoalMilestone {
  id: string;
  goalId: string;
  title: string;
  completed: boolean;
  completedAt?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface GoalCompletionLog {
  id: string;
  goalId: string;
  goalTitle: string;
  category: string;
  logicalDate: string;
  periodKey: string;
  loggedValue: number;
  targetValue: number;
  completedAt: string;
}

export interface StickyNoteItem {
  id: string;
  title: string;
  content: string;
  collapsed: boolean;
  x: number;
  y: number;
  updatedAt: string;
}

export interface FocusSessionItem {
  id: string;
  mode: "open" | "countdown";
  targetMinutes?: number | null;
  elapsedSeconds: number;
  startedAt: string;
  completedAt: string;
  label: string;
  goalId?: string | null;
  category?: string;
}

export interface HeatmapDay {
  date: string;
  focusMinutes: number;
  goalsCompleted: number;
  level: number;
}

export interface ScheduleBlock {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  category: string;
  date: string;
}

export type RecurringBlockCadence =
  | "daily"
  | "weekdays"
  | "weekends"
  | "specific_days";

export interface RecurringFocusBlock {
  id: string;
  title: string;
  linkedGoalId?: string | null;
  category: string;
  startTime: string; // "HH:MM"
  durationMinutes: number;
  cadence: RecurringBlockCadence;
  specificDays: number[]; // 0 = Mon .. 6 = Sun
  active: boolean;
  createdAt: string;
}

export interface RecurringBlockOverride {
  blockId: string;
  logicalDate: string;
  status: "rescheduled" | "skipped";
  overrideStartTime?: string | null;
  overrideDurationMinutes?: number | null;
  updatedAt: string;
}

export interface ExternalCalendarEvent {
  id: string;
  feedUrl: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  allDay: boolean;
  updatedAt: string;
}

export interface IcsSyncReport {
  feedsChecked: number;
  eventsSynced: number;
  errors: string[];
}

export interface WeeklySynthesisReport {
  weekKey: string;
  startDate: string;
  endDate: string;
  totalFocusMinutes: number;
  totalFocusHours: number;
  goalsCompleted: number;
  goalsPlanned: number;
  categoryHours: Record<string, number>;
  winsExcerpts: string[];
  gratitudeExcerpts: string[];
  filePath: string;
  webhookStatus?: string | null;
  generatedAt: string;
}

export interface QuickCaptureResult {
  kind: "task" | "inbox" | "sticky" | "focus" | string;
  message: string;
  focusSeconds?: number | null;
  focusOpen?: boolean;
}

export interface JournalEntry {
  id: string;
  date: string;
  title: string;
  body: string;
  mood: string;
  updatedAt: string;
}

export type PaperTint = "original" | "parchment" | "sage" | "obsidian";

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  status: "reading" | "queued" | "finished";
  progressPercent: number;
  notes: string;
  filePath: string;
  format: "pdf" | "epub" | "manual";
  currentPage: number;
  totalPages: number;
  scrollOffset: number;
  lastOpenedAt?: string | null;
  epubCfi?: string;
  coverThumbnail?: string;
}

export interface HighlightRect {
  left: number;   // 0..100 percentage relative to page width
  top: number;    // 0..100 percentage relative to page height
  width: number;  // 0..100 percentage relative to page width
  height: number; // 0..100 percentage relative to page height
}

export interface BookHighlight {
  id: string;
  bookId: string;
  pageNumber: number;
  quote: string;
  note: string;
  color: "brass" | "sage" | "amber";
  cfiRange: string;
  rects?: HighlightRect[];
  createdAt: string;
}

export interface DailyReadingProgress {
  logicalDate: string;
  pagesReadToday: number;
  targetPages: number;
  goalCompleted: boolean;
  goalAutoCheckedNow: boolean;
}

export interface TocNode {
  id: string;
  kind: "constraint" | "assumption" | "injection" | "objective";
  title: string;
  body: string;
  x: number;
  y: number;
}

export type TocFrameworkType =
  | "crt"
  | "cloud"
  | "frt_nbr"
  | "prt_trt"
  | "five_steps";

export type TocCanvasNodeKind =
  | "objective"
  | "requirement"
  | "prerequisite"
  | "ude"
  | "de"
  | "fact"
  | "core_problem"
  | "injection"
  | "trimming_injection"
  | "obstacle"
  | "io"
  | "trt_step";

export interface TocTrtFields {
  need: string;
  action: string;
  reality: string;
  effect: string;
}

export interface TocCanvasNode {
  id: string;
  kind: TocCanvasNodeKind;
  code?: string; // e.g. "A", "B", "C", "D", "D'", "UDE", "IO"
  title: string;
  body: string;
  x: number;
  y: number;
  trtFields?: TocTrtFields;
}

export interface TocCanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  isConflict?: boolean;
  andGroupId?: string | null;
  assumptions?: string[];
  injection?: string;
}

export interface FiveFocusingStepsData {
  systemGoal: string;
  throughputT: string;
  inventoryI: string;
  operatingExpenseOE: string;
  dbrNotes: string;
  steps: {
    identify: string;
    exploit: string;
    subordinate: string;
    elevate: string;
    repeat: string;
  };
}

export interface TocGraphData {
  nodes: TocCanvasNode[];
  edges: TocCanvasEdge[];
  subMode?: "prt" | "trt";
  fiveSteps?: FiveFocusingStepsData;
}

export interface TocTreeRecord {
  id: string;
  title: string;
  frameworkType: TocFrameworkType;
  tags: string[];
  attachedToDebriefDate?: string | null;
  graphJson: string;
  vaultFilePath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityBlockHourly {
  date: string;
  slotIndex: number; // 0..23 representing rolloverHour:00 through rolloverHour-1:00 next morning
  label: string;
  category: ActivityBlockCategory;
  source: "manual" | "focus_timer";
  updatedAt: string;
}

export interface DailyDebriefRecord {
  logicalDate: string;
  memories: string;
  gratitude1: string;
  gratitude2: string;
  gratitude3: string;
  closingThought: string;
  published: boolean;
  vaultFilePath?: string | null;
  updatedAt: string;
}

export interface DailyDebriefPayload {
  logicalDate: string;
  memories: string;
  gratitude1: string;
  gratitude2: string;
  gratitude3: string;
  closingThought: string;
  completedTasks: string[];
  focusMinutes: number;
  blockHighlights: string[];
  published: boolean;
  updatedAt: string;
}

export interface VaultFileEntry {
  fileName: string;
  filePath: string;
  date: string;
  title: string;
  tags: string[];
  content: string;
  body: string;
  updatedAt: string;
}

export interface ReflectionSaveInput {
  existingFileName?: string | null;
  logicalDate: string;
  title: string;
  tags: string[];
  body: string;
}

export type VaultFolder = "Reflections" | "Books" | "Daily" | "Inbox";

export interface VaultIndexedNote {
  folder: VaultFolder;
  fileName: string;
  filePath: string;
  title: string;
  date: string;
  tags: string[];
  body: string;
  updatedAt: string;
}

export interface VaultSearchResult {
  note: VaultIndexedNote;
  snippet: string;
  matchLine: number;
}

export interface BacklinkMention {
  sourceFolder: VaultFolder;
  sourceFileName: string;
  sourceTitle: string;
  sourceDate: string;
  contextLine: string;
}

export interface MediaSessionState {
  active: boolean;
  title: string;
  artist: string;
  album: string;
  sourceApp: string;
  isPlaying: boolean;
  isShuffle: boolean;
  repeatMode: "none" | "track" | "list";
  positionSeconds: number;
  durationSeconds: number;
}

export type AnalyticsTimeframe = "7d" | "30d" | "90d" | "all";

export interface DailyActivityRow {
  date: string;
  focusMinutes: number;
  goalsCompleted: number;
}

export interface DailyReadingCount {
  logicalDate: string;
  uniquePages: number;
}

export interface AnalyticsDataset {
  logicalToday: string;
  dayRolloverHour: number;
  dailyActivity: DailyActivityRow[];
  focusSessions: FocusSessionItem[];
  hourlyBlocks: ActivityBlockHourly[];
  goalCompletions: GoalCompletionLog[];
  dailyReadingPages: DailyReadingCount[];
  publishedDebriefDates: string[];
  deviceTelemetry: DeviceTelemetryRecord[];
  recallReviews: RecallReviewLog[];
}

export type RecallSourceCategory = "book" | "toc" | "snippet";

export interface RecallCardItem {
  cardHash: string;
  sourceFile: string;
  sourceFileName: string;
  sourceCategory: RecallSourceCategory;
  sourceTitle: string;
  contextBadge: string;
  cue: string;
  answer: string;
  easeFactor: number;
  intervalDays: number;
  nextDueLogicalDate: string;
  reviewCount: number;
}

export interface RecallDeckState {
  logicalToday: string;
  totalIndexed: number;
  totalDue: number;
  dailyLimit: number;
  reviewedToday: number;
  dueCards: RecallCardItem[];
  weeklyReviewsCount: number;
}

export interface RecallReviewResult {
  cardHash: string;
  rating: 1 | 2 | 3;
  nextEaseFactor: number;
  nextIntervalDays: number;
  nextDueLogicalDate: string;
  reviewCount: number;
  deck: RecallDeckState;
}

export interface RecallReviewLog {
  id: string;
  cardHash: string;
  sourceCategory: string;
  rating: number;
  logicalDate: string;
  reviewedAt: string;
}
