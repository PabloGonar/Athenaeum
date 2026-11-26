import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Feather,
  FileText,
  Hash,
  Inbox,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { MiniAppShell } from "./MiniAppShell";
import { storageService } from "../../services/storage";
import { formatLogicalHourTime } from "../../utils/logicalDate";
import {
  extractTocSummaryInsight,
  FRAMEWORK_LABELS,
} from "./toc/tocTemplates";
import type {
  ActivityBlockHourly,
  BacklinkMention,
  DailyDebriefPayload,
  DeviceTelemetryRecord,
  GoalItem,
  HeatmapDay,
  JournalMode,
  TimeFormat,
  TocTreeRecord,
  VaultFileEntry,
  VaultFolder,
  VaultIndexedNote,
  VaultSearchResult,
} from "../../types/athenaeum";

interface JournalMiniAppProps {
  initialMode: JournalMode;
  logicalToday: string;
  dayRolloverHour: number;
  timeFormat: TimeFormat;
  vaultPath: string;
  goals: GoalItem[];
  heatmap: HeatmapDay[];
  tocTrees: TocTreeRecord[];
  deviceTelemetry?: DeviceTelemetryRecord[];
  onOpenTocTree: (treeId: string) => void;
  onDebriefPublished: () => Promise<void>;
  onClose: () => void;
}

const FOLDER_ORDER: VaultFolder[] = ["Reflections", "Books", "Daily", "Inbox"];

function shiftIsoDate(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
}

function formatEditorialDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function renderHighlightedSnippet(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark
        key={idx}
        className="rounded-[2px] bg-[rgba(194,168,120,0.34)] px-0.5 text-[var(--text-ivory)]"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={idx}>{part}</Fragment>
    )
  );
}

function FolderIcon({ folder, className = "h-3 w-3" }: { folder: VaultFolder; className?: string }) {
  if (folder === "Books") return <BookMarked className={className} strokeWidth={1.6} />;
  if (folder === "Daily") return <BookOpen className={className} strokeWidth={1.6} />;
  if (folder === "Inbox") return <Inbox className={className} strokeWidth={1.6} />;
  return <Feather className={className} strokeWidth={1.6} />;
}

