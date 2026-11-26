import type { MiniAppId } from "../types/athenaeum";

export type ChamberRoomId =
  | "library"
  | "journal"
  | "goals"
  | "toc"
  | "focus"
  | "analytics";

export interface ChamberRoomRect {
  left: number; // %
  top: number; // %
  width: number; // %
  height: number; // %
}

export interface ChamberRoomConfig {
  id: ChamberRoomId;
  roman: string;
  /** Mini-App display title shown inside the centered hover emblem */
  title: string;
  /** Architectural cutaway room label */
  roomName: string;
  subtitle: string;
  /** Calibrated percentage recess aligned to bottom.webp (16:9) */
  rect: ChamberRoomRect;
  /** Center percentage coordinates used as transform-origin for camera zoom */
  center: {
    xPct: number;
    yPct: number;
  };
  /** Exact dedicated WebP room artwork path */
  imageUrl: string;
}

function makeRoom(
  id: ChamberRoomId,
  roman: string,
  title: string,
  roomName: string,
  subtitle: string,
  rect: ChamberRoomRect
): ChamberRoomConfig {
  return {
    id,
    roman,
    title,
    roomName,
    subtitle,
    rect,
    center: {
      xPct: Number((rect.left + rect.width / 2).toFixed(2)),
      yPct: Number((rect.top + rect.height / 2).toFixed(2)),
    },
    imageUrl: `/backgrounds/room-${id}.webp`,
  };
}

/**
 * Six architectural room recesses flanking the central spiral staircase
 * on public/backgrounds/bottom.webp (3 rows x 2 columns).
 */
export const CHAMBER_ROOMS: ChamberRoomConfig[] = [
  makeRoom(
    "library",
    "I",
    "Library",
    "Library",
    "Private shelf, PDF/EPUB reader & marginalia",
    { left: 11.8, top: 2.2, width: 29.1, height: 21.8 }
  ),
  makeRoom(
    "journal",
    "II",
    "Journal",
    "Scriptorium",
    "Daily Debrief & Markdown Reflections vault",
    { left: 58.7, top: 2.2, width: 29.5, height: 21.8 }
  ),
  makeRoom(
    "goals",
    "III",
    "Goals & Milestones",
    "Trophy & Map Vault",
    "Unified goals, cadences & milestones",
    { left: 11.8, top: 35.4, width: 29.1, height: 24.0 }
  ),
  makeRoom(
    "toc",
    "IV",
    "TOC Whiteboard",
    "TOC Strategy Room",
    "Conflict clouds & Goldratt thinking trees",
    { left: 58.7, top: 35.4, width: 29.5, height: 24.0 }
  ),
  makeRoom(
    "focus",
    "V",
    "Focus & Atmosphere Studio",
    "Music Lounge",
    "Focus engine, room lighting & soundscape",
    { left: 11.8, top: 66.4, width: 29.1, height: 27.4 }
  ),
  makeRoom(
    "analytics",
    "VI",
    "Advanced Analytics",
    "Quantitative Analytics Study",
    "Consistency streaks, circadian peaks & velocity",
    { left: 58.7, top: 66.4, width: 29.5, height: 27.4 }
  ),
];

export const CHAMBER_ROOM_MAP: Record<ChamberRoomId, ChamberRoomConfig> =
  CHAMBER_ROOMS.reduce(
    (acc, room) => {
      acc[room.id] = room;
      return acc;
    },
    {} as Record<ChamberRoomId, ChamberRoomConfig>
  );

export function isChamberRoomId(app: MiniAppId): app is ChamberRoomId {
  return (
    app === "library" ||
    app === "journal" ||
    app === "goals" ||
    app === "toc" ||
    app === "focus" ||
    app === "analytics"
  );
}

// Static offscreen pre-blurred texture cache (zero live CSS blur during zoom & scroll)
const PREBLUR_WIDTH = 1440;
const PREBLUR_HEIGHT = 810;

const preblurredUrls = new Map<ChamberRoomId, string>();
const preblurredImageHolders = new Map<ChamberRoomId, HTMLImageElement>();
const inFlightPreblur = new Set<ChamberRoomId>();
const textureListeners = new Map<ChamberRoomId, Set<(url: string) => void>>();

