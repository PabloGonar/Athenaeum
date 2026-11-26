import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Highlighter, MessageSquarePlus, X } from "lucide-react";
import ePub, { type Book, type Rendition } from "epubjs";
import type { BookHighlight, PaperTint } from "../../types/athenaeum";

export interface EpubSearchMatch {
  cfi: string;
  excerpt: string;
}

interface EpubDocumentViewProps {
  bytes: ArrayBuffer;
  pageNumber: number;
  initialCfi?: string;
  zoom: number;
  tint: PaperTint;
  highlights: BookHighlight[];
  jumpToCfi?: { cfi: string; nonce: number } | null;
  searchQuery?: string;
  activeSearchMatch?: EpubSearchMatch | null;
  onSearchResultsChange?: (matches: EpubSearchMatch[], indexing: boolean) => void;
  onDocumentLoaded: (totalPages: number) => void;
  onLocationChange: (page: number, total: number, cfi: string) => void;
  onSaveHighlight: (payload: {
    quote: string;
    note: string;
    pageNumber: number;
    cfiRange: string;
    color?: BookHighlight["color"];
  }) => Promise<void> | void;
}

const EPUB_TINT_STYLES: Record<
  PaperTint,
  { background: string; color: string; frameBg: string }
> = {
  original: { background: "#f9f8f5", color: "#1c1f1d", frameBg: "#f9f8f5" },
  parchment: { background: "#f4ecd8", color: "#2b2419", frameBg: "#f4ecd8" },
  sage: { background: "#dce4db", color: "#1b2821", frameBg: "#dce4db" },
  obsidian: { background: "#101916", color: "#e6e3d8", frameBg: "#101916" },
};

