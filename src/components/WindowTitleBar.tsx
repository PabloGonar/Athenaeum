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
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-50 flex h-8 items-center justify-between px-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pointer-events-none opacity-85"
      >
        <AthenaeumLogo className="h-4 w-4" />
        <span className="font-ui text-[0.58rem] uppercase tracking-[0.22em] text-[#E2B46D]/85">
          Athenaeum
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => void win.minimize()}
          aria-label="Minimize window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-muted)] hover:bg-[rgba(237,234,224,0.08)] hover:text-[var(--text-ivory)] transition-colors"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
        <button
          type="button"
          onClick={() => void win.toggleMaximize()}
          aria-label="Maximize or restore window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-muted)] hover:bg-[rgba(237,234,224,0.08)] hover:text-[var(--text-ivory)] transition-colors"
        >
          <Square className="h-3 w-3" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => void win.close()}
          aria-label="Close window"
          className="flex h-6 w-8 cursor-pointer items-center justify-center rounded bg-transparent border-0 text-[var(--text-muted)] hover:bg-[rgba(207,114,97,0.28)] hover:text-[#f5cfc8] transition-colors"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
