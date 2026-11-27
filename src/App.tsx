import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Settings } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { WindowTitleBar } from "./components/WindowTitleBar";
import { ObservatoryBackdrop } from "./components/ObservatoryBackdrop";
import { AmbientWildlifeLayer } from "./components/AmbientWildlifeLayer";
import { ObservatoryClock } from "./components/ObservatoryClock";
import { StickyNotesLayer } from "./components/StickyNotesLayer";
import { ScheduleReadout } from "./components/ScheduleReadout";
import { FocusRing } from "./components/FocusRing";
import { MusicPlayer } from "./components/MusicPlayer";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { ActiveStreakReadout } from "./components/ActiveStreakReadout";
import { HourlyRollingWidget } from "./components/HourlyRollingWidget";
import { BottomDockZone } from "./components/BottomDockZone";
import { SecretChamber } from "./components/SecretChamber";
import { DailyBriefingModal } from "./components/DailyBriefingModal";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { QuickCaptureOverlay } from "./components/QuickCaptureOverlay";
import { RecallDrawer } from "./components/RecallDrawer";
import { GoalsMiniApp } from "./components/miniapps/GoalsMiniApp";
import { JournalMiniApp } from "./components/miniapps/JournalMiniApp";
import { LibraryMiniApp } from "./components/miniapps/LibraryMiniApp";
import { TocMiniApp } from "./components/miniapps/TocMiniApp";
import { CalendarMiniApp } from "./components/miniapps/CalendarMiniApp";
import { FocusStudioMiniApp } from "./components/miniapps/FocusStudioMiniApp";
import { AnalyticsMiniApp } from "./components/miniapps/AnalyticsMiniApp";
import { AutomationsMiniApp } from "./components/miniapps/SecondaryMiniApps";
import { SettingsMiniApp } from "./components/miniapps/SettingsMiniApp";
import { RoomNavigationContext } from "./components/miniapps/MiniAppShell";
import { isChamberRoomId, preloadAllRoomBackdrops } from "./utils/chamberRooms";
import { ambientAudio } from "./services/ambientAudio";
import { isTauriRuntime, storageService } from "./services/storage";
import { computeConsistencyStreak } from "./utils/analyticsEngine";
import {
  getLogicalDate,
  getLogicalWeekdayIndex,
  isGoalActiveForTab,
} from "./utils/logicalDate";
import { formatTimeHHMM } from "./utils/time";
import type {
  ActivityBlockHourly,
  AnalyticsDataset,
  AthenaeumConfig,
  DailyDebriefRecord,
  ExternalCalendarEvent,
  FocusSessionItem,
  GoalItem,
  GoalMilestone,
  GoalScope,
  HaLightCommand,
  HeatmapDay,
  IcsSyncReport,
  JournalMode,
  LibraryBook,
  MiniAppId,
  QuickCaptureResult,
  RecallDeckState,
  RecallSourceCategory,
  RecurringBlockOverride,
  RecurringFocusBlock,
  ScheduleBlock,
  StickyNoteItem,
  TocTreeRecord,
} from "./types/athenaeum";

