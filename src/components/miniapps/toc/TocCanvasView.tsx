import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Sparkles, Trash2, X, Zap } from "lucide-react";
import type {
  TocCanvasEdge,
  TocCanvasNode,
  TocCanvasNodeKind,
  TocFrameworkType,
  TocGraphData,
} from "../../../types/athenaeum";

interface TocCanvasViewProps {
  boardId: string;
  framework: Exclude<TocFrameworkType, "five_steps">;
  graph: TocGraphData;
  addBlockSignal: number;
  fitViewSignal: number;
  onChange: (next: TocGraphData) => void;
}

function cloneGraph(g: TocGraphData): TocGraphData {
  return {
    ...g,
    nodes: g.nodes.map((n) => ({ ...n })),
    edges: g.edges.map((e) => ({
      ...e,
      assumptions: e.assumptions ? [...e.assumptions] : undefined,
    })),
  };
}

const NODE_WIDTH = 248;
const NODE_MIN_HEIGHT = 112;

type HandleSide = "top" | "right" | "bottom" | "left";

interface ConnectingDraft {
  sourceId: string;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function nodeAccentStyles(kind: TocCanvasNodeKind): {
  badgeText: string;
  cardBorder: string;
} {
  switch (kind) {
    case "core_problem":
    case "injection":
    case "trimming_injection":
    case "objective":
      return {
        badgeText: "text-[#E2B46D]",
        cardBorder: "border-[rgba(226,180,109,0.44)]",
      };
    case "ude":
    case "obstacle":
      return {
        badgeText: "text-[#dfa08e]",
        cardBorder: "border-[rgba(217,125,104,0.38)]",
      };
    case "de":
    case "io":
    case "requirement":
      return {
        badgeText: "text-[#a9c7b6]",
        cardBorder: "border-[rgba(169,199,182,0.34)]",
      };
    default:
      return {
        badgeText: "text-[#c8b89d]",
        cardBorder: "border-[rgba(222,188,132,0.24)]",
      };
  }
}

function getHandleCoords(node: TocCanvasNode, side: HandleSide): { x: number; y: number } {
  const w = NODE_WIDTH;
  const h = NODE_MIN_HEIGHT;
  if (side === "top") return { x: node.x + w / 2, y: node.y };
  if (side === "bottom") return { x: node.x + w / 2, y: node.y + h };
  if (side === "left") return { x: node.x, y: node.y + h / 2 };
  return { x: node.x + w, y: node.y + h / 2 };
}

function buildCurvedEdgePath(
  src: TocCanvasNode,
  tgt: TocCanvasNode,
  isConflict?: boolean
): {
  d: string;
  midX: number;
  midY: number;
} {
  const scx = src.x + NODE_WIDTH / 2;
  const scy = src.y + NODE_MIN_HEIGHT / 2;
  const tcx = tgt.x + NODE_WIDTH / 2;
  const tcy = tgt.y + NODE_MIN_HEIGHT / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (isConflict || Math.abs(dy) > Math.abs(dx) * 0.9) {
    // Vertical flow
    if (dy >= 0) {
      x1 = scx;
      y1 = src.y + NODE_MIN_HEIGHT;
      x2 = tcx;
      y2 = tgt.y;
    } else {
      x1 = scx;
      y1 = src.y;
      x2 = tcx;
      y2 = tgt.y + NODE_MIN_HEIGHT;
    }
    const bend = Math.max(36, Math.min(110, Math.abs(y2 - y1) * 0.45));
    const dir = dy >= 0 ? 1 : -1;
    c1x = x1;
    c1y = y1 + bend * dir;
    c2x = x2;
    c2y = y2 - bend * dir;
  } else {
    // Horizontal flow
    if (dx >= 0) {
      x1 = src.x + NODE_WIDTH;
      y1 = scy;
      x2 = tgt.x;
      y2 = tcy;
    } else {
      x1 = src.x;
      y1 = scy;
      x2 = tgt.x + NODE_WIDTH;
      y2 = tcy;
    }
    const bend = Math.max(40, Math.min(120, Math.abs(x2 - x1) * 0.45));
    const dir = dx >= 0 ? 1 : -1;
    c1x = x1 + bend * dir;
    c1y = y1;
    c2x = x2 - bend * dir;
    c2y = y2;
  }

  // Cubic Bezier midpoint at t = 0.5
  const midX = 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2;
  const midY = 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2;

  return {
    d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    midX,
    midY,
  };
}

function buildDraftCurvePath(draft: ConnectingDraft): string {
  const dx = draft.curX - draft.startX;
  const dy = draft.curY - draft.startY;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bend = Math.max(36, Math.abs(dx) * 0.4);
    const dir = dx >= 0 ? 1 : -1;
    return `M ${draft.startX.toFixed(1)} ${draft.startY.toFixed(1)} C ${(draft.startX + bend * dir).toFixed(1)} ${draft.startY.toFixed(1)}, ${(draft.curX - bend * dir).toFixed(1)} ${draft.curY.toFixed(1)}, ${draft.curX.toFixed(1)} ${draft.curY.toFixed(1)}`;
  }
  const bend = Math.max(36, Math.abs(dy) * 0.4);
  const dir = dy >= 0 ? 1 : -1;
  return `M ${draft.startX.toFixed(1)} ${draft.startY.toFixed(1)} C ${draft.startX.toFixed(1)} ${(draft.startY + bend * dir).toFixed(1)}, ${draft.curX.toFixed(1)} ${(draft.curY - bend * dir).toFixed(1)}, ${draft.curX.toFixed(1)} ${draft.curY.toFixed(1)}`;
}

