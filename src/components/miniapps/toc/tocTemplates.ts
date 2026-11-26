import type {
  FiveFocusingStepsData,
  TocCanvasNode,
  TocFrameworkType,
  TocGraphData,
  TocTreeRecord,
} from "../../../types/athenaeum";

export type TocTemplateId =
  | "blank"
  | "crt"
  | "cloud"
  | "frt_nbr"
  | "prt"
  | "trt"
  | "five_steps";

export interface TocTemplateOption {
  id: TocTemplateId;
  framework: TocFrameworkType;
  label: string;
  description: string;
  defaultTitle: string;
  defaultTags: string[];
}

export const TOC_WHITEBOARD_TEMPLATES: TocTemplateOption[] = [
  {
    id: "blank",
    framework: "crt",
    label: "Blank Canvas",
    description: "Start fresh with an open dot-grid board",
    defaultTitle: "Untitled Board",
    defaultTags: ["thinking"],
  },
  {
    id: "crt",
    framework: "crt",
    label: "Current Reality Tree",
    description: "Trace recurring problems down to one shared root cause",
    defaultTitle: "Current Reality Tree",
    defaultTags: ["strategy"],
  },
  {
    id: "cloud",
    framework: "cloud",
    label: "Evaporating Cloud",
    description: "Break a tug-of-war between two competing choices",
    defaultTitle: "Evaporating Cloud",
    defaultTags: ["strategy"],
  },
  {
    id: "frt_nbr",
    framework: "frt_nbr",
    label: "Future Reality Tree",
    description: "Test a proposed change and catch side effects early",
    defaultTitle: "Future Reality Tree",
    defaultTags: ["product"],
  },
  {
    id: "prt",
    framework: "prt_trt",
    label: "Prerequisite Tree",
    description: "Pair every obstacle with a milestone and sequence them",
    defaultTitle: "Prerequisite Tree",
    defaultTags: ["operations"],
  },
  {
    id: "trt",
    framework: "prt_trt",
    label: "Transition Tree",
    description: "Turn a milestone into concrete step-by-step actions",
    defaultTitle: "Transition Tree",
    defaultTags: ["operations"],
  },
  {
    id: "five_steps",
    framework: "five_steps",
    label: "Five Focusing Steps",
    description: "Find and widen the single bottleneck slowing your system",
    defaultTitle: "Five Focusing Steps",
    defaultTags: ["operations"],
  },
];

export const FRAMEWORK_LABELS: Record<TocFrameworkType, string> = {
  crt: "Current Reality Tree",
  cloud: "Evaporating Cloud",
  frt_nbr: "Future Reality Tree",
  prt_trt: "Prerequisite / Transition Tree",
  five_steps: "Five Focusing Steps",
};

export function createEmptyFiveSteps(): FiveFocusingStepsData {
  return {
    systemGoal: "",
    throughputT: "",
    inventoryI: "",
    operatingExpenseOE: "",
    dbrNotes: "",
    steps: {
      identify: "",
      exploit: "",
      subordinate: "",
      elevate: "",
      repeat: "",
    },
  };
}

export function createBlankGraph(): TocGraphData {
  return {
    nodes: [],
    edges: [],
  };
}

export function createTemplateGraphById(templateId: TocTemplateId): TocGraphData {
  if (templateId === "blank") {
    return createBlankGraph();
  }
  if (templateId === "prt") {
    return createTemplateGraph("prt_trt");
  }
  if (templateId === "trt") {
    return createTrtTemplateGraph();
  }
  return createTemplateGraph(templateId);
}