export function EpubDocumentView({
  bytes,
  pageNumber,
  initialCfi,
  zoom,
  tint,
  highlights,
  jumpToCfi = null,
  searchQuery = "",
  activeSearchMatch = null,
  onSearchResultsChange,
  onDocumentLoaded,
  onLocationChange,
  onSaveHighlight,
}: EpubDocumentViewProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const appliedCfisRef = useRef<Set<string>>(new Set());
  const inlineNoteInputRef = useRef<HTMLInputElement | null>(null);
  const onSearchResultsChangeRef = useRef(onSearchResultsChange);
  onSearchResultsChangeRef.current = onSearchResultsChange;

  const [totalLocations, setTotalLocations] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, pageNumber));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    text: string;
    cfiRange: string;
    pageNumber: number;
  } | null>(null);
  const [noteInputOpen, setNoteInputOpen] = useState<boolean>(false);
  const [inlineNote, setInlineNote] = useState<string>("");
  const [savingSelection, setSavingSelection] = useState<boolean>(false);

  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    container.innerHTML = "";
    appliedCfisRef.current.clear();

    try {
      const book = ePub(bytes.slice(0));
      bookRef.current = book;

      const rendition = book.renderTo(container, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
      });
      renditionRef.current = rendition;

      rendition.on("selected", (cfiRange: string, contents: { window: Window }) => {
        const text = contents.window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
        if (text.length >= 2) {
          setNoteInputOpen(false);
          setInlineNote("");
          setPendingSelection({ text, cfiRange, pageNumber: pageRef.current });
        }
      });

      rendition.on(
        "relocated",
        (location: { start?: { cfi?: string; location?: number; percentage?: number } }) => {
          if (cancelled) return;
          const cfi = location.start?.cfi ?? "";
          const total = Math.max(1, book.locations.length() || 1);
          const locIdx =
            typeof location.start?.location === "number" && location.start.location >= 0
              ? location.start.location + 1
              : Math.max(1, Math.round((location.start?.percentage ?? 0) * total));
          const bounded = Math.max(1, Math.min(total, locIdx));
          setCurrentPage(bounded);
          onLocationChange(bounded, total, cfi);
        }
      );

      void book.ready
        .then(async () => {
          if (cancelled) return;
          await book.locations.generate(1200);
          if (cancelled) return;
          const total = Math.max(1, book.locations.length());
          setTotalLocations(total);
          onDocumentLoaded(total);

          if (initialCfi) {
            await rendition.display(initialCfi);
          } else if (pageNumber > 1 && total > 1) {
            const pct = Math.min(0.99, (pageNumber - 1) / total);
            const targetCfi = book.locations.cfiFromPercentage(pct);
            await rendition.display(targetCfi || undefined);
          } else {
            await rendition.display();
          }
          if (!cancelled) setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Failed opening EPUB");
          setLoading(false);
        });

      return () => {
        cancelled = true;
        try {
          rendition.destroy();
          book.destroy();
        } catch {
          // Ignore teardown error
        }
        renditionRef.current = null;
        bookRef.current = null;
        appliedCfisRef.current.clear();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed initializing EPUB");
      setLoading(false);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const palette = EPUB_TINT_STYLES[tint];
    rendition.themes.override("background", palette.background);
    rendition.themes.override("color", palette.color);
    rendition.themes.fontSize(`${Math.round(zoom * 100)}%`);
  }, [tint, zoom, loading]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || loading) return;

    const desiredCfis = new Set(highlights.map((h) => h.cfiRange).filter(Boolean));
    for (const existing of Array.from(appliedCfisRef.current)) {
      if (!desiredCfis.has(existing)) {
        try {
          rendition.annotations.remove(existing, "highlight");
        } catch {
          // Ignore removal error
        }
        appliedCfisRef.current.delete(existing);
      }
    }

    for (const hl of highlights) {
      if (!hl.cfiRange || appliedCfisRef.current.has(hl.cfiRange)) continue;
      try {
        rendition.annotations.highlight(
          hl.cfiRange,
          {},
          undefined,
          "athenaeum-epub-hl",
          { fill: "#E2B46D", "fill-opacity": "0.30" }
        );
        appliedCfisRef.current.add(hl.cfiRange);
      } catch {
        // Ignore duplicate annotation
      }
    }
  }, [highlights, loading]);

  useEffect(() => {
    if (!jumpToCfi?.cfi || loading) return;
    const rendition = renditionRef.current;
    if (!rendition) return;
    void rendition.display(jumpToCfi.cfi);
  }, [jumpToCfi, loading]);

  useEffect(() => {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!book || !rendition || loading) return;
    if (Math.abs(pageNumber - pageRef.current) >= 1 && totalLocations > 1) {
      const pct = Math.max(0, Math.min(0.999, (pageNumber - 1) / totalLocations));
      const cfi = book.locations.cfiFromPercentage(pct);
      if (cfi) {
        void rendition.display(cfi);
      }
    }
  }, [pageNumber, totalLocations, loading]);

  useEffect(() => {
    const q = searchQuery.trim();
    const book = bookRef.current;
    if (!book || loading || !q) {
      onSearchResultsChangeRef.current?.([], false);
      return;
    }

    let cancelled = false;
    const runSearch = async () => {
      onSearchResultsChangeRef.current?.([], true);
      const matches: EpubSearchMatch[] = [];
      const spineItems = (book.spine as unknown as { spineItems?: Array<{
        load: (loader: unknown) => Promise<unknown>;
        find: (query: string) => Array<{ cfi: string; excerpt: string }>;
        unload: () => void;
      }> }).spineItems ?? [];

      for (const item of spineItems) {
        if (cancelled) return;
        try {
          await item.load(book.load.bind(book));
          const found = item.find(q);
          for (const hit of found) {
            matches.push({ cfi: hit.cfi, excerpt: hit.excerpt });
          }
          item.unload();
        } catch {
          // Skip unsearchable spine sections
        }
      }
      if (!cancelled) {
        onSearchResultsChangeRef.current?.(matches, false);
      }
    };

    const timer = window.setTimeout(() => void runSearch(), 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, loading]);

  useEffect(() => {
    if (!activeSearchMatch?.cfi || loading) return;
    void renditionRef.current?.display(activeSearchMatch.cfi);
  }, [activeSearchMatch, loading]);

  useEffect(() => {
    if (noteInputOpen) {
      window.setTimeout(() => inlineNoteInputRef.current?.focus(), 20);
    }
  }, [noteInputOpen]);

  const dismissPending = () => {
    setPendingSelection(null);
    setNoteInputOpen(false);
    setInlineNote("");
  };

  const commitSelectionHighlight = async (noteText: string) => {
    if (!pendingSelection || savingSelection) return;
    const captured = pendingSelection;
    setSavingSelection(true);
    try {
      await onSaveHighlight({
        quote: captured.text,
        note: noteText.trim(),
        pageNumber: captured.pageNumber,
        cfiRange: captured.cfiRange,
        color: "amber",
      });
      dismissPending();
    } finally {
      setSavingSelection(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden px-8 py-6 flex flex-col items-center justify-center">
        {loading && (
          <div className="font-reading text-[1.05rem] text-[var(--text-muted)]">
            Opening EPUB volume...
          </div>
        )}

        {error && (
          <div className="max-w-md smoked-glass rounded-[12px] p-6 text-center">
            <div className="font-editorial text-[1.25rem] text-[var(--text-ivory)]">
              Unable to open EPUB
            </div>
            <p className="mt-2 font-reading text-[0.94rem] text-[var(--text-muted)]">{error}</p>
          </div>
        )}

        <div
          data-testid="epub-page-frame"
          data-paper-tint={tint}
          className={`relative w-full max-w-[780px] h-full rounded-[8px] shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-[rgba(214,224,212,0.12)] overflow-hidden transition-colors duration-300 ${
            loading || error ? "opacity-0 pointer-events-none h-0" : "opacity-100"
          }`}
          style={{ backgroundColor: EPUB_TINT_STYLES[tint].frameBg }}
        >
          <div ref={viewerRef} className="h-full w-full" />

          {pendingSelection && (
            <div
              data-testid="floating-selection-pill"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).tagName !== "INPUT") {
                  e.preventDefault();
                }
                e.stopPropagation();
              }}
              className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-[4px] border border-[rgba(226,180,109,0.5)] bg-[rgba(24,22,20,0.96)] px-1.5 py-1 shadow-[0_14px_34px_rgba(0,0,0,0.65)] backdrop-blur-md"
            >
              {!noteInputOpen ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={savingSelection}
                    data-testid="floating-highlight-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitSelectionHighlight("")}
                    className="cursor-pointer rounded-[3px] border-0 bg-[rgba(226,180,109,0.16)] px-3 py-1 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#f4efe6] transition-colors hover:bg-[rgba(226,180,109,0.3)]"
                  >
                    <Highlighter className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.7} />
                    Highlight
                  </button>
                  <span className="h-3.5 w-[1px] bg-[rgba(222,188,132,0.22)]" />
                  <button
                    type="button"
                    disabled={savingSelection}
                    data-testid="floating-add-note-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setNoteInputOpen(true)}
                    className="cursor-pointer rounded-[3px] border-0 bg-transparent px-3 py-1 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#d9ccb8] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[#f4efe6]"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.6} />
                    + Note
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void commitSelectionHighlight(inlineNote);
                  }}
                  className="flex items-center gap-1.5 px-1.5 py-0.5"
                >
                  <Highlighter className="h-3.5 w-3.5 shrink-0 text-[#E2B46D]" strokeWidth={1.7} />
                  <input
                    ref={inlineNoteInputRef}
                    type="text"
                    value={inlineNote}
                    onChange={(e) => setInlineNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        dismissPending();
                      }
                    }}
                    placeholder="Add margin note... (Enter to save)"
                    data-testid="floating-note-input"
                    className="w-[220px] bg-transparent border-0 font-reading text-[0.86rem] text-[#f4efe6] placeholder:text-[#b8aa96]/70 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={savingSelection}
                    data-testid="floating-note-save-btn"
                    aria-label="Save highlight with note"
                    className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.2)] p-1 text-[#f4efe6] hover:bg-[rgba(226,180,109,0.34)]"
                  >
                    <Check className="h-3 w-3 text-[#E2B46D]" strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={dismissPending}
                    aria-label="Cancel highlight note"
                    className="cursor-pointer rounded-[3px] border-0 bg-transparent p-1 text-[#b8aa96] hover:text-[#f4efe6]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-center gap-6 py-2.5 border-t border-[rgba(214,224,212,0.08)] bg-[var(--surface-inner)] backdrop-blur-md">
        <button
          type="button"
          onClick={() => void renditionRef.current?.prev()}
          data-testid="reader-prev-page"
          className="cursor-pointer bg-transparent border-0 flex items-center gap-1.5 font-ui text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)]"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.6} />
          Previous
        </button>

        <div
          data-testid="reader-page-indicator"
          className="font-ui tabular-nums text-[0.72rem] tracking-[0.12em] text-[var(--text-muted)]"
        >
          Page <span className="text-[var(--text-ivory)]">{currentPage}</span> of{" "}
          <span>{totalLocations}</span>
        </div>

        <button
          type="button"
          onClick={() => void renditionRef.current?.next()}
          data-testid="reader-next-page"
          className="cursor-pointer bg-transparent border-0 flex items-center gap-1.5 font-ui text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)]"
        >
          Next
          <ChevronRight className="h-4 w-4" strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