export function App() {
  const [config, setConfig] = useState<AthenaeumConfig | null>(null);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [goalMilestones, setGoalMilestones] = useState<GoalMilestone[]>([]);
  const [analyticsDataset, setAnalyticsDataset] = useState<AnalyticsDataset>(() => ({
    logicalToday: storageService.getLogicalToday(3),
    dayRolloverHour: 3,
    dailyActivity: [],
    focusSessions: [],
    hourlyBlocks: [],
    goalCompletions: [],
    dailyReadingPages: [],
    publishedDebriefDates: [],
    deviceTelemetry: [],
    recallReviews: [],
  }));
  const [recallDeck, setRecallDeck] = useState<RecallDeckState | null>(null);
  const [recallOpen, setRecallOpen] = useState(false);
  const [notes, setNotes] = useState<StickyNoteItem[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [schedule, setSchedule] = useState<ScheduleBlock[]>([]);
  const [recurringBlocks, setRecurringBlocks] = useState<RecurringFocusBlock[]>([]);
  const [blockOverrides, setBlockOverrides] = useState<RecurringBlockOverride[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [sessions, setSessions] = useState<FocusSessionItem[]>([]);
  const [, setJournalCount] = useState<number>(0);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [tocTrees, setTocTrees] = useState<TocTreeRecord[]>([]);
  const [initialTocTreeId, setInitialTocTreeId] = useState<string | null>(null);
  const [todayDebrief, setTodayDebrief] = useState<DailyDebriefRecord | null>(null);
  const [yesterdayDebrief, setYesterdayDebrief] = useState<DailyDebriefRecord | null>(null);

  // 24-Hour Logical Day Log state (anchored to logical date)
  const [dayLogDate, setDayLogDate] = useState<string>(() =>
    storageService.getLogicalToday(3)
  );
  const [dayLogBlocks, setDayLogBlocks] = useState<ActivityBlockHourly[]>([]);

  // Strict Single-Tick 2-Tier Scroll Snap state (0 = Upper Observatory 0vh, 1 = Secret Chamber 100vh)
  const [activeTier, setActiveTier] = useState<0 | 1>(0);
  const tierSnapLockUntilRef = useRef<number>(0);

  // Modal & routing state
  const [showBriefing, setShowBriefing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [defaultLocalNotesPath, setDefaultLocalNotesPath] = useState("");
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [activeMiniApp, setActiveMiniApp] = useState<MiniAppId>(null);
  const [pendingCalendarEvent, setPendingCalendarEvent] = useState<{
    title: string;
    date?: string;
    durationMinutes?: number;
  } | null>(null);
  const [goalsInitialTab, setGoalsInitialTab] = useState<GoalScope>("daily");
  const [journalInitialMode, setJournalInitialMode] = useState<JournalMode>("debrief");
  const [vaultToast, setVaultToast] = useState<string | null>(null);

  // Sticky note interaction & dynamic trash vortex state
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [isHoveringTrash, setIsHoveringTrash] = useState(false);
  const trashZoneRef = useRef<HTMLDivElement | null>(null);

  // Focus Session Engine state (null = OPEN count-up, number = CUSTOM countdown seconds)
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusTargetSeconds, setFocusTargetSeconds] = useState<number | null>(null);
  const [focusElapsed, setFocusElapsed] = useState(0);
  const [focusStartedAt, setFocusStartedAt] = useState<string | null>(null);
  const [focusActiveLabel, setFocusActiveLabel] = useState<string>("");
  const [focusActiveGoalId, setFocusActiveGoalId] = useState<string | null>(null);
  const [focusActiveCategory, setFocusActiveCategory] = useState<string>("deep_work");
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const focusStoppingRef = useRef(false);

  const dayRolloverHour = config?.dayRolloverHour ?? 3;
  const logicalToday = getLogicalDate(new Date(), dayRolloverHour);
  const logicalYesterday = useMemo(() => {
    const [y, m, d] = logicalToday.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, (d || 1) - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
      dt.getDate()
    ).padStart(2, "0")}`;
  }, [logicalToday]);

  const yesterdayFocusMinutes = useMemo(() => {
    const fromDaily = analyticsDataset.dailyActivity.find((d) => d.date === logicalYesterday);
    if (fromDaily && fromDaily.focusMinutes > 0) return fromDaily.focusMinutes;
    const fromHeatmap = heatmap.find((d) => d.date === logicalYesterday);
    return fromHeatmap?.focusMinutes ?? 0;
  }, [analyticsDataset.dailyActivity, heatmap, logicalYesterday]);

  const showToast = useCallback((message: string) => {
    setVaultToast(message);
    window.setTimeout(() => {
      setVaultToast((prev) => (prev === message ? null : prev));
    }, 3600);
  }, []);

  const loadDayLog = useCallback(async (dateIso: string) => {
    const blocks = await storageService.listActivityBlocksHourly(dateIso);
    setDayLogBlocks(blocks);
  }, []);

  const refreshJournalCount = useCallback(async () => {
    const [dailyDates, reflections] = await Promise.all([
      storageService.listDailyDebriefArchive(),
      storageService.listReflections(),
    ]);
    setJournalCount(dailyDates.length + reflections.length);
  }, []);

  const refreshAllData = useCallback(
    async (cutoffOverride?: number) => {
      const cutoff = cutoffOverride ?? dayRolloverHour;
      const [
        loadedGoals,
        loadedMilestones,
        loadedAnalytics,
        loadedNotes,
        loadedHeatmap,
        loadedSchedule,
        loadedRecurring,
        loadedOverrides,
        loadedExternalEvents,
        loadedSessions,
        loadedBooks,
        loadedToc,
        loadedDayLog,
        dailyDates,
        reflections,
        loadedRecall,
        loadedTodayDebrief,
      ] = await Promise.all([
        storageService.listGoals(),
        storageService.listGoalMilestones(),
        storageService.getAnalyticsDataset(cutoff),
        storageService.listNotes(),
        storageService.getHeatmap60Days(cutoff),
        storageService.listScheduleBlocks(),
        storageService.listRecurringFocusBlocks(),
        storageService.listRecurringBlockOverrides(),
        storageService.listExternalCalendarEvents(),
        storageService.listFocusSessions(),
        storageService.listLibraryBooks(),
        storageService.listTocTrees(),
        storageService.listActivityBlocksHourly(dayLogDate),
        storageService.listDailyDebriefArchive(),
        storageService.listReflections(),
        storageService.getRecallDeck(cutoff),
        storageService.getDailyDebrief(getLogicalDate(new Date(), cutoff)).catch(() => null),
      ]);
      setGoals(loadedGoals);
      setGoalMilestones(loadedMilestones);
      setAnalyticsDataset(loadedAnalytics);
      setNotes(loadedNotes);
      setHeatmap(loadedHeatmap);
      setSchedule(loadedSchedule);
      setRecurringBlocks(loadedRecurring);
      setBlockOverrides(loadedOverrides);
      setExternalEvents(loadedExternalEvents);
      setSessions(loadedSessions);
      setBooks(loadedBooks);
      setTocTrees(loadedToc);
      setDayLogBlocks(loadedDayLog);
      setJournalCount(dailyDates.length + reflections.length);
      setRecallDeck(loadedRecall);
      setTodayDebrief(loadedTodayDebrief);
    },
    [dayLogDate, dayRolloverHour]
  );

  // Eagerly preload & decode all 6 dedicated room WebP assets on startup for 0ms transitions
  useEffect(() => {
    preloadAllRoomBackdrops();
  }, []);

  // Load persisted state on launch using configured logical day rollover hour
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      await storageService.initialize();
      const [cfg, localNotesFallback] = await Promise.all([
        storageService.getConfig(),
        storageService.getDefaultLocalNotesPath(),
      ]);
      const cutoff = cfg.dayRolloverHour ?? 3;
      const todayLogical = getLogicalDate(new Date(), cutoff);

      const [
        loadedGoals,
        loadedMilestones,
        loadedAnalytics,
        loadedNotes,
        loadedHeatmap,
        loadedSchedule,
        loadedRecurring,
        loadedOverrides,
        loadedExternalEvents,
        loadedSessions,
        loadedBooks,
        loadedToc,
        loadedDayLog,
        dailyDates,
        reflections,
        dismissedDate,
        loadedRecall,
      ] = await Promise.all([
        storageService.listGoals(),
        storageService.listGoalMilestones(),
        storageService.getAnalyticsDataset(cutoff),
        storageService.listNotes(),
        storageService.getHeatmap60Days(cutoff),
        storageService.listScheduleBlocks(),
        storageService.listRecurringFocusBlocks(),
        storageService.listRecurringBlockOverrides(),
        storageService.listExternalCalendarEvents(),
        storageService.listFocusSessions(),
        storageService.scanBooksFolder(cfg.booksFolderPath),
        storageService.listTocTrees(),
        storageService.listActivityBlocksHourly(todayLogical),
        storageService.listDailyDebriefArchive(),
        storageService.listReflections(),
        storageService.getBriefingDismissedDate(),
        storageService.getRecallDeck(cutoff),
      ]);

      if (!active) return;
      setDefaultLocalNotesPath(localNotesFallback);
      setConfig(cfg);
      setDayLogDate(todayLogical);
      setGoals(loadedGoals);
      setGoalMilestones(loadedMilestones);
      setAnalyticsDataset(loadedAnalytics);
      setNotes(loadedNotes);
      setHeatmap(loadedHeatmap);
      setSchedule(loadedSchedule);
      setRecurringBlocks(loadedRecurring);
      setBlockOverrides(loadedOverrides);
      setExternalEvents(loadedExternalEvents);
      setSessions(loadedSessions);
      setBooks(loadedBooks);
      setTocTrees(loadedToc);
      setDayLogBlocks(loadedDayLog);
      setJournalCount(dailyDates.length + reflections.length);
      setRecallDeck(loadedRecall);

      if (!cfg.onboardingCompleted) {
        setShowOnboarding(true);
      } else if (dismissedDate !== todayLogical) {
        setShowBriefing(true);
      }

      // Load yesterday's Daily Debrief for the Morning Anchor in Daily Briefing
      const [yy, ym, yd] = todayLogical.split("-").map(Number);
      const yDt = new Date(yy, (ym || 1) - 1, (yd || 1) - 1);
      const yesterdayIso = `${yDt.getFullYear()}-${String(yDt.getMonth() + 1).padStart(2, "0")}-${String(
        yDt.getDate()
      ).padStart(2, "0")}`;
      void storageService
        .getDailyDebrief(todayLogical)
        .then((rec) => {
          if (active) setTodayDebrief(rec);
        })
        .catch(() => {
          // Non-fatal
        });
      void storageService
        .getDailyDebrief(yesterdayIso)
        .then((rec) => {
          if (active) setYesterdayDebrief(rec);
        })
        .catch(() => {
          // Non-fatal
        });

      // Silent background sync of configured .ics feeds
      if (cfg.calendarIcsUrls && cfg.calendarIcsUrls.length > 0) {
        void storageService
          .syncIcsCalendars(cfg.calendarIcsUrls)
          .then(async () => {
            if (!active) return;
            const refreshed = await storageService.listExternalCalendarEvents();
            if (active) setExternalEvents(refreshed);
          })
          .catch(() => {
            // Keep cached events on offline launch
          });
      }

      // Silent automatic weekly synthesis (Sunday evening >= 18:00 or Monday morning rollover)
      if (cfg.autoWeeklySynthesis) {
        void storageService
          .checkAutoWeeklySynthesis()
          .then(async (autoReport) => {
            if (active && autoReport) {
              await refreshJournalCount();
            }
          })
          .catch(() => {
            // Ignore non-fatal auto synthesis errors
          });
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const handleDayLogDateChange = useCallback(
    (nextIso: string) => {
      setDayLogDate(nextIso);
      void loadDayLog(nextIso);
    },
    [loadDayLog]
  );

  // Periodic background check for silent Weekly Synthesis across Sunday evening / Monday rollover
  useEffect(() => {
    if (!config?.autoWeeklySynthesis) return;
    const intervalId = window.setInterval(() => {
      void storageService
        .checkAutoWeeklySynthesis()
        .then(async (autoReport) => {
          if (autoReport) {
            await refreshJournalCount();
          }
        })
        .catch(() => {
          // Ignore non-fatal background synthesis checks
        });
    }, 30 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [config?.autoWeeklySynthesis, refreshJournalCount]);

  // Tick active focus session
  useEffect(() => {
    if (!focusRunning) return;
    const id = window.setInterval(() => {
      setFocusElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [focusRunning]);

  const snapToTier = useCallback((nextTier: 0 | 1) => {
    const now = Date.now();
    if (now < tierSnapLockUntilRef.current) return;
    tierSnapLockUntilRef.current = now + 640;
    setActiveTier(nextTier);
  }, []);

  // Strict single-tick wheel snap between Upper Observatory (0vh) and Secret Chamber (100vh)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (
        activeMiniApp ||
        showBriefing ||
        quickCaptureOpen ||
        recallOpen ||
        draggingNoteId
      ) {
        return;
      }

      // Never hijack wheel when cursor is over an internally scrollable widget (e.g. Hourly Check-In)
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest(
          '[data-local-scroll="true"], [data-testid="schedule-displaced-drawer"]'
        )
      ) {
        return;
      }

      if (Math.abs(e.deltaY) < 6) return;

      const now = Date.now();
      if (now < tierSnapLockUntilRef.current) {
        e.preventDefault();
        return;
      }

      if (activeTier === 0 && e.deltaY > 0) {
        e.preventDefault();
        snapToTier(1);
      } else if (activeTier === 1 && e.deltaY < 0) {
        e.preventDefault();
        snapToTier(0);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [
    activeTier,
    activeMiniApp,
    showBriefing,
    quickCaptureOpen,
    recallOpen,
    draggingNoteId,
    snapToTier,
  ]);

  const ascendTimerRef = useRef<number | null>(null);
  const handleAscendToSurface = useCallback(() => {
    if (ascendTimerRef.current !== null) {
      window.clearTimeout(ascendTimerRef.current);
      ascendTimerRef.current = null;
    }
    if (activeMiniApp) {
      // Zoom smoothly out of the room first, then glide back up to the Upper Observatory
      setActiveMiniApp(null);
      ascendTimerRef.current = window.setTimeout(() => {
        ascendTimerRef.current = null;
        tierSnapLockUntilRef.current = 0;
        snapToTier(0);
      }, 260);
    } else {
      tierSnapLockUntilRef.current = 0;
      snapToTier(0);
    }
  }, [activeMiniApp, snapToTier]);

  useEffect(() => {
    return () => {
      if (ascendTimerRef.current !== null) {
        window.clearTimeout(ascendTimerRef.current);
      }
    };
  }, []);

  const spawnStickyNote = useCallback(() => {
    const count = notes.length;
    const x = 3.2 + (count % 3) * 3.0;
    const y = 10.2 + (count % 3) * 3.8;
    const newNote: StickyNoteItem = {
      id: `note-${Date.now()}`,
      title: "Note",
      content: "",
      collapsed: false,
      x,
      y,
      updatedAt: new Date().toISOString(),
    };
    setNotes((prev) => [...prev, newNote]);
    setSelectedNoteId(newNote.id);
    void storageService.upsertNote(newNote);
  }, [notes.length]);

  // Global keyboard shortcuts (including in-app Alt+Space / Ctrl+Shift+A Quick Capture)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isQuickCaptureCombo =
        (e.altKey && (e.code === "Space" || e.key === " ")) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a");
      if (isQuickCaptureCombo) {
        e.preventDefault();
        setQuickCaptureOpen((prev) => !prev);
        return;
      }

      if (e.altKey && e.key.toLowerCase() === "n" && !activeMiniApp && !showBriefing && !showOnboarding && !quickCaptureOpen) {
        e.preventDefault();
        if (activeTier !== 0) snapToTier(0);
        spawnStickyNote();
        return;
      }

      if (e.key === "Escape") {
        if (showOnboarding || recallOpen) {
          return;
        }
        if (quickCaptureOpen) {
          e.preventDefault();
          setQuickCaptureOpen(false);
          return;
        }
        if (activeMiniApp) {
          e.preventDefault();
          setActiveMiniApp(null);
          return;
        }
      }

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || activeMiniApp || showBriefing || showOnboarding || quickCaptureOpen) return;

      if (e.key === "Home" || (e.key === "PageUp" && activeTier === 1)) {
        e.preventDefault();
        snapToTier(0);
      } else if (e.key === "PageDown" && activeTier === 0) {
        e.preventDefault();
        snapToTier(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMiniApp, showBriefing, showOnboarding, quickCaptureOpen, recallOpen, activeTier, spawnStickyNote, snapToTier]);

  const isPointerInTrashZone = useCallback((clientX: number, clientY: number): boolean => {
    const el = trashZoneRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const pad = 28;
      return (
        clientX >= rect.left - pad &&
        clientX <= rect.right + pad &&
        clientY >= rect.top - pad &&
        clientY <= rect.bottom + pad
      );
    }
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight - 96;
    return Math.hypot(clientX - cx, clientY - cy) < 76;
  }, []);

  const handleNoteDragState = useCallback(
    (noteId: string | null, pointerX: number, pointerY: number) => {
      setDraggingNoteId((prev) => (prev === noteId ? prev : noteId));
      const hovering = noteId ? isPointerInTrashZone(pointerX, pointerY) : false;
      setIsHoveringTrash((prev) => (prev === hovering ? prev : hovering));
    },
    [isPointerInTrashZone]
  );

  const handleNoteDragEnd = useCallback(
    (
      noteId: string,
      pointerX: number,
      pointerY: number,
      nextPercentX: number,
      nextPercentY: number
    ) => {
      const shouldDissolve = isPointerInTrashZone(pointerX, pointerY);
      setDraggingNoteId(null);
      setIsHoveringTrash(false);
      if (shouldDissolve) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        if (selectedNoteId === noteId) setSelectedNoteId(null);
        void storageService.deleteNote(noteId);
      } else {
        setNotes((prev) =>
          prev.map((n) => {
            if (n.id !== noteId) return n;
            const updated: StickyNoteItem = {
              ...n,
              x: Number(nextPercentX.toFixed(2)),
              y: Number(nextPercentY.toFixed(2)),
              updatedAt: new Date().toISOString(),
            };
            void storageService.upsertNote(updated);
            return updated;
          })
        );
      }
    },
    [isPointerInTrashZone, selectedNoteId]
  );

  const handleUpdateNote = useCallback((note: StickyNoteItem) => {
    setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
    void storageService.upsertNote(note);
  }, []);

  const handlePromoteNote = useCallback(
    async (note: StickyNoteItem) => {
      try {
        await storageService.promoteNoteToVault(note, dayRolloverHour);
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        if (selectedNoteId === note.id) setSelectedNoteId(null);
        setVaultToast(`Moved "${note.title || "Quick Note"}" to Notes`);
        window.setTimeout(() => setVaultToast(null), 3600);
      } catch (err) {
        setVaultToast(err instanceof Error ? err.message : "Failed moving note");
        window.setTimeout(() => setVaultToast(null), 3600);
      }
    },
    [dayRolloverHour, selectedNoteId]
  );

  const handleApplyLightCommand = useCallback(
    async (command: HaLightCommand, presetLabel?: string) => {
      if (!config) return;
      const res = await storageService.setHaLightState(command, config);
      const isScene = Boolean(command.sceneEntityId?.trim()) || command.mode === "scene";
      const label = res.ok
        ? isScene
          ? res.message
          : presetLabel
          ? `Set room lighting to ${presetLabel} (${res.appliedBrightnessPct}%).`
          : `Set room lighting brightness to ${res.appliedBrightnessPct}%.`
        : res.message ||
          "Home Assistant isn't connected yet. Set it up in Settings to control your lights.";
      setWebhookStatus(label);
      window.setTimeout(() => {
        setWebhookStatus((prev) => (prev === label ? null : prev));
      }, 6000);
    },
    [config]
  );

  const handleStartFocus = useCallback(
    async (
      targetSecondsOverride?: number | null,
      labelOverride?: string,
      goalIdOverride?: string | null,
      categoryOverride?: string
    ) => {
      const effectiveTarget =
        targetSecondsOverride !== undefined ? targetSecondsOverride : focusTargetSeconds;
      if (targetSecondsOverride !== undefined) {
        setFocusTargetSeconds(targetSecondsOverride);
      }
      if (labelOverride !== undefined) {
        setFocusActiveLabel(labelOverride);
      }
      if (goalIdOverride !== undefined) {
        setFocusActiveGoalId(goalIdOverride);
      }
      if (categoryOverride !== undefined) {
        setFocusActiveCategory(categoryOverride);
      }
      setFocusElapsed(0);
      setFocusStartedAt(new Date().toISOString());
      focusStoppingRef.current = false;
      setFocusRunning(true);

      // Direct Home Assistant REST lighting/scene transition on Focus start (full 0-100% brightness)
      if (config && config.haAutoLight) {
        const preset = config.haFocusPreset;
        const sceneId = preset.sceneEntityId?.trim() || "";
        void handleApplyLightCommand(
          {
            mode: sceneId ? "scene" : preset.mode,
            rgbColor: preset.rgbColor,
            kelvin: preset.kelvin,
            brightnessPct: Math.max(0, Math.min(100, preset.brightnessPct)),
            entityId: config.haEntityId || "",
            sceneEntityId: sceneId || undefined,
          },
          preset.name || "Focus Light"
        );
      } else if (config && config.homeAssistantWebhookUrl.trim()) {
        const modeLabel =
          effectiveTarget && effectiveTarget > 0
            ? `${Math.ceil(effectiveTarget / 60)}m`
            : "open";
        const msg = await storageService.triggerHomeAssistantWebhook(
          "focus_started",
          modeLabel,
          config
        );
        setWebhookStatus(msg);
        window.setTimeout(() => setWebhookStatus(null), 4000);
      }
    },
    [config, focusTargetSeconds, handleApplyLightCommand]
  );

  const handleStopAndSaveFocus = useCallback(
    async (completedNaturally = false) => {
      if (focusStoppingRef.current) return;
      focusStoppingRef.current = true;
      setFocusRunning(false);
      const elapsed = focusElapsed;
      const started = focusStartedAt ?? new Date().toISOString();
      const isCountdown = focusTargetSeconds !== null && focusTargetSeconds > 0;
      setFocusElapsed(0);
      setFocusStartedAt(null);

      // Play resonant Web Audio completion chime on timed finish or open session >= 5 min
      const shouldChime = completedNaturally || (!isCountdown && elapsed >= 300);
      if (shouldChime) {
        ambientAudio.playCompletionChime();
      }

      // Automatically restore post-focus room lighting or scene when Auto-Light is active (full 0-100%)
      if (config && config.haAutoLight) {
        const warm = config.haNonFocusPreset;
        const sceneId = warm.sceneEntityId?.trim() || "";
        void handleApplyLightCommand(
          {
            mode: sceneId ? "scene" : warm.mode,
            rgbColor: warm.rgbColor,
            kelvin: warm.kelvin,
            brightnessPct: Math.max(0, Math.min(100, warm.brightnessPct)),
            entityId: config.haEntityId || "",
            sceneEntityId: sceneId || undefined,
          },
          warm.name || "Warm Restore"
        );
      }

      if (elapsed >= 5 || completedNaturally) {
        const resolvedLabel =
          focusActiveLabel.trim() || schedule[0]?.title || "General Focus";
        const effectiveElapsed = Math.max(1, elapsed);
        const session: FocusSessionItem = {
          id: `fs-${Date.now()}`,
          mode: isCountdown ? "countdown" : "open",
          targetMinutes: isCountdown ? Math.max(1, Math.ceil(focusTargetSeconds / 60)) : null,
          elapsedSeconds: effectiveElapsed,
          startedAt: started,
          completedAt: new Date().toISOString(),
          label: resolvedLabel,
          goalId: focusActiveGoalId,
          category: focusActiveCategory || "deep_work",
        };
        await storageService.logFocusSession(session);
        const [nextSessions, nextHeatmap, nextDayLog, nextAnalytics] = await Promise.all([
          storageService.listFocusSessions(),
          storageService.getHeatmap60Days(dayRolloverHour),
          storageService.listActivityBlocksHourly(dayLogDate),
          storageService.getAnalyticsDataset(dayRolloverHour),
        ]);
        setSessions(nextSessions);
        setHeatmap(nextHeatmap);
        setDayLogBlocks(nextDayLog);
        setAnalyticsDataset(nextAnalytics);
      }
    },
    [
      config,
      focusElapsed,
      focusTargetSeconds,
      focusStartedAt,
      focusActiveLabel,
      focusActiveGoalId,
      focusActiveCategory,
      schedule,
      dayLogDate,
      dayRolloverHour,
      handleApplyLightCommand,
    ]
  );

  // Single authoritative natural countdown completion watcher (avoids double-fire when multiple FocusRings mount)
  useEffect(() => {
    if (
      focusRunning &&
      focusTargetSeconds !== null &&
      focusTargetSeconds > 0 &&
      focusElapsed >= focusTargetSeconds
    ) {
      void handleStopAndSaveFocus(true);
    }
  }, [focusRunning, focusTargetSeconds, focusElapsed, handleStopAndSaveFocus]);

  // Subscribe to Tauri quick-capture events when running natively
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenData: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void listen("athenaeum:data-updated", () => {
      void refreshAllData();
    }).then((fn) => {
      unlistenData = fn;
    });

    void listen<{ open?: boolean; seconds?: number | null }>(
      "athenaeum:start-focus",
      (event) => {
        const secs = event.payload?.open ? null : (event.payload?.seconds ?? null);
        setActiveMiniApp(null);
        setActiveTier(0);
        void handleStartFocus(secs);
      }
    ).then((fn) => {
      unlistenFocus = fn;
    });

    return () => {
      unlistenData?.();
      unlistenFocus?.();
    };
  }, [refreshAllData, handleStartFocus]);

  const handleSyncCalendars = useCallback(
    async (urlsOverride?: string[]): Promise<IcsSyncReport> => {
      const report = await storageService.syncIcsCalendars(urlsOverride);
      const refreshed = await storageService.listExternalCalendarEvents();
      setExternalEvents(refreshed);
      return report;
    },
    []
  );

  const handleQuickCaptureSubmitted = useCallback(
    async (result: QuickCaptureResult) => {
      showToast(result.message);
      await refreshAllData();
      if (result.kind === "focus") {
        setActiveMiniApp(null);
        setActiveTier(0);
        const target = result.focusOpen ? null : (result.focusSeconds ?? null);
        await handleStartFocus(target);
      }
    },
    [refreshAllData, handleStartFocus, showToast]
  );

  const handleDismissBriefing = useCallback(async () => {
    setShowBriefing(false);
    await storageService.setBriefingDismissedDate(logicalToday);
  }, [logicalToday]);

  const handleUpsertGoal = useCallback(
    async (goal: GoalItem) => {
      const wasCompleted = goals.find((g) => g.id === goal.id)?.completed ?? false;
      const saved = await storageService.upsertGoal(goal);
      setGoals((prev) => {
        const idx = prev.findIndex((g) => g.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [...prev, saved];
      });
      if (!wasCompleted && saved.completed && config?.n8nTriggerGoalCompleted && config.n8nWebhookUrl.trim()) {
        void storageService.sendN8nEvent(
          "goal_completed",
          { goalId: saved.id, title: saved.title, scope: saved.scope, category: saved.category ?? "" },
          config
        );
      }
      const [updatedHeatmap, updatedAnalytics] = await Promise.all([
        storageService.getHeatmap60Days(dayRolloverHour),
        storageService.getAnalyticsDataset(dayRolloverHour),
      ]);
      setHeatmap(updatedHeatmap);
      setAnalyticsDataset(updatedAnalytics);
    },
    [config, dayRolloverHour, goals]
  );

  const handleDeleteGoal = useCallback(
    async (id: string) => {
      setGoals((prev) => prev.filter((g) => g.id !== id));
      setGoalMilestones((prev) => prev.filter((m) => m.goalId !== id));
      await storageService.deleteGoal(id);
      setAnalyticsDataset(await storageService.getAnalyticsDataset(dayRolloverHour));
    },
    [dayRolloverHour]
  );

  const handleReorderScope = useCallback(
    async (scope: GoalScope, ordered: GoalItem[]) => {
      const withRanks = ordered.map((g, idx) => ({ ...g, sortOrder: idx }));
      setGoals((prev) => [
        ...prev.filter((g) => g.scope !== scope),
        ...withRanks,
      ]);
      await storageService.reorderGoals(withRanks.map((g) => g.id));
    },
    []
  );

  const handleUpsertMilestone = useCallback(
    async (milestone: GoalMilestone) => {
      const saved = await storageService.upsertGoalMilestone(milestone);
      setGoalMilestones((prev) => {
        const idx = prev.findIndex((m) => m.id === saved.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = saved;
          return copy;
        }
        return [...prev, saved];
      });
      setAnalyticsDataset(await storageService.getAnalyticsDataset(dayRolloverHour));
    },
    [dayRolloverHour]
  );

  const handleDeleteMilestone = useCallback(async (id: string) => {
    setGoalMilestones((prev) => prev.filter((m) => m.id !== id));
    await storageService.deleteGoalMilestone(id);
  }, []);

  const handleReorderMilestones = useCallback(
    async (goalId: string, ordered: GoalMilestone[]) => {
      const withRanks = ordered.map((m, idx) => ({ ...m, sortOrder: idx }));
      setGoalMilestones((prev) => [
        ...prev.filter((m) => m.goalId !== goalId),
        ...withRanks,
      ]);
      await storageService.reorderGoalMilestones(withRanks.map((m) => m.id));
    },
    []
  );

  const handleFocusOnGoal = useCallback(
    (goalTitle: string) => {
      const matched = goals.find((g) => g.title === goalTitle);
      setActiveMiniApp(null);
      setActiveTier(0);
      void handleStartFocus(
        undefined,
        goalTitle,
        matched?.id ?? null,
        matched?.category || "deep_work"
      );
      showToast(`Focusing on "${goalTitle}"`);
    },
    [goals, handleStartFocus, showToast]
  );

  const handleStartFocusBlock = useCallback(
    (title: string, durationMinutes?: number) => {
      setActiveMiniApp(null);
      setActiveTier(0);
      const targetSecs =
        durationMinutes && durationMinutes > 0 ? durationMinutes * 60 : undefined;
      void handleStartFocus(targetSecs, title);
      showToast(`Focus started: "${title}"`);
    },
    [handleStartFocus, showToast]
  );

  const handleUpsertRecurringBlock = useCallback(
    async (block: RecurringFocusBlock) => {
      await storageService.upsertRecurringFocusBlock(block);
      setRecurringBlocks(await storageService.listRecurringFocusBlocks());
    },
    []
  );

  const handleDeleteRecurringBlock = useCallback(async (id: string) => {
    await storageService.deleteRecurringFocusBlock(id);
    const [nextBlocks, nextOverrides] = await Promise.all([
      storageService.listRecurringFocusBlocks(),
      storageService.listRecurringBlockOverrides(),
    ]);
    setRecurringBlocks(nextBlocks);
    setBlockOverrides(nextOverrides);
  }, []);

  const handleUpsertBlockOverride = useCallback(
    async (override: RecurringBlockOverride) => {
      await storageService.upsertRecurringBlockOverride(override);
      setBlockOverrides(await storageService.listRecurringBlockOverrides());
    },
    []
  );

  const handleRescheduleRecurring = useCallback(
    async (
      blockId: string,
      logicalDate: string,
      newStartTime: string,
      durationMinutes: number
    ) => {
      const ov: RecurringBlockOverride = {
        blockId,
        logicalDate,
        status: "rescheduled",
        overrideStartTime: newStartTime,
        overrideDurationMinutes: durationMinutes,
        updatedAt: new Date().toISOString(),
      };
      await handleUpsertBlockOverride(ov);
      showToast(
        `Rescheduled Focus Block to ${formatTimeHHMM(newStartTime, config?.timeFormat ?? "12h")}`
      );
    },
    [config?.timeFormat, handleUpsertBlockOverride, showToast]
  );

  const handleSkipRecurringToday = useCallback(
    async (blockId: string, logicalDate: string) => {
      const ov: RecurringBlockOverride = {
        blockId,
        logicalDate,
        status: "skipped",
        overrideStartTime: null,
        overrideDurationMinutes: null,
        updatedAt: new Date().toISOString(),
      };
      await handleUpsertBlockOverride(ov);
      showToast("Focus Block skipped for today");
    },
    [handleUpsertBlockOverride, showToast]
  );

  const handleUpsertDayLogBlock = useCallback(
    async (block: ActivityBlockHourly) => {
      setDayLogBlocks((prev) => {
        const next = prev.filter((b) => b.slotIndex !== block.slotIndex);
        next.push(block);
        next.sort((a, b) => a.slotIndex - b.slotIndex);
        return next;
      });
      await storageService.upsertActivityBlockHourly(block);
      setAnalyticsDataset(await storageService.getAnalyticsDataset(dayRolloverHour));
    },
    [dayRolloverHour]
  );

  const handleDeleteDayLogBlock = useCallback(
    async (date: string, slotIndex: number) => {
      setDayLogBlocks((prev) => prev.filter((b) => b.slotIndex !== slotIndex));
      await storageService.deleteActivityBlockHourly(date, slotIndex);
      setAnalyticsDataset(await storageService.getAnalyticsDataset(dayRolloverHour));
    },
    [dayRolloverHour]
  );

  const activeStreak = useMemo(
    () => computeConsistencyStreak(analyticsDataset, goals),
    [analyticsDataset, goals]
  );

  const todayDebriefDone = useMemo(() => {
    if (!todayDebrief) return false;
    return Boolean(
      todayDebrief.memories?.trim() ||
        todayDebrief.gratitude1?.trim() ||
        todayDebrief.gratitude2?.trim() ||
        todayDebrief.gratitude3?.trim() ||
        todayDebrief.closingThought?.trim()
    );
  }, [todayDebrief]);

  const logicalWeekday = useMemo(
    () => getLogicalWeekdayIndex(new Date(), dayRolloverHour),
    [dayRolloverHour]
  );

  const goalCounts = useMemo(() => {
    const calc = (scope: GoalScope) => {
      const subset = goals.filter((g) => isGoalActiveForTab(g, scope, logicalWeekday));
      return {
        done: subset.filter((g) => g.completed).length,
        total: subset.length,
      };
    };
    return {
      daily: calc("daily"),
      weekly: calc("weekly"),
      longTerm: calc("longTerm"),
    };
  }, [goals, logicalWeekday]);

  const lowerBg =
    config?.lowerBackgroundPath && config.lowerBackgroundPath !== "/backgrounds/secret-chamber.svg"
      ? config.lowerBackgroundPath
      : "/backgrounds/bottom.webp";
  const timeFormat = config?.timeFormat ?? "12h";
  const activeRoomId = isChamberRoomId(activeMiniApp) ? activeMiniApp : null;
  const roomNavigationValue = useMemo(
    () => ({
      activeRoomId,
      openedFromChamber: activeTier === 1,
      onAscendToSurface: handleAscendToSurface,
    }),
    [activeRoomId, activeTier, handleAscendToSurface]
  );

  return (
    <div
      data-active-tier={activeTier}
      data-logical-date={logicalToday}
      className="relative h-screen w-screen overflow-hidden bg-[var(--bg-deep)] text-[var(--text-ivory)]"
    >
      {/* Transparent 32px Top Window Titlebar (Tauri runtime only, artwork flows seamlessly behind it) */}
      <WindowTitleBar />

      {vaultToast && (
        <div
          data-testid="vault-toast"
          className="fixed bottom-36 left-1/2 z-50 -translate-x-1/2 smoked-glass rounded-[3px] px-4 py-1.5 font-ui text-[0.7rem] tracking-[0.06em] text-[var(--accent-luminous)] pointer-events-none"
        >
          {vaultToast}
        </div>
      )}

      {/* Strict Single-Tick Two-Tier Viewport Stack (0vh Upper Observatory <-> -100vh Workspace) */}
      <motion.div
        data-testid="athenaeum-tier-stack"
        initial={false}
        animate={{ y: activeTier === 0 ? "0vh" : "-100vh" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="h-[200vh] w-full will-change-transform"
      >
        {/* ==================== UPPER ZONE: THE ATHENAEUM (100vh) ==================== */}
        <section
          id="observatory"
          data-testid="upper-observatory"
          data-surface-paused={activeTier !== 0 || activeMiniApp !== null ? "true" : "false"}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.dataset.canvasSurface === "true") {
              spawnStickyNote();
            }
          }}
          className="relative h-screen w-full shrink-0 overflow-hidden bg-[#070d16]"
        >
          <ObservatoryBackdrop isFocusMode={focusRunning} />
          <AmbientWildlifeLayer
            isFocusMode={focusRunning}
            paused={activeTier !== 0 || activeMiniApp !== null}
          />

          {/* Fixed wide feather-soft ambient sky vignette behind upper header (decoupled from quote height) */}
          <div
            aria-hidden="true"
            data-testid="observatory-sky-vignette"
            className="pointer-events-none absolute left-1/2 top-0 z-[6] -translate-x-1/2"
            style={{
              width: "1040px",
              height: "380px",
              background:
                "radial-gradient(ellipse 56% 58% at 50% 36%, rgba(8, 12, 20, 0.68) 0%, rgba(8, 12, 20, 0.36) 48%, rgba(8, 12, 20, 0) 78%)",
            }}
          />

          {/* Seamless dark earth-and-root bottom blend into the Secret Chamber seam */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-20"
            style={{
              background:
                "linear-gradient(0deg, rgba(6, 11, 18, 0.92) 0%, rgba(6, 11, 18, 0.44) 48%, rgba(6, 11, 18, 0) 100%)",
            }}
          />

          <div
            data-canvas-surface="true"
            onClick={() => setSelectedNoteId(null)}
            className="absolute inset-0 z-10"
          />

          {/* Free-Positioning Smoked-Glass Sticky Notes Layer */}
          <StickyNotesLayer
            notes={notes}
            selectedNoteId={selectedNoteId}
            draggingNoteId={draggingNoteId}
            isFocusMode={focusRunning}
            onSelectNote={setSelectedNoteId}
            onUpdateNote={handleUpdateNote}
            onPromoteNote={(note) => void handlePromoteNote(note)}
            onDragStateChange={handleNoteDragState}
            onDragEnd={handleNoteDragEnd}
          />

          {/* 16:9 Widescreen-First Spatial Overlay (reserves dedicated 32px top row in desktop runtime) */}
          <div
            data-canvas-surface="true"
            className="pointer-events-none relative z-20 flex h-full w-full flex-col"
          >
            {isTauriRuntime() && (
              <div aria-hidden="true" className="h-8 w-full shrink-0 bg-transparent" />
            )}
            <div
              data-canvas-surface="true"
              className="pointer-events-none relative flex flex-1 min-h-0 w-full flex-col justify-between px-8 pb-7 pt-4"
            >
            {/* TOP BAND */}
            <div className="flex w-full items-start justify-between gap-6">
              {/* TOP-LEFT CONTROLS: Settings Gear + "+ New Note" */}
              <div
                data-focus-dimmed={focusRunning ? "true" : "false"}
                className="focus-dimmable pointer-events-auto flex items-center gap-3 pt-1"
              >
                <button
                  type="button"
                  onClick={() => setActiveMiniApp("settings")}
                  data-testid="settings-gear-btn"
                  aria-label="Open Settings"
                  title="Settings"
                  className="cursor-pointer bg-transparent border-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)] hover:rotate-45 transition-[color,transform] duration-500 focus:outline-none"
                >
                  <Settings className="h-[19px] w-[19px]" strokeWidth={1.45} />
                </button>

                <button
                  type="button"
                  onClick={spawnStickyNote}
                  data-testid="new-note-btn"
                  title="Create a new note (Alt+N or double-click canvas)"
                  className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)] transition-[background-color,border-color,color] duration-200 focus:outline-none"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--accent-luminous)]" strokeWidth={1.8} />
                  New Note
                </button>
              </div>

              {/* UPPER-CENTER: THE OBSERVATORY */}
              <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 z-20 hidden sm:block">
                <ObservatoryClock
                  userName={config?.userName ?? ""}
                  quotes={config?.quotes ?? []}
                  timeFormat={timeFormat}
                />
              </div>

              {/* TOP-RIGHT TIER: Compact Rolling 3-Hour Check-In Card (top: 28px; right: 32px) */}
              <div
                data-focus-dimmed={focusRunning ? "true" : "false"}
                className="focus-dimmable pointer-events-auto"
              >
                <HourlyRollingWidget
                  date={dayLogDate}
                  blocks={dayLogBlocks}
                  scheduleBlocks={schedule}
                  recurringBlocks={recurringBlocks}
                  overrides={blockOverrides}
                  externalEvents={externalEvents}
                  timeFormat={timeFormat}
                  dayRolloverHour={dayRolloverHour}
                  onUpsertBlock={(b) => void handleUpsertDayLogBlock(b)}
                  onDeleteBlock={(d, s) => void handleDeleteDayLogBlock(d, s)}
                />
              </div>
            </div>

            {/* MIDDLE-LEFT TIER: Smoked-Glass Schedule & Mini-Calendar Panel */}
            <div
              data-focus-dimmed={focusRunning ? "true" : "false"}
              className="focus-dimmable pointer-events-auto absolute left-8 top-[49%] -translate-y-1/2 z-20"
            >
              <ScheduleReadout
                blocks={schedule}
                recurringBlocks={recurringBlocks}
                overrides={blockOverrides}
                externalEvents={externalEvents}
                hasIcsFeeds={(config?.calendarIcsUrls?.length ?? 0) > 0}
                timeFormat={timeFormat}
                dayRolloverHour={dayRolloverHour}
                onAddBlock={async (blk) => {
                  await storageService.upsertScheduleBlock(blk);
                  setSchedule(await storageService.listScheduleBlocks());
                }}
                onRescheduleRecurring={(blockId, logicalDate, newStartTime, durationMinutes) =>
                  void handleRescheduleRecurring(
                    blockId,
                    logicalDate,
                    newStartTime,
                    durationMinutes
                  )
                }
                onSkipRecurringToday={(blockId, logicalDate) =>
                  void handleSkipRecurringToday(blockId, logicalDate)
                }
                onStartFocusBlock={handleStartFocusBlock}
                onSyncCalendars={async () => {
                  await handleSyncCalendars(config?.calendarIcsUrls);
                }}
                onOpenCalendar={() => setActiveMiniApp("calendar")}
              />
            </div>

            {/* MIDDLE-RIGHT TIER (Horizon Level): Active Streak directly above Weekly Cadence Heatmap */}
            <div
              data-testid="right-horizon-tier"
              data-focus-dimmed={focusRunning ? "true" : "false"}
              className="focus-dimmable pointer-events-auto absolute right-8 top-[49%] -translate-y-1/2 z-20 flex flex-col items-end gap-4"
            >
              <ActiveStreakReadout
                streak={activeStreak}
                todayDebriefDone={todayDebriefDone}
                onOpenAnalytics={() => setActiveMiniApp("analytics")}
                onOpenDailyDebrief={() => {
                  setJournalInitialMode("debrief");
                  setActiveMiniApp("journal");
                }}
              />
              <ActivityHeatmap
                days={heatmap}
                goalCompletions={analyticsDataset.goalCompletions}
                goals={goals}
                logicalToday={logicalToday}
                timeFormat={timeFormat}
                dayRolloverHour={dayRolloverHour}
                onOpenAnalytics={() => setActiveMiniApp("analytics")}
                onOpenDailyDebrief={() => {
                  setJournalInitialMode("debrief");
                  setActiveMiniApp("journal");
                }}
              />
            </div>

            {/* BOTTOM BAND */}
            <div className="relative flex w-full items-end justify-between">
              <div className="pointer-events-auto pl-1 pb-1">
                <FocusRing
                  isRunning={focusRunning}
                  targetSeconds={focusTargetSeconds}
                  elapsedSeconds={focusElapsed}
                  activeLabel={focusActiveLabel}
                  activeGoalId={focusActiveGoalId}
                  goals={goals}
                  milestones={goalMilestones}
                  webhookStatus={webhookStatus}
                  onTargetSecondsChange={setFocusTargetSeconds}
                  onActiveTargetChange={({ label, goalId, category }) => {
                    setFocusActiveLabel(label);
                    setFocusActiveGoalId(goalId);
                    if (category) setFocusActiveCategory(category);
                  }}
                  onStart={(override) => void handleStartFocus(override)}
                  onStopAndSave={(completedNaturally) =>
                    void handleStopAndSaveFocus(completedNaturally)
                  }
                />
              </div>

              <div
                data-focus-dimmed={focusRunning && !draggingNoteId ? "true" : "false"}
                className="focus-dimmable pointer-events-auto absolute left-1/2 bottom-0 -translate-x-1/2"
              >
                <BottomDockZone
                  counts={goalCounts}
                  isDraggingNote={draggingNoteId !== null}
                  isHoveringTrash={isHoveringTrash}
                  trashZoneRef={trashZoneRef}
                  onOpenGoalsTab={(scope) => {
                    setGoalsInitialTab(scope);
                    setActiveMiniApp("goals");
                  }}
                  onDescend={() => snapToTier(1)}
                />
              </div>

              {/* BOTTOM-RIGHT TIER: Apple Music & Ambient Soundscape Controls (aligned with Focus controls) */}
              <div
                data-focus-dimmed={focusRunning ? "true" : "false"}
                className="focus-dimmable pointer-events-auto pb-1"
              >
                <MusicPlayer
                  preferredMusicPlayer={config?.preferredMusicPlayer ?? "none"}
                  onOpenFocusStudio={() => setActiveMiniApp("focus")}
                />
              </div>
            </div>
            </div>
          </div>
        </section>

        {/* ==================== LOWER ZONE: SUBTERRANEAN SECRET CHAMBER (LOCKED 100vh) ==================== */}
        <SecretChamber
          backgroundPath={lowerBg}
          activeRoomId={activeRoomId}
          onOpenMiniApp={(app) => {
            if (app === "goals") setGoalsInitialTab("daily");
            if (app === "journal") setJournalInitialMode("debrief");
            if (app === "toc") setInitialTocTreeId(null);
            setActiveMiniApp(app);
          }}
          onAscend={() => snapToTier(0)}
        />
      </motion.div>

      {/* ==================== FIRST-RUN ONBOARDING WIZARD ==================== */}
      {config && (
        <OnboardingWizard
          open={showOnboarding}
          config={config}
          defaultLocalNotesPath={defaultLocalNotesPath}
          onPickVaultFolder={() => storageService.pickVaultFolder()}
          onPickBooksFolder={() => storageService.pickBooksFolder()}
          onComplete={async (nextCfg) => {
            const saved = await storageService.saveConfig({
              ...nextCfg,
              onboardingCompleted: true,
            });
            setConfig(saved);
            setShowOnboarding(false);
            const nextLogical = getLogicalDate(new Date(), saved.dayRolloverHour ?? 3);
            setDayLogDate(nextLogical);
            await storageService.setBriefingDismissedDate(nextLogical);
            await refreshAllData(saved.dayRolloverHour ?? 3);
          }}
        />
      )}

      {/* ==================== STARTUP DAILY BRIEFING ==================== */}
      <DailyBriefingModal
        open={showBriefing && !showOnboarding}
        userName={config?.userName ?? ""}
        timeFormat={timeFormat}
        logicalToday={logicalToday}
        goals={goals}
        schedule={schedule}
        yesterdayFocusMinutes={yesterdayFocusMinutes}
        yesterdayDebrief={yesterdayDebrief}
        onOpenDailyDebrief={() => {
          void handleDismissBriefing();
          setJournalInitialMode("debrief");
          setActiveMiniApp("journal");
        }}
        onDismiss={() => void handleDismissBriefing()}
      />

      {/* ==================== DAILY ACTIVE RECALL DRAWER ==================== */}
      <RecallDrawer
        open={recallOpen}
        deck={recallDeck}
        onRefresh={async () => {
          setRecallDeck(await storageService.getRecallDeck(dayRolloverHour));
        }}
        onRateCard={async (cardHash, rating) => {
          const result = await storageService.reviewRecallCard(cardHash, rating, dayRolloverHour);
          setRecallDeck(result.deck);
          setAnalyticsDataset(await storageService.getAnalyticsDataset(dayRolloverHour));
          return result;
        }}
        onOpenInVault={(sourceFile: string, sourceCategory: RecallSourceCategory, sourceFileName: string) => {
          if (isTauriRuntime()) {
            void storageService.openVaultFile(sourceFile);
          } else {
            setRecallOpen(false);
            if (sourceCategory === "toc") {
              setActiveMiniApp("toc");
            } else {
              setJournalInitialMode("reflections");
              setActiveMiniApp("journal");
            }
          }
          showToast(`Opening ${sourceFileName}`);
        }}
        onClose={() => setRecallOpen(false)}
      />

      {/* ==================== QUICK CAPTURE BAR (IN-APP OVERLAY) ==================== */}
      <QuickCaptureOverlay
        open={quickCaptureOpen}
        onSubmitted={(result) => void handleQuickCaptureSubmitted(result)}
        onClose={() => setQuickCaptureOpen(false)}
      />

      {/* ==================== FULL-SCREEN MINI-APP ROUTING ==================== */}
      <RoomNavigationContext.Provider value={roomNavigationValue}>
        <AnimatePresence>
        {activeMiniApp === "goals" && (
          <GoalsMiniApp
            key="miniapp-goals"
            initialScope={goalsInitialTab}
            goals={goals}
            milestones={goalMilestones}
            logicalDate={logicalToday}
            dayRolloverHour={dayRolloverHour}
            onUpsertGoal={(g) => void handleUpsertGoal(g)}
            onDeleteGoal={(id) => void handleDeleteGoal(id)}
            onReorderScope={(scope, ordered) => void handleReorderScope(scope, ordered)}
            onUpsertMilestone={(ms) => void handleUpsertMilestone(ms)}
            onDeleteMilestone={(id) => void handleDeleteMilestone(id)}
            onReorderMilestones={(gid, ordered) =>
              void handleReorderMilestones(gid, ordered)
            }
            onFocusOnGoal={handleFocusOnGoal}
            onAddToCalendar={(goal) => {
              setPendingCalendarEvent({
                title: goal.title,
                date: logicalToday,
                durationMinutes: goal.durationMinutes > 0 ? goal.durationMinutes : 60,
              });
              setActiveMiniApp("calendar");
            }}
            onOpenDailyDebrief={() => {
              setJournalInitialMode("debrief");
              setActiveMiniApp("journal");
            }}
            onClose={() => setActiveMiniApp(null)}
          />
        )}

        {activeMiniApp === "focus" && config && (
          <FocusStudioMiniApp
            key="miniapp-focus"
            config={config}
            isRunning={focusRunning}
            targetSeconds={focusTargetSeconds}
            elapsedSeconds={focusElapsed}
            activeLabel={focusActiveLabel}
            activeGoalId={focusActiveGoalId}
            goals={goals}
            milestones={goalMilestones}
            sessions={sessions}
            logicalToday={logicalToday}
            dayRolloverHour={dayRolloverHour}
            timeFormat={timeFormat}
            lightStatus={webhookStatus}
            onTargetSecondsChange={setFocusTargetSeconds}
            onActiveTargetChange={({ label, goalId, category }) => {
              setFocusActiveLabel(label);
              setFocusActiveGoalId(goalId);
              if (category) setFocusActiveCategory(category);
            }}
            onStart={(override) => void handleStartFocus(override)}
            onStopAndSave={(completedNaturally) =>
              void handleStopAndSaveFocus(completedNaturally)
            }
            onApplyLightCommand={handleApplyLightCommand}
            onSaveConfig={async (next) => {
              const saved = await storageService.saveConfig(next);
              setConfig(saved);
            }}
            onOpenSettings={() => setActiveMiniApp("settings")}
            onClose={() => setActiveMiniApp(null)}
          />
        )}

        {activeMiniApp === "calendar" && (
          <CalendarMiniApp
            key="miniapp-calendar"
            logicalToday={logicalToday}
            dayRolloverHour={dayRolloverHour}
            timeFormat={timeFormat}
            blocks={schedule}
            recurringBlocks={recurringBlocks}
            overrides={blockOverrides}
            externalEvents={externalEvents}
            goals={goals}
            onUpsertBlock={async (blk) => {
              await storageService.upsertScheduleBlock(blk);
              setSchedule(await storageService.listScheduleBlocks());
            }}
            onDeleteBlock={async (id) => {
              await storageService.deleteScheduleBlock(id);
              setSchedule(await storageService.listScheduleBlocks());
            }}
            onUpsertRecurringBlock={handleUpsertRecurringBlock}
            onDeleteRecurringBlock={handleDeleteRecurringBlock}
            onUpsertOverride={handleUpsertBlockOverride}
            onStartFocusBlock={handleStartFocusBlock}
            initialCreateEvent={pendingCalendarEvent}
            onConsumeInitialCreateEvent={() => setPendingCalendarEvent(null)}
            onClose={() => {
              setPendingCalendarEvent(null);
              setActiveMiniApp(null);
            }}
          />
        )}

        {activeMiniApp === "library" && config && (
          <LibraryMiniApp
            key="miniapp-library"
            books={books}
            config={config}
            timeFormat={timeFormat}
            dayRolloverHour={dayRolloverHour}
            focusRunning={focusRunning}
            focusTargetSeconds={focusTargetSeconds}
            focusElapsed={focusElapsed}
            focusActiveLabel={focusActiveLabel}
            onFocusTargetSecondsChange={setFocusTargetSeconds}
            onStartReadingFocus={(targetSecs) =>
              void handleStartFocus(targetSecs, "Read Book")
            }
            onStopAndSaveFocus={() => void handleStopAndSaveFocus()}
            onBooksChanged={setBooks}
            onReadingGoalCompleted={() => {
              void refreshAllData();
              showToast("Daily reading habit completed");
            }}
            recallDueCount={recallDeck?.dueCards.length ?? 0}
            onOpenDailyRecall={() => setRecallOpen(true)}
            onOpenSettings={() => setActiveMiniApp("settings")}
            onClose={() => setActiveMiniApp(null)}
          />
        )}

        {activeMiniApp === "toc" && (
          <TocMiniApp
            key="miniapp-toc"
            trees={tocTrees}
            initialTreeId={initialTocTreeId}
            logicalToday={logicalToday}
            onSaveTree={async (tree) => {
              const saved = await storageService.upsertTocTree(tree, dayRolloverHour);
              const refreshed = await storageService.listTocTrees();
              setTocTrees(refreshed);
              return saved;
            }}
            onDeleteTree={async (id) => {
              await storageService.deleteTocTree(id);
              setTocTrees(await storageService.listTocTrees());
            }}
            onClose={() => {
              setInitialTocTreeId(null);
              setActiveMiniApp(null);
            }}
          />
        )}

        {activeMiniApp === "analytics" && (
          <AnalyticsMiniApp
            key="miniapp-analytics"
            dataset={analyticsDataset}
            goals={goals}
            milestones={goalMilestones}
            dayLogDate={dayLogDate}
            dayLogBlocks={dayLogBlocks}
            timeFormat={timeFormat}
            dayRolloverHour={dayRolloverHour}
            onDayLogDateChange={handleDayLogDateChange}
            onUpsertDayLogBlock={(b) => void handleUpsertDayLogBlock(b)}
            onDeleteDayLogBlock={(d, s) => void handleDeleteDayLogBlock(d, s)}
            onClose={() => setActiveMiniApp(null)}
          />
        )}

        {activeMiniApp === "journal" && (
          <JournalMiniApp
            key="miniapp-journal"
            initialMode={journalInitialMode}
            logicalToday={logicalToday}
            dayRolloverHour={dayRolloverHour}
            timeFormat={timeFormat}
            vaultPath={config?.vaultPath ?? ""}
            goals={goals}
            heatmap={heatmap}
            tocTrees={tocTrees}
            deviceTelemetry={analyticsDataset.deviceTelemetry}
            onOpenTocTree={(treeId) => {
              setInitialTocTreeId(treeId);
              setActiveMiniApp("toc");
            }}
            onDebriefPublished={async () => {
              await refreshAllData();
              if (config?.n8nTriggerDailyDebrief && config.n8nWebhookUrl.trim()) {
                void storageService.sendN8nEvent(
                  "daily_debrief_published",
                  { logicalDate: logicalToday },
                  config
                );
              }
            }}
            onClose={() => {
              setActiveMiniApp(null);
              void refreshJournalCount();
              void storageService
                .getDailyDebrief(logicalToday)
                .then(setTodayDebrief)
                .catch(() => {});
            }}
          />
        )}

        {activeMiniApp === "automations" && config && (
          <AutomationsMiniApp
            key="miniapp-automations"
            config={config}
            onTestWebhook={() =>
              storageService.triggerHomeAssistantWebhook("test_scene", "manual", config)
            }
            onOpenSettings={() => setActiveMiniApp("settings")}
            onClose={() => setActiveMiniApp(null)}
          />
        )}

        {activeMiniApp === "settings" && config && (
          <SettingsMiniApp
            key="miniapp-settings"
            config={config}
            onSaveConfig={async (next) => {
              const saved = await storageService.saveConfig(next);
              setConfig(saved);
              const nextLogical = getLogicalDate(new Date(), saved.dayRolloverHour ?? 3);
              setDayLogDate(nextLogical);
              await refreshAllData(saved.dayRolloverHour ?? 3);
            }}
            onPickVaultFolder={() => storageService.pickVaultFolder()}
            onPickBooksFolder={() => storageService.pickBooksFolder()}
            onSyncCalendars={(urls) => handleSyncCalendars(urls)}
            onTestLightPing={async (cmd, label) => {
              const res = await storageService.setHaLightState(cmd, config);
              return label ? `${label}: ${res.message}` : res.message;
            }}
            onOpenFocusStudio={() => setActiveMiniApp("focus")}
            onReopenBriefing={() => setShowBriefing(true)}
            onRerunOnboarding={() => {
              setActiveMiniApp(null);
              setShowOnboarding(true);
            }}
            onClose={() => setActiveMiniApp(null)}
          />
        )}
        </AnimatePresence>
      </RoomNavigationContext.Provider>
    </div>
  );
}

export default App;
