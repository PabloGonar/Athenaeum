import { memo } from "react";
import { motion } from "framer-motion";

export interface ObservatoryBackdropProps {
  isFocusMode: boolean;
  mainImageSrc?: string;
  focusImageSrc?: string;
}

const FOCUS_CROSSFADE_TRANSITION = {
  duration: 1.25,
  ease: [0.22, 1, 0.36, 1] as const,
};

/**
 * Calibrated horizontal alignment so the Athenaeum dome spire & front temple stairs
 * (which sit at 50.99% in the 2752x1536 painting) lock onto the exact 50.0% viewport
 * centerline beneath the clock, greeting, central Weekly pill, and Descent cue.
 */
const CENTERED_IMAGE_STYLE = {
  objectPosition: "52.5% center",
  transform: "scale(1.03) translateX(-0.92%)",
} as const;

export const ObservatoryBackdrop = memo(function ObservatoryBackdrop({
  isFocusMode,
  mainImageSrc = "/backgrounds/top-main.webp",
  focusImageSrc = "/backgrounds/top-focus.webp",
}: ObservatoryBackdropProps) {
  return (
    <div
      data-testid="observatory-backdrop"
      data-focus-mode={isFocusMode ? "true" : "false"}
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 z-0 overflow-hidden bg-[#070d16]"
    >
      {/* Base Observatory painting */}
      <img
        src={mainImageSrc}
        alt=""
        draggable={false}
        decoding="async"
        data-testid="backdrop-main-image"
        style={CENTERED_IMAGE_STYLE}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Focus Mode painting stacked cleanly above with smooth opacity crossfade */}
      <motion.img
        src={focusImageSrc}
        alt=""
        draggable={false}
        decoding="async"
        data-testid="backdrop-focus-image"
        initial={false}
        animate={{ opacity: isFocusMode ? 1 : 0 }}
        transition={FOCUS_CROSSFADE_TRANSITION}
        style={CENTERED_IMAGE_STYLE}
        className="absolute inset-0 h-full w-full object-cover will-change-[opacity]"
      />

      {/* Subtle midnight slate-obsidian radial vignette so floating typography & controls stay crisp */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 76% 72% at 50% 48%, rgba(7, 13, 22, 0.05) 0%, rgba(7, 13, 22, 0.22) 56%, rgba(7, 13, 22, 0.58) 84%, rgba(7, 13, 22, 0.82) 100%)",
            "linear-gradient(180deg, rgba(7, 13, 22, 0.42) 0%, rgba(7, 13, 22, 0.08) 22%, rgba(7, 13, 22, 0.04) 68%, rgba(7, 13, 22, 0.56) 100%)",
          ].join(", "),
        }}
      />

      {/* Gentle Focus Mode atmospheric deepening */}
      <motion.div
        initial={false}
        animate={{ opacity: isFocusMode ? 1 : 0 }}
        transition={FOCUS_CROSSFADE_TRANSITION}
        className="absolute inset-0 will-change-[opacity]"
        style={{
          background:
            "radial-gradient(ellipse 68% 66% at 50% 50%, rgba(7, 13, 22, 0.04) 0%, rgba(7, 13, 22, 0.28) 72%, rgba(7, 13, 22, 0.48) 100%)",
        }}
      />
    </div>
  );
});