export function createTemplateGraph(framework: TocFrameworkType): TocGraphData {
  if (framework === "cloud") {
    return {
      nodes: [
        {
          id: "cloud-a",
          kind: "objective",
          code: "Objective",
          title: "",
          body: "Shared goal both sides want to protect...",
          x: 64,
          y: 210,
        },
        {
          id: "cloud-b",
          kind: "requirement",
          code: "Need A",
          title: "",
          body: "First essential requirement for the objective...",
          x: 388,
          y: 74,
        },
        {
          id: "cloud-c",
          kind: "requirement",
          code: "Need B",
          title: "",
          body: "Second essential requirement for the objective...",
          x: 388,
          y: 346,
        },
        {
          id: "cloud-d",
          kind: "prerequisite",
          code: "Choice A",
          title: "",
          body: "First action or position to satisfy Need A...",
          x: 716,
          y: 74,
        },
        {
          id: "cloud-dp",
          kind: "prerequisite",
          code: "Choice B",
          title: "",
          body: "Opposing action or position to satisfy Need B...",
          x: 716,
          y: 346,
        },
      ],
      edges: [
        {
          id: "e-ab",
          sourceId: "cloud-a",
          targetId: "cloud-b",
          assumptions: [],
          injection: "",
        },
        {
          id: "e-ac",
          sourceId: "cloud-a",
          targetId: "cloud-c",
          assumptions: [],
          injection: "",
        },
        {
          id: "e-bd",
          sourceId: "cloud-b",
          targetId: "cloud-d",
          assumptions: [],
          injection: "",
        },
        {
          id: "e-cdp",
          sourceId: "cloud-c",
          targetId: "cloud-dp",
          assumptions: [],
          injection: "",
        },
        {
          id: "e-conflict",
          sourceId: "cloud-d",
          targetId: "cloud-dp",
          isConflict: true,
          assumptions: [],
          injection: "",
        },
      ],
    };
  }

  if (framework === "crt") {
    return {
      nodes: [
        {
          id: "crt-ude-1",
          kind: "ude",
          code: "Symptom 1",
          title: "",
          body: "What recurring pain or friction keeps showing up?",
          x: 180,
          y: 52,
        },
        {
          id: "crt-ude-2",
          kind: "ude",
          code: "Symptom 2",
          title: "",
          body: "What second visible problem connects to this?",
          x: 520,
          y: 52,
        },
        {
          id: "crt-fact-1",
          kind: "fact",
          code: "Intermediate Cause",
          title: "",
          body: "What daily pattern or bottleneck produces those symptoms?",
          x: 350,
          y: 222,
        },
        {
          id: "crt-core",
          kind: "core_problem",
          code: "Root Cause",
          title: "",
          body: "What single underlying root cause drives everything above?",
          x: 350,
          y: 392,
        },
      ],
      edges: [
        { id: "crt-e-1", sourceId: "crt-core", targetId: "crt-fact-1" },
        { id: "crt-e-2", sourceId: "crt-fact-1", targetId: "crt-ude-1" },
        { id: "crt-e-3", sourceId: "crt-fact-1", targetId: "crt-ude-2" },
      ],
    };
  }

  if (framework === "frt_nbr") {
    return {
      nodes: [
        {
          id: "frt-de-1",
          kind: "de",
          code: "Desired Outcome",
          title: "",
          body: "What clear win proves the bold idea works?",
          x: 180,
          y: 66,
        },
        {
          id: "frt-nbr-ude",
          kind: "ude",
          code: "Hidden Risk",
          title: "",
          body: "What unintended side effect could this idea trigger?",
          x: 550,
          y: 66,
        },
        {
          id: "frt-inj-1",
          kind: "injection",
          code: "Bold Idea",
          title: "",
          body: "Describe the new change or strategic bet...",
          x: 180,
          y: 274,
        },
        {
          id: "frt-trim-1",
          kind: "trimming_injection",
          code: "Safeguard",
          title: "",
          body: "What guardrail neutralizes the hidden risk?",
          x: 550,
          y: 274,
        },
      ],
      edges: [
        { id: "frt-e-1", sourceId: "frt-inj-1", targetId: "frt-de-1" },
        { id: "frt-e-2", sourceId: "frt-inj-1", targetId: "frt-nbr-ude" },
        { id: "frt-e-3", sourceId: "frt-trim-1", targetId: "frt-nbr-ude" },
      ],
    };
  }

  if (framework === "prt_trt") {
    return {
      subMode: "prt",
      nodes: [
        {
          id: "prt-goal",
          kind: "objective",
          code: "Target Goal",
          title: "",
          body: "Where do you want to arrive once obstacles are cleared?",
          x: 360,
          y: 44,
        },
        {
          id: "prt-obs-1",
          kind: "obstacle",
          code: "Obstacle 1",
          title: "",
          body: "First major blocker standing in the way...",
          x: 120,
          y: 218,
        },
        {
          id: "prt-io-1",
          kind: "io",
          code: "Milestone 1",
          title: "",
          body: "Concrete milestone that overcomes Obstacle 1...",
          x: 510,
          y: 218,
        },
        {
          id: "prt-obs-2",
          kind: "obstacle",
          code: "Obstacle 2",
          title: "",
          body: "Second blocker to clear early...",
          x: 120,
          y: 388,
        },
        {
          id: "prt-io-2",
          kind: "io",
          code: "Milestone 2",
          title: "",
          body: "Concrete milestone that overcomes Obstacle 2...",
          x: 510,
          y: 388,
        },
      ],
      edges: [
        { id: "prt-e-1", sourceId: "prt-obs-1", targetId: "prt-io-1" },
        { id: "prt-e-2", sourceId: "prt-obs-2", targetId: "prt-io-2" },
        { id: "prt-e-3", sourceId: "prt-io-2", targetId: "prt-io-1" },
        { id: "prt-e-4", sourceId: "prt-io-1", targetId: "prt-goal" },
      ],
    };
  }

  return {
    nodes: [],
    edges: [],
    fiveSteps: createEmptyFiveSteps(),
  };
}

