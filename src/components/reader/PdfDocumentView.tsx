import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Highlighter, MessageSquarePlus, X } from "lucide-react";
import {
  AnnotationLayer,
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { BookHighlight, HighlightRect, PaperTint } from "../../types/athenaeum";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfSearchMatch {
  pageNumber: number;
  matchIndexOnPage: number;
}

export interface SaveHighlightPayload {
  quote: string;
  note: string;
  pageNumber: number;
  rects: HighlightRect[];
  color?: BookHighlight["color"];
}

interface PdfDocumentViewProps {
  bytes: ArrayBuffer;
  pageNumber: number;
  zoom: number;
  tint: PaperTint;
  initialScrollOffset: number;
  highlights: BookHighlight[];
  pulsingHighlightId?: string | null;
  jumpToHighlight?: {
    id: string;
    pageNumber: number;
    rects?: HighlightRect[];
    nonce: number;
  } | null;
  searchQuery?: string;
  activeSearchMatch?: PdfSearchMatch | null;
  onSearchResultsChange?: (matches: PdfSearchMatch[], indexing: boolean) => void;
  onDocumentLoaded: (totalPages: number) => void;
  onPageChange: (nextPage: number) => void;
  onScrollOffsetChange: (offset: number) => void;
  onSaveHighlight: (payload: SaveHighlightPayload) => Promise<void> | void;
  onOpenExternalUrl: (url: string) => void;
}

const TINT_CANVAS_FILTER: Record<PaperTint, string> = {
  original: "none",
  parchment: "sepia(0.28) brightness(0.96) contrast(0.97)",
  sage: "sepia(0.18) hue-rotate(70deg) saturate(0.75) brightness(0.92)",
  obsidian: "invert(0.9) hue-rotate(180deg) brightness(0.9) contrast(0.96)",
};

const TINT_FRAME_BG: Record<PaperTint, string> = {
  original: "#f9f8f5",
  parchment: "#f3ead4",
  sage: "#dde5dc",
  obsidian: "#111917",
};

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function collectLocalSpanRects(
  range: Range,
  span: HTMLSpanElement,
  frameRect: DOMRect
): PixelRect[] {
  const spanRect = span.getBoundingClientRect();
  if (spanRect.width < 1 || spanRect.height < 1) return [];

  const isStartSpan = span.contains(range.startContainer);
  const isEndSpan = span.contains(range.endContainer);

  const localRange = document.createRange();
  try {
    if (isStartSpan) {
      localRange.setStart(range.startContainer, range.startOffset);
    } else {
      localRange.setStart(span, 0);
    }
    if (isEndSpan) {
      localRange.setEnd(range.endContainer, range.endOffset);
    } else {
      localRange.setEnd(span, span.childNodes.length);
    }
  } catch {
    return [];
  }

  if (localRange.toString().trim().length === 0) {
    return [];
  }

  const rawRects =
    !isStartSpan && !isEndSpan
      ? [spanRect]
      : Array.from(localRange.getClientRects()).filter(
          (r) => r.width >= 1 && r.height >= 1 && r.height <= spanRect.height * 2.2 + 6
        );

  const sourceRects = rawRects.length > 0 ? rawRects : [spanRect];
  const results: PixelRect[] = [];

  for (const r of sourceRects) {
    const clampedLeft = clamp(Math.max(r.left, spanRect.left) - frameRect.left, 0, frameRect.width);
    const clampedRight = clamp(Math.min(r.right, spanRect.right) - frameRect.left, 0, frameRect.width);
    const clampedTop = clamp(Math.max(r.top, spanRect.top) - frameRect.top, 0, frameRect.height);
    const clampedBottom = clamp(Math.min(r.bottom, spanRect.bottom) - frameRect.top, 0, frameRect.height);

    if (clampedRight - clampedLeft >= 1 && clampedBottom - clampedTop >= 1) {
      results.push({
        left: clampedLeft,
        top: clampedTop,
        right: clampedRight,
        bottom: clampedBottom,
      });
    }
  }
  return results;
}

function computeNormalizedRects(
  range: Range,
  frameRect: DOMRect,
  textLayerEl: HTMLElement | null
): HighlightRect[] {
  if (frameRect.width <= 0 || frameRect.height <= 0) return [];

  const pixelRects: PixelRect[] = [];

  if (textLayerEl) {
    const spans = Array.from(textLayerEl.querySelectorAll("span"));
    for (const span of spans) {
      if (!(span.textContent ?? "").trim()) continue;
      let intersects = false;
      try {
        intersects = range.intersectsNode(span);
      } catch {
        intersects = false;
      }
      if (!intersects) continue;
      pixelRects.push(...collectLocalSpanRects(range, span, frameRect));
    }
  }

  if (pixelRects.length === 0) {
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      const left = clamp(r.left - frameRect.left, 0, frameRect.width);
      const right = clamp(r.right - frameRect.left, 0, frameRect.width);
      const top = clamp(r.top - frameRect.top, 0, frameRect.height);
      const bottom = clamp(r.bottom - frameRect.top, 0, frameRect.height);
      if (right - left >= 1 && bottom - top >= 1) {
        pixelRects.push({ left, top, right, bottom });
      }
    }
  }

  if (pixelRects.length === 0) return [];

  pixelRects.sort((a, b) => (Math.abs(a.top - b.top) < 4 ? a.left - b.left : a.top - b.top));

  const mergedPx: PixelRect[] = [];
  for (const rect of pixelRects) {
    const prev = mergedPx[mergedPx.length - 1];
    if (
      prev &&
      Math.abs(prev.top - rect.top) < 4 &&
      Math.abs((prev.bottom - prev.top) - (rect.bottom - rect.top)) < 10 &&
      rect.left <= prev.right + 14
    ) {
      prev.left = Math.min(prev.left, rect.left);
      prev.right = Math.max(prev.right, rect.right);
      prev.top = Math.min(prev.top, rect.top);
      prev.bottom = Math.max(prev.bottom, rect.bottom);
    } else {
      mergedPx.push({ ...rect });
    }
  }

  return mergedPx.map((r) => ({
    left: round3((r.left / frameRect.width) * 100),
    top: round3((r.top / frameRect.height) * 100),
    width: round3(((r.right - r.left) / frameRect.width) * 100),
    height: round3(((r.bottom - r.top) / frameRect.height) * 100),
  }));
}

