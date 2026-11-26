import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Eraser,
  FileOutput,
  FolderKanban,
  LayoutTemplate,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { RoomNavigationContext } from "./MiniAppShell";
import { RoomBackdrop } from "./RoomBackdrop";
import { TocFieldGuideDrawer } from "./toc/TocFieldGuideDrawer";
import { TocCanvasView } from "./toc/TocCanvasView";
import { FiveFocusingStepsView } from "./toc/FiveFocusingStepsView";
import {
  createBlankGraph,
  createEmptyFiveSteps,
  createTemplateGraphById,
  extractTocSummaryInsight,
  formatBoardAsJournalMarkdown,
  FRAMEWORK_LABELS,
  isGraphMeaningfullyPopulated,
  parseTocGraph,
  TOC_WHITEBOARD_TEMPLATES,
  type TocTemplateId,
} from "./toc/tocTemplates";
import { storageService } from "../../services/storage";
import type {
  TocFrameworkType,
  TocGraphData,
  TocTreeRecord,
} from "../../types/athenaeum";

interface TocMiniAppProps {
  trees: TocTreeRecord[];
  initialTreeId?: string | null;
  logicalToday: string;
  onSaveTree: (tree: TocTreeRecord) => Promise<TocTreeRecord>;
  onDeleteTree: (id: string) => Promise<void>;
  onClose: () => void;
}

