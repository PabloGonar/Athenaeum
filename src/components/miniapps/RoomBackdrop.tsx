import { memo, useEffect, useState } from "react";
import {
  CHAMBER_ROOM_MAP,
  getPreblurredRoomUrl,
  preloadRoomBackdrop,
  subscribeRoomTexture,
  type ChamberRoomId,
} from "../../utils/chamberRooms";

export interface RoomBackdropProps {
  roomId: ChamberRoomId;
}

/**
 * Zero-filter static pre-blurred room backdrop rendered behind open Secret Chamber mini-apps.
 * Uses the offscreen-canvas pre-blurred blob/data URL cached at startup so GPU compositing
 * runs at 60–120 FPS with zero per-frame CSS blur passes during zoom transitions or scrolling.
 */
export const RoomBackdrop = memo(function RoomBackdrop({
  roomId,
}: RoomBackdropProps) {
  const room = CHAMBER_ROOM_MAP[roomId];
  const [preblurredSrc, setPreblurredSrc] = useState<string | null>(() =>
    getPreblurredRoomUrl(roomId)
  );

  useEffect(() => {
    const cached = getPreblurredRoomUrl(roomId);
    setPreblurredSrc(cached);
    if (!cached) {
      preloadRoomBackdrop(roomId);
    }
    return subscribeRoomTexture(roomId, (nextUrl) => {
      setPreblurredSrc(nextUrl);
    });
  }, [roomId]);

  const activeSrc = preblurredSrc ?? room.imageUrl;
  const isPreblurred = Boolean(preblurredSrc);

  return (
    <div
      data-testid={`room-backdrop-${roomId}`}
      data-room-backdrop="true"
      data-preblurred={isPreblurred ? "true" : "false"}
      aria-hidden="true"
      className="pointer-events-none select-none fixed inset-0 -z-10 overflow-hidden bg-[#120c09]"
    >
      <img
        src={activeSrc}
        alt=""
        draggable={false}
        loading="eager"
        decoding="sync"
        data-testid="room-backdrop-image"
        className="block h-full w-full object-cover object-center"
        style={{ filter: "none" }}
      />

      {/* Static warm-dark radial vignette preserving recognizable room details while keeping text crisp */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, rgba(16, 11, 8, 0.34) 0%, rgba(12, 8, 6, 0.56) 100%)",
        }}
      />
    </div>
  );
});