export function createTrtTemplateGraph(): TocGraphData {
  return {
    subMode: "trt",
    nodes: [
      {
        id: "trt-outcome",
        kind: "objective",
        code: "Target Outcome",
        title: "",
        body: "What concrete result should be true once these actions finish?",
        x: 350,
        y: 44,
      },
      {
        id: "trt-effect-1",
        kind: "de",
        code: "Expected Result",
        title: "",
        body: "What changes right after Step 1 succeeds?",
        x: 350,
        y: 210,
      },
      {
        id: "trt-action-2",
        kind: "trt_step",
        code: "Step 2 Action",
        title: "",
        body: "Second concrete action that builds on the first result...",
        x: 640,
        y: 210,
      },
      {
        id: "trt-need-1",
        kind: "requirement",
        code: "Starting Need",
        title: "",
        body: "What gap or need right now makes Step 1 necessary?",
        x: 170,
        y: 382,
      },
      {
        id: "trt-action-1",
        kind: "trt_step",
        code: "Step 1 Action",
        title: "",
        body: "First specific, testable step you will take...",
        x: 520,
        y: 382,
      },
    ],
    edges: [
      { id: "trt-e-1", sourceId: "trt-need-1", targetId: "trt-effect-1" },
      { id: "trt-e-2", sourceId: "trt-action-1", targetId: "trt-effect-1" },
      { id: "trt-e-3", sourceId: "trt-effect-1", targetId: "trt-outcome" },
      { id: "trt-e-4", sourceId: "trt-action-2", targetId: "trt-outcome" },
    ],
  };
}

export function parseTocGraph(graphJson: string, framework: TocFrameworkType): TocGraphData {
  try {
    const parsed = JSON.parse(graphJson) as Partial<TocGraphData>;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      subMode: parsed.subMode,
      fiveSteps: parsed.fiveSteps ?? (framework === "five_steps" ? createEmptyFiveSteps() : undefined),
    };
  } catch {
    return createBlankGraph();
  }
}

export function isGraphMeaningfullyPopulated(
  framework: TocFrameworkType,
  graph: TocGraphData
): boolean {
  if (framework === "five_steps") {
    const fs = graph.fiveSteps;
    if (!fs) return false;
    return Boolean(
      fs.systemGoal.trim() ||
        fs.throughputT.trim() ||
        fs.inventoryI.trim() ||
        fs.operatingExpenseOE.trim() ||
        fs.dbrNotes.trim() ||
        Object.values(fs.steps).some((v) => v.trim().length > 0)
    );
  }
  return graph.nodes.length > 0 || graph.edges.length > 0;
}