function makeBoardId(): string {
  return `toc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export function TocMiniApp({
  trees,
  initialTreeId,
  logicalToday,
  onSaveTree,
  onDeleteTree,
  onClose,
}: TocMiniAppProps) {
  const navCtx = useContext(RoomNavigationContext);

  const [boardsDrawerOpen, setBoardsDrawerOpen] = useState(false);
  const [fieldGuideOpen, setFieldGuideOpen] = useState(false);
  const [templatesMenuSource, setTemplatesMenuSource] = useState<"top" | "dock" | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Open immediately onto a clean blank whiteboard (unless reopening a specific saved board)
  const [boardId, setBoardId] = useState<string>(() => makeBoardId());
  const [framework, setFramework] = useState<TocFrameworkType>("crt");
  const [title, setTitle] = useState<string>("Untitled Board");
  const [tags, setTags] = useState<string[]>(["thinking"]);
  const [attachedDate, setAttachedDate] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>(() => new Date().toISOString());
  const [graph, setGraph] = useState<TocGraphData>(() => createBlankGraph());

  // Signals passed to canvas for "+ Add Block" and auto-centering templates
  const [addBlockSignal, setAddBlockSignal] = useState<number>(0);
  const [fitViewSignal, setFitViewSignal] = useState<number>(0);

  // Silent SQLite auto-save + discreet toast feedback
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  const dirtyRef = useRef<boolean>(false);
  const savedBoardIdsRef = useRef<Set<string>>(new Set(trees.map((t) => t.id)));
  const saveTimerRef = useRef<number | null>(null);
  const onSaveTreeRef = useRef(onSaveTree);
  onSaveTreeRef.current = onSaveTree;

  useEffect(() => {
    for (const t of trees) {
      savedBoardIdsRef.current.add(t.id);
    }
  }, [trees]);

  const showNotice = useCallback((msg: string) => {
    setToastNotice(msg);
    window.setTimeout(() => {
      setToastNotice((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const loadBoardRecord = useCallback((record: TocTreeRecord) => {
    dirtyRef.current = false;
    setBoardId(record.id);
    setFramework(record.frameworkType);
    setTitle(record.title || "Untitled Board");
    setTags(record.tags.length > 0 ? record.tags : ["strategy"]);
    setAttachedDate(record.attachedToDebriefDate ?? null);
    setCreatedAt(record.createdAt);
    setGraph(parseTocGraph(record.graphJson, record.frameworkType));
    setAutoSaveState("saved");
    setConfirmClearOpen(false);
    setTemplatesMenuSource(null);
    setBoardsDrawerOpen(false);
    setFitViewSignal((n) => n + 1);
  }, []);

  // Reopen a specific board when launched from a Daily Debrief attachment link
  useEffect(() => {
    if (!initialTreeId) return;
    const found = trees.find((t) => t.id === initialTreeId);
    if (found) {
      loadBoardRecord(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTreeId]);

  const startFreshBlankBoard = useCallback(() => {
    dirtyRef.current = false;
    setBoardId(makeBoardId());
    setFramework("crt");
    setTitle("Untitled Board");
    setTags(["thinking"]);
    setAttachedDate(null);
    setCreatedAt(new Date().toISOString());
    setGraph(createBlankGraph());
    setAutoSaveState("idle");
    setConfirmClearOpen(false);
    setTemplatesMenuSource(null);
    setBoardsDrawerOpen(false);
    setFitViewSignal((n) => n + 1);
  }, []);

  const handleSelectTemplate = (templateId: TocTemplateId) => {
    const opt = TOC_WHITEBOARD_TEMPLATES.find((t) => t.id === templateId);
    if (!opt) return;
    dirtyRef.current = templateId !== "blank";
    setFramework(opt.framework);
    setGraph(createTemplateGraphById(templateId));
    setTags(opt.defaultTags);
    setTitle((prev) => {
      const cleaned = prev.trim();
      const isDefaultOrTemplate =
        !cleaned ||
        cleaned === "Untitled Board" ||
        TOC_WHITEBOARD_TEMPLATES.some((t) => t.defaultTitle === cleaned);
      return isDefaultOrTemplate ? opt.defaultTitle : prev;
    });
    setTemplatesMenuSource(null);
    setConfirmClearOpen(false);
    setFitViewSignal((n) => n + 1);
  };

  const handleGraphChange = useCallback((next: TocGraphData) => {
    dirtyRef.current = true;
    setGraph(next);
  }, []);

  const handleTitleChange = (nextTitle: string) => {
    dirtyRef.current = true;
    setTitle(nextTitle);
  };

  // Silent debounced SQLite auto-save whenever a board has content or already exists in SQLite
  useEffect(() => {
    if (!dirtyRef.current) return;
    const hasContent = isGraphMeaningfullyPopulated(framework, graph);
    const alreadyPersisted = savedBoardIdsRef.current.has(boardId);
    if (!hasContent && !alreadyPersisted) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    setAutoSaveState("saving");
    saveTimerRef.current = window.setTimeout(() => {
      const record: TocTreeRecord = {
        id: boardId,
        title: title.trim() || "Untitled Board",
        frameworkType: framework,
        tags,
        attachedToDebriefDate: attachedDate,
        graphJson: JSON.stringify(graph),
        createdAt,
        updatedAt: new Date().toISOString(),
      };
      void onSaveTreeRef
        .current(record)
        .then((saved) => {
          savedBoardIdsRef.current.add(saved.id);
          dirtyRef.current = false;
          setAutoSaveState("saved");
        })
        .catch(() => {
          setAutoSaveState("idle");
        });
    }, 850);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [boardId, framework, title, tags, attachedDate, createdAt, graph]);

  // Close menus/drawers or whiteboard cleanly on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      e.preventDefault();
      e.stopPropagation();
      if (confirmClearOpen) {
        setConfirmClearOpen(false);
      } else if (templatesMenuSource) {
        setTemplatesMenuSource(null);
      } else if (fieldGuideOpen) {
        setFieldGuideOpen(false);
      } else if (boardsDrawerOpen) {
        setBoardsDrawerOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [confirmClearOpen, templatesMenuSource, fieldGuideOpen, boardsDrawerOpen, onClose]);

  const boardHasContent = isGraphMeaningfullyPopulated(framework, graph);

  const performClearBoard = () => {
    dirtyRef.current = savedBoardIdsRef.current.has(boardId);
    setFramework("crt");
    setGraph(createBlankGraph());
    setConfirmClearOpen(false);
    setFitViewSignal((n) => n + 1);
  };

  const handleClearClick = () => {
    if (!boardHasContent) {
      performClearBoard();
      return;
    }
    setConfirmClearOpen(true);
  };

  const handleExportToJournal = async () => {
    const cleanTitle = title.trim() || "Untitled Board";
    const body = formatBoardAsJournalMarkdown(cleanTitle, framework, graph);
    try {
      const saved = await storageService.saveReflection({
        logicalDate: logicalToday,
        title: cleanTitle,
        tags: Array.from(new Set(["toc", ...tags])),
        body,
      });
      showNotice(`Exported to Journal /Reflections/${saved.fileName}`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Failed exporting to Journal");
    }
  };

  const handleDeleteBoard = async (id: string) => {
    await onDeleteTree(id);
    savedBoardIdsRef.current.delete(id);
    if (id === boardId) {
      startFreshBlankBoard();
    }
  };

  const renderTemplatesDropdown = (placement: "below" | "above") => (
    <motion.div
      initial={{ opacity: 0, y: placement === "below" ? -6 : 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === "below" ? -6 : 6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      data-testid="toc-templates-menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        background: "rgba(34, 34, 36, 0.86)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      className={`absolute z-50 w-[348px] rounded-[6px] border border-[rgba(226,180,109,0.34)] p-2 shadow-[0_22px_54px_rgba(0,0,0,0.68)] ${
        placement === "below" ? "left-0 top-full mt-2" : "left-1/2 bottom-full mb-3 -translate-x-1/2"
      }`}
    >
      <div className="px-2.5 py-1.5 font-ui text-[0.56rem] uppercase tracking-[0.2em] text-[#E2B46D]">
        Choose a Thinking Template
      </div>
      <div className="mt-0.5 space-y-0.5">
        {TOC_WHITEBOARD_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSelectTemplate(tpl.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                handleSelectTemplate(tpl.id);
              }
            }}
            data-testid={`toc-template-option-${tpl.id}`}
            className="w-full text-left cursor-pointer rounded-[9px] border border-transparent bg-transparent px-3 py-2 transition-colors hover:border-[rgba(226,180,109,0.28)] hover:bg-[rgba(226,180,109,0.1)]"
          >
            <div className="font-editorial text-[1.02rem] leading-tight text-[#f4efe6]">
              {tpl.label}
            </div>
            <div className="mt-0.5 font-reading text-[0.82rem] leading-snug text-[#b8aa96]">
              {tpl.description}
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );

  return (
    <>
      <motion.div
        data-testid="toc-whiteboard-shell"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="theme-chamber fixed inset-0 z-40 isolate flex h-screen w-screen flex-col overflow-hidden bg-transparent text-[var(--text-ivory)]"
      >
        <RoomBackdrop roomId="toc" />

        {/* Click-outside backdrop when Templates dropdown is open */}
        {templatesMenuSource && (
          <div
            aria-hidden="true"
            onMouseDown={() => setTemplatesMenuSource(null)}
            className="fixed inset-0 z-30"
          />
        )}

        {/* Minimalist Top Bar: Return, Editable Title, Templates, Boards, Field Guide */}
        <header className="relative z-40 shrink-0 flex items-center justify-between gap-4 border-b border-[rgba(222,188,132,0.16)] bg-[rgba(28,28,30,0.78)] px-6 py-3 backdrop-blur-md">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <button
              type="button"
              onClick={onClose}
              data-testid="miniapp-return-btn"
              className="chamber-return-btn group flex items-center gap-2 p-0 cursor-pointer text-[var(--text-ivory-soft)]/82 hover:text-[#E2B46D] transition-colors shrink-0"
            >
              <ArrowLeft
                className="h-4 w-4 text-[var(--accent-brass)] group-hover:text-[#E2B46D]"
                strokeWidth={1.6}
              />
              <span className="font-ui text-[0.66rem] uppercase tracking-[0.18em]">
                Workspace
              </span>
              <span className="font-ui text-[0.56rem] uppercase tracking-[0.14em] opacity-60">
                (Esc)
              </span>
            </button>

            <div className="h-5 w-[1px] bg-[var(--glass-border)] shrink-0" />

            {/* Editable Board Title */}
            <div className="flex items-center gap-2.5 min-w-0 max-w-[360px] flex-1">
              <input
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.currentTarget.blur();
                  }
                }}
                data-testid="toc-board-title-input"
                aria-label="Board title"
                placeholder="Untitled Board"
                className="min-w-0 flex-1 bg-transparent border-0 p-0 font-editorial text-[1.42rem] font-normal leading-none tracking-[0.02em] text-[#f4efe6] placeholder:text-[#b8aa96]/60 focus:outline-none truncate"
              />
              {autoSaveState !== "idle" && (
                <span className="shrink-0 font-ui text-[0.54rem] uppercase tracking-[0.16em] text-[#b8aa96]/70">
                  {autoSaveState === "saving" ? "Saving..." : "Saved"}
                </span>
              )}
            </div>

            {/* Top-Left Minimalist Templates Dropdown Trigger */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() =>
                  setTemplatesMenuSource((prev) => (prev === "top" ? null : "top"))
                }
                data-testid="toc-templates-top-btn"
                aria-expanded={templatesMenuSource === "top"}
                className={`cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 border font-ui text-[0.62rem] uppercase tracking-[0.15em] transition-colors ${
                  templatesMenuSource === "top"
                    ? "border-[rgba(226,180,109,0.6)] bg-[rgba(226,180,109,0.16)] text-[#f4efe6]"
                    : "border-[var(--glass-border)] bg-[#23211F] text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.42)] hover:text-[#f4efe6]"
                }`}
              >
                <LayoutTemplate className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.6} />
                Templates
                <ChevronDown className="h-3 w-3 opacity-75" />
              </button>

              <AnimatePresence>
                {templatesMenuSource === "top" && renderTemplatesDropdown("below")}
              </AnimatePresence>
            </div>
          </div>

          {/* Top-Right Controls: Boards Drawer, Field Guide, Borderless Ascend */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setFieldGuideOpen(false);
                setBoardsDrawerOpen((v) => !v);
              }}
              data-testid="toc-boards-btn"
              aria-pressed={boardsDrawerOpen}
              className={`cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 border font-ui text-[0.62rem] uppercase tracking-[0.15em] transition-colors ${
                boardsDrawerOpen
                  ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.18)] text-[#f4efe6]"
                  : "border-[var(--glass-border)] bg-[#23211F] text-[var(--text-ivory-soft)] hover:border-[rgba(226,180,109,0.42)] hover:text-[#f4efe6]"
              }`}
            >
              <FolderKanban className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.6} />
              Boards{trees.length > 0 ? ` (${trees.length})` : ""}
            </button>

            <button
              type="button"
              onClick={() => {
                setBoardsDrawerOpen(false);
                setFieldGuideOpen(true);
              }}
              data-testid="toc-field-guide-btn"
              className="cursor-pointer rounded-[3px] px-3.5 py-1.5 flex items-center gap-1.5 border border-[rgba(226,180,109,0.3)] bg-transparent font-ui text-[0.62rem] uppercase tracking-[0.15em] text-[#e4c27c] hover:border-[rgba(226,180,109,0.58)] hover:bg-[rgba(226,180,109,0.1)] transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
              Field Guide
            </button>

            {navCtx.onAscendToSurface && (
              <button
                type="button"
                onClick={navCtx.onAscendToSurface}
                data-testid="miniapp-ascend-surface-btn"
                className="chamber-return-btn group cursor-pointer p-0 pl-1 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.18em] text-[var(--text-ivory-soft)]/82 hover:text-[#E2B46D] transition-colors"
              >
                <ArrowUp
                  className="h-3.5 w-3.5 text-[var(--accent-brass)] transition-transform duration-200 group-hover:-translate-y-0.5"
                  strokeWidth={1.6}
                />
                Back to Overview
              </button>
            )}
          </div>
        </header>

        {/* Main Workspace: Direct Blank Whiteboard Canvas OR 5 Focusing Steps Worksheet */}
        <main className="relative flex flex-1 min-h-0 w-full flex-col overflow-hidden">
          {framework === "five_steps" ? (
            <div className="flex-1 overflow-y-auto bg-[rgba(30,30,32,0.72)]">
              <FiveFocusingStepsView
                data={graph.fiveSteps ?? createEmptyFiveSteps()}
                onChange={(nextFive) =>
                  handleGraphChange({ ...graph, fiveSteps: nextFive })
                }
              />
            </div>
          ) : (
            <TocCanvasView
              boardId={boardId}
              framework={framework}
              graph={graph}
              addBlockSignal={addBlockSignal}
              fitViewSignal={fitViewSignal}
              onChange={handleGraphChange}
            />
          )}

          {/* Discreet Toast Notification */}
          <AnimatePresence>
            {toastNotice && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.18 }}
                data-testid="toc-toast-notice"
                className="pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[#23211F] px-4 py-1.5 font-ui text-[0.64rem] uppercase tracking-[0.12em] text-[#E2B46D] shadow-[0_12px_30px_rgba(0,0,0,0.55)]"
              >
                {toastNotice}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Compact Floating Bottom Toolbar */}
          <div
            data-testid="toc-bottom-dock"
            style={{
              background: "rgba(34, 34, 36, 0.78)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
            className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 flex items-center gap-1.5 rounded-[4px] border border-[rgba(226,180,109,0.28)] px-2 py-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.62)]"
          >
            {confirmClearOpen ? (
              <div className="flex items-center gap-2 px-2 py-0.5">
                <span className="font-ui text-[0.64rem] uppercase tracking-[0.12em] text-[#f4efe6]">
                  Clear board?
                </span>
                <button
                  type="button"
                  onClick={performClearBoard}
                  data-testid="toc-confirm-clear-btn"
                  className="cursor-pointer rounded-[3px] border border-[rgba(217,125,104,0.6)] bg-[rgba(217,125,104,0.2)] px-3 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#f7c8bc] hover:bg-[rgba(217,125,104,0.34)]"
                >
                  Yes, Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(false)}
                  data-testid="toc-cancel-clear-btn"
                  className="cursor-pointer rounded-[3px] border border-[var(--glass-border)] bg-transparent px-3 py-1 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[#b8aa96] hover:text-[#f4efe6]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (framework === "five_steps") {
                      setFramework("crt");
                      setGraph(createBlankGraph());
                    }
                    setAddBlockSignal((n) => n + 1);
                  }}
                  data-testid="toc-add-block-btn"
                  className="cursor-pointer rounded-[3px] border-0 bg-[rgba(226,180,109,0.16)] px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#f4efe6] transition-colors hover:bg-[rgba(226,180,109,0.28)]"
                >
                  <Plus className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.8} />
                  Add Block
                </button>

                <span className="h-4 w-[1px] bg-[rgba(222,188,132,0.18)]" />

                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setTemplatesMenuSource((prev) => (prev === "dock" ? null : "dock"))
                    }
                    data-testid="toc-templates-dock-btn"
                    aria-expanded={templatesMenuSource === "dock"}
                    className={`cursor-pointer rounded-[3px] border-0 px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] transition-colors ${
                      templatesMenuSource === "dock"
                        ? "bg-[rgba(226,180,109,0.18)] text-[#f4efe6]"
                        : "bg-transparent text-[#d9ccb8] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#f4efe6]"
                    }`}
                  >
                    <LayoutTemplate className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.6} />
                    Templates
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>

                  <AnimatePresence>
                    {templatesMenuSource === "dock" && renderTemplatesDropdown("above")}
                  </AnimatePresence>
                </div>

                <span className="h-4 w-[1px] bg-[rgba(222,188,132,0.18)]" />

                <button
                  type="button"
                  onClick={handleClearClick}
                  data-testid="toc-clear-btn"
                  className="cursor-pointer rounded-[3px] border-0 bg-transparent px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#d9ccb8] transition-colors hover:bg-[rgba(217,125,104,0.14)] hover:text-[#f1b4a6]"
                >
                  <Eraser className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Clear
                </button>

                <span className="h-4 w-[1px] bg-[rgba(222,188,132,0.18)]" />

                <button
                  type="button"
                  onClick={() => void handleExportToJournal()}
                  data-testid="toc-export-journal-btn"
                  className="cursor-pointer rounded-[3px] border-0 bg-transparent px-3.5 py-1.5 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#E2B46D] transition-colors hover:bg-[rgba(226,180,109,0.14)] hover:text-[#f7dba1]"
                >
                  <FileOutput className="h-3.5 w-3.5" strokeWidth={1.6} />
                  Export to Journal
                </button>
              </>
            )}
          </div>
        </main>

        {/* Slide-Over Boards Drawer */}
        <AnimatePresence>
          {boardsDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setBoardsDrawerOpen(false)}
                className="fixed inset-0 z-50 bg-black/35"
              />
              <motion.aside
                initial={{ x: 380 }}
                animate={{ x: 0 }}
                exit={{ x: 380 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                data-testid="toc-boards-drawer"
                style={{
                  background: "rgba(34, 34, 36, 0.62)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
                className="fixed inset-y-0 right-0 z-[60] w-full max-w-[360px] border-l border-[rgba(226,180,109,0.24)] shadow-[-24px_0_60px_rgba(0,0,0,0.65)] flex flex-col"
              >
                <div className="shrink-0 flex items-center justify-between border-b border-[rgba(222,188,132,0.14)] px-5 py-4">
                  <div className="font-editorial text-[1.3rem] leading-none text-[#f4efe6]">
                    Saved Boards
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={startFreshBlankBoard}
                      data-testid="toc-new-board-btn"
                      className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.14)] px-3 py-1 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[#f4efe6] hover:bg-[rgba(226,180,109,0.26)]"
                    >
                      <Plus className="h-3 w-3 text-[#E2B46D]" />
                      New Board
                    </button>
                    <button
                      type="button"
                      onClick={() => setBoardsDrawerOpen(false)}
                      aria-label="Close boards drawer"
                      className="cursor-pointer bg-transparent border-0 p-1 text-[#b8aa96] hover:text-[#f4efe6]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
                  {trees.map((tree) => {
                    const isCurrent = tree.id === boardId;
                    return (
                      <div
                        key={tree.id}
                        data-testid={`toc-board-item-${tree.id}`}
                        className={`group rounded-[10px] border p-3.5 transition-colors ${
                          isCurrent
                            ? "border-[rgba(226,180,109,0.62)] bg-[rgba(226,180,109,0.12)]"
                            : "border-[var(--glass-border)] bg-[var(--surface-inner)] hover:border-[rgba(226,180,109,0.36)]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => loadBoardRecord(tree)}
                            className="flex-1 min-w-0 text-left cursor-pointer bg-transparent border-0 p-0"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-ui text-[0.54rem] uppercase tracking-[0.16em] text-[#E2B46D]">
                                {FRAMEWORK_LABELS[tree.frameworkType] ?? "Whiteboard"}
                              </span>
                              <span className="font-ui tabular-nums text-[0.56rem] text-[#b8aa96]/75">
                                {tree.updatedAt.slice(0, 10)}
                              </span>
                            </div>
                            <div className="mt-1 font-editorial text-[1.12rem] leading-snug text-[#f4efe6] truncate">
                              {tree.title}
                            </div>
                            <p className="mt-1 font-reading text-[0.82rem] leading-snug text-[#b8aa96] line-clamp-2">
                              {extractTocSummaryInsight(tree)}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteBoard(tree.id);
                            }}
                            data-testid={`toc-delete-board-${tree.id}`}
                            aria-label={`Delete ${tree.title}`}
                            className="opacity-55 group-hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-1 text-[#b8aa96] hover:text-[var(--danger-ember)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {trees.length === 0 && (
                    <div className="py-12 px-4 text-center font-reading text-[0.94rem] text-[#b8aa96]">
                      No saved boards yet. Start mapping on the canvas and your work saves
                      automatically.
                    </div>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </motion.div>

      <TocFieldGuideDrawer open={fieldGuideOpen} onClose={() => setFieldGuideOpen(false)} />
    </>
  );
}
