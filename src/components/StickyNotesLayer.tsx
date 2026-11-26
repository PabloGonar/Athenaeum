import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive } from "lucide-react";
import type { StickyNoteItem } from "../types/athenaeum";

interface StickyNotesLayerProps {
  notes: StickyNoteItem[];
  selectedNoteId: string | null;
  draggingNoteId: string | null;
  isFocusMode?: boolean;
  onSelectNote: (id: string | null) => void;
  onUpdateNote: (note: StickyNoteItem) => void;
  onPromoteNote: (note: StickyNoteItem) => void;
  onDragStateChange: (noteId: string | null, pointerX: number, pointerY: number) => void;
  onDragEnd: (
    noteId: string,
    pointerX: number,
    pointerY: number,
    nextPercentX: number,
    nextPercentY: number
  ) => void;
}

interface ActiveDragSession {
  id: string;
  startClientX: number;
  startClientY: number;
  originLeftPx: number;
  originTopPx: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  noteWidth: number;
  noteHeight: number;
  containerLeft: number;
  containerTop: number;
  containerWidth: number;
  containerHeight: number;
  lastPctX: number;
  lastPctY: number;
  hasMoved: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function StickyNotesLayer({
  notes,
  selectedNoteId,
  draggingNoteId,
  isFocusMode = false,
  onSelectNote,
  onUpdateNote,
  onPromoteNote,
  onDragStateChange,
  onDragEnd,
}: StickyNotesLayerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const noteNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragSessionRef = useRef<ActiveDragSession | null>(null);
  const suppressChipClickRef = useRef<string | null>(null);

  // Only flips on drag start/end so pointermove causes zero React re-renders
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Brief bridge for the single commit frame so left/top never flashes old coords
  const [committedPos, setCommittedPos] = useState<{
    id: string;
    pctX: number;
    pctY: number;
  } | null>(null);

  // Clear inline GPU transform right when committed left/top paints
  useLayoutEffect(() => {
    if (!committedPos) return;
    const node = noteNodeRefs.current.get(committedPos.id);
    if (node) {
      node.style.transform = "";
      node.style.willChange = "";
    }
  }, [committedPos]);

  // Clear commit bridge as soon as parent state reflects the committed coordinates
  useEffect(() => {
    if (!committedPos) return;
    const match = notes.find((n) => n.id === committedPos.id);
    if (
      !match ||
      (Math.abs(match.x - committedPos.pctX) < 0.01 &&
        Math.abs(match.y - committedPos.pctY) < 0.01)
    ) {
      setCommittedPos(null);
    }
  }, [notes, committedPos]);

  useEffect(() => {
    const computeDrag = (session: ActiveDragSession, clientX: number, clientY: number) => {
      const cw = session.containerWidth || window.innerWidth || 1920;
      const ch = session.containerHeight || window.innerHeight || 1080;

      const minLeftPx = cw * 0.008;
      const minTopPx = ch * 0.012;
      const maxLeftPx = Math.max(minLeftPx, cw - session.noteWidth - 12);
      const maxTopPx = Math.max(minTopPx, ch - session.noteHeight - 12);

      const nextLeftPx = clamp(
        clientX - session.containerLeft - session.pointerOffsetX,
        minLeftPx,
        maxLeftPx
      );
      const nextTopPx = clamp(
        clientY - session.containerTop - session.pointerOffsetY,
        minTopPx,
        maxTopPx
      );

      return {
        tx: nextLeftPx - session.originLeftPx,
        ty: nextTopPx - session.originTopPx,
        pctX: (nextLeftPx / cw) * 100,
        pctY: (nextTopPx / ch) * 100,
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      const dx = e.clientX - session.startClientX;
      const dy = e.clientY - session.startClientY;
      if (!session.hasMoved && Math.hypot(dx, dy) > 3) {
        session.hasMoved = true;
        setActiveDragId(session.id);
      }

      if (session.hasMoved) {
        const { tx, ty, pctX, pctY } = computeDrag(session, e.clientX, e.clientY);
        session.lastPctX = pctX;
        session.lastPctY = pctY;

        // Instant 1:1 GPU-composited positioning with zero CSS transitions or React re-renders
        const node = noteNodeRefs.current.get(session.id);
        if (node) {
          node.style.transition = "none";
          node.style.willChange = "transform";
          node.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        }

        onDragStateChange(session.id, e.clientX, e.clientY);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      const { id, hasMoved } = session;
      let finalPctX = session.lastPctX;
      let finalPctY = session.lastPctY;

      if (hasMoved) {
        const computed = computeDrag(session, e.clientX, e.clientY);
        finalPctX = computed.pctX;
        finalPctY = computed.pctY;
        suppressChipClickRef.current = id;
        window.setTimeout(() => {
          if (suppressChipClickRef.current === id) {
            suppressChipClickRef.current = null;
          }
        }, 120);
      }

      dragSessionRef.current = null;
      setActiveDragId(null);

      if (hasMoved) {
        setCommittedPos({ id, pctX: finalPctX, pctY: finalPctY });
        onDragEnd(id, e.clientX, e.clientY, finalPctX, finalPctY);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [onDragStateChange, onDragEnd]);

  // Ctrl+M or Esc collapses selected note into a slim draggable chip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedNoteId) return;
      const note = notes.find((n) => n.id === selectedNoteId);
      if (!note) return;

      if ((e.ctrlKey && e.key.toLowerCase() === "m") || e.key === "Escape") {
        if (!note.collapsed) {
          e.preventDefault();
          e.stopPropagation();
          onUpdateNote({
            ...note,
            collapsed: true,
            updatedAt: new Date().toISOString(),
          });
          onSelectNote(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNoteId, notes, onUpdateNote, onSelectNote]);

  const initDragSession = (
    note: StickyNoteItem,
    clientX: number,
    clientY: number,
    cardRect: DOMRect
  ) => {
    const containerRect = layerRef.current?.getBoundingClientRect();
    const cw = containerRect?.width || window.innerWidth || 1920;
    const ch = containerRect?.height || window.innerHeight || 1080;
    const leftBound = containerRect?.left ?? 0;
    const topBound = containerRect?.top ?? 0;

    const originLeftPx = cardRect.left - leftBound;
    const originTopPx = cardRect.top - topBound;

    dragSessionRef.current = {
      id: note.id,
      startClientX: clientX,
      startClientY: clientY,
      originLeftPx,
      originTopPx,
      pointerOffsetX: clientX - cardRect.left,
      pointerOffsetY: clientY - cardRect.top,
      noteWidth: cardRect.width,
      noteHeight: cardRect.height,
      containerLeft: leftBound,
      containerTop: topBound,
      containerWidth: cw,
      containerHeight: ch,
      lastPctX: (originLeftPx / cw) * 100,
      lastPctY: (originTopPx / ch) * 100,
      hasMoved: false,
    };
  };

  const startDrag = (
    note: StickyNoteItem,
    e: React.PointerEvent<HTMLElement>,
    forceDrag = false
  ) => {
    const el = e.target as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (el.closest("button")) return;
    if (!forceDrag && (tag === "textarea" || tag === "input")) return;

    const noteEl = noteNodeRefs.current.get(note.id) ?? e.currentTarget;
    initDragSession(note, e.clientX, e.clientY, noteEl.getBoundingClientRect());
  };

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
      data-testid="sticky-notes-layer"
    >
      <AnimatePresence initial={false}>
        {notes.map((note, idx) => {
          const isSelected = selectedNoteId === note.id;
          const isDragging = draggingNoteId === note.id || activeDragId === note.id;
          const isCommitting = committedPos?.id === note.id;

          const posX =
            committedPos?.id === note.id
              ? committedPos.pctX
              : note.x > 0
              ? note.x
              : 3.2 + (idx % 3) * 2.2;
          const posY =
            committedPos?.id === note.id
              ? committedPos.pctY
              : note.y > 0
              ? note.y
              : 10.5 + (idx % 4) * 4.5;

          const disableMotion = isDragging || isCommitting;

          const registerRef = (el: HTMLDivElement | null) => {
            if (el) {
              noteNodeRefs.current.set(note.id, el);
            } else {
              noteNodeRefs.current.delete(note.id);
            }
          };

          if (note.collapsed) {
            return (
              <div
                key={note.id}
                ref={registerRef}
                data-focus-dimmed={isFocusMode && !isDragging ? "true" : "false"}
                data-dragging={isDragging ? "true" : "false"}
                style={{
                  left: `${posX}%`,
                  top: `${posY}%`,
                  zIndex: isDragging ? 70 : 30 + idx,
                  transition: disableMotion ? "none" : undefined,
                }}
                className={`${disableMotion ? "" : "focus-dimmable "}pointer-events-auto absolute`}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: disableMotion ? 0 : 0.16 }}
                  onPointerDown={(e) => startDrag(note, e, true)}
                  onClick={() => {
                    if (suppressChipClickRef.current === note.id) return;
                    onUpdateNote({
                      ...note,
                      collapsed: false,
                      updatedAt: new Date().toISOString(),
                    });
                    onSelectNote(note.id);
                  }}
                  data-testid={`sticky-note-chip-${note.id}`}
                  style={{
                    transition: disableMotion ? "none" : undefined,
                  }}
                  className="smoked-glass smoked-glass-hover cursor-grab active:cursor-grabbing rounded-[3px] px-3.5 py-1.5 max-w-[240px] flex items-center gap-2 select-none"
                  title="Drag to move · Drag to bottom ring to delete · Click to expand"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-luminous)]/90 shrink-0" />
                  <span className="font-editorial text-[0.94rem] tracking-[0.02em] text-[var(--text-ivory-soft)] truncate">
                    {note.title || "Untitled Note"}
                  </span>
                </motion.div>
              </div>
            );
          }

          return (
            <div
              key={note.id}
              ref={registerRef}
              data-focus-dimmed={isFocusMode && !isDragging ? "true" : "false"}
              data-dragging={isDragging ? "true" : "false"}
              style={{
                left: `${posX}%`,
                top: `${posY}%`,
                zIndex: isDragging ? 70 : isSelected ? 45 : 30 + idx,
                transition: disableMotion ? "none" : undefined,
              }}
              className={`${disableMotion ? "" : "focus-dimmable "}pointer-events-auto absolute`}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ duration: disableMotion ? 0 : 0.16 }}
                onPointerDown={(e) => {
                  onSelectNote(note.id);
                  startDrag(note, e);
                }}
                data-testid={`sticky-note-card-${note.id}`}
                style={{
                  transition: disableMotion ? "none" : undefined,
                }}
                className={`group w-[258px] smoked-glass rounded-[6px] px-3.5 pb-3 pt-2 cursor-grab active:cursor-grabbing ${
                  isSelected ? "border-[var(--glass-border-hover)]" : ""
                }`}
                title="Drag to move · Drag to bottom ring to delete · Press Ctrl+M or Esc to collapse"
              >
                {/* Subtle top hairline drag bar + hover-only Move to Notes action */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectNote(note.id);
                    const wrapper = noteNodeRefs.current.get(note.id);
                    if (wrapper) {
                      initDragSession(note, e.clientX, e.clientY, wrapper.getBoundingClientRect());
                    }
                  }}
                  className="mb-1.5 flex h-4 w-full items-center justify-between cursor-grab active:cursor-grabbing"
                >
                  <span className="h-[2px] w-7 rounded-full bg-[rgba(226,180,109,0.28)]" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPromoteNote(note);
                    }}
                    data-testid={`promote-note-btn-${note.id}`}
                    title="Move to Notes and clear from overview"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200 cursor-pointer bg-transparent border-0 p-0 flex items-center gap-1 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:text-[var(--text-ivory)]"
                  >
                    <Archive className="h-3 w-3" strokeWidth={1.6} />
                    Move to Notes
                  </button>
                </div>

                <input
                  type="text"
                  value={note.title}
                  onFocus={() => onSelectNote(note.id)}
                  onChange={(e) =>
                    onUpdateNote({
                      ...note,
                      title: e.target.value,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  placeholder="Note Title"
                  className="w-full bg-transparent border-0 p-0 font-editorial text-[1rem] font-medium tracking-[0.03em] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
                <textarea
                  value={note.content}
                  onFocus={() => onSelectNote(note.id)}
                  onChange={(e) =>
                    onUpdateNote({
                      ...note,
                      content: e.target.value,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  rows={Math.max(3, Math.min(6, Math.ceil((note.content.length || 1) / 34)))}
                  placeholder="Write a thought..."
                  className="mt-1 w-full resize-none overflow-hidden bg-transparent border-0 p-0 font-reading text-[0.9rem] leading-[1.42] text-[var(--text-ivory-soft)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              </motion.div>
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
