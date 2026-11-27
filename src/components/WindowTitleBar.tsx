import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../services/storage";
import { AthenaeumLogo } from "./AthenaeumLogo";

export function WindowTitleBar() {
  if (!isTauriRuntime()) {
    return null;
  }

  const win = getCurrentWindow();

  return (
    <div
      data-testid="window-titlebar"
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex h-8 w-full shrink-0 items-center justify-between select-none"
      style={{ background: "transparent", borderBottom: "none" }}
    >
      {/* Non-interactive drag surface spanning brand emblem and open center bar */}
      <div
        data-tauri-drag-region
        className="pointer-events-auto flex h-full flex-1 items-center gap-2 px-3"
        style={{ background: "transparent" }}
      >
        <div className="pointer-events-none flex items-center gap-2 opacity-90">
          <AthenaeumLogo className="h-4 w-4 pointer-events-none" />
          <span
            className="pointer-events-none font-ui text-[0.58rem] uppercase tracking-[0.22em] text-[#E2B46D]/90"
            style={{ textShadow: "0 1px 6px rgba(4, 9, 18, 0.85)" }}
          >
            Athenaeum
          </span>
        </div>
      </div>

      {/* Explicit non-drag interactive window control buttons */}
      <div
        data-tauri-drag-region="false"
        className="pointer-events-auto flex h-full shrink-0 items-center gap-0.5 pr-1.5"
        style={{ background: "transparent" }}
      >
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => void win.minimize()}
          aria-label="Minimize window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-ivory-soft)]/80 hover:bg-[rgba(237,234,224,0.12)] hover:text-[var(--text-ivory)] transition-colors"
        >
          <Minus className="h-3.5 w-3.5 pointer-events-none" strokeWidth={1.6} />
        </button>
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => void win.toggleMaximize()}
          aria-label="Maximize or restore window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-ivory-soft)]/80 hover:bg-[rgba(237,234,224,0.12)] hover:text-[var(--text-ivory)] transition-colors"
        >
          <Square className="h-3 w-3 pointer-events-none" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={() => void win.close()}
          aria-label="Close window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-ivory-soft)]/80 hover:bg-[rgba(207,114,97,0.34)] hover:text-[#f5cfc8] transition-colors"
        >
          <X className="h-3.5 w-3.5 pointer-events-none" strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