function notifyTextureReady(roomId: ChamberRoomId, url: string) {
  const listeners = textureListeners.get(roomId);
  if (!listeners) return;
  for (const cb of listeners) {
    cb(url);
  }
}

export function getPreblurredRoomUrl(roomId: ChamberRoomId): string | null {
  return preblurredUrls.get(roomId) ?? null;
}

export function subscribeRoomTexture(
  roomId: ChamberRoomId,
  listener: (url: string) => void
): () => void {
  let set = textureListeners.get(roomId);
  if (!set) {
    set = new Set();
    textureListeners.set(roomId, set);
  }
  set.add(listener);
  const existing = preblurredUrls.get(roomId);
  if (existing) {
    listener(existing);
  }
  return () => {
    set?.delete(listener);
  };
}

function renderPreblurredTexture(img: HTMLImageElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = PREBLUR_WIDTH;
      canvas.height = PREBLUR_HEIGHT;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.fillStyle = "#120c09";
      ctx.fillRect(0, 0, PREBLUR_WIDTH, PREBLUR_HEIGHT);

      // Cover-fit with slight 1.04x overscan so Gaussian blur edges stay 100% opaque
      const srcW = Math.max(1, img.naturalWidth);
      const srcH = Math.max(1, img.naturalHeight);
      const baseScale = Math.max(PREBLUR_WIDTH / srcW, PREBLUR_HEIGHT / srcH) * 1.04;
      const drawW = srcW * baseScale;
      const drawH = srcH * baseScale;
      const dx = (PREBLUR_WIDTH - drawW) / 2;
      const dy = (PREBLUR_HEIGHT - drawH) / 2;

      ctx.filter = "blur(5px) saturate(1.06)";
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.filter = "none";

      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(URL.createObjectURL(blob));
            } else {
              resolve(canvas.toDataURL("image/webp", 0.86));
            }
          },
          "image/webp",
          0.86
        );
      } else {
        resolve(canvas.toDataURL("image/webp", 0.86));
      }
    } catch {
      resolve(null);
    }
  });
}

/**
 * Loads a room's dedicated WebP asset, pre-blurs it once onto an offscreen 1440x810 canvas,
 * caches the resulting blob/data URL, and eagerly decodes it so GPU compositing costs ~0ms.
 */
export function preloadRoomBackdrop(roomId: ChamberRoomId): void {
  if (preblurredUrls.has(roomId) || inFlightPreblur.has(roomId)) return;
  const url = CHAMBER_ROOM_MAP[roomId]?.imageUrl;
  if (!url) return;

  inFlightPreblur.add(roomId);
  const srcImg = new Image();
  srcImg.decoding = "async";

  const finalize = async () => {
    try {
      if (typeof srcImg.decode === "function") {
        await srcImg.decode().catch(() => {});
      }
      const textureUrl = await renderPreblurredTexture(srcImg);
      if (!textureUrl) return;

      // Hold a decoded Image reference so Chromium/WebView2 keeps the blurred bitmap GPU-resident
      const warmImg = new Image();
      warmImg.decoding = "async";
      warmImg.src = textureUrl;
      preblurredImageHolders.set(roomId, warmImg);
      if (typeof warmImg.decode === "function") {
        await warmImg.decode().catch(() => {});
      }

      preblurredUrls.set(roomId, textureUrl);
      notifyTextureReady(roomId, textureUrl);
    } finally {
      inFlightPreblur.delete(roomId);
    }
  };

  srcImg.onload = () => {
    void finalize();
  };
  srcImg.onerror = () => {
    inFlightPreblur.delete(roomId);
  };
  srcImg.src = url;
}

/** Eagerly preload & offscreen pre-blur all six room WebP assets on startup with gentle staggering. */
export function preloadAllRoomBackdrops(): void {
  CHAMBER_ROOMS.forEach((room, idx) => {
    window.setTimeout(() => {
      preloadRoomBackdrop(room.id);
    }, idx * 45);
  });
}