export function extractTocSummaryInsight(tree: TocTreeRecord): string {
  const graph = parseTocGraph(tree.graphJson, tree.frameworkType);
  if (tree.frameworkType === "five_steps" && graph.fiveSteps) {
    if (graph.fiveSteps.steps.identify.trim()) {
      return `Bottleneck: ${graph.fiveSteps.steps.identify.trim()}`;
    }
    if (graph.fiveSteps.systemGoal.trim()) {
      return `System Goal: ${graph.fiveSteps.systemGoal.trim()}`;
    }
    return "Bottleneck audit worksheet";
  }

  const edgeInjection = graph.edges.find((e) => e.injection && e.injection.trim())?.injection?.trim();
  if (edgeInjection) return `Breakthrough: ${edgeInjection}`;

  const core = graph.nodes.find((n) => n.kind === "core_problem" && n.title.trim());
  if (core) return `Root Cause: ${core.title.trim()}`;

  const injNode = graph.nodes.find(
    (n) => (n.kind === "injection" || n.kind === "trimming_injection") && n.title.trim()
  );
  if (injNode) return `Idea: ${injNode.title.trim()}`;

  const first = graph.nodes.find((n) => n.title.trim());
  if (first) return first.title.trim();
  if (graph.nodes.length > 0) return `${graph.nodes.length} blocks mapped`;
  return "Blank canvas";
}

function nodeDisplayText(node: TocCanvasNode): string {
  const label = node.code?.trim();
  const text = node.title.trim();
  if (label && text) return `**${label}:** ${text}`;
  if (text) return text;
  if (label) return `**${label}**`;
  return "Untitled block";
}

export function formatBoardAsJournalMarkdown(
  title: string,
  framework: TocFrameworkType,
  graph: TocGraphData
): string {
  const lines: string[] = [];
  const label = FRAMEWORK_LABELS[framework] ?? "Whiteboard";
  lines.push(`*Exported from TOC Whiteboard · ${label}*`);
  lines.push("");

  if (framework === "five_steps" && graph.fiveSteps) {
    const fs = graph.fiveSteps;
    if (fs.systemGoal.trim()) {
      lines.push("## System Goal");
      lines.push(fs.systemGoal.trim());
      lines.push("");
    }
    const metrics: [string, string][] = [
      ["Throughput (T)", fs.throughputT.trim()],
      ["Inventory / WIP (I)", fs.inventoryI.trim()],
      ["Operating Expense (OE)", fs.operatingExpenseOE.trim()],
      ["Drum-Buffer-Rope", fs.dbrNotes.trim()],
    ].filter(([, v]) => Boolean(v)) as [string, string][];

    if (metrics.length > 0) {
      lines.push("## Throughput Accounting");
      for (const [k, v] of metrics) {
        lines.push(`- **${k}:** ${v}`);
      }
      lines.push("");
    }

    lines.push("## Five Focusing Steps");
    const stepEntries: [string, string][] = [
      ["1. Identify the Constraint", fs.steps.identify.trim()],
      ["2. Exploit the Constraint", fs.steps.exploit.trim()],
      ["3. Subordinate Everything Else", fs.steps.subordinate.trim()],
      ["4. Elevate the Constraint", fs.steps.elevate.trim()],
      ["5. Repeat & Prevent Inertia", fs.steps.repeat.trim()],
    ];
    for (const [heading, content] of stepEntries) {
      if (content) {
        lines.push(`### ${heading}`);
        lines.push(content);
        lines.push("");
      }
    }
    return lines.join("\n").trim();
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  if (graph.nodes.length > 0) {
    lines.push("## Key Blocks");
    for (const node of graph.nodes) {
      lines.push(`- ${nodeDisplayText(node)}`);
    }
    lines.push("");
  }

  if (graph.edges.length > 0) {
    lines.push("## Connections & Logic");
    for (const edge of graph.edges) {
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) continue;
      const srcLabel = src.title.trim() || src.code || "Block";
      const tgtLabel = tgt.title.trim() || tgt.code || "Block";
      const arrow = edge.isConflict ? "↔ (Conflict)" : "→";
      lines.push(`- ${srcLabel} ${arrow} ${tgtLabel}`);
      if (edge.assumptions?.some((a) => a.trim())) {
        for (const asmp of edge.assumptions.filter((a) => a.trim())) {
          lines.push(`  - *Assumption:* ${asmp.trim()}`);
        }
      }
      if (edge.injection?.trim()) {
        lines.push(`  - **Breakthrough:** ${edge.injection.trim()}`);
      }
    }
    lines.push("");
  }

  if (graph.nodes.length === 0 && graph.edges.length === 0) {
    lines.push(`Summary note created from "${title.trim() || "Untitled Board"}".`);
  }

  return lines.join("\n").trim();
}
