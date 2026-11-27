import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  FolderSync,
  Highlighter,
  LampDesk,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { RoomBackdrop } from "./RoomBackdrop";
import {
  PdfDocumentView,
  type PdfSearchMatch,
  type SaveHighlightPayload,
} from "../reader/PdfDocumentView";
import { EpubDocumentView, type EpubSearchMatch } from "../reader/EpubDocumentView";
import { storageService } from "../../services/storage";
import {
  AMBIENT_SOUNDSCAPES,
  ambientAudio,
  type AmbientTexture,
} from "../../services/ambientAudio";
import { formatIsoTimestamp, formatSecondsMMSS, parseDurationSeconds } from "../../utils/time";
import { renderPdfPage1Thumbnail } from "../../utils/pdfCoverThumbnail";
import type {
  AthenaeumConfig,
  BookHighlight,
  DailyReadingProgress,
  HighlightRect,
  LibraryBook,
  MediaSessionState,
  PaperTint,
  TimeFormat,
} from "../../types/athenaeum";

interface LibraryMiniAppProps {
  books: LibraryBook[];
  config: AthenaeumConfig;
  timeFormat: TimeFormat;
  dayRolloverHour: number;
  // Shared Focus Engine props (auto-links "Read Book" when started from Reader)
  focusRunning: boolean;
  focusTargetSeconds: number | null;
  focusElapsed: number;
  focusActiveLabel: string;
  onFocusTargetSecondsChange: (seconds: number | null) => void;
  onStartReadingFocus: (targetSeconds?: number | null) => void;
  onStopAndSaveFocus: () => void;
  onBooksChanged: (books: LibraryBook[]) => void;
  onReadingGoalCompleted: () => void;
  recallDueCount?: number;
  onOpenDailyRecall?: () => void;
  onOpenSettings?: () => void;
  onClose: () => void;
}

const PAPER_TINTS: { id: PaperTint; label: string; swatch: string }[] = [
  { id: "original", label: "Original", swatch: "#f5f4f0" },
  { id: "parchment", label: "Parchment", swatch: "#efe3c5" },
  { id: "sage", label: "Sage", swatch: "#cfdcd0" },
  { id: "obsidian", label: "Obsidian", swatch: "#131e1b" },
];

function formatLastOpened(iso: string | null | undefined, timeFormat: TimeFormat): string {
  if (!iso) return "Unread";
  const datePart = iso.slice(0, 10);
  const timePart = formatIsoTimestamp(iso, timeFormat);
  return `${datePart} · ${timePart}`;
}

// Track book IDs whose PDF cover generation permanently failed this session so we don't retry endlessly
const thumbnailFailedIds = new Set<string>();

