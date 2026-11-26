import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const host = env?.TAURI_DEV_HOST;

function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 72)
    .trim()
    .replace(/\.+$/, "");
  return cleaned || fallback;
}

function parseFrontmatter(raw: string, fallbackDate: string, fallbackTitle: string) {
  let date = fallbackDate;
  let title = fallbackTitle;
  let tags: string[] = [];
  let body = raw;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    const fm = match[1];
    body = match[2].replace(/^\r?\n+/, "");
    for (const line of fm.split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith("date:") || t.startsWith("logical_date:")) {
        const colon = t.indexOf(":");
        date = t.slice(colon + 1).trim().replace(/^"|"$/g, "") || date;
      } else if (t.startsWith("title:")) {
        title = t.slice(6).trim().replace(/^"|"$/g, "") || title;
      } else if (t.startsWith("tags:")) {
        const inner = t.slice(5).trim().replace(/^\[|\]$/g, "");
        tags = inner
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    }
  }
  return { date, title, tags, body };
}

function readJsonBody(req: { on: (ev: string, cb: (chunk: unknown) => void) => void }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
    });
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function athenaeumDevBridges(): Plugin {
  return {
    name: "athenaeum-dev-bridges",
    configureServer(server) {
      // ActivityTracker ledger bridge
      server.middlewares.use("/__dev/activitytracker", async (req, res) => {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const rawUrl = (req as { url?: string }).url || "/";
          const queryPart = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
          const params = new Map<string, string>();
          for (const pair of queryPart.split("&")) {
            if (!pair) continue;
            const eq = pair.indexOf("=");
            if (eq >= 0) {
              params.set(
                decodeURIComponent(pair.slice(0, eq)),
                decodeURIComponent(pair.slice(eq + 1))
              );
            }
          }
          const requestedPath = params.get("path") || null;
          const metaOnly = params.get("meta") === "1";

          const appData = env?.APPDATA || "";
          const candidates = requestedPath
            ? [requestedPath]
            : [
                path.join(appData, "Activity Tracker", "ledger-v1.json"),
                path.join(appData, "activitytracker", "ledger-v1.json"),
              ];

          const foundPath = candidates.find((p) => p && fs.existsSync(p));
          res.setHeader("Content-Type", "application/json");
          if (!foundPath) {
            res.end(JSON.stringify({ found: false, error: "ledger-v1.json not found" }));
            return;
          }
          if (metaOnly) {
            res.end(JSON.stringify({ found: true, path: foundPath }));
            return;
          }
          const raw = fs.readFileSync(foundPath, "utf-8");
          const ledger = JSON.parse(raw);
          res.end(JSON.stringify({ found: true, path: foundPath, ledger }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ found: false, error: String(err) }));
        }
      });

      // Local Markdown Vault dev bridge (mirrors Rust vault.rs directly on disk during browser QA)
      server.middlewares.use("/__dev/vault", async (req, res) => {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const homeDir = env?.USERPROFILE || env?.HOME || "";
          const defaultRoot = homeDir
            ? path.join(homeDir, "Documents", "Athenaeum Notes")
            : path.join(".", "Athenaeum Notes");

          const ensureDirs = (root: string) => {
            const resolved = root?.trim() || defaultRoot;
            for (const sub of ["Daily", "Reflections", "Inbox", "Books", "TOC"]) {
              fs.mkdirSync(path.join(resolved, sub), { recursive: true });
            }
            return resolved;
          };

          const rawUrl = (req as { url?: string }).url || "/";
          const method = (req as { method?: string }).method || "GET";
          const body =
            method === "POST"
              ? await readJsonBody(
                  req as unknown as { on: (ev: string, cb: (chunk: unknown) => void) => void }
                )
              : {};

          const vaultRoot = ensureDirs(String(body.vaultPath || ""));
          res.setHeader("Content-Type", "application/json");

          if (rawUrl.startsWith("/init")) {
            res.end(JSON.stringify({ ok: true, vaultPath: vaultRoot }));
            return;
          }

          const buildVaultIndex = () => {
            const folders = ["Reflections", "Books", "Daily", "Inbox"] as const;
            const out: {
              folder: string;
              fileName: string;
              filePath: string;
              title: string;
              date: string;
              tags: string[];
              body: string;
              updatedAt: string;
            }[] = [];

            const extractInlineTags = (text: string): string[] => {
              const found: string[] = [];
              const re = /(?:^|[\s(\[])#([a-zA-Z][a-zA-Z0-9_/-]+)/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(text)) !== null) {
                const t = m[1].toLowerCase();
                if (t.length >= 2 && !found.includes(t)) found.push(t);
              }
              return found;
            };

            for (const folder of folders) {
              const dir = path.join(vaultRoot, folder);
              if (!fs.existsSync(dir)) continue;
              for (const fileName of fs.readdirSync(dir)) {
                if (!fileName.endsWith(".md")) continue;
                const full = path.join(dir, fileName);
                try {
                  const raw = fs.readFileSync(full, "utf-8");
                  const stem = fileName.slice(0, -3);
                  let fnDate = "";
                  let fnTitle = stem;
                  if (folder === "Daily") {
                    fnDate = stem;
                    fnTitle = stem;
                  } else if (folder === "Books") {
                    fnDate = "";
                    fnTitle = stem;
                  } else {
                    const sep = stem.indexOf(" - ");
                    if (sep >= 0) {
                      fnDate = stem.slice(0, sep).trim();
                      fnTitle = stem.slice(sep + 3).trim();
                    }
                  }
                  const parsed = parseFrontmatter(raw, fnDate, fnTitle);
                  const tags = [...parsed.tags];
                  for (const t of extractInlineTags(parsed.body)) {
                    if (!tags.some((e) => e.toLowerCase() === t)) tags.push(t);
                  }
                  const updatedAt = fs.statSync(full).mtime.toISOString();
                  out.push({
                    folder,
                    fileName,
                    filePath: full,
                    title: parsed.title,
                    date: parsed.date,
                    tags,
                    body: parsed.body,
                    updatedAt,
                  });
                } catch {
                  // Skip unreadable file
                }
              }
            }
            out.sort((a, b) =>
              b.date !== a.date
                ? b.date.localeCompare(a.date)
                : b.updatedAt.localeCompare(a.updatedAt)
            );
            return out;
          };

          const trimSnippet = (line: string, needleLower: string) => {
            const trimmed = line.trim();
            if (trimmed.length <= 140) return trimmed;
            if (!needleLower) return `${trimmed.slice(0, 136)}...`;
            const idx = trimmed.toLowerCase().indexOf(needleLower);
            if (idx >= 0) {
              const start = Math.max(0, idx - 42);
              const end = Math.min(trimmed.length, start + 132);
              return `${start > 0 ? "..." : ""}${trimmed.slice(start, end)}${end < trimmed.length ? "..." : ""}`;
            }
            return `${trimmed.slice(0, 136)}...`;
          };

          if (rawUrl.startsWith("/index")) {
            res.end(JSON.stringify({ notes: buildVaultIndex() }));
            return;
          }

          if (rawUrl.startsWith("/search")) {
            const query = String(body.query || "").trim().toLowerCase();
            const tagFilter = String(body.tagFilter || "").trim().replace(/^#/, "").toLowerCase();
            const indexed = buildVaultIndex();
            const results: { note: (typeof indexed)[number]; snippet: string; matchLine: number }[] = [];

            for (const note of indexed) {
              if (tagFilter && !note.tags.some((t) => t.toLowerCase() === tagFilter)) {
                continue;
              }
              if (!query) {
                const preview =
                  note.body
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .find((l) => l && !l.startsWith("#")) || note.title;
                results.push({ note, snippet: trimSnippet(preview, ""), matchLine: 1 });
                continue;
              }
              const lines = note.body.split(/\r?\n/);
              let hit: { snippet: string; matchLine: number } | null = null;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(query)) {
                  hit = { snippet: trimSnippet(lines[i], query), matchLine: i + 1 };
                  break;
                }
              }
              if (!hit) {
                const titleHit = note.title.toLowerCase().includes(query);
                const fileHit = note.fileName.toLowerCase().includes(query);
                const tagHit = note.tags.some((t) => t.toLowerCase().includes(query));
                if (titleHit || fileHit || tagHit) {
                  const preview =
                    lines.map((l) => l.trim()).find((l) => l.length > 0) || note.title;
                  hit = { snippet: trimSnippet(preview, query), matchLine: 1 };
                }
              }
              if (hit) results.push({ note, ...hit });
            }
            res.end(JSON.stringify({ results }));
            return;
          }

          if (rawUrl.startsWith("/backlinks")) {
            const targetLower = String(body.targetTitle || "").trim().toLowerCase();
            const exclude = String(body.excludeFileName || "").trim().toLowerCase();
            const mentions: {
              sourceFolder: string;
              sourceFileName: string;
              sourceTitle: string;
              sourceDate: string;
              contextLine: string;
            }[] = [];

            if (targetLower) {
              const indexed = buildVaultIndex();
              const linkRe = /\[\[([^\]]+)\]\]/g;
              for (const note of indexed) {
                if (exclude && note.fileName.toLowerCase() === exclude) continue;
                for (const line of note.body.split(/\r?\n/)) {
                  linkRe.lastIndex = 0;
                  let matched = false;
                  let m: RegExpExecArray | null;
                  while ((m = linkRe.exec(line)) !== null) {
                    const target = m[1].split("|")[0].split("#")[0].trim().toLowerCase();
                    if (target === targetLower) {
                      matched = true;
                      break;
                    }
                  }
                  if (matched) {
                    mentions.push({
                      sourceFolder: note.folder,
                      sourceFileName: note.fileName,
                      sourceTitle: note.title,
                      sourceDate: note.date,
                      contextLine: trimSnippet(line, targetLower),
                    });
                    break;
                  }
                }
              }
            }
            res.end(JSON.stringify({ mentions }));
            return;
          }

          if (rawUrl.startsWith("/note-save")) {
            const folder = String(body.folder || "");
            const fileName = path.basename(String(body.fileName || ""));
            const nextBody = String(body.body || "");
            if (!["Reflections", "Books", "Daily", "Inbox"].includes(folder) || !fileName) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid folder or filename" }));
              return;
            }
            const targetPath = path.join(vaultRoot, folder, fileName);
            const nowIso = new Date().toISOString();
            let fmBlock = "";
            if (fs.existsSync(targetPath)) {
              const existing = fs.readFileSync(targetPath, "utf-8");
              const m = existing.match(/^---\r?\n([\s\S]*?)\r?\n---/);
              if (m) {
                let sawUpdated = false;
                const lines = m[1].split(/\r?\n/).map((line) => {
                  if (line.trimStart().startsWith("updated_at:")) {
                    sawUpdated = true;
                    return `updated_at: ${nowIso}`;
                  }
                  return line;
                });
                if (!sawUpdated) lines.push(`updated_at: ${nowIso}`);
                fmBlock = `---\n${lines.join("\n")}\n---\n\n`;
              }
            }
            fs.writeFileSync(targetPath, `${fmBlock}${nextBody.trimEnd()}\n`, "utf-8");
            const note = buildVaultIndex().find(
              (n) => n.folder === folder && n.fileName === fileName
            );
            res.end(JSON.stringify({ note }));
            return;
          }

          if (rawUrl.startsWith("/toc-save")) {
            const logicalDate = String(body.logicalDate || new Date().toISOString().slice(0, 10));
            const title = String(body.title || "Untitled TOC Session").trim() || "Untitled TOC Session";
            const frameworkType = String(body.frameworkType || "crt");
            const tags = Array.isArray(body.tags)
              ? (body.tags as string[]).map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean)
              : [];
            if (!tags.some((t) => t.toLowerCase() === "toc")) tags.unshift("toc");
            const graphJson = String(body.graphJson || "{}");
            const safeTitle = sanitizeName(title, "Untitled TOC Session");
            const filePath = path.join(vaultRoot, "TOC", `${logicalDate} - ${safeTitle}.md`);
            const nowIso = new Date().toISOString();
            const fwNames: Record<string, string> = {
              crt: "Current Reality Tree (CRT)",
              cloud: "Evaporating Cloud (Conflict Resolution)",
              frt_nbr: "Future Reality Tree & Negative Branch Reservation",
              prt_trt: "Prerequisite Tree / Transition Tree",
              five_steps: "The Five Focusing Steps (Throughput Audit)",
            };

            let md = `---\ntype: toc\nframework: "${frameworkType}"\ndate: ${logicalDate}\ntitle: "${title.replace(
              /"/g,
              '\\"'
            )}"\ntags: [${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]\nupdated_at: ${nowIso}\n---\n\n# ${title}\n\n*Framework: ${
              fwNames[frameworkType] || "Theory of Constraints Analysis"
            }*\n`;

            try {
              const parsed = JSON.parse(graphJson) as {
                nodes?: { id: string; kind: string; title: string; body?: string }[];
                edges?: { sourceId: string; targetId: string; isConflict?: boolean; assumptions?: string[]; injection?: string }[];
                fiveSteps?: {
                  systemGoal?: string;
                  throughputT?: string;
                  inventoryI?: string;
                  operatingExpenseOE?: string;
                  dbrNotes?: string;
                  steps?: Record<string, string>;
                };
              };
              if (frameworkType === "five_steps" && parsed.fiveSteps) {
                const fsObj = parsed.fiveSteps;
                md += "\n## System Definition & Throughput Accounting\n";
                if (fsObj.systemGoal?.trim()) md += `- **System Goal:** ${fsObj.systemGoal.trim()}\n`;
                if (fsObj.throughputT?.trim()) md += `- **Throughput (T):** ${fsObj.throughputT.trim()}\n`;
                if (fsObj.inventoryI?.trim()) md += `- **Inventory / Investment (I):** ${fsObj.inventoryI.trim()}\n`;
                if (fsObj.operatingExpenseOE?.trim()) md += `- **Operating Expense (OE):** ${fsObj.operatingExpenseOE.trim()}\n`;
                if (fsObj.dbrNotes?.trim()) md += `- **Drum-Buffer-Rope (DBR):** ${fsObj.dbrNotes.trim()}\n`;
                if (fsObj.steps) {
                  md += "\n## The Five Focusing Steps\n";
                  const labels: [string, string, string][] = [
                    ["1", "Identify the Constraint", "identify"],
                    ["2", "Exploit the Constraint", "exploit"],
                    ["3", "Subordinate Everything Else", "subordinate"],
                    ["4", "Elevate the Constraint", "elevate"],
                    ["5", "Repeat & Prevent Inertia", "repeat"],
                  ];
                  for (const [num, lbl, key] of labels) {
                    const val = (fsObj.steps[key] || "").trim();
                    md += `\n### ${num}. ${lbl}\n${val || "_Not yet specified._"}\n`;
                  }
                }
              } else {
                const nodes = parsed.nodes ?? [];
                const edges = parsed.edges ?? [];
                const byId = new Map(nodes.map((n) => [n.id, n]));
                const keyNodes = nodes.filter((n) =>
                  ["core_problem", "injection", "trimming_injection", "objective"].includes(n.kind)
                );
                if (keyNodes.length > 0) {
                  md += "\n## Key Strategic Nodes\n";
                  for (const n of keyNodes) {
                    if (n.title.trim()) {
                      md += `- **${n.kind.replace(/_/g, " ").toUpperCase()}:** ${n.title.trim()}${
                        n.body?.trim() ? ` (${n.body.trim()})` : ""
                      }\n`;
                    }
                  }
                }
                const assumptionBlocks: string[] = [];
                for (const e of edges) {
                  const sTitle = byId.get(e.sourceId)?.title || e.sourceId;
                  const tTitle = byId.get(e.targetId)?.title || e.targetId;
                  const asmp = (e.assumptions ?? []).map((x) => x.trim()).filter(Boolean);
                  const inj = (e.injection || "").trim();
                  if (asmp.length > 0 || inj) {
                    let b = `- **${sTitle} -> ${tTitle}:**\n`;
                    for (const a of asmp) b += `  - Assumption: ${a}\n`;
                    if (inj) b += `  - **Winning Injection:** ${inj}\n`;
                    assumptionBlocks.push(b);
                  }
                }
                if (assumptionBlocks.length > 0) {
                  md += "\n## Surfaced Assumptions & Injections\n" + assumptionBlocks.join("");
                }
                const incoming = new Map<string, string[]>();
                for (const e of edges) {
                  if (e.isConflict) continue;
                  const list = incoming.get(e.targetId) ?? [];
                  list.push(byId.get(e.sourceId)?.title || e.sourceId);
                  incoming.set(e.targetId, list);
                }
                if (incoming.size > 0) {
                  md += "\n## Causal Logic Chains\n";
                  for (const [tid, causes] of incoming.entries()) {
                    md += `- **IF** ${causes.join(" AND ")}, **THEN** ${byId.get(tid)?.title || tid}\n`;
                  }
                }
                if (nodes.length > 0) {
                  md += "\n## Node Ledger\n";
                  for (const n of nodes) {
                    if (n.title.trim()) {
                      md += `- \`[${n.kind.toUpperCase()}]\` **${n.title.trim()}**${
                        n.body?.trim() ? `: ${n.body.trim()}` : ""
                      }\n`;
                    }
                  }
                }
              }
            } catch {
              // Keep base header if JSON malformed
            }

            fs.writeFileSync(filePath, md, "utf-8");
            res.end(JSON.stringify({ ok: true, filePath }));
            return;
          }

          if (rawUrl.startsWith("/book-note")) {
            const bookTitle = String(body.bookTitle || "Untitled Volume");
            const bookAuthor = String(body.bookAuthor || "Unknown Author");
            const pageNumber = Math.max(1, Number(body.pageNumber || 1));
            const quote = String(body.quote || "").trim();
            const note = String(body.note || "").trim();
            const createdAt = String(body.createdAt || new Date().toISOString());
            const safeTitle = sanitizeName(bookTitle, "Untitled Volume");
            const filePath = path.join(vaultRoot, "Books", `${safeTitle}.md`);
            const now = new Date();
            const displayTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
              now.getDate()
            ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
              now.getMinutes()
            ).padStart(2, "0")}`;

            if (!fs.existsSync(filePath)) {
              const header = `---\ntype: book-notes\ntitle: "${bookTitle.replace(
                /"/g,
                '\\"'
              )}"\nauthor: "${bookAuthor.replace(
                /"/g,
                '\\"'
              )}"\ncreated_at: ${createdAt}\nupdated_at: ${createdAt}\ntags: ["book", "reading"]\n---\n\n# ${bookTitle.trim()}\n\n*By ${
                bookAuthor.trim() || "Unknown Author"
              }*\n`;
              fs.writeFileSync(filePath, header, "utf-8");
            }

            let entry = `\n## p. ${pageNumber} · ${displayTime}\n`;
            if (quote) {
              entry +=
                "\n" +
                quote
                  .split(/\r?\n/)
                  .map((l) => `> ${l.trim()}`)
                  .join("\n") +
                "\n";
            }
            if (note) {
              entry += `\n${note}\n`;
            }

            let existing = fs.readFileSync(filePath, "utf-8");
            if (!existing.endsWith("\n")) existing += "\n";
            existing += entry;
            fs.writeFileSync(filePath, existing, "utf-8");
            res.end(JSON.stringify({ ok: true, filePath }));
            return;
          }

          if (rawUrl.startsWith("/promote")) {
            const logicalDate = String(body.logicalDate || new Date().toISOString().slice(0, 10));
            const title = String(body.title || "Quick Note");
            const content = String(body.content || "");
            const now = new Date();
            const stamp = `${String(now.getHours()).padStart(2, "0")}${String(
              now.getMinutes()
            ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
            const safeTitle = sanitizeName(title, "Quick Note");
            const filePath = path.join(
              vaultRoot,
              "Inbox",
              `${logicalDate} - ${stamp} - ${safeTitle}.md`
            );
            const md = `---\ntype: inbox\nlogical_date: ${logicalDate}\ncreated_at: ${now.toISOString()}\ntitle: "${title.replace(
              /"/g,
              '\\"'
            )}"\n---\n\n# ${title.trim() || "Quick Note"}\n\n${content.trim()}\n`;
            fs.writeFileSync(filePath, md, "utf-8");
            res.end(JSON.stringify({ ok: true, filePath }));
            return;
          }

          if (rawUrl.startsWith("/daily/publish")) {
            const logicalDate = String(body.logicalDate || "");
            const memories = String(body.memories || "");
            const g1 = String(body.gratitude1 || "");
            const g2 = String(body.gratitude2 || "");
            const g3 = String(body.gratitude3 || "");
            const closing = String(body.closingThought || "");
            const tasks = Array.isArray(body.completedTasks) ? (body.completedTasks as string[]) : [];
            const focusMinutes = Number(body.focusMinutes || 0);
            const highlights = Array.isArray(body.blockHighlights)
              ? (body.blockHighlights as string[])
              : [];

            const focusHours = (focusMinutes / 60).toFixed(2);
            const tasksMd = tasks.length
              ? tasks.map((t) => `- [x] ${t}`).join("\n")
              : "- No completed tasks logged yet.";
            const blocksMd = highlights.length
              ? highlights.map((h) => `- ${h}`).join("\n")
              : "- No hourly activity blocks logged.";
            const filePath = path.join(vaultRoot, "Daily", `${logicalDate}.md`);
            const md = `---\ntype: daily-debrief\ndate: ${logicalDate}\npublished_at: ${new Date().toISOString()}\nfocus_hours: ${focusHours}\ntasks_completed: ${tasks.length}\nblocks_logged: ${highlights.length}\n---\n\n# Daily Debrief: ${logicalDate}\n\n## Day Summary\n- **Focus Logged:** ${(focusMinutes / 60).toFixed(1)}h (${focusMinutes} min)\n- **Tasks Completed:** ${tasks.length}\n\n### Completed Tasks\n${tasksMd}\n\n### Hourly Activity Highlights\n${blocksMd}\n\n## Memorable Moments & Wins\n${memories.trim() || "(None recorded)"}\n\n## 3 Specific Things I Am Grateful For\n1. ${g1.trim() || "(Empty)"}\n2. ${g2.trim() || "(Empty)"}\n3. ${g3.trim() || "(Empty)"}\n\n## Closing Thought & Tomorrow's Priority\n${closing.trim() || "(None recorded)"}\n`;
            fs.writeFileSync(filePath, md, "utf-8");
            res.end(JSON.stringify({ ok: true, filePath }));
            return;
          }

          if (rawUrl.startsWith("/weekly")) {
            const weekKey = String(body.weekKey || "2026-W48");
            const startDate = String(body.startDate || "");
            const endDate = String(body.endDate || "");
            const totalFocusMinutes = Number(body.totalFocusMinutes || 0);
            const totalFocusHours = totalFocusMinutes / 60;
            const goalsCompleted = Number(body.goalsCompleted || 0);
            const goalsPlanned = Number(body.goalsPlanned || 0);
            const categoryHours = (body.categoryHours || {}) as Record<string, number>;
            const dates = Array.isArray(body.dates) ? (body.dates as string[]) : [];
            const n8nWebhookUrl = String(body.n8nWebhookUrl || "").trim();

            const winsExcerpts: string[] = [];
            const gratitudeExcerpts: string[] = [];
            for (const d of dates) {
              const dailyPath = path.join(vaultRoot, "Daily", `${d}.md`);
              if (!fs.existsSync(dailyPath)) continue;
              const raw = fs.readFileSync(dailyPath, "utf-8");
              const winsMatch = raw.match(/## Memorable Moments & Wins\r?\n([\s\S]*?)(?:\r?\n## |$)/);
              if (winsMatch && winsMatch[1].trim() && winsMatch[1].trim() !== "(None recorded)") {
                winsExcerpts.push(`**${d}:** ${winsMatch[1].trim()}`);
              }
              const gratMatch = raw.match(/## 3 Specific Things I Am Grateful For\r?\n([\s\S]*?)(?:\r?\n## |$)/);
              if (gratMatch) {
                const lines = gratMatch[1]
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter((l) => l && !l.includes("(Empty)"));
                if (lines.length) {
                  gratitudeExcerpts.push(`**${d}:** ${lines.join(" | ")}`);
                }
              }
            }

            const catMd = Object.keys(categoryHours).length
              ? Object.entries(categoryHours)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => `- **${k}:** ${Number(v).toFixed(1)}h`)
                  .join("\n")
              : "- No hourly activity blocks logged during this window.";
            const winsMd = winsExcerpts.length
              ? winsExcerpts.map((w) => `- ${w}`).join("\n")
              : "- No Daily Debrief wins recorded in `/Daily` during this window.";
            const gratsMd = gratitudeExcerpts.length
              ? gratitudeExcerpts.map((g) => `- ${g}`).join("\n")
              : "- No Daily Debrief gratitudes recorded in `/Daily` during this window.";

            const generatedAt = new Date().toISOString();
            const filePath = path.join(vaultRoot, "Reflections", `${weekKey}-Weekly-Review.md`);
            const md = `---\ntype: weekly-synthesis\nweek: ${weekKey}\ndate: ${endDate}\ntitle: "${weekKey} Weekly Review"\ntags: ["weekly-review", "synthesis"]\nstart_date: ${startDate}\nend_date: ${endDate}\nfocus_hours: ${totalFocusHours.toFixed(2)}\ngoals_completed: ${goalsCompleted}\ngoals_planned: ${goalsPlanned}\ngenerated_at: ${generatedAt}\n---\n\n# Weekly Review: ${weekKey} (${startDate} to ${endDate})\n\n## Core Telemetry\n- **Total Focus:** ${totalFocusHours.toFixed(1)}h (${totalFocusMinutes} min)\n- **Goals Completed vs. Planned:** ${goalsCompleted} / ${goalsPlanned}\n\n## Hourly Time Distribution by Category\n${catMd}\n\n## Highlights & Wins from Daily Debriefs\n${winsMd}\n\n## Gratitudes Archived This Week\n${gratsMd}\n`;
            fs.writeFileSync(filePath, md, "utf-8");

            let webhookStatus: string | null = null;
            if (n8nWebhookUrl) {
              try {
                const resp = await fetch(n8nWebhookUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    weekKey,
                    startDate,
                    endDate,
                    totalFocusMinutes,
                    totalFocusHours,
                    goalsCompleted,
                    goalsPlanned,
                    categoryHours,
                    winsExcerpts,
                    gratitudeExcerpts,
                    filePath,
                    generatedAt,
                  }),
                });
                webhookStatus = `n8n webhook HTTP ${resp.status}`;
              } catch (err) {
                webhookStatus = `n8n webhook error: ${String(err)}`;
              }
            }

            res.end(
              JSON.stringify({
                report: {
                  weekKey,
                  startDate,
                  endDate,
                  totalFocusMinutes,
                  totalFocusHours,
                  goalsCompleted,
                  goalsPlanned,
                  categoryHours,
                  winsExcerpts,
                  gratitudeExcerpts,
                  filePath,
                  webhookStatus,
                  generatedAt,
                },
              })
            );
            return;
          }

          if (rawUrl.startsWith("/daily/list")) {
            const dir = path.join(vaultRoot, "Daily");
            const files = fs
              .readdirSync(dir)
              .filter((f) => f.endsWith(".md"))
              .map((f) => f.slice(0, -3))
              .sort()
              .reverse();
            res.end(JSON.stringify({ dates: files }));
            return;
          }

          if (rawUrl.startsWith("/daily/read")) {
            const logicalDate = String(body.logicalDate || "");
            const filePath = path.join(vaultRoot, "Daily", `${logicalDate}.md`);
            if (!fs.existsSync(filePath)) {
              res.end(JSON.stringify({ content: null }));
              return;
            }
            res.end(JSON.stringify({ content: fs.readFileSync(filePath, "utf-8") }));
            return;
          }

          if (rawUrl.startsWith("/reflections/list")) {
            const dir = path.join(vaultRoot, "Reflections");
            const entries = fs
              .readdirSync(dir)
              .filter((f) => f.endsWith(".md"))
              .map((fileName) => {
                const full = path.join(dir, fileName);
                const raw = fs.readFileSync(full, "utf-8");
                const stem = fileName.slice(0, -3);
                const sep = stem.indexOf(" - ");
                const fnDate = sep >= 0 ? stem.slice(0, sep).trim() : "";
                const fnTitle = sep >= 0 ? stem.slice(sep + 3).trim() : stem;
                const parsed = parseFrontmatter(raw, fnDate, fnTitle);
                const updatedAt = fs.statSync(full).mtime.toISOString();
                return {
                  fileName,
                  filePath: full,
                  date: parsed.date,
                  title: parsed.title,
                  tags: parsed.tags,
                  content: raw,
                  body: parsed.body,
                  updatedAt,
                };
              })
              .sort((a, b) =>
                b.date !== a.date
                  ? b.date.localeCompare(a.date)
                  : b.updatedAt.localeCompare(a.updatedAt)
              );
            res.end(JSON.stringify({ entries }));
            return;
          }

          if (rawUrl.startsWith("/reflections/save")) {
            const dir = path.join(vaultRoot, "Reflections");
            const logicalDate = String(body.logicalDate || "");
            const rawTitle = String(body.title || "").trim() || "Untitled Reflection";
            const safeTitle = sanitizeName(rawTitle, "Untitled Reflection");
            const tags = Array.isArray(body.tags)
              ? (body.tags as string[]).map((t) => String(t).trim()).filter(Boolean)
              : [];
            const contentBody = String(body.body || "");
            const existingFileName = body.existingFileName ? path.basename(String(body.existingFileName)) : "";

            const fileName = `${logicalDate} - ${safeTitle}.md`;
            const targetPath = path.join(dir, fileName);
            if (existingFileName && existingFileName !== fileName) {
              const oldPath = path.join(dir, existingFileName);
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            const nowIso = new Date().toISOString();
            const tagsYaml = tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ");
            const md = `---\ntype: reflection\ndate: ${logicalDate}\ntitle: "${rawTitle.replace(
              /"/g,
              '\\"'
            )}"\ntags: [${tagsYaml}]\nupdated_at: ${nowIso}\n---\n\n${contentBody.trimEnd()}\n`;
            fs.writeFileSync(targetPath, md, "utf-8");

            res.end(
              JSON.stringify({
                entry: {
                  fileName,
                  filePath: targetPath,
                  date: logicalDate,
                  title: rawTitle,
                  tags,
                  content: md,
                  body: contentBody,
                  updatedAt: nowIso,
                },
              })
            );
            return;
          }

          if (rawUrl.startsWith("/reflections/delete")) {
            const fileName = path.basename(String(body.fileName || ""));
            if (fileName) {
              const full = path.join(vaultRoot, "Reflections", fileName);
              if (fs.existsSync(full)) fs.unlinkSync(full);
            }
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (rawUrl.startsWith("/recall-scan")) {
            const fnvHash = (cat: string, fileName: string, cue: string, ans: string): string => {
              let h = 0xcbf29ce484222325n;
              const prime = 0x100000001b3n;
              const mask = 0xffffffffffffffffn;
              for (const part of [cat, fileName, cue.trim(), ans.trim()]) {
                for (let idx = 0; idx < part.length; idx++) {
                  h ^= BigInt(part.charCodeAt(idx) & 0xff);
                  h = (h * prime) & mask;
                }
                h ^= 0xffn;
                h = (h * prime) & mask;
              }
              return `rc-${h.toString(16).padStart(16, "0")}`;
            };

            const splitFm = (raw: string): { meta: Record<string, string>; body: string } => {
              const meta: Record<string, string> = {};
              const cleaned = raw.replace(/^\uFEFF/, "");
              const m = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
              if (!m) return { meta, body: cleaned };
              for (const line of m[1].split(/\r?\n/)) {
                const idx = line.indexOf(":");
                if (idx > 0) {
                  meta[line.slice(0, idx).trim().toLowerCase()] = line
                    .slice(idx + 1)
                    .trim()
                    .replace(/^["']|["']$/g, "");
                }
              }
              return { meta, body: m[2] };
            };

            const firstH1 = (body: string, fallback: string): string => {
              for (const l of body.split(/\r?\n/)) {
                const t = l.trim();
                if (t.startsWith("# ")) return t.slice(2).trim() || fallback;
              }
              return fallback;
            };

            const items: Array<{
              cardHash: string;
              sourceFile: string;
              sourceFileName: string;
              sourceCategory: "book" | "toc" | "snippet";
              sourceTitle: string;
              contextBadge: string;
              cue: string;
              answer: string;
            }> = [];

            const listMd = (folderName: string): string[] => {
              const dir = path.join(vaultRoot, folderName);
              if (!fs.existsSync(dir)) return [];
              return fs
                .readdirSync(dir)
                .filter((f) => f.toLowerCase().endsWith(".md"))
                .sort()
                .map((f) => path.join(dir, f));
            };

            // 1. Books/*.md
            for (const fp of listMd("Books")) {
              const raw = fs.readFileSync(fp, "utf-8");
              const fileName = path.basename(fp);
              const { meta, body } = splitFm(raw);
              const title = meta.title || firstH1(body, fileName.replace(/\.md$/i, ""));
              let curHeading = "";
              let quotes: string[] = [];
              let notes: string[] = [];
              const flush = () => {
                const q = quotes.join("\n").trim();
                const n = notes.join("\n").trim();
                quotes = [];
                notes = [];
                if (!q && !n) return;
                const pageRef = curHeading.split("·")[0].trim();
                const ctx = pageRef ? `${title}, ${pageRef}` : title;
                const cue =
                  n && q
                    ? n
                    : q
                    ? `Recall the core highlighted passage from ${ctx}.`
                    : `Recall your margin insight from ${ctx}.`;
                const ans = q || n;
                items.push({
                  cardHash: fnvHash("book", fileName, cue, ans),
                  sourceFile: fp,
                  sourceFileName: fileName,
                  sourceCategory: "book",
                  sourceTitle: title,
                  contextBadge: ctx,
                  cue,
                  answer: ans,
                });
              };
              for (const line of body.split(/\r?\n/)) {
                const t = line.trim();
                if (t.startsWith("## ")) {
                  flush();
                  curHeading = t.slice(3).trim();
                  continue;
                }
                if (!curHeading) continue;
                if (t.startsWith("> ")) quotes.push(t.slice(2).trim());
                else if (t && t !== ">" && !t.startsWith("*By ") && !t.startsWith("---")) {
                  notes.push(t);
                }
              }
              flush();
            }

            // 2. TOC/*.md
            for (const fp of listMd("TOC")) {
              const raw = fs.readFileSync(fp, "utf-8");
              const fileName = path.basename(fp);
              const { meta, body } = splitFm(raw);
              const title = meta.title || firstH1(body, fileName.replace(/\.md$/i, ""));
              let inAssump = false;
              let curEdge = "";
              let curAns: string[] = [];
              const beforeLen = items.length;
              const flushEdge = () => {
                const ans = curAns.join("\n").trim();
                curAns = [];
                if (!curEdge || !ans) return;
                const cue = `In "${title}", what hidden assumption or injection resolves: ${curEdge}?`;
                items.push({
                  cardHash: fnvHash("toc", fileName, cue, ans),
                  sourceFile: fp,
                  sourceFileName: fileName,
                  sourceCategory: "toc",
                  sourceTitle: title,
                  contextBadge: `TOC · ${title}`,
                  cue,
                  answer: ans,
                });
              };
              const conflicts: string[] = [];
              const injections: string[] = [];
              for (const line of body.split(/\r?\n/)) {
                const t = line.trim();
                if (t.startsWith("## ")) {
                  if (inAssump) {
                    flushEdge();
                    curEdge = "";
                  }
                  inAssump = t.toLowerCase() === "## surfaced assumptions & injections";
                  continue;
                }
                if (inAssump) {
                  if (t.startsWith("- **")) {
                    flushEdge();
                    curEdge = t
                      .slice(4)
                      .replace(/:\*\*$/, "")
                      .replace(/\*\*$/, "")
                      .replace(/:$/, "")
                      .trim();
                  } else if (t.startsWith("- Assumption:") || t.startsWith("- **Winning Injection:**")) {
                    curAns.push(
                      t.replace(/^- /, "").replace("**Winning Injection:**", "Winning Injection:").trim()
                    );
                  }
                } else {
                  if (
                    t.includes("`[CONFLICT]`") ||
                    t.includes("`[UDE]`") ||
                    t.includes("`[OBSTACLE]`") ||
                    t.includes("`[ROOT_CAUSE]`")
                  ) {
                    conflicts.push(t.replace(/^- /, "").replace(/\*\*/g, ""));
                  } else if (t.includes("`[INJECTION]`") || t.includes("`[INTERMEDIATE]`")) {
                    injections.push(t.replace(/^- /, "").replace(/\*\*/g, ""));
                  }
                }
              }
              if (inAssump) flushEdge();
              if (items.length === beforeLen && conflicts.length > 0 && injections.length > 0) {
                const cue = `In "${title}", what injection resolves ${conflicts[0]}?`;
                const ans = injections.join("\n");
                items.push({
                  cardHash: fnvHash("toc", fileName, cue, ans),
                  sourceFile: fp,
                  sourceFileName: fileName,
                  sourceCategory: "toc",
                  sourceTitle: title,
                  contextBadge: `TOC · ${title}`,
                  cue,
                  answer: ans,
                });
              }
            }

            // 3. Reflections/*.md and Inbox/*.md (#recall blocks)
            const stripTag = (s: string) => s.replace(/#recall/gi, "").trim();
            for (const folderName of ["Reflections", "Inbox"]) {
              for (const fp of listMd(folderName)) {
                const raw = fs.readFileSync(fp, "utf-8");
                const fileName = path.basename(fp);
                const { meta, body } = splitFm(raw);
                const title = meta.title || firstH1(body, fileName.replace(/\.md$/i, ""));
                const lines = body.split(/\r?\n/);
                const beforeLen = items.length;
                for (let idx = 0; idx < lines.length; idx++) {
                  const t = lines[idx].trim();
                  if (!/#recall\b/i.test(t)) continue;
                  if (t.includes("::")) {
                    const clean = stripTag(t.replace(/^[-*]\s+/, ""));
                    const [q, ...rest] = clean.split("::");
                    const cue = q.trim();
                    const ans = rest.join("::").trim();
                    if (cue && ans) {
                      items.push({
                        cardHash: fnvHash("snippet", fileName, cue, ans),
                        sourceFile: fp,
                        sourceFileName: fileName,
                        sourceCategory: "snippet",
                        sourceTitle: title,
                        contextBadge: `${folderName} · ${title}`,
                        cue,
                        answer: ans,
                      });
                    }
                  } else if (t.startsWith("#")) {
                    const cue = stripTag(t.replace(/^#+\s*/, ""));
                    const block: string[] = [];
                    let j = idx + 1;
                    while (j < lines.length && !lines[j].trim().startsWith("#")) {
                      if (lines[j].trim()) block.push(lines[j].trim());
                      j++;
                    }
                    idx = j - 1;
                    const ans = block.join("\n").trim();
                    if (cue && ans) {
                      items.push({
                        cardHash: fnvHash("snippet", fileName, cue, ans),
                        sourceFile: fp,
                        sourceFileName: fileName,
                        sourceCategory: "snippet",
                        sourceTitle: title,
                        contextBadge: `${folderName} · ${title}`,
                        cue,
                        answer: ans,
                      });
                    }
                  } else {
                    const ans = stripTag(t.replace(/^[-*]\s+/, ""));
                    if (ans) {
                      const cue = `Recall your #recall note from "${title}" (${folderName}).`;
                      items.push({
                        cardHash: fnvHash("snippet", fileName, cue, ans),
                        sourceFile: fp,
                        sourceFileName: fileName,
                        sourceCategory: "snippet",
                        sourceTitle: title,
                        contextBadge: `${folderName} · ${title}`,
                        cue,
                        answer: ans,
                      });
                    }
                  }
                }
                if (items.length === beforeLen && (meta.tags || "").toLowerCase().includes("recall")) {
                  const cleanBody = lines
                    .filter((l) => !l.trim().startsWith("# "))
                    .join("\n")
                    .trim();
                  if (cleanBody) {
                    const cue = `Recall the key synthesis from "${title}".`;
                    items.push({
                      cardHash: fnvHash("snippet", fileName, cue, cleanBody),
                      sourceFile: fp,
                      sourceFileName: fileName,
                      sourceCategory: "snippet",
                      sourceTitle: title,
                      contextBadge: `${folderName} · ${title}`,
                      cue,
                      answer: cleanBody,
                    });
                  }
                }
              }
            }

            res.end(JSON.stringify({ items }));
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Unknown vault endpoint" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // Dev-only .ics feed fetcher/parser bridge mirroring Rust ics.rs
      server.middlewares.use("/__dev/ics", async (req, res) => {
        try {
          const fs = await import("node:fs");
          const body = await readJsonBody(
            req as unknown as { on: (ev: string, cb: (chunk: unknown) => void) => void }
          );
          const urls = Array.isArray(body.urls) ? (body.urls as string[]) : [];
          const events: Array<Record<string, unknown>> = [];
          const errors: string[] = [];

          const parseIcs = (raw: string, feedUrl: string) => {
            const unfolded: string[] = [];
            for (const rawLine of raw.split(/\r?\n/)) {
              if ((rawLine.startsWith(" ") || rawLine.startsWith("\t")) && unfolded.length) {
                unfolded[unfolded.length - 1] += rawLine.slice(1);
              } else {
                unfolded.push(rawLine);
              }
            }
            const parseDt = (val: string): { date: string; time: string; allDay: boolean } | null => {
              const c = val.trim();
              if (/^\d{8}$/.test(c)) {
                return {
                  date: `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`,
                  time: "00:00",
                  allDay: true,
                };
              }
              const m = c.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
              if (!m) return null;
              if (m[7] === "Z") {
                const dt = new Date(
                  Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
                );
                return {
                  date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
                    dt.getDate()
                  ).padStart(2, "0")}`,
                  time: `${String(dt.getHours()).padStart(2, "0")}:${String(
                    dt.getMinutes()
                  ).padStart(2, "0")}`,
                  allDay: false,
                };
              }
              return {
                date: `${m[1]}-${m[2]}-${m[3]}`,
                time: `${m[4]}:${m[5]}`,
                allDay: false,
              };
            };

            let inEvent = false;
            let uid = "";
            let summary = "";
            let location = "";
            let dtStart = "";
            let dtEnd = "";
            for (const line of unfolded) {
              const up = line.toUpperCase();
              if (up === "BEGIN:VEVENT") {
                inEvent = true;
                uid = summary = location = dtStart = dtEnd = "";
              } else if (up === "END:VEVENT") {
                if (inEvent && dtStart) {
                  const s = parseDt(dtStart);
                  if (s) {
                    const e = dtEnd ? parseDt(dtEnd) : null;
                    events.push({
                      id: `ics_${(uid || `${s.date}_${s.time}_${summary}`).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
                      feedUrl,
                      title: summary.replace(/\\,/g, ",").replace(/\\n/gi, " ").trim() || "Calendar Event",
                      date: s.date,
                      startTime: s.time,
                      endTime: e ? e.time : s.allDay ? "23:59" : s.time,
                      location: location.replace(/\\,/g, ",").trim(),
                      allDay: s.allDay,
                      updatedAt: new Date().toISOString(),
                    });
                  }
                }
                inEvent = false;
              } else if (inEvent) {
                const colon = line.indexOf(":");
                if (colon > 0) {
                  const prop = line.slice(0, colon).split(";")[0].toUpperCase();
                  const val = line.slice(colon + 1);
                  if (prop === "UID") uid = val.trim();
                  else if (prop === "SUMMARY") summary = val;
                  else if (prop === "LOCATION") location = val;
                  else if (prop === "DTSTART") dtStart = val.trim();
                  else if (prop === "DTEND") dtEnd = val.trim();
                }
              }
            }
          };

          for (const rawUrl of urls) {
            const u = String(rawUrl || "").trim();
            if (!u) continue;
            try {
              if (u.startsWith("file:///")) {
                const p = u.slice(8).replace(/\//g, "\\");
                parseIcs(fs.readFileSync(p, "utf-8"), u);
              } else if (fs.existsSync(u)) {
                parseIcs(fs.readFileSync(u, "utf-8"), u);
              } else {
                const norm = u.startsWith("webcal://") ? `https://${u.slice(9)}` : u;
                const resp = await fetch(norm);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                parseIcs(await resp.text(), u);
              }
            } catch (err) {
              errors.push(String(err));
            }
          }

          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              events,
              report: {
                feedsChecked: urls.filter((x) => String(x || "").trim()).length,
                eventsSynced: events.length,
                errors,
              },
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ events: [], report: { feedsChecked: 0, eventsSynced: 0, errors: [String(err)] } }));
        }
      });

      // Local Books folder dev bridge (mirrors Rust library.rs directly during browser QA)
      server.middlewares.use("/__dev/books", async (req, res) => {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const defaultBooksRoot = "";
          const rawUrl = (req as { url?: string }).url || "/";
          const qIdx = rawUrl.indexOf("?");
          const params = new Map<string, string>();
          if (qIdx >= 0) {
            for (const pair of rawUrl.slice(qIdx + 1).split("&")) {
              const eq = pair.indexOf("=");
              if (eq > 0) {
                params.set(
                  decodeURIComponent(pair.slice(0, eq)),
                  decodeURIComponent(pair.slice(eq + 1))
                );
              }
            }
          }

          if (rawUrl.startsWith("/file")) {
            const targetPath = params.get("path") || "";
            if (!targetPath || !fs.existsSync(targetPath)) {
              res.statusCode = 404;
              res.end("Book file not found");
              return;
            }
            const lower = targetPath.toLowerCase();
            res.setHeader(
              "Content-Type",
              lower.endsWith(".epub") ? "application/epub+zip" : "application/pdf"
            );
            const bytes = fs.readFileSync(targetPath);
            res.end(bytes);
            return;
          }

          if (rawUrl.startsWith("/scan")) {
            const folder = (params.get("folder") || "").trim() || defaultBooksRoot;
            const found: { filePath: string; title: string; author: string; format: "pdf" | "epub" }[] = [];

            const parseName = (filePath: string) => {
              const lower = filePath.toLowerCase();
              const format: "pdf" | "epub" = lower.endsWith(".epub") ? "epub" : "pdf";
              const base = path.basename(filePath, format === "epub" ? ".epub" : ".pdf");
              let cleaned = base.replace(/\.(pdf|epub)$/i, "").trim();
              for (const suf of [" - PDF Room", " - pdfroom", " (PDF Room)", " (z-lib.org)", " (Z-Library)"]) {
                if (cleaned.endsWith(suf)) cleaned = cleaned.slice(0, -suf.length).trim();
              }
              cleaned = cleaned.replace(/_ /g, ": ").replace(/_/g, " ");
              if (!cleaned.includes(" ") && cleaned.includes("-")) {
                cleaned = cleaned.replace(/-/g, " ");
              }
              let title = cleaned;
              let author = "Library Volume";
              const dashIdx = cleaned.lastIndexOf(" - ");
              const byIdx = cleaned.toLowerCase().lastIndexOf(" by ");
              if (dashIdx > 0 && cleaned.length - dashIdx - 3 <= 48) {
                title = cleaned.slice(0, dashIdx).trim();
                author = cleaned.slice(dashIdx + 3).trim();
              } else if (byIdx > 0 && cleaned.length - byIdx - 4 <= 48) {
                title = cleaned.slice(0, byIdx).trim();
                author = cleaned.slice(byIdx + 4).trim();
              }
              if (title === title.toLowerCase()) {
                title = title
                  .split(/\s+/)
                  .map((w, i) => {
                    if (["pm", "ai", "os", "ui", "ux"].includes(w)) return w.toUpperCase();
                    if (i > 0 && ["the", "a", "an", "of", "in", "on", "and", "for", "to", "with"].includes(w)) {
                      return w;
                    }
                    return w.charAt(0).toUpperCase() + w.slice(1);
                  })
                  .join(" ");
              }
              return { filePath, title: title || "Untitled Volume", author, format };
            };

            const walk = (dir: string) => {
              if (!fs.existsSync(dir)) return;
              for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name);
                try {
                  const st = fs.statSync(full);
                  if (st.isDirectory()) {
                    walk(full);
                  } else if (/\.(pdf|epub)$/i.test(name)) {
                    found.push(parseName(full));
                  }
                } catch {
                  // Skip unreadable file
                }
              }
            };

            walk(folder);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ folder, files: found }));
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Unknown books route" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // Home Assistant REST lighting bridge for dev/QA verification (enforces 50% cap)
      const haDispatchLog: Array<{
        at: string;
        endpoint: string;
        payload: Record<string, unknown>;
        status: string;
      }> = [];

      server.middlewares.use("/__dev/ha-light", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        const method = ((req as unknown as { method?: string }).method || "GET").toUpperCase();
        if (method === "GET") {
          res.end(JSON.stringify({ dispatches: haDispatchLog.slice(-20) }));
          return;
        }
        if (method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const raw = (await readJsonBody(
            req as unknown as { on: (ev: string, cb: (chunk: unknown) => void) => void }
          )) as {
            baseUrl?: string;
            token?: string;
            command?: {
              mode?: string;
              rgbColor?: [number, number, number];
              kelvin?: number;
              brightnessPct?: number;
              entityId?: string;
              transition?: number;
            };
          };
          const baseUrl = String(raw.baseUrl || "").trim().replace(/\/+$/, "");
          const token = String(raw.token || "").trim();
          const cmd = raw.command || {};
          const entityId = String(cmd.entityId || "").trim();
          const safeBrightness = Math.max(1, Math.min(100, Math.round(Number(cmd.brightnessPct ?? 45))));
          if (!baseUrl || !entityId) {
            res.end(
              JSON.stringify({
                ok: false,
                endpoint: "",
                entityId,
                appliedBrightnessPct: safeBrightness,
                message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.",
              })
            );
            return;
          }
          const brightness255 = Math.max(0, Math.min(255, Math.round(safeBrightness * 2.55)));
          const endpoint = `${baseUrl}/api/services/light/turn_on`;
          const payload: Record<string, unknown> =
            cmd.mode === "kelvin"
              ? {
                  entity_id: entityId,
                  color_temp_kelvin: Math.max(2000, Math.min(6500, Math.round(Number(cmd.kelvin ?? 2700)))),
                  brightness: brightness255,
                  transition: Number(cmd.transition ?? 1.2),
                }
              : {
                  entity_id: entityId,
                  rgb_color: Array.isArray(cmd.rgbColor) && cmd.rgbColor.length === 3 ? cmd.rgbColor : [128, 0, 255],
                  brightness: brightness255,
                  transition: Number(cmd.transition ?? 1.2),
                };

          try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers.Authorization = `Bearer ${token}`;
            const g = globalThis as unknown as {
              fetch: (
                u: string,
                init?: { method?: string; headers?: Record<string, string>; body?: string }
              ) => Promise<{ ok: boolean; status: number }>;
            };
            const upstream = await Promise.race([
              g.fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
              }),
              new Promise<never>((_, reject) =>
                (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(
                  () => reject(new Error("timeout")),
                  2200
                )
              ),
            ]);
            const statusMsg = upstream.ok
              ? `Room lighting updated (${safeBrightness}%).`
              : "Home Assistant isn't connected yet. Check your URL and token in Settings.";
            haDispatchLog.push({
              at: new Date().toISOString(),
              endpoint,
              payload,
              status: `HTTP ${upstream.status}`,
            });
            res.end(
              JSON.stringify({
                ok: upstream.ok,
                endpoint,
                entityId,
                appliedBrightnessPct: safeBrightness,
                message: statusMsg,
              })
            );
          } catch {
            haDispatchLog.push({
              at: new Date().toISOString(),
              endpoint,
              payload,
              status: "LAN_UNREACHABLE_LOGGED",
            });
            res.end(
              JSON.stringify({
                ok: false,
                endpoint,
                entityId,
                appliedBrightnessPct: safeBrightness,
                message: "Home Assistant isn't connected yet. Set it up in Settings to control your lights.",
              })
            );
          }
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: String(err) }));
        }
      });

      // Dev bridge for n8n outbound webhook testing
      server.middlewares.use("/__dev/n8n-webhook", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        try {
          const raw = (await readJsonBody(
            req as unknown as { on: (ev: string, cb: (chunk: unknown) => void) => void }
          )) as { url?: string; eventName?: string; payload?: Record<string, unknown> };
          const url = String(raw.url || "").trim();
          if (!url) {
            res.end(JSON.stringify({ ok: false, message: "n8n webhook URL not configured" }));
            return;
          }
          try {
            const g = globalThis as unknown as {
              fetch: (
                u: string,
                init?: { method?: string; headers?: Record<string, string>; body?: string }
              ) => Promise<{ ok: boolean; status: number }>;
            };
            const upstream = await Promise.race([
              g.fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source: "athenaeum",
                  event: raw.eventName || "test_ping",
                  timestamp: new Date().toISOString(),
                  data: raw.payload || {},
                }),
              }),
              new Promise<never>((_, reject) =>
                (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(
                  () => reject(new Error("timeout")),
                  2200
                )
              ),
            ]);
            res.end(
              JSON.stringify({
                ok: upstream.ok,
                message: `n8n webhook responded HTTP ${upstream.status}`,
              })
            );
          } catch {
            res.end(
              JSON.stringify({
                ok: false,
                message: `Dispatched to ${url} (target unreachable in dev)`,
              })
            );
          }
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), athenaeumDevBridges()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