export function PdfDocumentView({
  bytes,
  pageNumber,
  zoom,
  tint,
  initialScrollOffset,
  highlights,
  pulsingHighlightId = null,
  jumpToHighlight = null,
  searchQuery = "",
  activeSearchMatch = null,
  onSearchResultsChange,
  onDocumentLoaded,
  onPageChange,
  onScrollOffsetChange,
  onSaveHighlight,
  onOpenExternalUrl,
}: PdfDocumentViewProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: 680,
    height: 880,
  });
  const [viewportWidthBucket, setViewportWidthBucket] = useState<number>(860);

  const [selectionPopover, setSelectionPopover] = useState<{
    text: string;
    pageNumber: number;
    rects: HighlightRect[];
    x: number;
    y: number;
  } | null>(null);
  const [noteInputOpen, setNoteInputOpen] = useState<boolean>(false);
  const [inlineNote, setInlineNote] = useState<string>("");
  const [savingSelection, setSavingSelection] = useState<boolean>(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inlineNoteInputRef = useRef<HTMLInputElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const restoredScrollRef = useRef(false);
  const pageTextsCacheRef = useRef<string[] | null>(null);
  const pageTextsDocRef = useRef<PDFDocumentProxy | null>(null);

  const onDocumentLoadedRef = useRef(onDocumentLoaded);
  onDocumentLoadedRef.current = onDocumentLoaded;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const onOpenExternalUrlRef = useRef(onOpenExternalUrl);
  onOpenExternalUrlRef.current = onOpenExternalUrl;
  const onSearchResultsChangeRef = useRef(onSearchResultsChange);
  onSearchResultsChangeRef.current = onSearchResultsChange;
  const initialScrollOffsetRef = useRef(initialScrollOffset);
  initialScrollOffsetRef.current = initialScrollOffset;
  const applyVisualHighlightsRef = useRef<() => void>(() => {});
  const applySearchHighlightsRef = useRef<() => void>(() => {});

  // Observe center column width changes so the PDF page refits cleanly without horizontal clipping
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: number | null = null;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? el.clientWidth;
      const bucket = Math.round(w / 16) * 16;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setViewportWidthBucket((prev) => (Math.abs(prev - bucket) >= 16 ? bucket : prev));
      }, 160);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Load PDF document strictly once per bytes buffer so re-renders never destroy the worker transport
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    restoredScrollRef.current = false;
    pageTextsCacheRef.current = null;
    pageTextsDocRef.current = null;

    const copy = bytes.slice(0);
    const task = getDocument({ data: new Uint8Array(copy) });
    task.promise
      .then((doc) => {
        if (cancelled) {
          void task.destroy();
          return;
        }
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setLoading(false);
        onDocumentLoadedRef.current(doc.numPages);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed loading PDF");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [bytes]);

  const pageHighlights = useMemo(
    () => highlights.filter((h) => h.pageNumber === pageNumber),
    [highlights, pageNumber]
  );

  const rectHighlights = useMemo(
    () => pageHighlights.filter((h) => Array.isArray(h.rects) && h.rects.length > 0),
    [pageHighlights]
  );
  const legacySpanHighlights = useMemo(
    () =>
      pageHighlights.filter(
        (h) => (!h.rects || h.rects.length === 0) && h.quote.trim().length > 0
      ),
    [pageHighlights]
  );

  const applyVisualHighlights = useCallback(() => {
    const container = textLayerRef.current;
    if (!container) return;
    const spans = Array.from(container.querySelectorAll("span"));
    for (const span of spans) {
      span.classList.remove("pdf-hl-brass", "pdf-hl-sage", "pdf-hl-amber");
    }
    if (legacySpanHighlights.length === 0) return;

    for (const hl of legacySpanHighlights) {
      const q = normalizeText(hl.quote);
      if (q.length < 3) continue;
      const cls =
        hl.color === "sage"
          ? "pdf-hl-sage"
          : hl.color === "amber"
          ? "pdf-hl-amber"
          : "pdf-hl-brass";

      for (const span of spans) {
        const st = normalizeText(span.textContent || "");
        if (st.length < 3) continue;
        if (q.includes(st) || st.includes(q)) {
          span.classList.add(cls);
        }
      }
    }
  }, [legacySpanHighlights]);

  applyVisualHighlightsRef.current = applyVisualHighlights;

  const applySearchHighlights = useCallback(() => {
    const container = textLayerRef.current;
    if (!container) return;
    const spans = Array.from(container.querySelectorAll("span"));
    for (const span of spans) {
      span.classList.remove("pdf-search-match", "pdf-search-match-active");
    }
    const q = normalizeText(searchQuery);
    if (!q) return;

    let matchCounter = 0;
    let firstActiveSpan: HTMLSpanElement | null = null;
    for (const span of spans) {
      const st = normalizeText(span.textContent || "");
      if (!st) continue;
      if (st.includes(q)) {
        span.classList.add("pdf-search-match");
        if (
          activeSearchMatch &&
          activeSearchMatch.pageNumber === pageNumber &&
          matchCounter === activeSearchMatch.matchIndexOnPage
        ) {
          span.classList.add("pdf-search-match-active");
          firstActiveSpan = span;
        }
        matchCounter += 1;
      }
    }
    if (!firstActiveSpan && activeSearchMatch?.pageNumber === pageNumber) {
      const firstMatch = container.querySelector<HTMLSpanElement>("span.pdf-search-match");
      if (firstMatch) {
        firstMatch.classList.add("pdf-search-match-active");
        firstActiveSpan = firstMatch;
      }
    }
    if (firstActiveSpan && scrollContainerRef.current) {
      firstActiveSpan.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchQuery, activeSearchMatch, pageNumber]);

  applySearchHighlightsRef.current = applySearchHighlights;

  useEffect(() => {
    const q = normalizeText(searchQuery);
    if (!pdfDoc || !q) {
      onSearchResultsChangeRef.current?.([], false);
      return;
    }

    let cancelled = false;
    const runSearch = async () => {
      onSearchResultsChangeRef.current?.([], true);
      let texts = pageTextsCacheRef.current;
      if (!texts || pageTextsDocRef.current !== pdfDoc) {
        texts = new Array<string>(pdfDoc.numPages).fill("");
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          if (cancelled) return;
          try {
            const page = await pdfDoc.getPage(p);
            const content = await page.getTextContent();
            const joined = content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ");
            texts[p - 1] = normalizeText(joined);
          } catch {
            texts[p - 1] = "";
          }
          if (p % 10 === 0) {
            await new Promise<void>((r) => window.setTimeout(r, 0));
          }
        }
        if (cancelled) return;
        pageTextsCacheRef.current = texts;
        pageTextsDocRef.current = pdfDoc;
      }

      const matches: PdfSearchMatch[] = [];
      for (let i = 0; i < texts.length; i++) {
        const hay = texts[i];
        if (!hay) continue;
        let idx = hay.indexOf(q);
        let pageMatchIdx = 0;
        while (idx !== -1) {
          matches.push({ pageNumber: i + 1, matchIndexOnPage: pageMatchIdx });
          pageMatchIdx += 1;
          idx = hay.indexOf(q, idx + Math.max(1, q.length));
        }
      }
      if (!cancelled) {
        onSearchResultsChangeRef.current?.(matches, false);
      }
    };

    const timer = window.setTimeout(() => void runSearch(), 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pdfDoc, searchQuery]);

  // Render active PDF page + exact-geometry PDF.js 6.x TextLayer + clickable AnnotationLayer
  useEffect(() => {
    if (!pdfDoc || totalPages <= 0) return;
    const safePage = Math.max(1, Math.min(totalPages, pageNumber));
    let cancelled = false;
    setSelectionPopover(null);
    setNoteInputOpen(false);
    setInlineNote("");

    const resolvePdfDestination = async (dest: string | unknown[]) => {
      try {
        let explicitDest: unknown[] | null = null;
        if (typeof dest === "string") {
          explicitDest = (await pdfDoc.getDestination(dest)) as unknown[] | null;
        } else if (Array.isArray(dest)) {
          explicitDest = dest;
        }
        if (!explicitDest || explicitDest.length === 0) return;
        const destRef = explicitDest[0];
        let targetPageIndex: number | null = null;
        if (typeof destRef === "number") {
          targetPageIndex = destRef;
        } else if (destRef && typeof destRef === "object") {
          targetPageIndex = await pdfDoc.getPageIndex(destRef as { num: number; gen: number });
        }
        if (targetPageIndex !== null && Number.isFinite(targetPageIndex)) {
          const targetPage = clamp(targetPageIndex + 1, 1, pdfDoc.numPages);
          onPageChangeRef.current(targetPage);
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
          }
        }
      } catch {
        // Ignore malformed PDF destinations gracefully
      }
    };

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }
        const page = await pdfDoc.getPage(safePage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = scrollContainerRef.current?.clientWidth || viewportWidthBucket || 860;
        const targetWidth = Math.max(320, Math.min(920, containerWidth - 56));
        const fitScale = targetWidth / baseViewport.width;
        const effectiveScale = Math.max(0.55, Math.min(2.6, fitScale * zoom));

        const viewport = page.getViewport({ scale: effectiveScale });
        const pageW = Math.round(viewport.width);
        const pageH = Math.round(viewport.height);
        setPageSize({ width: pageW, height: pageH });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${pageW}px`;
        canvas.style.height = `${pageH}px`;

        const renderTask = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        // Render PDF.js 6.x TextLayer with exact --scale-factor / --total-scale-factor & dimensions
        const layerEl = textLayerRef.current;
        if (layerEl) {
          layerEl.innerHTML = "";
          layerEl.classList.remove("selecting");
          layerEl.style.setProperty("--scale-factor", String(effectiveScale));
          layerEl.style.setProperty("--total-scale-factor", String(effectiveScale));
          layerEl.style.width = `${pageW}px`;
          layerEl.style.height = `${pageH}px`;

          const textContent = await page.getTextContent();
          if (cancelled) return;

          const textLayer = new TextLayer({
            textContentSource: textContent,
            container: layerEl,
            viewport,
          });
          await textLayer.render();
          if (!cancelled) {
            applyVisualHighlightsRef.current();
            applySearchHighlightsRef.current();
          }
        }

        // Render PDF.js AnnotationLayer above TextLayer (pointer-events: none except links)
        const annotEl = annotationLayerRef.current;
        if (annotEl) {
          annotEl.innerHTML = "";
          annotEl.style.setProperty("--scale-factor", String(effectiveScale));
          annotEl.style.setProperty("--total-scale-factor", String(effectiveScale));
          annotEl.style.width = `${pageW}px`;
          annotEl.style.height = `${pageH}px`;

          const annotations = await page.getAnnotations({ intent: "display" });
          if (cancelled) return;

          if (annotations.length > 0) {
            const linkService = {
              externalLinkEnabled: true,
              pagesCount: pdfDoc.numPages,
              page: safePage,
              rotation: 0,
              isInPresentationMode: false,
              getDestinationHash: () => "#",
              getAnchorUrl: (anchor: string) => anchor || "#",
              addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
                link.href = url;
                link.title = url;
                link.target = "_blank";
                link.rel = "noopener noreferrer nofollow";
                link.dataset.externalUrl = url;
              },
              goToDestination: (dest: string | unknown[]) => resolvePdfDestination(dest),
              goToPage: (val: number | string) => {
                const parsed = typeof val === "number" ? val : Number.parseInt(String(val), 10);
                if (Number.isFinite(parsed) && parsed >= 1) {
                  onPageChangeRef.current(clamp(parsed, 1, pdfDoc.numPages));
                  if (scrollContainerRef.current) {
                    scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }
              },
              goToXY: (targetPage: number) => {
                if (Number.isFinite(targetPage) && targetPage >= 1) {
                  onPageChangeRef.current(clamp(targetPage, 1, pdfDoc.numPages));
                }
              },
              executeNamedAction: (action: string) => {
                if (action === "NextPage") {
                  onPageChangeRef.current(clamp(safePage + 1, 1, pdfDoc.numPages));
                } else if (action === "PrevPage") {
                  onPageChangeRef.current(clamp(safePage - 1, 1, pdfDoc.numPages));
                } else if (action === "FirstPage") {
                  onPageChangeRef.current(1);
                } else if (action === "LastPage") {
                  onPageChangeRef.current(pdfDoc.numPages);
                }
              },
              setHash: () => {},
              executeSetOCGState: async () => {},
              getAttachmentContent: async () => null,
            };

            const annotViewport = viewport.clone({ dontFlip: true });
            const annotationLayer = new AnnotationLayer({
              div: annotEl,
              accessibilityManager: null,
              annotationCanvasMap: null,
              annotationEditorUIManager: null,
              page,
              viewport: annotViewport,
              structTreeLayer: null,
              commentManager: null,
              linkService,
              annotationStorage: null,
            });
            await annotationLayer.render({
              viewport: annotViewport,
              div: annotEl,
              annotations,
              page,
              linkService: linkService as never,
              renderForms: false,
            });
          }
        }

        if (
          !restoredScrollRef.current &&
          scrollContainerRef.current &&
          initialScrollOffsetRef.current > 0
        ) {
          scrollContainerRef.current.scrollTop = initialScrollOffsetRef.current;
          restoredScrollRef.current = true;
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("cancel")) {
          setError(msg);
        }
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, totalPages, pageNumber, zoom, viewportWidthBucket]);

  useEffect(() => {
    applyVisualHighlights();
  }, [applyVisualHighlights]);

  useEffect(() => {
    applySearchHighlights();
  }, [applySearchHighlights]);

  useEffect(() => {
    if (!jumpToHighlight || jumpToHighlight.pageNumber !== pageNumber) return;
    const container = scrollContainerRef.current;
    const frame = pageFrameRef.current;
    if (!container || !frame) return;
    const firstRect = jumpToHighlight.rects?.[0];
    if (!firstRect) return;

    const timer = window.setTimeout(() => {
      const targetY =
        frame.offsetTop + (firstRect.top / 100) * frame.clientHeight - container.clientHeight * 0.35;
      container.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [jumpToHighlight, pageNumber, pageSize.height]);

  useEffect(() => {
    if (noteInputOpen) {
      window.setTimeout(() => inlineNoteInputRef.current?.focus(), 20);
    }
  }, [noteInputOpen]);

  const dismissSelectionPopover = useCallback(() => {
    setSelectionPopover(null);
    setNoteInputOpen(false);
    setInlineNote("");
  }, []);

  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (popoverRef.current?.contains(e.target as Node)) {
      return;
    }
    textLayerRef.current?.classList.add("selecting");
    if (selectionPopover) {
      dismissSelectionPopover();
    }
  };

  const handleContainerMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    textLayerRef.current?.classList.remove("selecting");
    if (popoverRef.current?.contains(e.target as Node)) {
      return;
    }
    const frameEl = pageFrameRef.current;
    if (!frameEl) return;

    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!text || text.length < 2 || !sel || sel.rangeCount === 0) {
      dismissSelectionPopover();
      return;
    }

    const range = sel.getRangeAt(0);
    if (
      !frameEl.contains(range.commonAncestorContainer) &&
      !range.intersectsNode(frameEl)
    ) {
      dismissSelectionPopover();
      return;
    }

    const frameRect = frameEl.getBoundingClientRect();
    const rects = computeNormalizedRects(range, frameRect, textLayerRef.current);
    const bounding = range.getBoundingClientRect();
    if (rects.length === 0 && bounding.width === 0 && bounding.height === 0) {
      dismissSelectionPopover();
      return;
    }

    const anchorTopPx =
      rects.length > 0 ? (rects[0].top / 100) * frameRect.height : bounding.top - frameRect.top;
    const anchorBottomPx =
      rects.length > 0
        ? ((rects[rects.length - 1].top + rects[rects.length - 1].height) / 100) * frameRect.height
        : bounding.bottom - frameRect.top;
    const anchorCenterX =
      rects.length > 0
        ? ((rects[0].left + rects[0].width / 2) / 100) * frameRect.width
        : bounding.width > 0
        ? bounding.left - frameRect.left + bounding.width / 2
        : frameRect.width / 2;

    const x = clamp(anchorCenterX, 118, Math.max(118, frameRect.width - 118));
    const preferredTop = anchorTopPx - 46;
    const y =
      preferredTop >= 8
        ? preferredTop
        : clamp(anchorBottomPx + 10, 8, Math.max(8, frameRect.height - 52));

    setNoteInputOpen(false);
    setInlineNote("");
    setSelectionPopover({
      text,
      pageNumber,
      rects,
      x,
      y,
    });
  };

  const commitSelectionHighlight = async (noteText: string) => {
    if (!selectionPopover || savingSelection) return;
    const captured = selectionPopover;
    setSavingSelection(true);
    try {
      await onSaveHighlight({
        quote: captured.text,
        note: noteText.trim(),
        pageNumber: captured.pageNumber,
        rects: captured.rects,
        color: "amber",
      });
      dismissSelectionPopover();
      window.getSelection()?.removeAllRanges();
    } finally {
      setSavingSelection(false);
    }
  };

  const handleAnnotationLayerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement | null)?.closest("a");
    if (!anchor) return;
    const externalUrl =
      anchor.dataset.externalUrl ||
      (anchor.getAttribute("href") &&
      /^(https?:|mailto:)/i.test(anchor.getAttribute("href") ?? "")
        ? anchor.getAttribute("href")
        : null);
    if (externalUrl) {
      e.preventDefault();
      e.stopPropagation();
      onOpenExternalUrlRef.current(externalUrl);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={(e) => onScrollOffsetChange(e.currentTarget.scrollTop)}
        onMouseDown={handleContainerMouseDown}
        onMouseUp={handleContainerMouseUp}
        data-testid="pdf-scroll-container"
        className="flex-1 overflow-y-auto px-6 py-6 flex flex-col items-center"
      >
        {loading && (
          <div className="my-auto py-20 font-reading text-[1.05rem] text-[var(--text-muted)]">
            Illuminating pages...
          </div>
        )}

        {error && (
          <div className="my-auto max-w-md smoked-glass rounded-[12px] p-6 text-center">
            <div className="font-editorial text-[1.25rem] text-[var(--text-ivory)]">
              Unable to render document
            </div>
            <p className="mt-2 font-reading text-[0.94rem] text-[var(--text-muted)]">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div
            ref={pageFrameRef}
            data-testid="pdf-page-frame"
            data-paper-tint={tint}
            className="relative rounded-[6px] shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-[rgba(214,224,212,0.12)] transition-colors duration-300"
            style={{
              width: pageSize.width,
              height: pageSize.height,
              backgroundColor: TINT_FRAME_BG[tint],
            }}
          >
            <canvas
              ref={canvasRef}
              className="relative z-0 block rounded-[6px] transition-[filter] duration-300"
              style={{ filter: TINT_CANVAS_FILTER[tint] }}
            />

            {/* Persistent Warm-Amber Highlight Overlays */}
            <div
              data-testid="pdf-highlight-overlay"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[6px]"
              style={{ mixBlendMode: tint === "obsidian" ? "normal" : "multiply" }}
            >
              {rectHighlights.map((hl) => {
                const isPulsing = pulsingHighlightId === hl.id;
                const fillColor =
                  hl.color === "sage"
                    ? "rgba(143, 184, 163, 0.30)"
                    : "rgba(226, 180, 109, 0.28)";
                return (hl.rects ?? []).map((rect, idx) => (
                  <div
                    key={`${hl.id}-${idx}`}
                    data-testid="pdf-highlight-rect"
                    data-highlight-id={hl.id}
                    className={`absolute rounded-[2px] ${isPulsing ? "pdf-hl-pulse" : ""}`}
                    style={{
                      left: `${rect.left}%`,
                      top: `${rect.top}%`,
                      width: `${rect.width}%`,
                      height: `${rect.height}%`,
                      backgroundColor: fillColor,
                    }}
                  />
                ));
              })}
            </div>

            {/* Exact-Geometry PDF.js 6.x Selectable TextLayer */}
            <div
              ref={textLayerRef}
              data-testid="pdf-text-layer"
              className="textLayer pdf-text-layer absolute inset-0 z-20 rounded-[6px]"
            />

            {/* Clickable PDF AnnotationLayer (pointer-events: none except links) */}
            <div
              ref={annotationLayerRef}
              data-testid="pdf-annotation-layer"
              onClick={handleAnnotationLayerClick}
              className="annotationLayer pdf-annotation-layer absolute inset-0 z-30 overflow-hidden rounded-[6px]"
            />

            {/* Two-Action Floating Selection Bar: 1-Click Highlight + Inline Note */}
            {selectionPopover && (
              <div
                ref={popoverRef}
                data-testid="floating-selection-pill"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).tagName !== "INPUT") {
                    e.preventDefault();
                  }
                  e.stopPropagation();
                }}
                style={{
                  left: noteInputOpen
                    ? clamp(selectionPopover.x, 164, Math.max(164, pageSize.width - 164))
                    : selectionPopover.x,
                  top: selectionPopover.y,
                }}
                className="absolute z-40 -translate-x-1/2 rounded-[4px] border border-[rgba(226,180,109,0.5)] bg-[rgba(24,22,20,0.96)] px-1.5 py-1 shadow-[0_14px_34px_rgba(0,0,0,0.65)] backdrop-blur-md"
              >
                {!noteInputOpen ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={savingSelection}
                      data-testid="floating-highlight-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => void commitSelectionHighlight("")}
                      className="cursor-pointer rounded-[3px] border-0 bg-[rgba(226,180,109,0.16)] px-3 py-1 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#f4efe6] transition-colors hover:bg-[rgba(226,180,109,0.3)] disabled:opacity-50"
                    >
                      <Highlighter className="h-3.5 w-3.5 text-[#E2B46D]" strokeWidth={1.7} />
                      Highlight
                    </button>

                    <span className="h-3.5 w-[1px] bg-[rgba(222,188,132,0.22)]" />

                    <button
                      type="button"
                      disabled={savingSelection}
                      data-testid="floating-add-note-btn"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => setNoteInputOpen(true)}
                      className="cursor-pointer rounded-[3px] border-0 bg-transparent px-3 py-1 flex items-center gap-1.5 font-ui text-[0.64rem] uppercase tracking-[0.14em] text-[#d9ccb8] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[#f4efe6] disabled:opacity-50"
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
                          dismissSelectionPopover();
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
                      className="cursor-pointer rounded-[3px] border border-[rgba(226,180,109,0.45)] bg-[rgba(226,180,109,0.2)] p-1 text-[#f4efe6] hover:bg-[rgba(226,180,109,0.34)] disabled:opacity-50"
                    >
                      <Check className="h-3 w-3 text-[#E2B46D]" strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={dismissSelectionPopover}
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
        )}
      </div>

      {/* Subtle Bottom Page Turn Bar */}
      {totalPages > 0 && (
        <div className="shrink-0 flex items-center justify-center gap-6 py-2.5 border-t border-[rgba(214,224,212,0.08)] bg-[var(--surface-inner)] backdrop-blur-md">
          <button
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => {
              onPageChange(Math.max(1, pageNumber - 1));
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }}
            data-testid="reader-prev-page"
            className="cursor-pointer bg-transparent border-0 flex items-center gap-1.5 font-ui text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)] disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.6} />
            Previous
          </button>

          <div
            data-testid="reader-page-indicator"
            className="font-ui tabular-nums text-[0.72rem] tracking-[0.12em] text-[var(--text-muted)]"
          >
            Page <span className="text-[var(--text-ivory)]">{pageNumber}</span> of{" "}
            <span>{totalPages}</span>
          </div>

          <button
            type="button"
            disabled={pageNumber >= totalPages}
            onClick={() => {
              onPageChange(Math.min(totalPages, pageNumber + 1));
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }}
            data-testid="reader-next-page"
            className="cursor-pointer bg-transparent border-0 flex items-center gap-1.5 font-ui text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-ivory-soft)] hover:text-[var(--text-ivory)] disabled:opacity-30"
          >
            Next
            <ChevronRight className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>
      )}
    </div>
  );
}