export function LibraryMiniApp({
  books,
  config,
  timeFormat,
  dayRolloverHour,
  focusRunning,
  focusTargetSeconds,
  focusElapsed,
  focusActiveLabel,
  onFocusTargetSecondsChange,
  onStartReadingFocus,
  onStopAndSaveFocus,
  onBooksChanged,
  onReadingGoalCompleted,
  onOpenSettings,
  onClose,
}: LibraryMiniAppProps) {
  const [scanning, setScanning] = useState(false);
  const [shelfNotice, setShelfNotice] = useState<string | null>(null);

  // Active open book state
  const [activeBook, setActiveBook] = useState<LibraryBook | null>(null);
  const [bookBytes, setBookBytes] = useState<ArrayBuffer | null>(null);
  const [loadingBook, setLoadingBook] = useState(false);
  const [bookLoadError, setBookLoadError] = useState<string | null>(null);

  // Reader controls
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [pageJumpDraft, setPageJumpDraft] = useState<string>("1");
  const [zoom, setZoom] = useState<number>(1.0);
  const [tint, setTint] = useState<PaperTint>(() => {
    const saved = window.localStorage.getItem("athenaeum_reader_tint");
    if (saved === "original" || saved === "parchment" || saved === "sage" || saved === "obsidian") {
      return saved;
    }
    return "parchment";
  });

  // Daily reading progress state (respects optional Daily Reading Habit preference)
  const [dailyReading, setDailyReading] = useState<DailyReadingProgress>({
    logicalDate: storageService.getLogicalToday(dayRolloverHour),
    pagesReadToday: 0,
    targetPages: config.dailyReadingTargetPages || 10,
    goalCompleted: false,
    goalAutoCheckedNow: false,
  });

  // Left margin widgets: Compact Focus Timer, Reading Light, Audio & Soundscape
  const [customMode, setCustomMode] = useState<boolean>(
    focusTargetSeconds !== null && focusTargetSeconds > 0
  );
  const [customDurationInput, setCustomDurationInput] = useState<string>(
    focusTargetSeconds ? formatSecondsMMSS(focusTargetSeconds) : ""
  );
  const [readingLightOn, setReadingLightOn] = useState<boolean>(false);
  const [readingLightStatus, setReadingLightStatus] = useState<string | null>(null);

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
  const [ambientTexture, setAmbientTexture] = useState<AmbientTexture>(() =>
    ambientAudio.getTexture()
  );
  const [ambientVolume, setAmbientVolume] = useState<number>(() => ambientAudio.getVolume());

  // Collapsible Highlights & Notes Side Panel
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  const [highlightsDrawerOpen, setHighlightsDrawerOpen] = useState<boolean>(false);
  const [pulsingHighlightId, setPulsingHighlightId] = useState<string | null>(null);
  const [jumpToHighlight, setJumpToHighlight] = useState<{
    id: string;
    pageNumber: number;
    rects?: HighlightRect[];
    nonce: number;
  } | null>(null);
  const [jumpToCfi, setJumpToCfi] = useState<{ cfi: string; nonce: number } | null>(null);
  const [pageNoteDraft, setPageNoteDraft] = useState<string>("");
  const [savingNote, setSavingNote] = useState<boolean>(false);
  const [vaultSyncNotice, setVaultSyncNotice] = useState<string | null>(null);

  // Minimalist Ctrl+F In-Book Search
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pdfSearchMatches, setPdfSearchMatches] = useState<PdfSearchMatch[]>([]);
  const [epubSearchMatches, setEpubSearchMatches] = useState<EpubSearchMatch[]>([]);
  const [searchIndexing, setSearchIndexing] = useState<boolean>(false);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number>(0);

  const scrollOffsetRef = useRef<number>(0);
  const epubCfiRef = useRef<string>("");
  const saveProgressTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autoCompletedFocusRef = useRef(false);
  const currentPageRef = useRef<number>(currentPage);
  currentPageRef.current = currentPage;

  // Sync ambient soundscape state with global engine
  useEffect(() => {
    return ambientAudio.subscribe(() => {
      setAmbientTexture(ambientAudio.getTexture());
      setAmbientVolume(ambientAudio.getVolume());
    });
  }, []);

  // Poll Apple Music SMTC while in Reader view
  const pollMedia = useCallback(async () => {
    const state = await storageService.getMediaState();
    setMedia(state);
  }, []);

  useEffect(() => {
    if (!activeBook) return;
    void pollMedia();
    const id = window.setInterval(() => void pollMedia(), 3000);
    return () => window.clearInterval(id);
  }, [activeBook, pollMedia]);

  // Auto-scan configured Books folder + load daily reading progress on mount
  const scanFolder = useCallback(async () => {
    setScanning(true);
    try {
      const scanned = await storageService.scanBooksFolder(config.booksFolderPath);
      onBooksChanged(scanned);
    } finally {
      setScanning(false);
    }
  }, [config.booksFolderPath, onBooksChanged]);

  useEffect(() => {
    void scanFolder();
    void storageService
      .getDailyReadingProgress(dayRolloverHour)
      .then(setDailyReading);
  }, [scanFolder, dayRolloverHour]);

  // Non-blocking background queue generating & caching Page-1 PDF cover thumbnails in SQLite
  const booksRef = useRef<LibraryBook[]>(books);
  booksRef.current = books;
  const onBooksChangedRef = useRef(onBooksChanged);
  onBooksChangedRef.current = onBooksChanged;
  const [localThumbMap, setLocalThumbMap] = useState<Record<string, string>>({});
  const localThumbMapRef = useRef<Record<string, string>>({});
  localThumbMapRef.current = localThumbMap;
  const isMountedRef = useRef(true);
  const queueRunningRef = useRef(false);
  const activeBookRef = useRef<LibraryBook | null>(activeBook);
  activeBookRef.current = activeBook;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const drainThumbnailQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    try {
      while (isMountedRef.current && !activeBookRef.current) {
        const nextBook = booksRef.current.find(
          (b) =>
            b.format === "pdf" &&
            Boolean(b.filePath?.trim()) &&
            !b.coverThumbnail &&
            !localThumbMapRef.current[b.id] &&
            !thumbnailFailedIds.has(b.id)
        );
        if (!nextBook) break;

        // Yield cleanly to browser paint before each offscreen PDF Page-1 render
        await new Promise<void>((resolve) => window.setTimeout(resolve, 35));
        if (!isMountedRef.current || activeBookRef.current) break;

        try {
          const bytes = await storageService.readBookBytes(nextBook.filePath);
          if (!isMountedRef.current) break;
          const dataUrl = await renderPdfPage1Thumbnail(bytes, 260, 360);
          if (!isMountedRef.current) break;

          if (!dataUrl) {
            thumbnailFailedIds.add(nextBook.id);
            continue;
          }

          localThumbMapRef.current = {
            ...localThumbMapRef.current,
            [nextBook.id]: dataUrl,
          };
          setLocalThumbMap(localThumbMapRef.current);

          const saved = await storageService.saveBookCoverThumbnail(nextBook.id, dataUrl);
          if (isMountedRef.current && saved) {
            const updatedBooks = booksRef.current.map((item) =>
              item.id === nextBook.id ? { ...item, coverThumbnail: dataUrl } : item
            );
            booksRef.current = updatedBooks;
            onBooksChangedRef.current(updatedBooks);
          }
        } catch {
          thumbnailFailedIds.add(nextBook.id);
        }
      }
    } finally {
      queueRunningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!activeBook) {
      void drainThumbnailQueue();
    }
  }, [books, activeBook, drainThumbnailQueue]);

  // Auto-complete custom focus countdown inside the reader
  useEffect(() => {
    if (!focusRunning) {
      autoCompletedFocusRef.current = false;
      return;
    }
    if (
      focusTargetSeconds !== null &&
      focusTargetSeconds > 0 &&
      focusElapsed >= focusTargetSeconds &&
      !autoCompletedFocusRef.current
    ) {
      autoCompletedFocusRef.current = true;
      onStopAndSaveFocus();
    }
  }, [focusRunning, focusTargetSeconds, focusElapsed, onStopAndSaveFocus]);

  // Persist tint preference
  const handleSelectTint = (next: PaperTint) => {
    setTint(next);
    window.localStorage.setItem("athenaeum_reader_tint", next);
  };

  // Persist book progress & record unique page toward Daily 5-Page Goal
  const persistProgress = useCallback(
    async (bookId: string, page: number, total: number, scroll: number, cfi?: string) => {
      try {
        const updatedBook = await storageService.updateBookProgress(
          bookId,
          page,
          total,
          scroll,
          cfi
        );
        setActiveBook((prev) => (prev && prev.id === bookId ? updatedBook : prev));
        const all = await storageService.listLibraryBooks();
        onBooksChanged(all);
      } catch {
        // Non-fatal persistence error
      }
    },
    [onBooksChanged]
  );

  const trackLogicalPageRead = useCallback(
    async (bookId: string, page: number) => {
      try {
        const progress = await storageService.recordReadingPage(bookId, page, dayRolloverHour);
        setDailyReading(progress);
        if (progress.goalAutoCheckedNow) {
          onReadingGoalCompleted();
        }
      } catch {
        // Non-fatal tracking error
      }
    },
    [dayRolloverHour, onReadingGoalCompleted]
  );

  const openBook = useCallback(
    async (book: LibraryBook) => {
      if (!book.filePath) {
        setShelfNotice("This entry has no linked PDF or EPUB file on disk.");
        window.setTimeout(() => setShelfNotice(null), 3200);
        return;
      }
      setActiveBook(book);
      setBookBytes(null);
      setBookLoadError(null);
      setLoadingBook(true);
      const startPage = Math.max(1, book.currentPage || 1);
      setCurrentPage(startPage);
      setTotalPages(book.totalPages || 0);
      setPageJumpDraft(String(startPage));
      scrollOffsetRef.current = book.scrollOffset || 0;
      epubCfiRef.current = book.epubCfi || "";
      setHighlightsDrawerOpen(false);
      setPulsingHighlightId(null);
      setJumpToHighlight(null);
      setJumpToCfi(null);
      setPageNoteDraft("");
      setSearchOpen(false);
      setSearchQuery("");
      setPdfSearchMatches([]);
      setEpubSearchMatches([]);
      setActiveSearchIdx(0);

      try {
        const [bytes, loadedHighlights, progress] = await Promise.all([
          storageService.readBookBytes(book.filePath),
          storageService.listBookHighlights(book.id),
          storageService.getDailyReadingProgress(dayRolloverHour),
        ]);
        setBookBytes(bytes);
        setHighlights(loadedHighlights);
        setDailyReading(progress);
        await persistProgress(
          book.id,
          startPage,
          book.totalPages || 0,
          book.scrollOffset || 0,
          book.epubCfi
        );
        await trackLogicalPageRead(book.id, startPage);
        if (config.haAutoLight && config.haBaseUrl.trim()) {
          setReadingLightOn(true);
          void storageService
            .triggerReadingLightWebhook(true, config)
            .then((msg) => setReadingLightStatus(msg))
            .catch(() => {});
        }
      } catch (err) {
        setBookLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingBook(false);
      }
    },
    [config, dayRolloverHour, persistProgress, trackLogicalPageRead]
  );

  const closeReader = useCallback(() => {
    if (activeBook) {
      void persistProgress(
        activeBook.id,
        currentPage,
        totalPages,
        scrollOffsetRef.current,
        epubCfiRef.current
      );
      if (config.haAutoLight && config.haBaseUrl.trim()) {
        setReadingLightOn(false);
        void storageService.triggerReadingLightWebhook(false, config).catch(() => {});
      }
    }
    setActiveBook(null);
    setBookBytes(null);
    setBookLoadError(null);
  }, [activeBook, config, currentPage, totalPages, persistProgress]);

  // Keyboard navigation in Reader (Ctrl+F toggles search; Esc closes search first, then returns to shelf)
  useEffect(() => {
    if (!activeBook) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
        window.setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 20);
        return;
      }

      if (e.key === "Escape") {
        const targetEl = e.target as HTMLElement | null;
        if (targetEl?.getAttribute("data-testid") === "floating-note-input") {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          setPdfSearchMatches([]);
          setEpubSearchMatches([]);
          setActiveSearchIdx(0);
          return;
        }
        closeReader();
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "ArrowRight" && totalPages > 0 && currentPage < totalPages) {
        e.preventDefault();
        handlePageChange(currentPage + 1);
      } else if (e.key === "ArrowLeft" && currentPage > 1) {
        e.preventDefault();
        handlePageChange(currentPage - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBook, currentPage, totalPages, searchOpen, closeReader]);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const clamped = Math.max(1, totalPages > 0 ? Math.min(totalPages, nextPage) : nextPage);
      setCurrentPage(clamped);
      setPageJumpDraft(String(clamped));
      scrollOffsetRef.current = 0;
      if (activeBook) {
        void persistProgress(activeBook.id, clamped, totalPages, 0, epubCfiRef.current);
        void trackLogicalPageRead(activeBook.id, clamped);
      }
    },
    [activeBook, totalPages, persistProgress, trackLogicalPageRead]
  );

  const handleDocumentLoaded = useCallback(
    (pages: number) => {
      setTotalPages(pages);
      if (activeBook) {
        const safePage = Math.max(1, Math.min(pages, currentPage));
        if (safePage !== currentPage) {
          setCurrentPage(safePage);
          setPageJumpDraft(String(safePage));
        }
        void persistProgress(
          activeBook.id,
          safePage,
          pages,
          scrollOffsetRef.current,
          epubCfiRef.current
        );
      }
    },
    [activeBook, currentPage, persistProgress]
  );

  const handleScrollOffsetChange = useCallback(
    (offset: number) => {
      scrollOffsetRef.current = offset;
      if (!activeBook) return;
      if (saveProgressTimerRef.current) {
        window.clearTimeout(saveProgressTimerRef.current);
      }
      saveProgressTimerRef.current = window.setTimeout(() => {
        void persistProgress(
          activeBook.id,
          currentPage,
          totalPages,
          offset,
          epubCfiRef.current
        );
      }, 650);
    },
    [activeBook, currentPage, totalPages, persistProgress]
  );

  const handleEpubLocationChange = useCallback(
    (page: number, total: number, cfi: string) => {
      setCurrentPage(page);
      setTotalPages(total);
      setPageJumpDraft(String(page));
      epubCfiRef.current = cfi;
      if (activeBook) {
        void persistProgress(activeBook.id, page, total, 0, cfi);
        void trackLogicalPageRead(activeBook.id, page);
      }
    },
    [activeBook, persistProgress, trackLogicalPageRead]
  );

  const handleSaveHighlight = useCallback(
    async (payload: {
      quote: string;
      note: string;
      pageNumber: number;
      rects?: HighlightRect[];
      cfiRange?: string;
      color?: BookHighlight["color"];
    }) => {
      if (!activeBook) return;
      const cleanQuote = payload.quote.trim();
      const cleanNote = payload.note.trim();
      if (!cleanQuote && !cleanNote) return;

      setSavingNote(true);
      try {
        const item: BookHighlight = {
          id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          bookId: activeBook.id,
          pageNumber: Math.max(1, payload.pageNumber || currentPageRef.current),
          quote: cleanQuote,
          note: cleanNote,
          color: payload.color ?? "amber",
          cfiRange: payload.cfiRange ?? "",
          rects: payload.rects && payload.rects.length > 0 ? payload.rects : undefined,
          createdAt: new Date().toISOString(),
        };
        const res = await storageService.addBookHighlight(item, activeBook.title, activeBook.author);
        setHighlights((prev) =>
          [...prev, res.highlight].sort(
            (a, b) => a.pageNumber - b.pageNumber || b.createdAt.localeCompare(a.createdAt)
          )
        );
        setVaultSyncNotice(
          cleanNote
            ? `Saved highlight & note (p. ${item.pageNumber}) to Vault`
            : `Highlighted p. ${item.pageNumber} · synced to Vault`
        );
        window.setTimeout(() => setVaultSyncNotice(null), 3200);
      } catch (err) {
        setVaultSyncNotice(err instanceof Error ? err.message : "Failed saving highlight");
        window.setTimeout(() => setVaultSyncNotice(null), 3500);
      } finally {
        setSavingNote(false);
      }
    },
    [activeBook]
  );

  const handleSaveStandalonePageNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = pageNoteDraft.trim();
    if (!clean) return;
    await handleSaveHighlight({
      quote: "",
      note: clean,
      pageNumber: currentPage,
      color: "brass",
    });
    setPageNoteDraft("");
  };

  const handleJumpToHighlight = useCallback(
    (hl: BookHighlight) => {
      if (hl.pageNumber !== currentPageRef.current) {
        handlePageChange(hl.pageNumber);
      }
      if (activeBook?.format === "epub" && hl.cfiRange) {
        setJumpToCfi({ cfi: hl.cfiRange, nonce: Date.now() });
      } else {
        setJumpToHighlight({
          id: hl.id,
          pageNumber: hl.pageNumber,
          rects: hl.rects,
          nonce: Date.now(),
        });
      }
      setPulsingHighlightId(hl.id);
      if (pulseTimerRef.current) {
        window.clearTimeout(pulseTimerRef.current);
      }
      pulseTimerRef.current = window.setTimeout(() => {
        setPulsingHighlightId((prev) => (prev === hl.id ? null : prev));
      }, 1450);
    },
    [activeBook?.format, handlePageChange]
  );

  const handleDeleteHighlight = async (id: string) => {
    if (!activeBook) return;
    await storageService.deleteBookHighlight(activeBook.id, id);
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  };

  const handlePdfSearchResults = useCallback(
    (matches: PdfSearchMatch[], indexing: boolean) => {
      setSearchIndexing(indexing);
      setPdfSearchMatches(matches);
      if (matches.length === 0) {
        setActiveSearchIdx(0);
        return;
      }
      // Jump smoothly to the first match on or after the current page
      const firstAtOrAfter = matches.findIndex((m) => m.pageNumber >= currentPageRef.current);
      const nextIdx = firstAtOrAfter >= 0 ? firstAtOrAfter : 0;
      setActiveSearchIdx(nextIdx);
      const targetPage = matches[nextIdx].pageNumber;
      if (targetPage !== currentPageRef.current) {
        handlePageChange(targetPage);
      }
    },
    [handlePageChange]
  );

  const handleEpubSearchResults = useCallback(
    (matches: EpubSearchMatch[], indexing: boolean) => {
      setSearchIndexing(indexing);
      setEpubSearchMatches(matches);
      setActiveSearchIdx(0);
    },
    []
  );

  const totalSearchMatches =
    activeBook?.format === "epub" ? epubSearchMatches.length : pdfSearchMatches.length;

  const stepSearchMatch = useCallback(
    (delta: 1 | -1) => {
      if (totalSearchMatches === 0) return;
      const nextIdx = (activeSearchIdx + delta + totalSearchMatches) % totalSearchMatches;
      setActiveSearchIdx(nextIdx);
      if (activeBook?.format === "pdf") {
        const match = pdfSearchMatches[nextIdx];
        if (match && match.pageNumber !== currentPageRef.current) {
          handlePageChange(match.pageNumber);
        }
      }
    },
    [activeBook?.format, activeSearchIdx, handlePageChange, pdfSearchMatches, totalSearchMatches]
  );

  const closeSearchBar = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setPdfSearchMatches([]);
    setEpubSearchMatches([]);
    setActiveSearchIdx(0);
  }, []);

  const handleOpenExternalUrl = useCallback((url: string) => {
    void storageService.openExternalUrl(url);
  }, []);

  const handleToggleReadingLight = async () => {
    const next = !readingLightOn;
    setReadingLightOn(next);
    try {
      const msg = await storageService.triggerReadingLightWebhook(next, config);
      setReadingLightStatus(msg);
      window.setTimeout(() => setReadingLightStatus(null), 3600);
    } catch (err) {
      setReadingLightStatus(err instanceof Error ? err.message : "Webhook failed");
      window.setTimeout(() => setReadingLightStatus(null), 3600);
    }
  };

  const handleCommitCustomTimer = () => {
    const trimmed = customDurationInput.trim();
    if (!trimmed) {
      onFocusTargetSecondsChange(null);
      setCustomMode(false);
      return;
    }
    const parsed = parseDurationSeconds(trimmed);
    if (parsed !== null) {
      onFocusTargetSecondsChange(parsed);
      setCustomDurationInput(formatSecondsMMSS(parsed));
      setCustomMode(true);
    }
  };

  const handleStartReaderTimer = () => {
    let targetOverride: number | null | undefined = undefined;
    if (customMode) {
      const parsed = parseDurationSeconds(customDurationInput.trim());
      if (parsed !== null) {
        targetOverride = parsed;
      } else {
        targetOverride = null;
        setCustomMode(false);
      }
    } else {
      targetOverride = null;
    }
    onStartReadingFocus(targetOverride);
  };

  // Most recently opened book for prominent "Continue Reading" hero banner
  const mostRecentBook = useMemo(() => {
    const opened = books.filter((b) => b.lastOpenedAt && b.filePath);
    if (opened.length > 0) {
      return [...opened].sort((a, b) =>
        (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "")
      )[0];
    }
    return books.find((b) => Boolean(b.filePath)) ?? null;
  }, [books]);

  // Compact Focus Ring geometry for Left Margin Dock
  const compactRadius = 40;
  const compactCirc = 2 * Math.PI * compactRadius;
  const isCountdown = focusTargetSeconds !== null && focusTargetSeconds > 0;
  const timerDisplaySeconds = isCountdown
    ? Math.max(0, focusTargetSeconds - focusElapsed)
    : focusElapsed;
  const timerProgress = isCountdown
    ? Math.max(0, (focusTargetSeconds - focusElapsed) / focusTargetSeconds)
    : focusRunning
    ? Math.min(1, 0.14 + ((focusElapsed % 3600) / 3600) * 0.86)
    : 1;
  const compactDashOffset = compactCirc * (1 - timerProgress);

  const dailyPct = Math.min(
    100,
    Math.round((dailyReading.pagesReadToday / Math.max(1, dailyReading.targetPages)) * 100)
  );

  /* ==================== VIEW B: FULL-VIEWPORT 3-COLUMN READING SANCTUARY ==================== */
  if (activeBook) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28 }}
        data-testid="library-reader-view"
        className="theme-chamber absolute inset-0 z-50 isolate flex h-full w-full flex-col overflow-hidden bg-transparent text-[var(--text-ivory)]"
      >
        <RoomBackdrop roomId="library" />

        {/* Top Thin Editorial Control Bar */}
        <header className="relative z-10 shrink-0 flex items-center justify-between gap-3 border-b border-[var(--glass-border)] bg-[var(--surface-header)] px-4 py-2.5 backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <button
              type="button"
              onClick={closeReader}
              data-testid="reader-back-to-shelf"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3 py-1.5 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)] shrink-0 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[var(--accent-luminous)]" strokeWidth={1.6} />
              Back to Shelf
            </button>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="font-editorial text-[1.1rem] leading-tight text-[var(--text-ivory)] truncate">
                {activeBook.title}
              </div>
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-muted)] truncate">
                {activeBook.author} · {activeBook.format.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Center-Right Reader Controls: Page Jump, Zoom, Paper Tint, Search, Highlights */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Page Jump */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = Number.parseInt(pageJumpDraft, 10);
                if (Number.isFinite(parsed) && parsed >= 1) {
                  handlePageChange(parsed);
                } else {
                  setPageJumpDraft(String(currentPage));
                }
              }}
              className="flex items-center gap-1.5 shrink-0"
            >
              <span className="font-ui text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Page
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={pageJumpDraft}
                onChange={(e) => setPageJumpDraft(e.target.value)}
                onBlur={() => {
                  const parsed = Number.parseInt(pageJumpDraft, 10);
                  if (Number.isFinite(parsed) && parsed >= 1) {
                    handlePageChange(parsed);
                  } else {
                    setPageJumpDraft(String(currentPage));
                  }
                }}
                data-testid="reader-page-jump-input"
                aria-label="Jump to page number"
                className="w-[44px] rounded-md border border-[rgba(214,224,212,0.18)] bg-[var(--surface-inner)] px-1.5 py-0.5 text-center font-ui tabular-nums text-[0.72rem] text-[var(--text-ivory)] focus:border-[var(--accent-luminous)] focus:outline-none"
              />
              <span className="font-ui tabular-nums text-[0.66rem] text-[var(--text-muted)] whitespace-nowrap">
                / {totalPages || "..."}
              </span>
            </form>

            {/* Zoom / Font Size */}
            <div className="flex items-center gap-1 border-l border-[var(--glass-border)] pl-3 shrink-0">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.1).toFixed(2))))}
                aria-label="Zoom out"
                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="font-ui tabular-nums text-[0.66rem] text-[var(--text-ivory-soft)] w-9 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.85, Number((z + 0.1).toFixed(2))))}
                aria-label="Zoom in"
                className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Paper Tint Toggle */}
            <div
              data-testid="paper-tint-toggle"
              className="flex items-center gap-1 border-l border-[var(--glass-border)] pl-3 shrink-0"
            >
              {PAPER_TINTS.map((pt) => {
                const active = tint === pt.id;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => handleSelectTint(pt.id)}
                    data-testid={`paper-tint-${pt.id}`}
                    aria-pressed={active}
                    title={`${pt.label} paper tint`}
                    className={`cursor-pointer rounded-[3px] px-2 py-1 flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.1em] transition-all border ${
                      active
                        ? "border-[var(--accent-brass)]/70 bg-[rgba(194,168,120,0.14)] text-[var(--text-ivory)]"
                        : "border-transparent bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-[rgba(255,255,255,0.22)]"
                      style={{ backgroundColor: pt.swatch }}
                    />
                    <span className="hidden xl:inline">{pt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Lightweight In-Book Search & Highlights Drawer Toggles */}
            <div className="flex items-center gap-2 border-l border-[var(--glass-border)] pl-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (searchOpen) {
                    closeSearchBar();
                  } else {
                    setSearchOpen(true);
                    window.setTimeout(() => {
                      searchInputRef.current?.focus();
                      searchInputRef.current?.select();
                    }, 20);
                  }
                }}
                data-testid="reader-search-toggle"
                aria-label="Search in book (Ctrl+F)"
                aria-pressed={searchOpen}
                title="Find in book (Ctrl+F)"
                className={`cursor-pointer rounded-[3px] p-1.5 border transition-colors ${
                  searchOpen
                    ? "border-[rgba(226,180,109,0.58)] bg-[rgba(226,180,109,0.16)] text-[#f4efe6]"
                    : "border-transparent bg-transparent text-[var(--text-muted)] hover:border-[var(--glass-border)] hover:text-[var(--text-ivory)]"
                }`}
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.7} />
              </button>

              <button
                type="button"
                onClick={() => setHighlightsDrawerOpen((prev) => !prev)}
                data-testid="reader-highlights-toggle"
                aria-pressed={highlightsDrawerOpen}
                className={`cursor-pointer rounded-[3px] px-3 py-1 flex items-center gap-1.5 border font-ui text-[0.62rem] uppercase tracking-[0.14em] transition-colors ${
                  highlightsDrawerOpen
                    ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.18)] text-[var(--text-ivory)]"
                    : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.42)] hover:text-[var(--text-ivory)]"
                }`}
              >
                <Highlighter className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.65} />
                <span>Highlights ({highlights.length})</span>
              </button>
            </div>
          </div>
        </header>

        {/* Minimalist Ctrl+F Inline Search Bar */}
        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              data-testid="reader-search-bar"
              className="relative z-20 shrink-0 flex items-center justify-center border-b border-[rgba(226,180,109,0.22)] bg-[rgba(20,14,10,0.92)] px-5 py-2"
            >
              <div className="flex items-center gap-2 rounded-[3px] border border-[rgba(226,180,109,0.34)] bg-[rgba(28,20,15,0.9)] px-3.5 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                <Search className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.7} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      stepSearchMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      closeSearchBar();
                    }
                  }}
                  placeholder="Find in book..."
                  data-testid="reader-search-input"
                  className="w-[240px] bg-transparent border-0 font-ui text-[0.76rem] text-[#f4efe6] placeholder:text-[#b8aa96]/65 focus:outline-none"
                />
                <span
                  data-testid="reader-search-count"
                  className="min-w-[74px] text-right font-ui tabular-nums text-[0.64rem] uppercase tracking-[0.08em] text-[var(--text-muted)]"
                >
                  {!searchQuery.trim()
                    ? ""
                    : searchIndexing
                    ? "Searching..."
                    : totalSearchMatches > 0
                    ? `${activeSearchIdx + 1} / ${totalSearchMatches}`
                    : "0 matches"}
                </span>
                <div className="flex items-center gap-0.5 border-l border-[rgba(222,188,132,0.18)] pl-1.5">
                  <button
                    type="button"
                    disabled={totalSearchMatches === 0}
                    onClick={() => stepSearchMatch(-1)}
                    data-testid="reader-search-prev"
                    aria-label="Previous match"
                    className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-ivory-soft)] hover:text-[#E2B46D] disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={totalSearchMatches === 0}
                    onClick={() => stepSearchMatch(1)}
                    data-testid="reader-search-next"
                    aria-label="Next match"
                    className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-ivory-soft)] hover:text-[#E2B46D] disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={closeSearchBar}
                    data-testid="reader-search-close"
                    aria-label="Close search"
                    className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 3-Column Widescreen Reading Sanctuary */}
        <div className="relative z-10 flex flex-1 min-h-0 w-full overflow-hidden">
          {/* LEFT MARGIN DOCK: Atmosphere, Auto-Linked Focus Timer, Daily 5-Page Goal, Reading Light & Audio */}
          <aside
            data-testid="reader-left-margin"
            className="w-[260px] shrink-0 overflow-y-auto border-r border-[rgba(214,224,212,0.08)] bg-[var(--surface-inner)] px-5 py-5 flex flex-col gap-6"
          >
            {/* 1. Compact Auto-Linked "Read Book" Focus Timer */}
            <section data-testid="reader-focus-timer">
              <div className="flex items-center justify-between">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                  Focus Timer
                </span>
                <span className="font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)]">
                  Read Book
                </span>
              </div>

              <div className="mt-3 flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => (focusRunning ? onStopAndSaveFocus() : handleStartReaderTimer())}
                  data-testid="reader-focus-toggle-btn"
                  aria-label={focusRunning ? "Finish reading focus session" : "Start Read Book focus session"}
                  className="group relative flex h-[98px] w-[98px] cursor-pointer items-center justify-center rounded-full bg-transparent border-0 p-0 focus:outline-none"
                >
                  <svg
                    className={`h-[98px] w-[98px] -rotate-90 ${
                      focusRunning && !isCountdown ? "animate-focus-breathe" : ""
                    }`}
                    viewBox="0 0 98 98"
                  >
                    <circle
                      cx="49"
                      cy="49"
                      r={compactRadius}
                      fill="none"
                      stroke="rgba(237, 234, 224, 0.14)"
                      strokeWidth="1.6"
                    />
                    <circle
                      cx="49"
                      cy="49"
                      r={compactRadius}
                      fill="none"
                      stroke={focusRunning ? "var(--accent-luminous)" : "var(--accent-brass)"}
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeDasharray={compactCirc}
                      strokeDashoffset={compactDashOffset}
                      className="transition-all duration-700"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-editorial tabular-nums text-[1.28rem] font-light text-[var(--text-ivory)]">
                      {formatSecondsMMSS(timerDisplaySeconds)}
                    </span>
                    <span className="font-ui text-[0.54rem] uppercase tracking-[0.18em] text-[var(--text-muted)] group-hover:text-[var(--text-ivory)]">
                      {focusRunning ? "Finish" : "Begin"}
                    </span>
                  </div>
                </button>

                {focusRunning && (
                  <div className="mt-1.5 font-reading text-[0.84rem] text-[var(--accent-luminous)] text-center">
                    {focusActiveLabel || "Read Book"}
                  </div>
                )}

                {!focusRunning && (
                  <div className="mt-2.5 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMode(false);
                        onFocusTargetSecondsChange(null);
                      }}
                      className={`cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.6rem] uppercase tracking-[0.16em] ${
                        !customMode
                          ? "text-[var(--text-ivory)] underline decoration-[var(--accent-luminous)] underline-offset-4"
                          : "text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                      }`}
                    >
                      Open
                    </button>
                    <span className="text-[var(--text-muted)]/40">·</span>
                    <button
                      type="button"
                      onClick={() => setCustomMode(true)}
                      className={`cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.6rem] uppercase tracking-[0.16em] ${
                        customMode
                          ? "text-[var(--text-ivory)] underline decoration-[var(--accent-brass)] underline-offset-4"
                          : "text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                )}

                {!focusRunning && customMode && (
                  <input
                    type="text"
                    value={customDurationInput}
                    onChange={(e) => setCustomDurationInput(e.target.value)}
                    onBlur={handleCommitCustomTimer}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCommitCustomTimer();
                      }
                    }}
                    placeholder="25 or 12:30"
                    className="mt-2 w-[108px] rounded-full border border-[rgba(194,168,120,0.3)] bg-[var(--surface-inner)] px-2.5 py-0.5 text-center font-ui tabular-nums text-[0.68rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/60 focus:outline-none"
                  />
                )}
              </div>
            </section>

            <div className="h-[1px] w-full bg-[rgba(214,224,212,0.08)]" />

            {/* 2. Daily Reading Progress / Optional Daily Reading Habit */}
            <section data-testid="daily-reading-goal-widget">
              <div className="flex items-center justify-between">
                <span className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                  {config.dailyReadingHabitEnabled ? "Daily Reading Habit" : "Pages Read Today"}
                </span>
                {config.dailyReadingHabitEnabled && dailyReading.goalCompleted && (
                  <span
                    data-testid="daily-reading-goal-complete-badge"
                    className="inline-flex items-center gap-1 font-ui text-[0.56rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)]"
                  >
                    <Check className="h-3 w-3" strokeWidth={2.2} />
                    Done
                  </span>
                )}
              </div>

              <div
                data-testid="daily-reading-goal-progress"
                className="mt-2 flex items-baseline justify-between"
              >
                <span className="font-editorial tabular-nums text-[1.45rem] font-light text-[var(--text-ivory)]">
                  {config.dailyReadingHabitEnabled
                    ? `${dailyReading.pagesReadToday} / ${dailyReading.targetPages}`
                    : `${dailyReading.pagesReadToday}`}
                </span>
                <span className="font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {dailyReading.pagesReadToday === 1 ? "page today" : "pages today"}
                </span>
              </div>

              {config.dailyReadingHabitEnabled ? (
                <>
                  <div className="mt-2 h-[3px] w-full rounded-full bg-[rgba(237,234,224,0.12)] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        dailyReading.goalCompleted
                          ? "bg-[var(--accent-brass)]"
                          : "bg-[var(--accent-luminous)]"
                      }`}
                      style={{ width: `${dailyPct}%` }}
                    />
                  </div>

                  <p className="mt-2 font-reading text-[0.82rem] text-[var(--text-muted)] leading-snug">
                    {dailyReading.goalCompleted
                      ? "Daily reading habit completed for today."
                      : `Read ${Math.max(
                          0,
                          dailyReading.targetPages - dailyReading.pagesReadToday
                        )} more unique page(s) to complete today's reading habit.`}
                  </p>
                </>
              ) : (
                <p className="mt-2 font-reading text-[0.8rem] text-[var(--text-muted)] leading-snug">
                  Enable the optional Daily Reading Habit toggle in Settings to track a daily page target.
                </p>
              )}
            </section>

            <div className="h-[1px] w-full bg-[rgba(214,224,212,0.08)]" />

            {/* 3. Dedicated Home Assistant Reading Light Toggle */}
            <section data-testid="reading-light-widget">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                Room Lighting
              </div>
              <button
                type="button"
                onClick={() => void handleToggleReadingLight()}
                data-testid="reading-light-toggle-btn"
                aria-pressed={readingLightOn}
                className={`mt-2.5 w-full cursor-pointer rounded-[10px] px-3.5 py-2.5 flex items-center justify-between border transition-all ${
                  readingLightOn
                    ? "border-[rgba(217,152,82,0.55)] bg-[rgba(217,152,82,0.16)] text-[var(--text-ivory)] shadow-[0_0_24px_rgba(217,152,82,0.15)]"
                    : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(214,224,212,0.28)]"
                }`}
              >
                <span className="flex items-center gap-2 font-ui text-[0.68rem] uppercase tracking-[0.14em]">
                  <LampDesk
                    className={`h-4 w-4 ${
                      readingLightOn ? "text-[#e5b370]" : "text-[var(--text-muted)]"
                    }`}
                    strokeWidth={1.6}
                  />
                  Reading Light
                </span>
                <span
                  className={`font-ui text-[0.58rem] uppercase tracking-[0.16em] ${
                    readingLightOn ? "text-[#e5b370]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {readingLightOn ? "Warm On" : "Off"}
                </span>
              </button>
              <div className="mt-1.5 font-ui text-[0.56rem] tracking-[0.06em] text-[var(--text-muted)]/85 truncate">
                {readingLightStatus || config.haReadingLightEntity || config.haEntityId || "Not configured in Settings"}
              </div>
            </section>

            <div className="h-[1px] w-full bg-[rgba(214,224,212,0.08)]" />

            {/* 4. Compact Audio & Built-In Soundscape Controls */}
            <section data-testid="reader-audio-widget" className="mt-auto">
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                Audio & Soundscape
              </div>

              {/* Desktop Media SMTC */}
              <div className="mt-2.5">
                {media.active ? (
                  <>
                    <div className="font-editorial text-[0.96rem] leading-tight text-[var(--text-ivory)] truncate">
                      {media.title || "Playing"}
                    </div>
                    <div className="font-ui text-[0.6rem] text-[var(--text-muted)] truncate">
                      {media.artist || "Active Media"}
                    </div>
                  </>
                ) : config.preferredMusicPlayer !== "none" ? (
                  <button
                    type="button"
                    onClick={() => void storageService.launchMusicPlayer(config.preferredMusicPlayer)}
                    className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                  >
                    <Music className="h-3 w-3" />
                    {config.preferredMusicPlayer === "spotify" ? "Open Spotify" : "Open Apple Music"}
                  </button>
                ) : (
                  <div className="font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    No Media Active
                  </div>
                )}

                <div className="mt-2 flex items-center gap-4 text-[var(--text-ivory-soft)]">
                  <button
                    type="button"
                    onClick={() => void storageService.sendMediaControl("previous")}
                    aria-label="Previous track"
                    className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                  >
                    <SkipBack className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void storageService.sendMediaControl("play_pause")}
                    aria-label={media.isPlaying ? "Pause audio" : "Play audio"}
                    className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-ivory)] hover:text-[var(--accent-luminous)]"
                  >
                    {media.isPlaying ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void storageService.sendMediaControl("next")}
                    aria-label="Next track"
                    className="cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Ambient Soundscape quick toggle (3x2 even grid) */}
              <div className="mt-3.5 space-y-2">
                <div className="flex items-center gap-1.5 font-ui text-[0.52rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <Volume2
                    className={`h-3 w-3 shrink-0 ${
                      ambientTexture !== "off"
                        ? "text-[#E2B46D]"
                        : "text-[var(--text-muted)]/60"
                    }`}
                  />
                  <span>Soundscapes</span>
                </div>
                <div
                  data-testid="reader-ambient-grid"
                  className="grid grid-cols-3 gap-1.5"
                >
                  {AMBIENT_SOUNDSCAPES.map((t) => {
                    const active = ambientTexture === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        data-testid={`reader-ambient-${t.id}`}
                        aria-pressed={active}
                        onClick={() => {
                          ambientAudio.setVolume(ambientVolume);
                          ambientAudio.toggleTexture(t.id);
                        }}
                        className={`cursor-pointer rounded-[6px] border px-1 py-1 text-center font-ui text-[0.54rem] uppercase tracking-[0.09em] transition-colors truncate ${
                          active
                            ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.16)] text-[var(--text-ivory)]"
                            : "border-[var(--glass-border)] bg-[var(--surface-inner)] text-[var(--text-muted)] hover:border-[rgba(226,180,109,0.34)] hover:text-[var(--text-ivory-soft)]"
                        }`}
                      >
                        {t.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(ambientVolume * 100)}
                  onChange={(e) => ambientAudio.setVolume(Number(e.target.value) / 100)}
                  aria-label="Reader ambient soundscape volume"
                  className="h-[2px] w-full cursor-pointer appearance-none rounded-full bg-[rgba(237,234,224,0.2)] accent-[#E2B46D]"
                />
                <span className="font-ui tabular-nums text-[0.56rem] text-[var(--text-muted)] w-7 text-right">
                  {Math.round(ambientVolume * 100)}%
                </span>
              </div>
            </section>
          </aside>

          {/* CENTER COLUMN: Distraction-Free Document Canvas */}
          <main
            data-testid="reader-center-column"
            className="flex-1 min-w-0 h-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(36,24,16,0.18),rgba(14,10,7,0.52)_72%)] flex flex-col"
          >
            {loadingBook && (
              <div className="m-auto font-reading text-[1.08rem] text-[var(--text-muted)]">
                Loading volume from disk...
              </div>
            )}

            {bookLoadError && !loadingBook && (
              <div className="m-auto max-w-md smoked-glass rounded-[12px] p-6 text-center">
                <div className="font-editorial text-[1.3rem] text-[var(--text-ivory)]">
                  Unable to open book file
                </div>
                <p className="mt-2 font-reading text-[0.95rem] text-[var(--text-muted)]">
                  {bookLoadError}
                </p>
              </div>
            )}

            {!loadingBook && !bookLoadError && bookBytes && activeBook.format === "pdf" && (
              <PdfDocumentView
                bytes={bookBytes}
                pageNumber={currentPage}
                zoom={zoom}
                tint={tint}
                initialScrollOffset={activeBook.scrollOffset || 0}
                highlights={highlights}
                pulsingHighlightId={pulsingHighlightId}
                jumpToHighlight={jumpToHighlight}
                searchQuery={searchOpen ? searchQuery : ""}
                activeSearchMatch={
                  searchOpen && pdfSearchMatches.length > 0
                    ? pdfSearchMatches[activeSearchIdx] ?? null
                    : null
                }
                onSearchResultsChange={handlePdfSearchResults}
                onDocumentLoaded={handleDocumentLoaded}
                onPageChange={handlePageChange}
                onScrollOffsetChange={handleScrollOffsetChange}
                onSaveHighlight={(payload: SaveHighlightPayload) => handleSaveHighlight(payload)}
                onOpenExternalUrl={handleOpenExternalUrl}
              />
            )}

            {!loadingBook && !bookLoadError && bookBytes && activeBook.format === "epub" && (
              <EpubDocumentView
                bytes={bookBytes}
                pageNumber={currentPage}
                initialCfi={activeBook.epubCfi}
                zoom={zoom}
                tint={tint}
                highlights={highlights}
                jumpToCfi={jumpToCfi}
                searchQuery={searchOpen ? searchQuery : ""}
                activeSearchMatch={
                  searchOpen && epubSearchMatches.length > 0
                    ? epubSearchMatches[activeSearchIdx] ?? null
                    : null
                }
                onSearchResultsChange={handleEpubSearchResults}
                onDocumentLoaded={handleDocumentLoaded}
                onLocationChange={handleEpubLocationChange}
                onSaveHighlight={(payload) => handleSaveHighlight(payload)}
              />
            )}

            {/* Discreet bottom-right Vault sync confirmation toast */}
            <AnimatePresence>
              {vaultSyncNotice && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                  data-testid="reader-vault-toast"
                  className="pointer-events-none fixed bottom-14 right-6 z-40 rounded-[3px] border border-[rgba(226,180,109,0.42)] bg-[rgba(24,22,20,0.94)] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.12em] text-[#E2B46D] shadow-[0_10px_28px_rgba(0,0,0,0.52)]"
                >
                  {vaultSyncNotice}
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {/* COLLAPSIBLE BOOK HIGHLIGHTS & NOTES SIDE DRAWER */}
          <AnimatePresence initial={false}>
            {highlightsDrawerOpen && (
              <motion.aside
                key="highlights-drawer"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                data-testid="reader-highlights-drawer"
                className="shrink-0 overflow-hidden border-l border-[rgba(222,188,132,0.16)] bg-[rgba(24,22,20,0.9)] flex flex-col"
              >
                <div className="w-[320px] flex h-full flex-col">
                  <div className="shrink-0 flex items-center justify-between border-b border-[rgba(222,188,132,0.14)] px-5 py-3.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-ui text-[0.62rem] uppercase tracking-[0.2em] text-[#E2B46D]">
                        Highlights &amp; Notes
                      </span>
                      <span className="font-ui tabular-nums text-[0.6rem] text-[var(--text-muted)]">
                        ({highlights.length})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setHighlightsDrawerOpen(false)}
                      aria-label="Close highlights drawer"
                      className="cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div
                    data-testid="reader-margin-ledger"
                    className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
                  >
                    {highlights.map((hl) => (
                      <div
                        key={hl.id}
                        data-testid="reader-margin-entry"
                        data-highlight-id={hl.id}
                        className={`group relative rounded-[6px] border transition-colors p-3.5 ${
                          pulsingHighlightId === hl.id
                            ? "border-[rgba(226,180,109,0.72)] bg-[rgba(226,180,109,0.14)]"
                            : "border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(226,180,109,0.38)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleJumpToHighlight(hl)}
                            data-testid={`margin-jump-p-${hl.pageNumber}`}
                            className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1.5 font-ui tabular-nums text-[0.62rem] uppercase tracking-[0.14em] text-[#E2B46D] hover:text-[var(--text-ivory)]"
                          >
                            <span className="h-2 w-2 rounded-full bg-[#E2B46D]" />
                            p. {hl.pageNumber}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteHighlight(hl.id);
                            }}
                            data-testid="delete-highlight-btn"
                            aria-label="Delete highlight"
                            title="Delete highlight"
                            className="opacity-55 group-hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {hl.quote && (
                          <button
                            type="button"
                            onClick={() => handleJumpToHighlight(hl)}
                            className="mt-2 block w-full text-left cursor-pointer bg-transparent border-0 border-l-2 border-[#E2B46D]/60 pl-2.5 font-reading italic text-[0.86rem] leading-snug text-[var(--text-ivory-soft)]"
                          >
                            “{hl.quote}”
                          </button>
                        )}

                        {hl.note && (
                          <button
                            type="button"
                            onClick={() => handleJumpToHighlight(hl)}
                            className="mt-2 block w-full text-left cursor-pointer bg-transparent border-0 p-0 font-reading text-[0.88rem] leading-relaxed text-[var(--text-ivory)]"
                          >
                            {hl.note}
                          </button>
                        )}
                      </div>
                    ))}

                    {highlights.length === 0 && (
                      <div className="py-12 px-3 text-center font-reading text-[0.94rem] text-[var(--text-muted)] leading-relaxed">
                        Select any passage in the book and click{" "}
                        <span className="text-[#E2B46D]">Highlight</span> or{" "}
                        <span className="text-[#E2B46D]">+ Note</span> to archive it here
                        and in your Vault.
                      </div>
                    )}
                  </div>

                  <form
                    onSubmit={(e) => void handleSaveStandalonePageNote(e)}
                    className="shrink-0 border-t border-[rgba(222,188,132,0.14)] px-4 py-3"
                  >
                    <div className="flex items-center gap-2 rounded-[4px] border border-[var(--glass-border)] bg-[var(--surface-input)] px-2.5 py-1.5 focus-within:border-[rgba(226,180,109,0.5)]">
                      <input
                        type="text"
                        value={pageNoteDraft}
                        onChange={(e) => setPageNoteDraft(e.target.value)}
                        placeholder={`Jot a note for p. ${currentPage}...`}
                        data-testid="reader-margin-note-input"
                        className="flex-1 min-w-0 bg-transparent border-0 font-reading text-[0.86rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/65 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={savingNote || !pageNoteDraft.trim()}
                        data-testid="reader-save-note-btn"
                        aria-label="Save page note"
                        className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[rgba(226,180,109,0.14)] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[#f4efe6] hover:bg-[rgba(226,180,109,0.28)] disabled:opacity-35"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  }

  /* ==================== VIEW A: EDITORIAL BOOKSHELF ==================== */
  const booksFolderDisplay = config.booksFolderPath || "your Books folder (configure in Settings)";

  return (
    <MiniAppShell
      roomId="library"
      title="The Library"
      onClose={onClose}
    >
      {/* Top Toolbar: Daily Reading Progress + Rescan Folder Only */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <span className="font-ui text-[0.62rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
              Today’s Reading
            </span>
            <span className="font-editorial tabular-nums text-[1.15rem] text-[var(--text-ivory)]">
              {config.dailyReadingHabitEnabled
                ? `${dailyReading.pagesReadToday} / ${dailyReading.targetPages} pages`
                : `${dailyReading.pagesReadToday} ${dailyReading.pagesReadToday === 1 ? "page" : "pages"}`}
            </span>
            {config.dailyReadingHabitEnabled && dailyReading.goalCompleted && (
              <span className="inline-flex items-center gap-1 rounded-[3px] border border-[rgba(226,180,109,0.4)] bg-[rgba(226,180,109,0.14)] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[#E2B46D]">
                <Check className="h-3 w-3" />
                Goal Complete
              </span>
            )}
          </div>
          {shelfNotice && (
            <span className="font-ui text-[0.68rem] text-[var(--accent-luminous)]">
              {shelfNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={scanning}
            onClick={() => void scanFolder()}
            data-testid="library-rescan-btn"
            className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.66rem] uppercase tracking-[0.15em] text-[var(--text-ivory-soft)] disabled:opacity-50"
          >
            <FolderSync className="h-3.5 w-3.5 text-[var(--accent-luminous)]" />
            {scanning ? "Scanning..." : "Rescan Folder"}
          </button>
        </div>
      </div>

      {/* Prominent "Continue Reading" Spotlight */}
      {mostRecentBook && (() => {
        const heroThumb = mostRecentBook.coverThumbnail || localThumbMap[mostRecentBook.id];
        return (
          <div
            data-testid="continue-reading-banner"
            className="mt-7 relative overflow-hidden rounded-[14px] smoked-glass border-[rgba(222,188,132,0.28)] p-7 flex flex-wrap items-center justify-between gap-6"
          >
            <div className="flex items-start gap-6 max-w-2xl">
              <div className="h-[132px] w-[92px] shrink-0 overflow-hidden rounded-[6px] border border-[rgba(222,188,132,0.36)] bg-gradient-to-b from-[#3d281b] to-[#20140d] shadow-[0_12px_28px_rgba(0,0,0,0.52)]">
                {heroThumb ? (
                  <img
                    src={heroThumb}
                    alt={`${mostRecentBook.title} cover`}
                    data-testid="hero-book-cover-thumbnail"
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-between py-2.5 px-2 text-center">
                    <span className="font-ui text-[0.52rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
                      {mostRecentBook.format.toUpperCase()}
                    </span>
                    <BookOpen className="h-5 w-5 text-[var(--accent-luminous)]/80" strokeWidth={1.4} />
                    <span className="font-ui tabular-nums text-[0.56rem] text-[var(--text-muted)]">
                      {mostRecentBook.progressPercent}%
                    </span>
                  </div>
                )}
              </div>

              <div>
                <div className="font-ui text-[0.6rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                  {mostRecentBook.lastOpenedAt ? "Resume Volume" : "Featured Shelf Volume"}
                </div>
                <h2 className="mt-1 font-editorial text-[1.85rem] font-normal leading-tight text-[var(--text-ivory)]">
                  {mostRecentBook.title}
                </h2>
                <div className="mt-0.5 font-reading text-[1rem] text-[var(--text-muted)]">
                  {mostRecentBook.author}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 font-ui tabular-nums text-[0.66rem] uppercase tracking-[0.12em] text-[var(--text-ivory-soft)]">
                  <span>
                    {mostRecentBook.totalPages > 0
                      ? `Page ${mostRecentBook.currentPage} of ${mostRecentBook.totalPages}`
                      : `Page ${mostRecentBook.currentPage}`}
                  </span>
                  <span className="text-[var(--text-muted)]/40">·</span>
                  <span className="text-[var(--text-muted)]">
                    {formatLastOpened(mostRecentBook.lastOpenedAt, timeFormat)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void openBook(mostRecentBook)}
              data-testid="continue-reading-btn"
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-5 py-2.5 border border-[rgba(222,188,132,0.45)] font-ui text-[0.7rem] uppercase tracking-[0.18em] text-[var(--text-ivory)] flex items-center gap-2"
            >
              <BookOpen className="h-4 w-4 text-[var(--accent-brass)]" strokeWidth={1.6} />
              Continue Reading
            </button>
          </div>
        );
      })()}

      {/* Tactile Editorial Bookshelf Grid */}
      <div
        data-testid="library-bookshelf-grid"
        className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
      >
        {books.map((book) => {
          const pct =
            book.totalPages > 0
              ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
              : book.progressPercent;
          const coverThumb = book.coverThumbnail || localThumbMap[book.id];
          return (
            <button
              key={book.id}
              type="button"
              onClick={() => void openBook(book)}
              data-testid="library-book-card"
              className="group relative text-left cursor-pointer rounded-[12px] border border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(222,188,132,0.42)] hover:bg-[var(--surface-panel-hover)] transition-all duration-300 p-4 flex flex-col justify-between min-h-[196px] overflow-hidden"
            >
              {/* Tactile Left Warm Antique-Brass Spine Hairline */}
              <div
                aria-hidden="true"
                className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#deb874]/65 via-[#9c7244]/40 to-[#4a311e]/45 group-hover:from-[#e6c686] group-hover:to-[#c29758] transition-colors"
              />

              <div className="flex items-start gap-4 pl-1.5">
                {/* Portrait PDF Page-1 Cover Frame (minimalist serif fallback when non-PDF / pending) */}
                <div className="h-[112px] w-[78px] shrink-0 overflow-hidden rounded-[5px] border border-[rgba(222,188,132,0.28)] bg-gradient-to-b from-[#342217] to-[#1b110b] shadow-[0_8px_20px_rgba(0,0,0,0.42)]">
                  {coverThumb ? (
                    <img
                      src={coverThumb}
                      alt={`${book.title} cover`}
                      data-testid="book-cover-thumbnail"
                      className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div
                      data-testid="book-cover-fallback"
                      className="flex h-full w-full flex-col justify-between p-2 text-left"
                    >
                      <span className="font-ui text-[0.48rem] uppercase tracking-[0.16em] text-[var(--accent-brass)]/90">
                        {book.format.toUpperCase()}
                      </span>
                      <span className="font-editorial text-[0.68rem] leading-tight text-[var(--text-ivory-soft)] line-clamp-3">
                        {book.title}
                      </span>
                      <span className="h-[1px] w-5 bg-[rgba(222,188,132,0.45)]" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-[4px] border border-[rgba(222,188,132,0.3)] bg-[rgba(222,188,132,0.08)] px-2 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
                      {book.format.toUpperCase()}
                    </span>
                    <span className="font-ui tabular-nums text-[0.66rem] text-[var(--accent-luminous)]">
                      {pct}%
                    </span>
                  </div>

                  <h3 className="mt-2 font-editorial text-[1.24rem] font-normal leading-snug text-[var(--text-ivory)] group-hover:text-white line-clamp-2">
                    {book.title}
                  </h3>
                  <div className="mt-1 font-reading text-[0.88rem] text-[var(--text-muted)] truncate">
                    {book.author}
                  </div>
                </div>
              </div>

              <div className="mt-4 pl-1.5">
                <div className="flex items-center justify-between font-ui tabular-nums text-[0.62rem] text-[var(--text-muted)]">
                  <span>
                    {book.totalPages > 0
                      ? `Page ${book.currentPage} of ${book.totalPages}`
                      : `Page ${book.currentPage}`}
                  </span>
                  <span>{formatLastOpened(book.lastOpenedAt, timeFormat)}</span>
                </div>
                <div className="mt-2 h-[2px] w-full bg-[rgba(244,239,230,0.12)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-luminous)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}

        {books.length === 0 && !scanning && (
          <div className="md:col-span-2 lg:col-span-3 py-16 text-center font-reading text-[1.06rem] text-[var(--text-muted)]">
            No `.pdf` or `.epub` volumes found in{" "}
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="bg-transparent border-0 p-0 cursor-pointer text-[var(--text-ivory-soft)] underline decoration-[rgba(226,180,109,0.4)] underline-offset-4 hover:text-[#E2B46D]"
            >
              {booksFolderDisplay}
            </button>
            .
          </div>
        )}
      </div>
    </MiniAppShell>
  );
}
