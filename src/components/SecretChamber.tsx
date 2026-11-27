import { useRef } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BookOpen,
  ChevronUp,
  Compass,
  Feather,
  Network,
  Target,
} from "lucide-react";
import {
  CHAMBER_ROOMS,
  CHAMBER_ROOM_MAP,
  preloadRoomBackdrop,
  type ChamberRoomId,
} from "../utils/chamberRooms";
import type { MiniAppId } from "../types/athenaeum";

interface SecretChamberProps {
  backgroundPath: string;
  activeRoomId: ChamberRoomId | null;
  onOpenMiniApp: (app: MiniAppId) => void;
  onAscend: () => void;
}

const ROOM_ICONS: Record<
  ChamberRoomId,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  library: BookOpen,
  journal: Feather,
  goals: Target,
  toc: Network,
  focus: Compass,
  analytics: Activity,
};

const CAMERA_ZOOM_TRANSITION = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1] as const,
};

export function SecretChamber({
  backgroundPath,
  activeRoomId,
  onOpenMiniApp,
  onAscend,
}: SecretChamberProps) {
  const chamberImageUrl =
    backgroundPath && backgroundPath !== "/backgrounds/secret-chamber.svg"
      ? backgroundPath
      : "/backgrounds/bottom.webp";

  // Preserve last entered room center so reverse zoom-out pulls back from that exact recess
  const lastRoomRef = useRef<ChamberRoomId>("library");
  if (activeRoomId) {
    lastRoomRef.current = activeRoomId;
  }
  const zoomAnchorRoom = CHAMBER_ROOM_MAP[activeRoomId ?? lastRoomRef.current];
  const isZoomedIntoRoom = activeRoomId !== null;

  return (
    <section
      id="secret-chamber"
      data-testid="secret-chamber"
      data-zoomed-room={activeRoomId ?? "none"}
      className="relative h-1/2 w-full shrink-0 overflow-hidden bg-[#060b0f]"
    >
      {/* Exact 16:9 aspect-preserving cover stage locked to 100vw x 100vh with zero overflow below */}
      <motion.div
        data-testid="secret-chamber-stage"
        initial={false}
        animate={{
          scale: isZoomedIntoRoom ? 2.85 : 1,
          opacity: isZoomedIntoRoom ? 0.16 : 1,
        }}
        transition={CAMERA_ZOOM_TRANSITION}
        style={{
          width: "max(100vw, 177.7778vh)",
          height: "max(100vh, 56.25vw)",
          backgroundColor: "#060b0f",
          backgroundImage: `url("${chamberImageUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
          transformOrigin: `${zoomAnchorRoom.center.xPct}% ${zoomAnchorRoom.center.yPct}%`,
          willChange: "transform, opacity",
        }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        {/* Six Calibrated Interactive Room Hotspots (Hover Blur + Clean Icon & Serif Title Only) */}
        {CHAMBER_ROOMS.map((room) => {
          const Icon = ROOM_ICONS[room.id];
          return (
            <button
              key={room.id}
              type="button"
              onMouseEnter={() => preloadRoomBackdrop(room.id)}
              onFocus={() => preloadRoomBackdrop(room.id)}
              onClick={() => onOpenMiniApp(room.id)}
              data-testid={`chamber-station-${room.id}`}
              data-room-name={room.title}
              aria-label={`Enter ${room.title}`}
              style={{
                left: `${room.rect.left}%`,
                top: `${room.rect.top}%`,
                width: `${room.rect.width}%`,
                height: `${room.rect.height}%`,
              }}
              className="group absolute z-20 flex cursor-pointer items-center justify-center overflow-hidden rounded-[6px] border border-transparent bg-transparent p-3 text-center transition-[border-color,box-shadow] duration-[220ms] ease-out hover:border-[rgba(224,177,104,0.62)] hover:shadow-[inset_0_0_36px_rgba(224,177,104,0.16),0_0_24px_rgba(0,0,0,0.38)] focus:outline-none focus-visible:border-[rgba(224,177,104,0.78)] focus-visible:shadow-[inset_0_0_40px_rgba(224,177,104,0.22)]"
            >
              {/* Hover-only translucent veil (zero backdrop-filter blur to keep GPU zoom 60-120fps) */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[rgba(10,14,20,0.68)] opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
              />

              {/* Centered Brass Station Icon + Editorial Serif Title Only */}
              <div className="pointer-events-none relative z-10 flex flex-col items-center justify-center px-3 opacity-0 translate-y-1 transition-all duration-[220ms] ease-out group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(224,177,104,0.52)] bg-[rgba(11,18,28,0.66)] shadow-[0_6px_22px_rgba(0,0,0,0.48)]">
                  <Icon
                    className="h-5 w-5 text-[#E0B168]"
                    strokeWidth={1.5}
                  />
                </div>

                <span className="mt-2.5 font-editorial text-[1.28rem] font-normal leading-tight tracking-[0.04em] text-[#F3EFE6] drop-shadow-[0_2px_10px_rgba(0,0,0,0.78)]">
                  {room.title}
                </span>
              </div>
            </button>
          );
        })}
      </motion.div>

      {/* Seamless dark earth-and-root blend across the 0vh <-> 100vh transition seam */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24"
        style={{
          background:
            "linear-gradient(180deg, rgba(6, 11, 18, 0.94) 0%, rgba(6, 11, 18, 0.52) 44%, rgba(6, 11, 18, 0) 100%)",
        }}
      />

      {/* Clean, Borderless "Ascend to Surface" Editorial Typography Trigger */}
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
        <button
          type="button"
          onClick={onAscend}
          data-testid="ascend-cue"
          className="pointer-events-auto group flex flex-col items-center bg-transparent border-0 p-0 cursor-pointer select-none focus:outline-none"
        >
          <ChevronUp
            className="h-4 w-4 text-[#E0B168]/85 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:text-[#F3EFE6]"
            strokeWidth={1.5}
            style={{ filter: "drop-shadow(0 2px 6px rgba(0, 0, 0, 0.9))" }}
          />
          <span
            className="font-editorial text-[0.9rem] tracking-[0.13em] text-[#F3EFE6]/88 group-hover:text-[#F3EFE6] transition-colors whitespace-nowrap"
            style={{
              textShadow:
                "0 1px 3px rgba(0, 0, 0, 0.96), 0 3px 16px rgba(4, 9, 16, 0.92)",
            }}
          >
            Back to Overview
          </span>
        </button>
      </div>
    </section>
  );
}