export function TocCanvasView({
  boardId,
  framework,
  graph,
  addBlockSignal,
  fitViewSignal,
  onChange,
}: TocCanvasViewProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeInspectorOpen, setEdgeInspectorOpen] = useState<boolean>(false);
  const [connectingDraft, setConnectingDraft] = useState<ConnectingDraft | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [newAssumptionDraft, setNewAssumptionDraft] = useState<string>("");

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const pendingFocusNodeIdRef = useRef<string | null>(null);
  const lastAddSignalRef = useRef<number>(addBlockSignal);
  const lastFitSignalRef = useRef<number>(fitViewSignal);

  // Undo/Redo history & Clipboard for Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Ctrl+C / Ctrl+V / Ctrl+D
  const undoStackRef = useRef<TocGraphData[]>([]);
  const redoStackRef = useRef<TocGraphData[]>([]);
  const clipboardRef = useRef<{ nodes: TocCanvasNode[]; edges: TocCanvasEdge[] } | null>(null);
  const pasteCountRef = useRef<number>(0);
  const textEditCapturedRef = useRef<boolean>(false);

  const panStateRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const dragNodeRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    startGraph: TocGraphData;
    moved: boolean;
  } | null>(null);

  const connectingRef = useRef<ConnectingDraft | null>(null);

  const graphRef = useRef(graph);
  graphRef.current = graph;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  // Reset history when switching to a different saved/new board
  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEdgeInspectorOpen(false);
  }, [boardId]);

  const pushUndoSnapshot = useCallback((snapshot: TocGraphData) => {
    undoStackRef.current.push(cloneGraph(snapshot));
    if (undoStackRef.current.length > 60) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, []);

  const commitGraphChange = useCallback(
    (next: TocGraphData, recordUndo = true) => {
      if (recordUndo) {
        pushUndoSnapshot(graphRef.current);
      }
      onChangeRef.current(next);
    },
    [pushUndoSnapshot]
  );

  const performUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(cloneGraph(graphRef.current));
    onChangeRef.current(cloneGraph(prev));
    setSelectedEdgeId(null);
    setEdgeInspectorOpen(false);
  }, []);

  const performRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(cloneGraph(graphRef.current));
    onChangeRef.current(cloneGraph(next));
    setSelectedEdgeId(null);
    setEdgeInspectorOpen(false);
  }, []);

  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes]
  );

  const selectedEdge = selectedEdgeId
    ? graph.edges.find((e) => e.id === selectedEdgeId) ?? null
    : null;

  const updateNode = useCallback(
    (id: string, patch: Partial<TocCanvasNode>, recordUndo = false) => {
      const cur = graphRef.current;
      commitGraphChange(
        {
          ...cur,
          nodes: cur.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        },
        recordUndo
      );
    },
    [commitGraphChange]
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const removeSet = new Set(ids);
      const cur = graphRef.current;
      commitGraphChange(
        {
          ...cur,
          nodes: cur.nodes.filter((n) => !removeSet.has(n.id)),
          edges: cur.edges.filter(
            (e) => !removeSet.has(e.sourceId) && !removeSet.has(e.targetId)
          ),
        },
        true
      );
      setSelectedNodeIds((prev) => prev.filter((id) => !removeSet.has(id)));
    },
    [commitGraphChange]
  );

  const deleteNode = useCallback((id: string) => deleteNodes([id]), [deleteNodes]);

  const updateEdge = useCallback(
    (id: string, patch: Partial<TocCanvasEdge>) => {
      const cur = graphRef.current;
      commitGraphChange(
        {
          ...cur,
          edges: cur.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        },
        true
      );
    },
    [commitGraphChange]
  );

  const deleteEdge = useCallback(
    (id: string) => {
      const cur = graphRef.current;
      commitGraphChange(
        {
          ...cur,
          edges: cur.edges.filter((e) => e.id !== id),
        },
        true
      );
      setSelectedEdgeId((prev) => (prev === id ? null : prev));
      setEdgeInspectorOpen(false);
    },
    [commitGraphChange]
  );

  const connectNodes = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const cur = graphRef.current;
      const exists = cur.edges.some(
        (e) => e.sourceId === sourceId && e.targetId === targetId
      );
      if (exists) return;
      const newEdge: TocCanvasEdge = {
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        sourceId,
        targetId,
        assumptions: [],
        injection: "",
      };
      commitGraphChange(
        {
          ...cur,
          edges: [...cur.edges, newEdge],
        },
        true
      );
      setSelectedEdgeId(newEdge.id);
      setSelectedNodeIds([]);
    },
    [commitGraphChange]
  );

  const createBlockAt = useCallback(
    (x: number, y: number) => {
      const cur = graphRef.current;
      const id = `blk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      const newNode: TocCanvasNode = {
        id,
        kind: "fact",
        code: "Block",
        title: "",
        body: "Type a thought, cause, or effect...",
        x: Math.round(x),
        y: Math.round(y),
      };
      pendingFocusNodeIdRef.current = id;
      commitGraphChange(
        {
          ...cur,
          nodes: [...cur.nodes, newNode],
        },
        true
      );
      setSelectedNodeIds([id]);
      setSelectedEdgeId(null);
      setEdgeInspectorOpen(false);
    },
    [commitGraphChange]
  );

  const copySelectedBlocks = useCallback(() => {
    const selIds = selectedNodeIdsRef.current;
    if (selIds.length === 0) return;
    const selSet = new Set(selIds);
    const cur = graphRef.current;
    const nodes = cur.nodes.filter((n) => selSet.has(n.id)).map((n) => ({ ...n }));
    if (nodes.length === 0) return;
    const edges = cur.edges
      .filter((e) => selSet.has(e.sourceId) && selSet.has(e.targetId))
      .map((e) => ({
        ...e,
        assumptions: e.assumptions ? [...e.assumptions] : undefined,
      }));
    clipboardRef.current = { nodes, edges };
    pasteCountRef.current = 0;
  }, []);

  const pasteBlocksFromBundle = useCallback(
    (bundle: { nodes: TocCanvasNode[]; edges: TocCanvasEdge[] }, offsetPx: number) => {
      if (bundle.nodes.length === 0) return;
      const cur = graphRef.current;
      const idMap = new Map<string, string>();
      const stamp = Date.now();
      const newNodes: TocCanvasNode[] = bundle.nodes.map((n, idx) => {
        const newId = `blk-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          x: Math.round(n.x + offsetPx),
          y: Math.round(n.y + offsetPx),
        };
      });
      const newEdges: TocCanvasEdge[] = [];
      bundle.edges.forEach((e, idx) => {
        const src = idMap.get(e.sourceId);
        const tgt = idMap.get(e.targetId);
        if (!src || !tgt) return;
        newEdges.push({
          ...e,
          id: `e-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          sourceId: src,
          targetId: tgt,
          ...(e.assumptions ? { assumptions: [...e.assumptions] } : {}),
        });
      });

      commitGraphChange(
        {
          ...cur,
          nodes: [...cur.nodes, ...newNodes],
          edges: [...cur.edges, ...newEdges],
        },
        true
      );
      setSelectedNodeIds(newNodes.map((n) => n.id));
      setSelectedEdgeId(null);
      setEdgeInspectorOpen(false);
    },
    [commitGraphChange]
  );

  const pasteCopiedBlocks = useCallback(() => {
    const bundle = clipboardRef.current;
    if (!bundle || bundle.nodes.length === 0) return;
    pasteCountRef.current += 1;
    pasteBlocksFromBundle(bundle, 24 * pasteCountRef.current);
  }, [pasteBlocksFromBundle]);

  const duplicateSelectedBlocks = useCallback(() => {
    const selIds = selectedNodeIdsRef.current;
    if (selIds.length === 0) return;
    const selSet = new Set(selIds);
    const cur = graphRef.current;
    const nodes = cur.nodes.filter((n) => selSet.has(n.id)).map((n) => ({ ...n }));
    if (nodes.length === 0) return;
    const edges = cur.edges
      .filter((e) => selSet.has(e.sourceId) && selSet.has(e.targetId))
      .map((e) => ({
        ...e,
        assumptions: e.assumptions ? [...e.assumptions] : undefined,
      }));
    pasteBlocksFromBundle({ nodes, edges }, 24);
  }, [pasteBlocksFromBundle]);

  // Auto-focus newly created block's inline textarea
  useEffect(() => {
    const pendingId = pendingFocusNodeIdRef.current;
    if (!pendingId) return;
    const el = textareaRefs.current.get(pendingId);
    if (el) {
      pendingFocusNodeIdRef.current = null;
      window.setTimeout(() => {
        el.focus();
      }, 15);
    }
  }, [graph.nodes]);

  // Respond to bottom dock "+ Add Block" button
  useEffect(() => {
    if (addBlockSignal === lastAddSignalRef.current) return;
    lastAddSignalRef.current = addBlockSignal;
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 1200;
    const vh = vp?.clientHeight ?? 700;
    const stagger = (graphRef.current.nodes.length % 5) * 26;
    const cx = (vw / 2 - pan.x) / zoom - NODE_WIDTH / 2 + stagger - 36;
    const cy = (vh / 2 - pan.y) / zoom - NODE_MIN_HEIGHT / 2 + stagger - 36;
    createBlockAt(cx, cy);
  }, [addBlockSignal, createBlockAt, pan.x, pan.y, zoom]);

  // Center current template or loaded board nicely inside the viewport
  const centerNodesInViewport = useCallback(() => {
    const vp = viewportRef.current;
    const nodes = graphRef.current.nodes;
    if (!vp || nodes.length === 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_MIN_HEIGHT));
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const padX = 110;
    const padY = 120;
    const fitScale = Math.min(
      1,
      (vp.clientWidth - padX * 2) / contentW,
      (vp.clientHeight - padY * 2) / contentH
    );
    const nextZoom = clamp(Number(fitScale.toFixed(2)), 0.55, 1);
    const centerX = minX + contentW / 2;
    const centerY = minY + contentH / 2;
    setZoom(nextZoom);
    setPan({
      x: Math.round(vp.clientWidth / 2 - centerX * nextZoom),
      y: Math.round((vp.clientHeight - 48) / 2 - centerY * nextZoom),
    });
  }, []);

  useEffect(() => {
    if (fitViewSignal === lastFitSignalRef.current) return;
    lastFitSignalRef.current = fitViewSignal;
    window.setTimeout(() => centerNodesInViewport(), 25);
  }, [fitViewSignal, centerNodesInViewport]);

  // Keyboard shortcuts: Space-to-pan, Undo (Ctrl/Cmd+Z), Redo (Ctrl+Y / Ctrl+Shift+Z),
  // Copy (Ctrl/Cmd+C), Paste (Ctrl/Cmd+V), Duplicate (Ctrl/Cmd+D), Delete/Backspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inEditable =
        tag === "input" || tag === "textarea" || Boolean(target?.isContentEditable);

      if (inEditable) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        performUndo();
        return;
      }

      if ((mod && key === "y") || (mod && e.shiftKey && key === "z")) {
        e.preventDefault();
        performRedo();
        return;
      }

      if (mod && key === "c") {
        if (selectedNodeIdsRef.current.length > 0) {
          e.preventDefault();
          copySelectedBlocks();
        }
        return;
      }

      if (mod && key === "v") {
        if (clipboardRef.current && clipboardRef.current.nodes.length > 0) {
          e.preventDefault();
          pasteCopiedBlocks();
        }
        return;
      }

      if (mod && key === "d") {
        if (selectedNodeIdsRef.current.length > 0) {
          e.preventDefault();
          duplicateSelectedBlocks();
        }
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeId) {
          e.preventDefault();
          deleteEdge(selectedEdgeId);
        } else if (selectedNodeIdsRef.current.length > 0) {
          e.preventDefault();
          deleteNodes(selectedNodeIdsRef.current);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    selectedEdgeId,
    deleteEdge,
    deleteNodes,
    performUndo,
    performRedo,
    copySelectedBlocks,
    pasteCopiedBlocks,
    duplicateSelectedBlocks,
  ]);

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom]
  );

  const findNodeAtCanvasPoint = useCallback((cx: number, cy: number, excludeId: string) => {
    const margin = 18;
    for (const node of graphRef.current.nodes) {
      if (node.id === excludeId) continue;
      if (
        cx >= node.x - margin &&
        cx <= node.x + NODE_WIDTH + margin &&
        cy >= node.y - margin &&
        cy <= node.y + NODE_MIN_HEIGHT + margin
      ) {
        return node.id;
      }
    }
    return null;
  }, []);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isBg = target.dataset.canvasBg === "true";
    if (!isBg && !spacePressed) return;

    if (document.activeElement instanceof HTMLElement && !spacePressed) {
      document.activeElement.blur();
    }
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEdgeInspectorOpen(false);

    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (connectingRef.current) {
      const pt = clientToCanvas(e.clientX, e.clientY);
      const updated: ConnectingDraft = {
        ...connectingRef.current,
        curX: pt.x,
        curY: pt.y,
      };
      connectingRef.current = updated;
      setConnectingDraft(updated);
      setHoveredTargetId(findNodeAtCanvasPoint(pt.x, pt.y, updated.sourceId));
      return;
    }

    if (dragNodeRef.current) {
      const d = dragNodeRef.current;
      const dx = (e.clientX - d.startClientX) / zoom;
      const dy = (e.clientY - d.startClientY) / zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        d.moved = true;
      }
      updateNode(
        d.id,
        {
          x: Math.round(d.origX + dx),
          y: Math.round(d.origY + dy),
        },
        false
      );
      return;
    }

    if (panStateRef.current) {
      const p = panStateRef.current;
      setPan({
        x: Math.round(p.origX + (e.clientX - p.startX)),
        y: Math.round(p.origY + (e.clientY - p.startY)),
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (connectingRef.current) {
      const draft = connectingRef.current;
      const pt = clientToCanvas(e.clientX, e.clientY);
      const hitTargetId = findNodeAtCanvasPoint(pt.x, pt.y, draft.sourceId);
      if (hitTargetId) {
        connectNodes(draft.sourceId, hitTargetId);
      }
      connectingRef.current = null;
      setConnectingDraft(null);
      setHoveredTargetId(null);
    }

    if (dragNodeRef.current?.moved) {
      pushUndoSnapshot(dragNodeRef.current.startGraph);
    }

    panStateRef.current = null;
    dragNodeRef.current = null;
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-toc-node='true']") || target.closest("[data-toc-ui='true']")) {
      return;
    }
    const pt = clientToCanvas(e.clientX, e.clientY);
    createBlockAt(pt.x - NODE_WIDTH / 2, pt.y - NODE_MIN_HEIGHT / 2);
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Allow scrolling inside an open edge inspector drawer without zooming the canvas
    if ((e.target as HTMLElement).closest("[data-toc-ui='true']")) return;
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = clamp(Number((zoom * factor).toFixed(3)), 0.45, 1.85);
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const ratio = nextZoom / zoom;
    setZoom(nextZoom);
    setPan({
      x: Math.round(cursorX - (cursorX - pan.x) * ratio),
      y: Math.round(cursorY - (cursorY - pan.y) * ratio),
    });
  };

  const startHandleDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    node: TocCanvasNode,
    side: HandleSide
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const origin = getHandleCoords(node, side);
    const draft: ConnectingDraft = {
      sourceId: node.id,
      startX: origin.x,
      startY: origin.y,
      curX: origin.x,
      curY: origin.y,
    };
    connectingRef.current = draft;
    setConnectingDraft(draft);
    setSelectedNodeIds([node.id]);
    setSelectedEdgeId(null);
    viewportRef.current?.setPointerCapture(e.pointerId);
  };

  return (
    <div
      ref={viewportRef}
      data-canvas-bg="true"
      data-testid="toc-interactive-canvas"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onDoubleClick={handleCanvasDoubleClick}
      onWheel={handleCanvasWheel}
      style={{ backgroundColor: "rgba(30, 30, 32, 0.72)" }}
      className={`relative flex-1 min-h-0 w-full overflow-hidden select-none ${
        spacePressed ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      }`}
    >
      {/* Subtle Translucent Dark-Grey Architectural Dot Grid */}
      <div
        data-canvas-bg="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(214, 212, 206, 0.14) 1.25px, transparent 1.25px)",
          backgroundSize: `${Math.max(12, Math.round(24 * zoom))}px ${Math.max(12, Math.round(24 * zoom))}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      {/* Quiet Empty Canvas Prompt */}
      {graph.nodes.length === 0 && (
        <div
          data-testid="toc-empty-canvas-hint"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6"
        >
          <p className="font-editorial text-[1.45rem] font-light tracking-[0.02em] text-[#f3efe6]/58">
            Double-click anywhere to add a block
          </p>
          <p className="mt-1.5 font-ui text-[0.64rem] uppercase tracking-[0.2em] text-[#b8aa96]/55">
            Or pick a starter structure from Templates
          </p>
        </div>
      )}

      {/* Transformed Infinite Plane */}
      <div
        data-canvas-bg="true"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
        className="relative h-[3000px] w-[4000px]"
      >
        {/* Curved Antique-Brass Arrows & Live Connector Preview */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          width="4000"
          height="3000"
        >
          <defs>
            <marker
              id="toc-brass-arrow"
              markerWidth="9"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 9 3.5, 0 7" fill="rgba(226, 180, 109, 0.85)" />
            </marker>
            <marker
              id="toc-brass-arrow-active"
              markerWidth="9"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 9 3.5, 0 7" fill="#f5d38c" />
            </marker>
          </defs>

          {graph.edges.map((edge) => {
            const src = nodeMap.get(edge.sourceId);
            const tgt = nodeMap.get(edge.targetId);
            if (!src || !tgt) return null;
            const geom = buildCurvedEdgePath(src, tgt, edge.isConflict);
            const isSelected = selectedEdgeId === edge.id;

            return (
              <g key={edge.id} className="pointer-events-auto cursor-pointer">
                {/* Wide transparent click target */}
                <path
                  d={geom.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedNodeIds([]);
                  }}
                />
                <path
                  d={geom.d}
                  data-testid={`toc-edge-${edge.id}`}
                  fill="none"
                  stroke={
                    edge.isConflict
                      ? isSelected
                        ? "#f5d38c"
                        : "rgba(217, 125, 104, 0.85)"
                      : isSelected
                      ? "#f5d38c"
                      : "rgba(226, 180, 109, 0.7)"
                  }
                  strokeWidth={isSelected ? 2.6 : 1.85}
                  strokeDasharray={edge.isConflict ? "6 5" : undefined}
                  markerEnd={
                    edge.isConflict
                      ? undefined
                      : isSelected
                      ? "url(#toc-brass-arrow-active)"
                      : "url(#toc-brass-arrow)"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEdgeId(edge.id);
                    setSelectedNodeIds([]);
                  }}
                />
              </g>
            );
          })}

          {connectingDraft && (
            <path
              d={buildDraftCurvePath(connectingDraft)}
              fill="none"
              stroke="#E2B46D"
              strokeWidth={2}
              strokeDasharray="5 4"
              markerEnd="url(#toc-brass-arrow-active)"
            />
          )}
        </svg>

        {/* Subtle Midpoint Badge on Conflict Arrow or Selected Arrow */}
        {graph.edges.map((edge) => {
          const src = nodeMap.get(edge.sourceId);
          const tgt = nodeMap.get(edge.targetId);
          if (!src || !tgt) return null;
          const geom = buildCurvedEdgePath(src, tgt, edge.isConflict);
          const isSelected = selectedEdgeId === edge.id;
          const hasNote =
            (edge.assumptions?.some((a) => a.trim()) ?? false) ||
            Boolean(edge.injection?.trim());

          if (!edge.isConflict && !isSelected && !hasNote) return null;

          return (
            <div
              key={`edge-ui-${edge.id}`}
              data-toc-ui="true"
              style={{ left: geom.midX, top: geom.midY }}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeIds([]);
                  setEdgeInspectorOpen(true);
                }}
                data-testid={`toc-edge-pill-${edge.id}`}
                className={`cursor-pointer rounded-full px-2.5 py-0.5 flex items-center gap-1 font-ui text-[0.56rem] uppercase tracking-[0.12em] border transition-colors ${
                  edge.isConflict
                    ? "border-[rgba(217,125,104,0.55)] bg-[rgba(28,16,14,0.92)] text-[#f0aa99] hover:border-[#E2B46D]"
                    : "border-[rgba(226,180,109,0.5)] bg-[rgba(22,16,12,0.92)] text-[#E2B46D] hover:text-[#f4efe6]"
                }`}
              >
                {edge.isConflict ? (
                  <>
                    <Zap className="h-2.5 w-2.5" />
                    Conflict
                  </>
                ) : edge.injection?.trim() ? (
                  <>
                    <Sparkles className="h-2.5 w-2.5" />
                    Idea
                  </>
                ) : (
                  <span>Why?</span>
                )}
              </button>

              {isSelected && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteEdge(edge.id);
                  }}
                  aria-label="Delete connection"
                  className="cursor-pointer rounded-full border border-[rgba(217,125,104,0.45)] bg-[rgba(24,15,13,0.94)] p-1 text-[#b8aa96] hover:text-[#e59280]"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Draggable, Inline-Editable Whiteboard Blocks with Edge Connector Handles */}
        {graph.nodes.map((node) => {
          const accent = nodeAccentStyles(node.kind);
          const isSelected = selectedNodeIds.includes(node.id);
          const isConnectTarget = hoveredTargetId === node.id;

          return (
            <div
              key={node.id}
              data-toc-node="true"
              data-selected={isSelected ? "true" : "false"}
              data-testid={`toc-node-${node.id}`}
              data-node-code={node.code ?? ""}
              style={{
                left: node.x,
                top: node.y,
                width: NODE_WIDTH,
                minHeight: NODE_MIN_HEIGHT,
              }}
              onPointerDown={(e) => {
                if (spacePressed) return;
                const tag = (e.target as HTMLElement).tagName.toLowerCase();
                const toggleSelection = () => {
                  if (e.shiftKey) {
                    setSelectedNodeIds((prev) =>
                      prev.includes(node.id)
                        ? prev.filter((id) => id !== node.id)
                        : [...prev, node.id]
                    );
                  } else {
                    setSelectedNodeIds([node.id]);
                  }
                };
                if (tag === "textarea" || tag === "input" || tag === "button") {
                  e.stopPropagation();
                  toggleSelection();
                  setSelectedEdgeId(null);
                  return;
                }
                e.stopPropagation();
                toggleSelection();
                setSelectedEdgeId(null);
                setEdgeInspectorOpen(false);
                dragNodeRef.current = {
                  id: node.id,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  origX: node.x,
                  origY: node.y,
                  startGraph: cloneGraph(graphRef.current),
                  moved: false,
                };
              }}
              className={`group/node absolute z-10 rounded-[6px] border bg-[rgba(34,34,36,0.82)] backdrop-blur-sm px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.42)] transition-[border-color,box-shadow] cursor-grab active:cursor-grabbing ${
                isConnectTarget
                  ? "border-[#E2B46D] ring-2 ring-[#E2B46D]/60 shadow-[0_0_26px_rgba(226,180,109,0.28)]"
                  : isSelected
                  ? "border-[rgba(226,180,109,0.72)] ring-1 ring-[#E2B46D]/50 shadow-[0_16px_38px_rgba(0,0,0,0.58)]"
                  : `${accent.cardBorder} hover:border-[rgba(226,180,109,0.48)]`
              }`}
            >
              {/* Top Minimal Role Label + Hover Delete */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-ui text-[0.58rem] uppercase tracking-[0.18em] ${accent.badgeText}`}
                >
                  {node.code || "Block"}
                </span>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNode(node.id);
                  }}
                  data-testid={`toc-delete-node-${node.id}`}
                  aria-label={`Delete ${node.code || "block"}`}
                  className="opacity-0 group-hover/node:opacity-100 focus:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0.5 text-[#b8aa96]/70 hover:text-[var(--danger-ember)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Direct Inline Text Editor (Shift+Enter newline, Enter / Esc finishes) */}
              <textarea
                ref={(el) => {
                  if (el) textareaRefs.current.set(node.id, el);
                  else textareaRefs.current.delete(node.id);
                }}
                rows={3}
                value={node.title}
                onChange={(e) => {
                  const shouldRecord = !textEditCapturedRef.current;
                  textEditCapturedRef.current = true;
                  updateNode(node.id, { title: e.target.value }, shouldRecord);
                }}
                onFocus={() => {
                  textEditCapturedRef.current = false;
                  setSelectedNodeIds([node.id]);
                  setSelectedEdgeId(null);
                }}
                onBlur={() => {
                  textEditCapturedRef.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.blur();
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                data-testid={`toc-node-input-${node.id}`}
                placeholder={node.body || "Click to write..."}
                className="mt-1.5 w-full resize-none bg-transparent border-0 p-0 font-reading text-[0.98rem] leading-[1.45] text-[#f4efe6] placeholder:text-[#b8aa96]/55 focus:outline-none cursor-text"
              />

              {/* 4 Subtle Edge Connector Handles (Drag to another block to draw arrow) */}
              {(
                [
                  { side: "top" as const, pos: "left-1/2 -top-1.5 -translate-x-1/2" },
                  { side: "right" as const, pos: "-right-1.5 top-1/2 -translate-y-1/2" },
                  { side: "bottom" as const, pos: "left-1/2 -bottom-1.5 -translate-x-1/2" },
                  { side: "left" as const, pos: "-left-1.5 top-1/2 -translate-y-1/2" },
                ] as const
              ).map(({ side, pos }) => (
                <button
                  key={side}
                  type="button"
                  data-testid={`node-handle-${node.id}-${side}`}
                  aria-label={`Connect from ${side} edge`}
                  title="Drag to another block to connect"
                  onPointerDown={(e) => startHandleDrag(e, node, side)}
                  className={`absolute ${pos} z-30 h-3 w-3 rounded-full border border-[#E2B46D] bg-[#241912] shadow-[0_0_8px_rgba(226,180,109,0.45)] cursor-crosshair transition-opacity ${
                    isSelected || connectingDraft?.sourceId === node.id
                      ? "opacity-100"
                      : "opacity-0 group-hover/node:opacity-100"
                  } hover:scale-125 hover:bg-[#E2B46D]`}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Subtle Corner Zoom Reset Pill */}
      <div
        data-toc-ui="true"
        className="absolute bottom-5 right-5 z-30 flex items-center gap-1 rounded-[3px] border border-[rgba(222,188,132,0.22)] bg-[rgba(34,34,36,0.72)] backdrop-blur-md px-2 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.45, 1.85))}
          aria-label="Zoom out"
          className="cursor-pointer bg-transparent border-0 p-1 text-[#b8aa96] hover:text-[#f4efe6]"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (graph.nodes.length > 0) {
              centerNodesInViewport();
            } else {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }
          }}
          data-testid="toc-zoom-reset-btn"
          title="Reset view to 100%"
          className="cursor-pointer bg-transparent border-0 px-1.5 py-0.5 font-ui tabular-nums text-[0.62rem] tracking-[0.08em] text-[#e0d4c2] hover:text-[#E2B46D]"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.45, 1.85))}
          aria-label="Zoom in"
          className="cursor-pointer bg-transparent border-0 p-1 text-[#b8aa96] hover:text-[#f4efe6]"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Optional Compact Arrow Assumptions / Breakthrough Popover (Only when user clicks Why?/Conflict) */}
      {selectedEdge && edgeInspectorOpen && (
        <aside
          data-toc-ui="true"
          data-testid="toc-edge-assumptions-drawer"
          className="absolute right-5 top-5 z-40 w-[308px] max-h-[calc(100%-96px)] overflow-y-auto rounded-[12px] border border-[rgba(226,180,109,0.4)] bg-[rgba(22,16,12,0.95)] p-4 shadow-[0_18px_46px_rgba(0,0,0,0.65)] space-y-3.5"
        >
          <div className="flex items-start justify-between gap-2 border-b border-[rgba(222,188,132,0.14)] pb-2.5">
            <div>
              <div className="font-ui text-[0.58rem] uppercase tracking-[0.18em] text-[#E2B46D]">
                {selectedEdge.isConflict ? "Conflict Tension" : "Connection Assumptions"}
              </div>
              <div className="mt-0.5 font-editorial text-[1rem] text-[#f4efe6]">
                {nodeMap.get(selectedEdge.sourceId)?.code || "Block"}{" "}
                {selectedEdge.isConflict ? "↔" : "→"}{" "}
                {nodeMap.get(selectedEdge.targetId)?.code || "Block"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEdgeInspectorOpen(false)}
              aria-label="Close connection notes"
              className="cursor-pointer bg-transparent border-0 p-0.5 text-[#b8aa96] hover:text-[#f4efe6]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="font-ui text-[0.56rem] uppercase tracking-[0.16em] text-[#b8aa96]">
              Underlying Assumptions
            </div>
            {(selectedEdge.assumptions ?? []).map((asmp, idx) => (
              <div
                key={idx}
                className="flex items-start gap-1.5 rounded-lg border border-[rgba(222,188,132,0.16)] bg-[rgba(30,22,16,0.75)] px-2.5 py-1.5"
              >
                <span className="flex-1 font-reading text-[0.86rem] text-[#f4efe6]/90">
                  {asmp}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = (selectedEdge.assumptions ?? []).filter((_, i) => i !== idx);
                    updateEdge(selectedEdge.id, { assumptions: next });
                  }}
                  aria-label="Remove assumption"
                  className="cursor-pointer bg-transparent border-0 p-0.5 text-[#b8aa96] hover:text-[var(--danger-ember)]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newAssumptionDraft.trim()) return;
                updateEdge(selectedEdge.id, {
                  assumptions: [
                    ...(selectedEdge.assumptions ?? []),
                    newAssumptionDraft.trim(),
                  ],
                });
                setNewAssumptionDraft("");
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={newAssumptionDraft}
                onChange={(e) => setNewAssumptionDraft(e.target.value)}
                placeholder="Surface a hidden assumption..."
                className="flex-1 rounded-lg border border-[rgba(222,188,132,0.2)] bg-[rgba(30,22,16,0.75)] px-2.5 py-1.5 font-reading text-[0.84rem] text-[#f4efe6] placeholder:text-[#b8aa96]/55 focus:border-[#E2B46D] focus:outline-none"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-lg border border-[rgba(226,180,109,0.35)] bg-[rgba(226,180,109,0.14)] px-2.5 py-1 font-ui text-[0.58rem] uppercase tracking-[0.12em] text-[#f4efe6]"
              >
                Add
              </button>
            </form>
          </div>

          {framework === "cloud" && (
            <div className="space-y-1.5 pt-2 border-t border-[rgba(222,188,132,0.12)]">
              <div className="font-ui text-[0.56rem] uppercase tracking-[0.16em] text-[#E2B46D]">
                Win-Win Breakthrough Idea
              </div>
              <textarea
                rows={2}
                value={selectedEdge.injection ?? ""}
                onChange={(e) => updateEdge(selectedEdge.id, { injection: e.target.value })}
                placeholder="How could we break this assumption and satisfy both sides?"
                className="w-full resize-none rounded-lg border border-[rgba(226,180,109,0.32)] bg-[rgba(30,22,16,0.75)] p-2.5 font-reading text-[0.86rem] text-[#f2dfb3] placeholder:text-[#b8aa96]/55 focus:border-[#E2B46D] focus:outline-none"
              />
            </div>
          )}

          <div className="pt-2 border-t border-[rgba(222,188,132,0.12)] flex justify-end">
            <button
              type="button"
              onClick={() => deleteEdge(selectedEdge.id)}
              className="cursor-pointer bg-transparent border-0 p-0 font-ui text-[0.58rem] uppercase tracking-[0.14em] text-[var(--danger-ember)] hover:underline"
            >
              Remove Arrow
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