export function JournalMiniApp({
  initialMode,
  logicalToday,
  dayRolloverHour,
  timeFormat,
  vaultPath,
  goals,
  heatmap,
  tocTrees,
  deviceTelemetry = [],
  onOpenTocTree,
  onDebriefPublished,
  onClose,
}: JournalMiniAppProps) {
  const [mode, setMode] = useState<JournalMode>(initialMode);

  // ==================== VAULT-WIDE SEARCH, TAGS & INDEX STATE ====================
  const [vaultIndex, setVaultIndex] = useState<VaultIndexedNote[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<VaultSearchResult[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ==================== MODE A: DAILY DEBRIEF STATE ====================
  const [debriefDate, setDebriefDate] = useState<string>(logicalToday);
  const [memories, setMemories] = useState("");
  const [gratitude1, setGratitude1] = useState("");
  const [gratitude2, setGratitude2] = useState("");
  const [gratitude3, setGratitude3] = useState("");
  const [closingThought, setClosingThought] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [publishedPath, setPublishedPath] = useState<string | null>(null);
  const [archiveDates, setArchiveDates] = useState<string[]>([]);
  const [archiveRawMd, setArchiveRawMd] = useState<string | null>(null);
  const [dayBlocks, setDayBlocks] = useState<ActivityBlockHourly[]>([]);
  const [debriefNotice, setDebriefNotice] = useState<string | null>(null);
  const [refreshingSummary, setRefreshingSummary] = useState(false);

  // ==================== MODE B: REFLECTIONS & VAULT NOTE EDITOR STATE ====================
  const [reflections, setReflections] = useState<VaultFileEntry[]>([]);
  const [activeReflectionFile, setActiveReflectionFile] = useState<string | null>(null);
  /** When opening a /Books or /Inbox note from search or a [[Wiki-Link]], edit/read it cleanly */
  const [activeExternalNote, setActiveExternalNote] = useState<VaultIndexedNote | null>(null);
  const [refTitle, setRefTitle] = useState("");
  const [refTags, setRefTags] = useState("");
  const [refBody, setRefBody] = useState("");
  const [refDate, setRefDate] = useState(logicalToday);
  const [previewMode, setPreviewMode] = useState(false);
  const [refNotice, setRefNotice] = useState<string | null>(null);
  const rightPaneScrollRef = useRef<HTMLDivElement | null>(null);

  // ==================== [[WIKI-LINK]] AUTOCOMPLETE & BACKLINKS STATE ====================
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [wikiAutocomplete, setWikiAutocomplete] = useState<{
    startIndex: number;
    endIndex: number;
    query: string;
  } | null>(null);
  const [wikiSelectedIdx, setWikiSelectedIdx] = useState(0);
  const [backlinks, setBacklinks] = useState<BacklinkMention[]>([]);
  const [backlinksExpanded, setBacklinksExpanded] = useState(true);

  const refreshVaultIndex = useCallback(async () => {
    const [indexed, refls, dates] = await Promise.all([
      storageService.listVaultIndex(),
      storageService.listReflections(),
      storageService.listDailyDebriefArchive(),
    ]);
    setVaultIndex(indexed);
    setReflections(refls);
    setArchiveDates(dates);
  }, []);

  const loadDebriefForDate = useCallback(
    async (dateIso: string) => {
      const [rec, blocks, dates, mdFile] = await Promise.all([
        storageService.getDailyDebrief(dateIso),
        storageService.listActivityBlocksHourly(dateIso),
        storageService.listDailyDebriefArchive(),
        storageService.readDailyDebriefFile(dateIso),
      ]);

      setDayBlocks(blocks);
      setArchiveDates(dates);
      setArchiveRawMd(mdFile);

      if (rec) {
        setMemories(rec.memories);
        setGratitude1(rec.gratitude1);
        setGratitude2(rec.gratitude2);
        setGratitude3(rec.gratitude3);
        setClosingThought(rec.closingThought);
        setIsPublished(rec.published);
        setPublishedPath(rec.vaultFilePath ?? null);
      } else {
        setMemories("");
        setGratitude1("");
        setGratitude2("");
        setGratitude3("");
        setClosingThought("");
        setIsPublished(Boolean(mdFile));
        setPublishedPath(mdFile ? `${vaultPath}\\Daily\\${dateIso}.md` : null);
      }
    },
    [vaultPath]
  );

  useEffect(() => {
    void loadDebriefForDate(debriefDate);
  }, [debriefDate, loadDebriefForDate]);

  useEffect(() => {
    void refreshVaultIndex();
  }, [refreshVaultIndex]);

  // Run instant vault-wide full-text + #tag search whenever query or tag filter changes
  const isSearchActive = searchQuery.trim().length > 0 || activeTag !== null;
  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    void storageService
      .searchVaultNotes(searchQuery, activeTag)
      .then((res) => {
        if (!cancelled) setSearchResults(res);
      });
    return () => {
      cancelled = true;
    };
  }, [searchQuery, activeTag, isSearchActive, vaultIndex]);

  // Aggregate unique #tags across entire vault for clickable filter pills
  const allVaultTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of vaultIndex) {
      for (const raw of note.tags) {
        const clean = raw.trim().replace(/^#/, "").toLowerCase();
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14)
      .map(([tag, count]) => ({ tag, count }));
  }, [vaultIndex]);

  // Group search results cleanly by folder: Reflections, Books, Daily, Inbox
  const groupedSearchResults = useMemo(() => {
    const groups: Record<VaultFolder, VaultSearchResult[]> = {
      Reflections: [],
      Books: [],
      Daily: [],
      Inbox: [],
    };
    for (const hit of searchResults) {
      const f = hit.note.folder;
      if (groups[f]) groups[f].push(hit);
    }
    return FOLDER_ORDER.map((folder) => ({
      folder,
      items: groups[folder],
    })).filter((g) => g.items.length > 0);
  }, [searchResults]);

  // Refresh Linked Mentions (Backlinks) for the active Reflection or Book/Inbox note
  const activeNoteTitleForBacklinks = useMemo(() => {
    if (activeExternalNote) return activeExternalNote.title;
    return refTitle.trim();
  }, [activeExternalNote, refTitle]);

  const activeNoteFileNameForBacklinks = useMemo(() => {
    if (activeExternalNote) return activeExternalNote.fileName;
    return activeReflectionFile;
  }, [activeExternalNote, activeReflectionFile]);

  const refreshBacklinks = useCallback(async () => {
    if (!activeNoteTitleForBacklinks) {
      setBacklinks([]);
      return;
    }
    const found = await storageService.findVaultBacklinks(
      activeNoteTitleForBacklinks,
      activeNoteFileNameForBacklinks
    );
    setBacklinks(found);
  }, [activeNoteTitleForBacklinks, activeNoteFileNameForBacklinks]);

  useEffect(() => {
    if (mode !== "reflections") return;
    void refreshBacklinks();
  }, [mode, refreshBacklinks, vaultIndex]);

  // Candidates for [[Wiki-Link]] autocomplete across Reflections, Books, Daily, and Inbox
  const wikiCandidates = useMemo(() => {
    if (!wikiAutocomplete) return [];
    const q = wikiAutocomplete.query.trim().toLowerCase();
    const seen = new Set<string>();
    const list: VaultIndexedNote[] = [];
    for (const note of vaultIndex) {
      const key = `${note.folder}:${note.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      if (q && !note.title.toLowerCase().includes(q) && !note.folder.toLowerCase().includes(q)) {
        continue;
      }
      seen.add(key);
      list.push(note);
    }
    return list.slice(0, 10);
  }, [vaultIndex, wikiAutocomplete]);

  // Auto-populated day summary derived live from SQLite for debriefDate
  const daySummary = useMemo(() => {
    const dayHeat = heatmap.find((h) => h.date === debriefDate);
    const focusMinutes = dayHeat?.focusMinutes ?? 0;

    const completedTasks = goals
      .filter((g) => {
        if (!g.completed) return false;
        if (g.scope === "daily") {
          return !g.dueDate || g.dueDate === debriefDate || debriefDate === logicalToday;
        }
        return false;
      })
      .map((g) => g.title);

    const blockHighlights = dayBlocks.map((b) => {
      const startLbl = formatLogicalHourTime(b.slotIndex, dayRolloverHour, timeFormat);
      const endLbl = formatLogicalHourTime(b.slotIndex + 1, dayRolloverHour, timeFormat);
      return `${startLbl} to ${endLbl} · ${b.label}`;
    });

    return {
      focusMinutes,
      focusHours: (focusMinutes / 60).toFixed(1),
      completedTasks,
      blockHighlights,
    };
  }, [heatmap, goals, dayBlocks, debriefDate, logicalToday, dayRolloverHour, timeFormat]);

  const handleRefreshSummary = async () => {
    setRefreshingSummary(true);
    await loadDebriefForDate(debriefDate);
    window.setTimeout(() => setRefreshingSummary(false), 320);
  };

  const handleSaveDraft = async () => {
    const saved = await storageService.saveDailyDebriefDraft({
      logicalDate: debriefDate,
      memories,
      gratitude1,
      gratitude2,
      gratitude3,
      closingThought,
      published: isPublished,
      vaultFilePath: publishedPath,
      updatedAt: new Date().toISOString(),
    });
    setPublishedPath(saved.vaultFilePath ?? publishedPath);
    setDebriefNotice("Draft saved locally");
    window.setTimeout(() => setDebriefNotice(null), 2600);
  };

  const handlePublishDebrief = async () => {
    const payload: DailyDebriefPayload = {
      logicalDate: debriefDate,
      memories,
      gratitude1,
      gratitude2,
      gratitude3,
      closingThought,
      completedTasks: daySummary.completedTasks,
      focusMinutes: daySummary.focusMinutes,
      blockHighlights: daySummary.blockHighlights,
      published: true,
      updatedAt: new Date().toISOString(),
    };
    const record = await storageService.publishDailyDebrief(payload);
    setIsPublished(true);
    setPublishedPath(record.vaultFilePath ?? `${vaultPath}\\Daily\\${debriefDate}.md`);
    await onDebriefPublished();
    await refreshVaultIndex();
    setDebriefNotice(`Published to Daily/${debriefDate}.md · Daily Debrief goal completed`);
    window.setTimeout(() => setDebriefNotice(null), 4500);
  };

  const startNewReflection = (prefillTitle = "") => {
    setMode("reflections");
    setActiveExternalNote(null);
    setActiveReflectionFile(null);
    setRefTitle(prefillTitle);
    setRefTags("");
    setRefBody("");
    setRefDate(logicalToday);
    setPreviewMode(false);
    setRefNotice(null);
    setWikiAutocomplete(null);
    rightPaneScrollRef.current?.scrollTo({ top: 0 });
  };

  const selectReflection = (entry: VaultFileEntry) => {
    setMode("reflections");
    setActiveExternalNote(null);
    setActiveReflectionFile(entry.fileName);
    setRefTitle(entry.title);
    setRefTags(entry.tags.join(", "));
    setRefBody(entry.body);
    setRefDate(entry.date || logicalToday);
    setPreviewMode(true);
    setRefNotice(null);
    setWikiAutocomplete(null);
    rightPaneScrollRef.current?.scrollTo({ top: 0 });
  };

  const openVaultNote = useCallback(
    (note: VaultIndexedNote) => {
      setWikiAutocomplete(null);
      if (note.folder === "Daily") {
        const targetDate = note.date || note.fileName.replace(/\.md$/i, "");
        setDebriefDate(targetDate);
        setMode("debrief");
        rightPaneScrollRef.current?.scrollTo({ top: 0 });
        return;
      }
      if (note.folder === "Reflections") {
        setMode("reflections");
        setActiveExternalNote(null);
        setActiveReflectionFile(note.fileName);
        setRefTitle(note.title);
        setRefTags(note.tags.join(", "));
        setRefBody(note.body);
        setRefDate(note.date || logicalToday);
        setPreviewMode(true);
        setRefNotice(null);
        rightPaneScrollRef.current?.scrollTo({ top: 0 });
        return;
      }
      // Books or Inbox note -> open cleanly in Preview mode inside Reflections workspace
      setMode("reflections");
      setActiveExternalNote(note);
      setActiveReflectionFile(null);
      setRefTitle(note.title);
      setRefTags(note.tags.join(", "));
      setRefBody(note.body);
      setRefDate(note.date || logicalToday);
      setPreviewMode(true);
      setRefNotice(null);
      rightPaneScrollRef.current?.scrollTo({ top: 0 });
    },
    [logicalToday]
  );

  // Navigate to a [[Note Title]] link across Reflections, Books, Daily, or Inbox
  const navigateToWikiLink = useCallback(
    (linkTitle: string) => {
      const targetLower = linkTitle.trim().toLowerCase();
      if (!targetLower) return;

      const exact =
        vaultIndex.find((n) => n.title.toLowerCase() === targetLower) ??
        vaultIndex.find((n) => n.fileName.replace(/\.md$/i, "").toLowerCase() === targetLower) ??
        vaultIndex.find((n) => n.title.toLowerCase().includes(targetLower));

      if (exact) {
        openVaultNote(exact);
      } else {
        startNewReflection(linkTitle.trim());
        setRefNotice(`Started new Reflection "${linkTitle.trim()}"`);
        window.setTimeout(() => setRefNotice(null), 3200);
      }
    },
    [vaultIndex, openVaultNote]
  );

  const handleSaveActiveNote = useCallback(async () => {
    if (activeExternalNote) {
      const saved = await storageService.saveVaultNoteBody(
        activeExternalNote.folder,
        activeExternalNote.fileName,
        refBody
      );
      setActiveExternalNote(saved);
      await refreshVaultIndex();
      await refreshBacklinks();
      setRefNotice(`Saved ${saved.folder}/${saved.fileName}`);
      window.setTimeout(() => setRefNotice(null), 3200);
      return;
    }

    const parsedTags = refTags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    const saved = await storageService.saveReflection({
      existingFileName: activeReflectionFile,
      logicalDate: refDate || logicalToday,
      title: refTitle.trim() || "Untitled Reflection",
      tags: parsedTags,
      body: refBody,
    });
    setActiveReflectionFile(saved.fileName);
    setRefTitle(saved.title);
    await refreshVaultIndex();
    await refreshBacklinks();
    setRefNotice(`Saved Reflections/${saved.fileName}`);
    window.setTimeout(() => setRefNotice(null), 3200);
  }, [
    activeExternalNote,
    activeReflectionFile,
    refDate,
    logicalToday,
    refTitle,
    refTags,
    refBody,
    refreshVaultIndex,
    refreshBacklinks,
  ]);

  const handleDeleteReflection = async (fileName: string) => {
    await storageService.deleteReflection(fileName);
    if (activeReflectionFile === fileName) {
      startNewReflection();
    }
    await refreshVaultIndex();
  };

  // Detect `[[query` before cursor inside the Reflections editor textarea
  const updateWikiAutocompleteFromCursor = (text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const openIdx = before.lastIndexOf("[[");
    if (openIdx < 0) {
      setWikiAutocomplete(null);
      return;
    }
    const between = before.slice(openIdx + 2);
    if (between.includes("]]") || between.includes("\n") || between.includes("\r")) {
      setWikiAutocomplete(null);
      return;
    }
    setWikiAutocomplete({
      startIndex: openIdx,
      endIndex: cursorPos,
      query: between,
    });
    setWikiSelectedIdx(0);
  };

  const insertWikiLinkSuggestion = useCallback(
    (note: VaultIndexedNote) => {
      if (!wikiAutocomplete) return;
      const before = refBody.slice(0, wikiAutocomplete.startIndex);
      const after = refBody.slice(wikiAutocomplete.endIndex);
      const inserted = `[[${note.title}]]`;
      const nextBody = `${before}${inserted}${after}`;
      const nextCursor = before.length + inserted.length;
      setRefBody(nextBody);
      setWikiAutocomplete(null);
      window.setTimeout(() => {
        const el = bodyTextareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCursor, nextCursor);
        }
      }, 15);
    },
    [wikiAutocomplete, refBody]
  );

  // Global Journal shortcuts: Ctrl+F focuses vault search, Ctrl+S saves active Reflection/Vault note
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (mode === "reflections" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveActiveNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, handleSaveActiveNote]);

  const wordCount = useMemo(() => {
    const trimmed = refBody.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [refBody]);

  const booksAndInboxNotes = useMemo(
    () => vaultIndex.filter((n) => n.folder === "Books" || n.folder === "Inbox"),
    [vaultIndex]
  );

  // Rich Markdown renderer with clean inline clickable [[Wiki-Links]] (no brackets shown in Preview)
  const renderMarkdownWithWikiLinks = (markdown: string) => {
    const renderFormattedText = (segment: string, keyPrefix: string) => {
      const tokenRe = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
      const chunks = segment.split(tokenRe);
      return chunks.map((chunk, idx) => {
        if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
          return (
            <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-[var(--text-ivory)]">
              {chunk.slice(2, -2)}
            </strong>
          );
        }
        if (chunk.startsWith("*") && chunk.endsWith("*") && chunk.length > 2) {
          return (
            <em key={`${keyPrefix}-i-${idx}`} className="italic text-[var(--text-ivory-soft)]">
              {chunk.slice(1, -1)}
            </em>
          );
        }
        if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 2) {
          return (
            <code
              key={`${keyPrefix}-c-${idx}`}
              className="rounded-[4px] border border-[rgba(226,180,109,0.22)] bg-[rgba(226,180,109,0.08)] px-1.5 py-0.5 font-mono text-[0.86em] text-[#e8cf9b]"
            >
              {chunk.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={`${keyPrefix}-t-${idx}`}>{chunk}</Fragment>;
      });
    };

    const renderInline = (line: string) => {
      const parts = line.split(/(\[\[[^\]]+\]\])/g);
      return parts.map((part, i) => {
        const m = part.match(/^\[\[([^\]]+)\]\]$/);
        if (m) {
          const [rawTarget, alias] = m[1].split("|");
          const cleanTarget = rawTarget.split("#")[0].trim();
          const label = (alias || cleanTarget).trim();
          return (
            <button
              key={i}
              type="button"
              data-testid="wikilink-btn"
              data-wikilink-target={cleanTarget}
              onClick={() => navigateToWikiLink(cleanTarget)}
              className="inline cursor-pointer border-0 bg-transparent p-0 font-reading text-[1em] text-[#E2B46D] underline decoration-[#E2B46D]/45 underline-offset-[4px] rounded-[3px] px-0.5 -mx-0.5 transition-colors hover:bg-[rgba(226,180,109,0.14)] hover:decoration-[#E2B46D] hover:text-[#f6d598]"
            >
              {label}
            </button>
          );
        }
        return <Fragment key={i}>{renderFormattedText(part, `seg-${i}`)}</Fragment>;
      });
    };

    const lines = markdown.split(/\r?\n/);

    return (
      <div
        data-testid="reflection-preview-pane"
        className="mt-5 min-h-[300px] space-y-3 font-reading text-[1.08rem] leading-[1.78] text-[var(--text-ivory-soft)]"
      >
        {markdown.trim().length === 0 ? (
          <p className="text-[var(--text-muted)]">
            Empty note. Click Edit to begin writing.
          </p>
        ) : (
          lines.map((line, idx) => {
            const t = line.trim();
            if (!t) return <div key={idx} className="h-2" />;
            if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) {
              return (
                <hr
                  key={idx}
                  className="my-4 border-0 border-t border-[rgba(222,188,132,0.18)]"
                />
              );
            }
            if (t.startsWith("### ")) {
              return (
                <h4 key={idx} className="pt-2 font-editorial text-[1.28rem] text-[var(--text-ivory)]">
                  {renderInline(t.slice(4))}
                </h4>
              );
            }
            if (t.startsWith("## ")) {
              return (
                <h3
                  key={idx}
                  className="pt-3 font-editorial text-[1.5rem] text-[#E2B46D] border-b border-[rgba(222,188,132,0.14)] pb-1"
                >
                  {renderInline(t.slice(3))}
                </h3>
              );
            }
            if (t.startsWith("# ")) {
              return (
                <h2 key={idx} className="pt-2 font-editorial text-[1.8rem] text-[var(--text-ivory)]">
                  {renderInline(t.slice(2))}
                </h2>
              );
            }
            if (t.startsWith("> ")) {
              return (
                <blockquote
                  key={idx}
                  className="border-l-2 border-[#E2B46D]/65 bg-[rgba(226,180,109,0.06)] pl-4 py-1.5 italic text-[var(--text-ivory-soft)]/92"
                >
                  {renderInline(t.slice(2))}
                </blockquote>
              );
            }
            const orderedMatch = t.match(/^(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
              return (
                <div key={idx} className="flex items-start gap-2.5 pl-1.5">
                  <span className="font-ui tabular-nums text-[0.78rem] pt-1 text-[#E2B46D]/85 shrink-0 min-w-[1.25rem]">
                    {orderedMatch[1]}.
                  </span>
                  <div className="flex-1">{renderInline(orderedMatch[2])}</div>
                </div>
              );
            }
            if (t.startsWith("- ") || t.startsWith("* ")) {
              return (
                <div key={idx} className="flex items-start gap-2.5 pl-2">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E2B46D]/75" />
                  <div className="flex-1">{renderInline(t.slice(2))}</div>
                </div>
              );
            }
            return <p key={idx}>{renderInline(line)}</p>;
          })
        )}
      </div>
    );
  };

  return (
    <MiniAppShell
      roomId="journal"
      title="Journal"
      lockScroll
      subtitle={
        mode === "debrief"
          ? `Daily Debrief · Vault /Daily/${debriefDate}.md`
          : activeExternalNote
          ? `Vault Reader · /${activeExternalNote.folder}/${activeExternalNote.fileName}`
          : `Reflections · Long-form Markdown & Linked Vault Notes`
      }
      onClose={onClose}
      rightSlot={
        <div className="flex items-center gap-1 rounded-[3px] border border-[var(--glass-border)] bg-[var(--surface-inner)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setActiveExternalNote(null);
              setMode("debrief");
              rightPaneScrollRef.current?.scrollTo({ top: 0 });
            }}
            data-testid="journal-mode-debrief"
            className={`cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.66rem] uppercase tracking-[0.14em] transition-colors ${
              mode === "debrief"
                ? "bg-[var(--surface-panel-hover)] text-[var(--text-ivory)] border border-[rgba(226,180,109,0.42)]"
                : "bg-transparent border border-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
            Daily Debrief
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("reflections");
              rightPaneScrollRef.current?.scrollTo({ top: 0 });
            }}
            data-testid="journal-mode-reflections"
            className={`cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.66rem] uppercase tracking-[0.14em] transition-colors ${
              mode === "reflections"
                ? "bg-[var(--surface-panel-hover)] text-[var(--text-ivory)] border border-[rgba(226,180,109,0.42)]"
                : "bg-transparent border border-transparent text-[var(--text-muted)] hover:text-[var(--text-ivory-soft)]"
            }`}
          >
            <Feather className="h-3.5 w-3.5" strokeWidth={1.6} />
            Reflections
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:flex-1 md:min-h-0 md:h-full md:overflow-hidden">
        {/* ==================== FIXED/LOCKED LEFT VAULT ARCHIVE & FULL-TEXT SEARCH SIDEBAR ==================== */}
        <aside
          data-testid="journal-vault-sidebar"
          className="md:col-span-4 xl:col-span-3 smoked-glass rounded-[12px] p-4 flex flex-col md:h-full md:min-h-0 md:overflow-hidden"
        >
          {/* Instant Vault Search Input (Ctrl+F) */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
              strokeWidth={1.6}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="vault-search-input"
              placeholder="Search notes... (Ctrl+F)"
              className="w-full rounded-[9px] border border-[var(--glass-border)] bg-[var(--surface-inner)] pl-8 pr-8 py-2 font-ui text-[0.75rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:border-[var(--accent-luminous)] focus:outline-none"
            />
            {(searchQuery || activeTag) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setActiveTag(null);
                }}
                data-testid="vault-search-clear"
                aria-label="Clear search and tag filters"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer bg-transparent border-0 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-ivory)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Clickable #tag Filter Pills */}
          {allVaultTags.length > 0 && (
            <div
              data-testid="vault-tag-pills"
              className="mt-2.5 flex flex-wrap gap-1.5 pb-3 border-b border-[rgba(214,224,212,0.08)]"
            >
              {allVaultTags.map(({ tag }) => {
                const selected = activeTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
                    data-testid={`vault-tag-pill-${tag}`}
                    aria-pressed={selected}
                    className={`cursor-pointer rounded-[3px] px-2 py-0.5 flex items-center gap-0.5 font-ui text-[0.58rem] tracking-[0.06em] transition-colors border ${
                      selected
                        ? "border-[rgba(226,180,109,0.6)] bg-[rgba(226,180,109,0.2)] text-[var(--text-ivory)]"
                        : "border-[rgba(226,180,109,0.18)] bg-[rgba(226,180,109,0.08)] text-[var(--accent-luminous)] hover:border-[rgba(226,180,109,0.4)]"
                    }`}
                  >
                    <Hash className="h-2.5 w-2.5 opacity-75" />
                    {tag}
                  </button>
                );
              })}
            </div>
          )}

          {/* Sidebar Body: Either Grouped Full-Text Search Results OR Mode Archive */}
          {isSearchActive ? (
            <div
              data-testid="vault-search-results"
              className="mt-3 flex-1 overflow-y-auto space-y-4 pr-1"
            >
              <div className="flex items-center justify-between font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                <span>
                  {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
                </span>
                {activeTag && (
                  <span className="text-[var(--accent-brass)]">#{activeTag}</span>
                )}
              </div>

              {groupedSearchResults.map((group) => (
                <div key={group.folder} data-testid={`search-group-${group.folder}`}>
                  <div className="flex items-center gap-1.5 font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)] mb-1.5">
                    <FolderIcon folder={group.folder} className="h-3 w-3" />
                    <span>{group.folder}</span>
                    <span className="text-[var(--text-muted)]">({group.items.length})</span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((hit) => (
                      <button
                        key={`${hit.note.folder}-${hit.note.fileName}`}
                        type="button"
                        onClick={() => openVaultNote(hit.note)}
                        data-testid={`search-hit-${hit.note.folder}-${hit.note.fileName}`}
                        className="w-full text-left cursor-pointer rounded-[9px] border border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(194,168,120,0.42)] hover:bg-[var(--surface-panel-hover)] transition-colors p-2.5"
                      >
                        <div className="font-editorial text-[1rem] leading-snug text-[var(--text-ivory)] truncate">
                          {renderHighlightedSnippet(hit.note.title, searchQuery)}
                        </div>
                        <p className="mt-1 font-reading text-[0.82rem] leading-snug text-[var(--text-muted)] line-clamp-2">
                          {renderHighlightedSnippet(hit.snippet, searchQuery)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {groupedSearchResults.length === 0 && (
                <div className="py-10 text-center font-reading text-[0.92rem] text-[var(--text-muted)]">
                  No vault notes matched your filter.
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Reflections Section */}
              <div>
                <div className="flex items-center justify-between pb-2">
                  <span className="font-ui text-[0.6rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                    Reflections ({reflections.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => startNewReflection()}
                    data-testid="new-reflection-btn"
                    className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.38)] bg-[rgba(226,180,109,0.12)] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--text-ivory)] flex items-center gap-1 hover:bg-[rgba(226,180,109,0.22)]"
                  >
                    <Plus className="h-3 w-3" />
                    New
                  </button>
                </div>

                <div className="space-y-1.5">
                  {reflections.map((entry) => {
                    const active =
                      mode === "reflections" &&
                      !activeExternalNote &&
                      activeReflectionFile === entry.fileName;
                    return (
                      <div
                        key={entry.fileName}
                        className={`group rounded-[9px] border p-2.5 transition-colors cursor-pointer ${
                          active
                            ? "border-[rgba(194,168,120,0.45)] bg-[var(--surface-panel-hover)]"
                            : "border-[rgba(214,224,212,0.08)] bg-[var(--surface-inner)] hover:border-[rgba(214,224,212,0.22)]"
                        }`}
                        onClick={() => selectReflection(entry)}
                        data-testid={`reflection-item-${entry.fileName}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-editorial text-[1.02rem] leading-snug text-[var(--text-ivory)] truncate">
                              {entry.title}
                            </div>
                            <div className="mt-0.5 font-ui tabular-nums text-[0.6rem] tracking-[0.1em] text-[var(--text-muted)]">
                              {entry.date}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteReflection(entry.fileName);
                            }}
                            aria-label={`Delete ${entry.title}`}
                            className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-1 text-[var(--text-muted)] hover:text-[var(--danger-ember)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {entry.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {entry.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-[3px] bg-[rgba(226,180,109,0.12)] px-2 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.08em] text-[var(--accent-luminous)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {reflections.length === 0 && (
                    <div className="py-4 text-center font-reading text-[0.88rem] text-[var(--text-muted)]">
                      No reflections yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Books & Inbox Quick Vault Index */}
              {booksAndInboxNotes.length > 0 && (
                <div className="pt-2 border-t border-[rgba(214,224,212,0.08)]">
                  <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)] mb-2">
                    Books & Inbox ({booksAndInboxNotes.length})
                  </div>
                  <div className="space-y-1.5">
                    {booksAndInboxNotes.slice(0, 8).map((note) => {
                      const active =
                        mode === "reflections" &&
                        activeExternalNote?.folder === note.folder &&
                        activeExternalNote?.fileName === note.fileName;
                      return (
                        <button
                          key={`${note.folder}-${note.fileName}`}
                          type="button"
                          onClick={() => openVaultNote(note)}
                          className={`w-full text-left cursor-pointer rounded-[8px] border px-2.5 py-2 flex items-center gap-2 transition-colors ${
                            active
                              ? "border-[rgba(194,168,120,0.45)] bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                              : "border-[rgba(214,224,212,0.07)] bg-[var(--surface-inner)] text-[var(--text-ivory-soft)] hover:border-[rgba(214,224,212,0.2)]"
                          }`}
                        >
                          <FolderIcon
                            folder={note.folder}
                            className="h-3.5 w-3.5 shrink-0 text-[var(--accent-luminous)]"
                          />
                          <span className="font-reading text-[0.9rem] truncate flex-1">
                            {note.title}
                          </span>
                          <span className="font-ui text-[0.52rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                            {note.folder}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Published Daily Debrief Archive */}
              {archiveDates.length > 0 && (
                <div className="pt-2 border-t border-[rgba(214,224,212,0.08)]">
                  <div className="font-ui text-[0.58rem] uppercase tracking-[0.2em] text-[var(--accent-brass)] mb-2">
                    Daily Debriefs ({archiveDates.length})
                  </div>
                  <div className="space-y-1">
                    {archiveDates.slice(0, 7).map((d) => {
                      const active = mode === "debrief" && debriefDate === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setActiveExternalNote(null);
                            setDebriefDate(d);
                            setMode("debrief");
                          }}
                          className={`w-full text-left cursor-pointer rounded-[8px] border px-2.5 py-1.5 font-ui tabular-nums text-[0.7rem] tracking-[0.08em] transition-colors ${
                            active
                              ? "border-[rgba(194,168,120,0.45)] bg-[var(--surface-panel-hover)] text-[var(--text-ivory)]"
                              : "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-panel-hover)] hover:text-[var(--text-ivory-soft)]"
                          }`}
                        >
                          {d}.md
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ==================== INDEPENDENTLY SCROLLABLE RIGHT WORKSPACE ==================== */}
        <div
          ref={rightPaneScrollRef}
          data-testid="journal-main-scroll"
          className="no-scrollbar md:col-span-8 xl:col-span-9 min-w-0 md:h-full md:min-h-0 md:overflow-y-auto md:pr-1 pb-10"
        >
          {mode === "debrief" ? (
            <div className="space-y-6" data-testid="daily-debrief-view">
              {/* Date Switcher & Archive Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDebriefDate((d) => shiftIsoDate(d, -1))}
                    aria-label="Previous logical day"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] p-2 text-[var(--text-ivory-soft)]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div>
                    <div className="font-editorial text-[1.45rem] leading-none text-[var(--text-ivory)]">
                      {formatEditorialDate(debriefDate)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-ui tabular-nums text-[0.66rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      <span>Logical Day {debriefDate}</span>
                      <span>·</span>
                      <span
                        data-testid="debrief-status-badge"
                        className={
                          isPublished
                            ? "text-[var(--accent-luminous)]"
                            : "text-[var(--accent-brass)]"
                        }
                      >
                        {isPublished ? "Saved" : "Draft"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDebriefDate((d) => shiftIsoDate(d, 1))}
                    aria-label="Next logical day"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] p-2 text-[var(--text-ivory-soft)]"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  {debriefDate !== logicalToday && (
                    <button
                      type="button"
                      onClick={() => setDebriefDate(logicalToday)}
                      className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.34)] bg-transparent px-3 py-1 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                    >
                      Today
                    </button>
                  )}
                </div>

                {archiveDates.length > 0 && (
                  <label className="flex items-center gap-2 font-ui text-[0.64rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    <span>Archive</span>
                    <select
                      value={archiveDates.includes(debriefDate) ? debriefDate : ""}
                      onChange={(e) => {
                        if (e.target.value) setDebriefDate(e.target.value);
                      }}
                      className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-3 py-1.5 font-ui tabular-nums text-[0.74rem] text-[var(--text-ivory)] focus:outline-none"
                    >
                      <option value="">Browse {archiveDates.length} published...</option>
                      {archiveDates.map((d) => (
                        <option key={d} value={d}>
                          {d}.md
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Auto-Populated Day Summary */}
              <section
                className="smoked-glass rounded-[12px] p-6"
                data-testid="debrief-auto-summary"
              >
                <div className="flex items-center justify-between">
                  <div className="font-ui text-[0.64rem] uppercase tracking-[0.22em] text-[var(--accent-brass)]">
                    Auto-Populated Day Summary (SQLite Telemetry)
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRefreshSummary()}
                    className="cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.16em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${refreshingSummary ? "animate-spin" : ""}`}
                      strokeWidth={1.7}
                    />
                    Refresh Summary
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div>
                    <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Focus Logged
                    </div>
                    <div className="mt-1 font-editorial tabular-nums text-[1.9rem] font-light text-[var(--text-ivory)]">
                      {daySummary.focusHours}h
                    </div>
                    <div className="font-ui tabular-nums text-[0.66rem] text-[var(--text-muted)]">
                      {daySummary.focusMinutes} minutes recorded
                    </div>
                  </div>

                  <div>
                    <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Completed Tasks ({daySummary.completedTasks.length})
                    </div>
                    <ul className="no-scrollbar mt-1.5 space-y-1 list-none p-0 m-0 max-h-[96px] overflow-y-auto">
                      {daySummary.completedTasks.length > 0 ? (
                        daySummary.completedTasks.map((t, i) => (
                          <li
                            key={i}
                            className="font-reading text-[0.92rem] text-[var(--text-ivory-soft)] truncate"
                          >
                            · {t}
                          </li>
                        ))
                      ) : (
                        <li className="font-reading text-[0.9rem] text-[var(--text-muted)]">
                          No completed daily tasks yet.
                        </li>
                      )}
                    </ul>
                  </div>

                  <div>
                    <div className="font-ui text-[0.6rem] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Hourly Activity Highlights ({daySummary.blockHighlights.length})
                    </div>
                    <ul className="no-scrollbar mt-1.5 space-y-1 list-none p-0 m-0 max-h-[96px] overflow-y-auto">
                      {daySummary.blockHighlights.length > 0 ? (
                        daySummary.blockHighlights.slice(0, 6).map((b, i) => (
                          <li
                            key={i}
                            className="font-ui tabular-nums text-[0.72rem] text-[var(--text-ivory-soft)]/85 truncate"
                          >
                            {b}
                          </li>
                        ))
                      ) : (
                        <li className="font-reading text-[0.9rem] text-[var(--text-muted)]">
                          No hourly blocks logged yet.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>

                {/* Subtle iPhone Sleep & Screen Time Telemetry Strip (when received via /ingest) */}
                {(() => {
                  const tel = deviceTelemetry.find((t) => t.logicalDate === debriefDate);
                  if (!tel || (tel.sleepHours == null && tel.screenTimeMinutes == null)) {
                    return null;
                  }
                  const stMins = tel.screenTimeMinutes ?? null;
                  const stFormatted =
                    stMins !== null
                      ? `${Math.floor(stMins / 60)}h ${stMins % 60}m`
                      : null;
                  return (
                    <div
                      data-testid="debrief-device-telemetry"
                      className="mt-4 pt-3 border-t border-[rgba(214,224,212,0.08)] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex flex-wrap items-center gap-4 font-ui text-[0.66rem] uppercase tracking-[0.14em]">
                        {tel.sleepHours != null && (
                          <span className="text-[var(--accent-luminous)]">
                            Sleep: {tel.sleepHours.toFixed(1)}h
                          </span>
                        )}
                        {stFormatted && (
                          <span className="text-[#e4c27c]">
                            Screen Time: {stFormatted}
                          </span>
                        )}
                      </div>
                      <span className="font-ui text-[0.56rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        iPhone Telemetry · {tel.source.replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })()}
              </section>

              {/* Attached Strategic Thinking / TOC Session Summary Block */}
              {tocTrees.filter((t) => t.attachedToDebriefDate === debriefDate).length > 0 && (
                <section
                  data-testid="debrief-toc-attachment"
                  className="smoked-glass rounded-[12px] border border-[#C5A059]/35 p-6 space-y-3"
                >
                  <div className="font-ui text-[0.64rem] uppercase tracking-[0.22em] text-[#C5A059]">
                    Strategic Thinking / TOC Session
                  </div>
                  <div className="space-y-3">
                    {tocTrees
                      .filter((t) => t.attachedToDebriefDate === debriefDate)
                      .map((tree) => (
                        <div
                          key={tree.id}
                          className="rounded-[10px] border border-[var(--glass-border)] bg-[var(--surface-inner)] px-4 py-3.5 flex flex-wrap items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-editorial text-[1.18rem] text-[var(--text-ivory)]">
                                {tree.title}
                              </span>
                              <span className="rounded-full border border-[#C5A059]/35 bg-[#C5A059]/12 px-2 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[#e4c27c] shrink-0">
                                {FRAMEWORK_LABELS[tree.frameworkType]}
                              </span>
                            </div>
                            <p className="mt-1 font-reading text-[0.92rem] text-[var(--text-muted)]">
                              {extractTocSummaryInsight(tree)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenTocTree(tree.id)}
                            data-testid={`debrief-reopen-toc-${tree.id}`}
                            className="smoked-glass smoked-glass-hover shrink-0 cursor-pointer rounded-full px-4 py-1.5 border border-[#C5A059]/45 font-ui text-[0.62rem] uppercase tracking-[0.14em] text-[#e4c27c]"
                          >
                            Reopen TOC Session →
                          </button>
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {/* Structured Editorial Prompts */}
              <div className="space-y-6">
                <section className="smoked-glass rounded-[12px] p-6">
                  <label className="block">
                    <div className="font-ui text-[0.64rem] uppercase tracking-[0.22em] text-[var(--accent-luminous)]">
                      I · Memorable Moments & Wins from Today
                    </div>
                    <p className="mt-1 font-reading text-[0.94rem] text-[var(--text-muted)]">
                      What actually happened today worth remembering years from now?
                    </p>
                    <textarea
                      rows={5}
                      value={memories}
                      onChange={(e) => setMemories(e.target.value)}
                      data-testid="debrief-memories-input"
                      placeholder="Capture the specific conversations, breakthroughs, or quiet moments from today..."
                      className="mt-3 w-full resize-y rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 font-reading text-[1.06rem] leading-relaxed text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                  </label>
                </section>

                <section className="smoked-glass rounded-[12px] p-6">
                  <div className="font-ui text-[0.64rem] uppercase tracking-[0.22em] text-[var(--accent-luminous)]">
                    II · 3 Specific Things I Am Grateful For Today
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      { num: 1, val: gratitude1, set: setGratitude1 },
                      { num: 2, val: gratitude2, set: setGratitude2 },
                      { num: 3, val: gratitude3, set: setGratitude3 },
                    ].map((slot) => (
                      <div key={slot.num} className="flex items-center gap-3">
                        <span className="font-editorial tabular-nums text-[1.15rem] text-[var(--accent-brass)] w-5 shrink-0">
                          {slot.num}.
                        </span>
                        <input
                          type="text"
                          value={slot.val}
                          onChange={(e) => slot.set(e.target.value)}
                          data-testid={`debrief-gratitude-${slot.num}`}
                          placeholder={`Specific gratitude #${slot.num}...`}
                          className="flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] px-4 py-2.5 font-reading text-[1.02rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:border-[var(--accent-luminous)] focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </section>

                <section className="smoked-glass rounded-[12px] p-6">
                  <label className="block">
                    <div className="font-ui text-[0.64rem] uppercase tracking-[0.22em] text-[var(--accent-luminous)]">
                      III · Quick Closing Thought / Tomorrow&apos;s Priority
                    </div>
                    <textarea
                      rows={3}
                      value={closingThought}
                      onChange={(e) => setClosingThought(e.target.value)}
                      data-testid="debrief-closing-input"
                      placeholder="One crisp anchor thought or the single first priority for tomorrow..."
                      className="mt-3 w-full resize-y rounded-lg border border-[var(--glass-border)] bg-[var(--surface-inner)] p-4 font-reading text-[1.04rem] leading-relaxed text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:border-[var(--accent-luminous)] focus:outline-none"
                    />
                  </label>
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="min-h-[20px]">
                  {debriefNotice ? (
                    <span
                      data-testid="debrief-notice"
                      className="font-ui text-[0.74rem] tracking-[0.06em] text-[var(--accent-luminous)]"
                    >
                      {debriefNotice}
                    </span>
                  ) : publishedPath ? (
                    <span className="font-ui text-[0.68rem] tracking-[0.06em] text-[var(--text-muted)]">
                      Vault File: {publishedPath}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveDraft()}
                    data-testid="debrief-save-draft-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-4 py-2 font-ui text-[0.68rem] uppercase tracking-[0.14em] text-[var(--text-ivory-soft)] flex items-center gap-2"
                  >
                    <Save className="h-3.5 w-3.5" strokeWidth={1.6} />
                    Save Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePublishDebrief()}
                    data-testid="debrief-publish-btn"
                    className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-5 py-2 font-editorial text-[1.02rem] tracking-[0.04em] text-[var(--text-ivory)] border-[rgba(226,180,109,0.52)] bg-[rgba(226,180,109,0.18)] flex items-center gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[var(--accent-luminous)]" strokeWidth={1.7} />
                    Publish Daily Debrief
                  </button>
                </div>
              </div>

              {archiveRawMd && !memories && !gratitude1 && (
                <section className="smoked-glass rounded-[12px] p-6">
                  <div className="font-ui text-[0.62rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                    Archived Vault Markdown ({debriefDate}.md)
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap font-reading text-[0.98rem] leading-relaxed text-[var(--text-ivory-soft)]">
                    {archiveRawMd}
                  </pre>
                </section>
              )}
            </div>
          ) : (
            /* ==================== MODE B: REFLECTIONS & VAULT NOTE WORKSPACE ==================== */
            <div
              data-testid="reflections-view"
              className="smoked-glass rounded-[12px] p-6 md:p-8 flex flex-col relative"
            >
              {/* Title Bar + Edit/Preview Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-border)] pb-4">
                <div className="flex-1 min-w-[200px]">
                  {activeExternalNote && (
                    <div className="mb-1 inline-flex items-center gap-1.5 rounded-[3px] border border-[rgba(226,180,109,0.35)] bg-[rgba(226,180,109,0.1)] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.16em] text-[var(--accent-brass)]">
                      <FolderIcon folder={activeExternalNote.folder} className="h-3 w-3" />
                      {activeExternalNote.folder} Note
                    </div>
                  )}
                  <input
                    type="text"
                    value={refTitle}
                    readOnly={previewMode || Boolean(activeExternalNote)}
                    onChange={(e) => setRefTitle(e.target.value)}
                    data-testid="reflection-title-input"
                    placeholder="Reflection Title..."
                    className={`w-full bg-transparent border-0 p-0 font-editorial text-[1.72rem] font-light tracking-[0.02em] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:outline-none ${
                      previewMode ? "cursor-default" : ""
                    }`}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPreviewMode((v) => !v)}
                    data-testid="reflection-preview-toggle"
                    className={`cursor-pointer rounded-[3px] border px-3.5 py-1 flex items-center gap-1.5 font-ui text-[0.62rem] uppercase tracking-[0.14em] transition-colors ${
                      previewMode
                        ? "border-[rgba(226,180,109,0.52)] bg-[rgba(226,180,109,0.14)] text-[var(--text-ivory)] hover:bg-[rgba(226,180,109,0.24)]"
                        : "border-[var(--glass-border)] bg-transparent text-[var(--text-muted)] hover:border-[rgba(226,180,109,0.42)] hover:text-[var(--text-ivory)]"
                    }`}
                  >
                    {previewMode ? (
                      <>
                        <Pencil className="h-3 w-3 text-[#E2B46D]" />
                        Edit
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3 text-[#E2B46D]" />
                        Preview
                      </>
                    )}
                  </button>

                  <span className="font-ui tabular-nums text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {wordCount} words
                  </span>
                </div>
              </div>

              {/* Date + Tags Row */}
              <div className="mt-3 flex flex-wrap items-center gap-4 border-b border-[rgba(214,224,212,0.08)] pb-3">
                <div className="flex items-center gap-2 font-ui tabular-nums text-[0.68rem] tracking-[0.1em] text-[var(--accent-brass)]">
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{refDate}</span>
                </div>
                {previewMode ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {refTags
                      .split(",")
                      .map((t) => t.trim().replace(/^#/, ""))
                      .filter(Boolean)
                      .map((tag) => (
                        <span
                          key={tag}
                          className="rounded-[3px] border border-[rgba(226,180,109,0.26)] bg-[rgba(226,180,109,0.08)] px-2.5 py-0.5 font-ui text-[0.58rem] uppercase tracking-[0.08em] text-[#E2B46D]"
                        >
                          #{tag}
                        </span>
                      ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={refTags}
                    readOnly={Boolean(activeExternalNote)}
                    onChange={(e) => setRefTags(e.target.value)}
                    data-testid="reflection-tags-input"
                    placeholder="Topic tags (comma separated, e.g. systems, strategy, philosophy)..."
                    className="flex-1 min-w-[220px] bg-transparent border-0 p-0 font-ui text-[0.76rem] text-[var(--text-ivory-soft)] placeholder:text-[var(--text-muted)]/75 focus:outline-none"
                  />
                )}
              </div>

              {/* Editor Textarea OR Clickable Markdown Preview */}
              {previewMode ? (
                renderMarkdownWithWikiLinks(refBody)
              ) : (
                <div className="relative mt-5 flex-1 flex flex-col">
                  <textarea
                    ref={bodyTextareaRef}
                    value={refBody}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRefBody(val);
                      updateWikiAutocompleteFromCursor(val, e.target.selectionStart);
                    }}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      updateWikiAutocompleteFromCursor(el.value, el.selectionStart);
                    }}
                    onKeyDown={(e) => {
                      if (!wikiAutocomplete || wikiCandidates.length === 0) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setWikiSelectedIdx((idx) => (idx + 1) % wikiCandidates.length);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setWikiSelectedIdx(
                          (idx) => (idx - 1 + wikiCandidates.length) % wikiCandidates.length
                        );
                      } else if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const chosen = wikiCandidates[wikiSelectedIdx] ?? wikiCandidates[0];
                        if (chosen) insertWikiLinkSuggestion(chosen);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setWikiAutocomplete(null);
                      }
                    }}
                    data-testid="reflection-body-input"
                    placeholder="Write long-form Markdown... Type [[ to link Reflections, Book notes, or Daily Debriefs."
                    className="min-h-[380px] w-full flex-1 resize-y bg-transparent border-0 p-0 font-reading text-[1.12rem] leading-[1.74] text-[var(--text-ivory-soft)] placeholder:text-[var(--text-muted)]/65 focus:outline-none"
                  />

                  {/* Floating [[Wiki-Link]] Autocomplete Picker */}
                  {wikiAutocomplete && (
                    <div
                      data-testid="wikilink-autocomplete"
                      className="mt-2 z-30 w-full max-w-[420px] rounded-[10px] border border-[rgba(194,168,120,0.42)] bg-[var(--surface-inner)] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                    >
                      <div className="px-2 py-1 flex items-center justify-between font-ui text-[0.56rem] uppercase tracking-[0.18em] text-[var(--accent-brass)]">
                        <span>Link Vault Note</span>
                        <span className="text-[var(--text-muted)]">Enter to insert · Esc</span>
                      </div>

                      <div className="mt-1 max-h-[210px] overflow-y-auto space-y-1">
                        {wikiCandidates.map((cand, idx) => {
                          const active = idx === wikiSelectedIdx;
                          return (
                            <button
                              key={`${cand.folder}-${cand.fileName}`}
                              type="button"
                              data-testid={`wikilink-option-${cand.title}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertWikiLinkSuggestion(cand);
                              }}
                              className={`w-full text-left cursor-pointer rounded-[7px] px-2.5 py-1.5 flex items-center justify-between gap-2 transition-colors border-0 ${
                                active
                                  ? "bg-[rgba(143,184,163,0.18)] text-[var(--text-ivory)]"
                                  : "bg-transparent text-[var(--text-ivory-soft)] hover:bg-[rgba(143,184,163,0.1)]"
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <FolderIcon
                                  folder={cand.folder}
                                  className="h-3.5 w-3.5 shrink-0 text-[var(--accent-luminous)]"
                                />
                                <span className="font-editorial text-[0.98rem] truncate">
                                  {cand.title}
                                </span>
                              </span>
                              <span className="shrink-0 font-ui text-[0.54rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                {cand.folder}
                              </span>
                            </button>
                          );
                        })}

                        {wikiCandidates.length === 0 && (
                          <div className="px-2.5 py-2 font-reading text-[0.86rem] text-[var(--text-muted)]">
                            No matching vault notes. Finish typing ]] to create a new link.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Save Footer (shown in Edit mode or when displaying a status notice) */}
              {(!previewMode || refNotice) && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
                  <div className="min-h-[20px]">
                    {refNotice ? (
                      <span
                        data-testid="reflection-notice"
                        className="font-ui text-[0.74rem] tracking-[0.06em] text-[var(--accent-luminous)]"
                      >
                        {refNotice}
                      </span>
                    ) : (
                      <span className="font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Type [[ for wiki-links · Ctrl+S to save · Ctrl+F to search vault
                      </span>
                    )}
                  </div>

                  {!previewMode && (
                    <button
                      type="button"
                      onClick={() => void handleSaveActiveNote()}
                      data-testid="reflection-save-btn"
                      className="smoked-glass smoked-glass-hover cursor-pointer rounded-[3px] px-5 py-2 font-editorial text-[1rem] tracking-[0.04em] text-[var(--text-ivory)] border-[rgba(226,180,109,0.45)] flex items-center gap-2"
                    >
                      <Save className="h-3.5 w-3.5 text-[var(--accent-luminous)]" strokeWidth={1.6} />
                      {activeExternalNote ? `Save ${activeExternalNote.folder} Note` : "Save Reflection"}
                    </button>
                  )}
                </div>
              )}

              {/* Understated Collapsible Linked Mentions (Backlinks) Footer */}
              <section
                data-testid="linked-mentions-section"
                className="mt-6 border-t border-[var(--glass-border)] pt-4"
              >
                <button
                  type="button"
                  onClick={() => setBacklinksExpanded((v) => !v)}
                  data-testid="linked-mentions-toggle"
                  className="w-full cursor-pointer bg-transparent border-0 p-0 flex items-center justify-between text-left"
                >
                  <span className="flex items-center gap-2 font-ui text-[0.62rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
                    <Link2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                    Linked Mentions ({backlinks.length})
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${
                      backlinksExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {backlinksExpanded && (
                  <div className="mt-3 space-y-2" data-testid="linked-mentions-list">
                    {backlinks.map((mention) => (
                      <button
                        key={`${mention.sourceFolder}-${mention.sourceFileName}`}
                        type="button"
                        onClick={() => {
                          const target = vaultIndex.find(
                            (n) =>
                              n.folder === mention.sourceFolder &&
                              n.fileName === mention.sourceFileName
                          );
                          if (target) openVaultNote(target);
                        }}
                        data-testid={`backlink-item-${mention.sourceTitle}`}
                        className="w-full text-left cursor-pointer rounded-[9px] border border-[rgba(214,224,212,0.09)] bg-[var(--surface-inner)] hover:border-[rgba(194,168,120,0.38)] transition-colors px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            <FolderIcon
                              folder={mention.sourceFolder}
                              className="h-3.5 w-3.5 shrink-0 text-[var(--accent-luminous)]"
                            />
                            <span className="font-editorial text-[1.02rem] text-[var(--text-ivory)] truncate">
                              {mention.sourceTitle}
                            </span>
                            <span className="rounded-[3px] bg-[rgba(226,180,109,0.12)] px-2 py-0.5 font-ui text-[0.54rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                              {mention.sourceFolder}
                            </span>
                          </span>
                          {mention.sourceDate && (
                            <span className="font-ui tabular-nums text-[0.6rem] text-[var(--text-muted)] shrink-0">
                              {mention.sourceDate}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 font-reading text-[0.88rem] leading-relaxed text-[var(--text-muted)]">
                          {renderHighlightedSnippet(
                            mention.contextLine,
                            `[[${activeNoteTitleForBacklinks}]]`
                          )}
                        </p>
                      </button>
                    ))}

                    {backlinks.length === 0 && (
                      <div className="py-2 font-reading text-[0.88rem] text-[var(--text-muted)]/85">
                        {activeNoteTitleForBacklinks
                          ? `No other vault files link to [[${activeNoteTitleForBacklinks}]] yet.`
                          : "Save or title this note to discover incoming [[Wiki-Links]] across your vault."}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </MiniAppShell>
  );
}
