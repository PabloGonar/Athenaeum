import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CornerDownLeft } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, storageService } from "../services/storage";
import type { QuickCaptureResult } from "../types/athenaeum";

interface QuickCaptureOverlayProps {
  /** Standalone frameless Tauri window mode (?window=quick-capture) vs in-app modal overlay */
  standalone?: boolean;
  open?: boolean;
  onSubmitted?: (result: QuickCaptureResult) => void;
  onClose?: () => void;
}

function detectPrefixMeta(raw: string): { badge: string; hint: string } {
  const lower = raw.trimStart().toLowerCase();
  if (lower.startsWith("n:")) {
    return { badge: "Notes /Inbox", hint: "Saves timestamped Markdown note in /Inbox" };
  }
  if (lower.startsWith("s:")) {
    return { badge: "Sticky Note", hint: "Adds a sticky note to Overview" };
  }
  if (lower.startsWith("f:")) {
    return { badge: "Focus Session", hint: "Starts a focus timer (e.g. f: open or f: 45)" };
  }
  if (lower.startsWith("t:")) {
    return { badge: "Daily Goal", hint: "Adds directly to today's Goals & Tasks" };
  }
  return { badge: "Daily Goal", hint: "Prefixes: t: task · n: notes inbox · s: sticky · f: focus" };
}

export function QuickCaptureOverlay({
  standalone = false,
  open = true,
  onSubmitted,
  onClose,
}: QuickCaptureOverlayProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!standalone) return;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, [standalone]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Refocus input whenever the global shortcut summons the standalone Tauri window
  useEffect(() => {
    if (!standalone || !isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    void listen("athenaeum:quick-capture-opened", () => {
      setValue("");
      setStatus(null);
      window.setTimeout(() => inputRef.current?.focus(), 25);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [standalone]);

  const meta = useMemo(() => detectPrefixMeta(value), [value]);

  const dismiss = async () => {
    setValue("");
    setStatus(null);
    if (standalone) {
      await storageService.hideQuickCapture();
    } else {
      onClose?.();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await storageService.executeQuickCapture(trimmed);
      setValue("");
      setStatus(res.message);
      onSubmitted?.(res);
      if (!standalone) {
        onClose?.();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open && !standalone) return null;

  const content = (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      data-testid="quick-capture-bar"
      data-glass-theme="surface"
      className="theme-surface smoked-glass-modal w-full max-w-[640px] rounded-[14px] px-5 py-4 text-[var(--text-ivory)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          void dismiss();
        }
      }}
    >
      <div className="flex items-center gap-3">
        <Command className="h-4 w-4 text-[var(--accent-brass)] shrink-0" strokeWidth={1.6} />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="quick-capture-input"
          placeholder="t: task · n: vault note · s: sticky · f: 45 or f: open"
          className="flex-1 bg-transparent border-0 p-0 font-reading text-[1.22rem] text-[var(--text-ivory)] placeholder:text-[var(--text-muted)]/75 focus:outline-none"
        />
        <span
          data-testid="quick-capture-prefix-badge"
          className="rounded-full border border-[rgba(224,177,104,0.36)] bg-[var(--surface-inner)] px-2.5 py-0.5 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] shrink-0"
        >
          {meta.badge}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--glass-border)] pt-2.5">
        <span className="font-ui text-[0.62rem] tracking-[0.08em] text-[var(--text-muted)] truncate pr-3">
          {status || meta.hint}
        </span>
        <div className="flex items-center gap-3 shrink-0 font-ui text-[0.6rem] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> Enter
          </span>
          <span>Esc</span>
        </div>
      </div>
    </form>
  );

  if (standalone) {
    return (
      <div
        data-tauri-drag-region
        className="flex h-screen w-screen items-center justify-center bg-transparent p-2"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      data-testid="quick-capture-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) void dismiss();
      }}
      className="theme-surface fixed inset-0 z-50 flex items-start justify-center bg-[rgba(7,13,22,0.54)] backdrop-blur-[8px] pt-[18vh] px-6"
    >
      {content}
    </div>
  );
}
