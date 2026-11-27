import { createContext, useContext } from "react";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { motion } from "framer-motion";
import { RoomBackdrop } from "./RoomBackdrop";
import { isTauriRuntime } from "../../services/storage";
import { CHAMBER_ROOM_MAP, type ChamberRoomId } from "../../utils/chamberRooms";

export interface RoomNavigationContextValue {
  activeRoomId: ChamberRoomId | null;
  openedFromChamber: boolean;
  onAscendToSurface?: () => void;
}

export const RoomNavigationContext = createContext<RoomNavigationContextValue>({
  activeRoomId: null,
  openedFromChamber: false,
});

interface MiniAppShellProps {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  roomId?: ChamberRoomId | null;
  rightSlot?: React.ReactNode;
  lockScroll?: boolean;
  wide?: boolean;
  opaque?: boolean;
  children: React.ReactNode;
}

const ROOM_ZOOM_TRANSITION = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1] as const,
};

const STANDARD_MODAL_TRANSITION = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function MiniAppShell({
  title,
  onClose,
  roomId,
  rightSlot,
  lockScroll = false,
  wide = false,
  opaque = false,
  children,
}: MiniAppShellProps) {
  const navCtx = useContext(RoomNavigationContext);
  const resolvedRoomId = roomId !== undefined ? roomId : navCtx.activeRoomId;
  const roomMeta = !opaque && resolvedRoomId ? CHAMBER_ROOM_MAP[resolvedRoomId] : null;
  const isChamberRoom = Boolean(roomMeta);
  const returnLabel = isChamberRoom ? "Workspace" : "Overview";
  const hasDesktopTitlebar = isTauriRuntime();

  return (
    <motion.div
      data-testid="miniapp-shell"
      data-room-id={resolvedRoomId ?? "overlay"}
      data-glass-theme={isChamberRoom ? "chamber" : "surface"}
      data-opaque={opaque ? "true" : "false"}
      initial={
        roomMeta
          ? { opacity: 0, scale: 0.94 }
          : { opacity: 0, y: 10 }
      }
      animate={
        roomMeta
          ? { opacity: 1, scale: 1 }
          : { opacity: 1, y: 0 }
      }
      exit={
        roomMeta
          ? { opacity: 0, scale: 0.96 }
          : { opacity: 0, y: 6 }
      }
      transition={roomMeta ? ROOM_ZOOM_TRANSITION : STANDARD_MODAL_TRANSITION}
      style={
        opaque
          ? {
              backgroundColor: "#0B0F17",
              willChange: "transform, opacity",
            }
          : roomMeta
          ? {
              background: "transparent",
              transformOrigin: `${roomMeta.center.xPct}% ${roomMeta.center.yPct}%`,
              willChange: "transform, opacity",
            }
          : {
              backgroundColor: "rgba(9, 15, 25, 0.92)",
              willChange: "transform, opacity",
            }
      }
      className={`fixed inset-0 z-40 isolate flex flex-col overflow-hidden text-[var(--text-ivory)] ${
        isChamberRoom ? "theme-chamber bg-transparent" : "theme-surface"
      }`}
    >
      {/* Locked non-scrolling full-room backdrop behind transparent shell (fills 0..100vh seamlessly behind transparent titlebar) */}
      {!opaque && resolvedRoomId && <RoomBackdrop roomId={resolvedRoomId} />}

      {/* Dedicated 32px top flex row reserving space for the transparent desktop titlebar so headers never collide */}
      {hasDesktopTitlebar && (
        <div
          aria-hidden="true"
          data-testid="miniapp-titlebar-row"
          className="relative z-10 h-8 w-full shrink-0 bg-transparent"
        />
      )}

      {/* Dedicated foreground scroll viewport starting cleanly below the titlebar row */}
      <div
        data-testid="miniapp-scroll-viewport"
        style={{ contain: "layout style" }}
        className={`relative z-10 flex flex-1 min-h-0 w-full flex-col bg-transparent ${
          lockScroll ? "overflow-y-auto md:overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {/* Top Return & Surface Ascent Bar */}
        <header
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--glass-border)] px-8 py-4 md:px-14"
          style={{
            backgroundColor: opaque
              ? "#0B0F17"
              : isChamberRoom
              ? "rgba(18, 13, 10, 0.88)"
              : "rgba(10, 16, 26, 0.92)",
          }}
        >
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onClose}
              data-testid="miniapp-return-btn"
              className="chamber-return-btn group -ml-2 flex cursor-pointer items-center gap-2 rounded-[4px] border border-transparent px-[14px] py-[8px] text-[var(--text-ivory-soft)]/88 hover:border-[rgba(226,180,109,0.28)] hover:bg-[rgba(226,180,109,0.08)] hover:text-[#E2B46D] focus-visible:text-[#E2B46D] transition-colors duration-200"
            >
              <ArrowLeft
                className="h-4 w-4 text-[var(--accent-brass)] group-hover:text-[#E2B46D] transition-colors duration-200"
                strokeWidth={1.6}
              />
              <span className="font-ui text-[0.68rem] uppercase tracking-[0.18em]">
                {returnLabel}
              </span>
              <span className="font-ui text-[0.58rem] uppercase tracking-[0.14em] opacity-60 group-hover:opacity-90 transition-opacity duration-200">
                (Esc)
              </span>
            </button>

            <div className="h-5 w-[1px] bg-[var(--glass-border)]" />

            <div>
              <h1 className="font-editorial text-[1.6rem] font-normal leading-none tracking-[0.04em] text-[var(--text-ivory)]">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {rightSlot ? <div>{rightSlot}</div> : null}

            {isChamberRoom && navCtx.onAscendToSurface && (
              <button
                type="button"
                onClick={navCtx.onAscendToSurface}
                data-testid="miniapp-ascend-surface-btn"
                title="Back to Overview"
                className="chamber-return-btn group cursor-pointer p-0 flex items-center gap-1.5 font-ui text-[0.66rem] uppercase tracking-[0.18em] text-[var(--text-ivory-soft)]/82 hover:text-[#E2B46D] focus-visible:text-[#E2B46D] transition-colors duration-200 focus:outline-none"
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

        <main
          className={`relative z-10 mx-auto w-full flex-1 bg-transparent px-8 md:px-12 ${
            wide ? "max-w-[1440px]" : "max-w-[1140px]"
          } ${
            lockScroll ? "py-5 md:min-h-0 md:overflow-hidden md:flex md:flex-col" : "py-9"
          }`}
        >
          {children}
        </main>
      </div>
    </motion.div>
  );
}
