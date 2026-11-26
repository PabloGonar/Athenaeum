import { memo, useEffect, useRef } from "react";

export interface AmbientWildlifeLayerProps {
  isFocusMode: boolean;
  paused?: boolean;
}

interface Firefly {
  x: number; // normalized [0, 1]
  y: number; // normalized [0.46, 0.96]
  baseX: number;
  baseY: number;
  minY: number;
  maxY: number;
  driftX: number; // normalized units / sec
  driftY: number;
  wanderRadiusX: number;
  wanderRadiusY: number;
  wanderFreqX: number;
  wanderFreqY: number;
  wanderPhaseX: number;
  wanderPhaseY: number;
  coreRadius: number; // CSS px
  haloMultiplier: number;
  maxAlpha: number;
  pulseFreq: number; // rad / sec
  pulsePhase: number;
}

interface StartledBird {
  /** Normalized progress along the bird's canopy eruption -> sky glide -> treeline fade [0..1] */
  progress: number;
  durationSec: number;
  delaySec: number;
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  endX: number;
  endY: number;
  /** Half-wingspan in CSS px (5..8px => 10..16px full wingspan) */
  halfSpan: number;
  flapFreq: number;
  flapPhase: number;
  glideFreq: number;
  glidePhase: number;
  baseAlpha: number; // 0.85..0.92 crisp dark silhouette
  dir: 1 | -1;
}

// +30% firefly density (50 -> 65) across foreground foliage, water edge, and island trees
const FIREFLY_COUNT = 65;
// Startled jungle bird bursts every 16–28 seconds
const BIRD_INTERVAL_MIN_SEC = 16;
const BIRD_INTERVAL_MAX_SEC = 28;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createFireflies(): Firefly[] {
  const list: Firefly[] = [];

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const zoneRoll = i % 10;
    let baseX: number;
    let baseY: number;
    let minY = 0.54;
    let maxY = 0.96;

    if (zoneRoll <= 2) {
      baseX = randomRange(0.025, 0.34);
      baseY = randomRange(0.56, 0.94);
    } else if (zoneRoll <= 5) {
      baseX = randomRange(0.66, 0.975);
      baseY = randomRange(0.56, 0.94);
    } else if (zoneRoll <= 7) {
      baseX = randomRange(0.14, 0.86);
      baseY = randomRange(0.72, 0.96);
      minY = 0.68;
    } else {
      const leftBank = zoneRoll === 8;
      baseX = leftBank ? randomRange(0.28, 0.40) : randomRange(0.60, 0.72);
      baseY = randomRange(0.50, 0.68);
      minY = 0.46;
      maxY = 0.72;
    }

    list.push({
      x: baseX,
      y: baseY,
      baseX,
      baseY,
      minY,
      maxY,
      driftX: randomRange(-0.0024, 0.0024),
      driftY: randomRange(-0.0012, 0.0012),
      wanderRadiusX: randomRange(0.008, 0.022),
      wanderRadiusY: randomRange(0.006, 0.016),
      wanderFreqX: randomRange(0.16, 0.36),
      wanderFreqY: randomRange(0.14, 0.32),
      wanderPhaseX: randomRange(0, Math.PI * 2),
      wanderPhaseY: randomRange(0, Math.PI * 2),
      coreRadius: randomRange(1.0, 1.85),
      haloMultiplier: randomRange(4.8, 6.4),
      maxAlpha: randomRange(0.42, 0.78),
      pulseFreq: randomRange(0.45, 1.05),
      pulsePhase: randomRange(0, Math.PI * 2),
    });
  }

  return list;
}

/**
 * Spawns a startled burst of 4–7 crisp dark jungle birds (#070b11, 10–16px wingspan)
 * erupting suddenly upward & outward from a specific left or right cliff tree canopy,
 * fanning out across the upper crater sky and fading into the distant treeline without
 * obscuring the center clock or Athenaeum building.
 */
function spawnStartledBirdBurst(): StartledBird[] {
  const fromLeftCanopy = Math.random() < 0.5;
  const count = Math.floor(randomRange(4, 8)); // 4 to 7 birds
  const dir: 1 | -1 = fromLeftCanopy ? 1 : -1;

  // Tight canopy origin point on the left or right cliff treeline
  const originX = fromLeftCanopy ? randomRange(0.05, 0.14) : randomRange(0.86, 0.95);
  const originY = randomRange(0.34, 0.43);

  // Target distant treeline on the same outer crater flank (staying clear of center clock/dome)
  const targetBaseX = fromLeftCanopy ? randomRange(0.29, 0.39) : randomRange(0.61, 0.71);
  const targetBaseY = randomRange(0.25, 0.34);
  const peakBaseY = randomRange(0.09, 0.17);
  const baseDuration = randomRange(8.2, 11.8);

  const flock: StartledBird[] = [];
  for (let i = 0; i < count; i++) {
    // Fanning spread as birds erupt from the tight canopy cluster
    const fanFraction = count > 1 ? i / (count - 1) - 0.5 : 0;
    const spreadCtrlX = fanFraction * 0.055 + randomRange(-0.015, 0.015);
    const spreadCtrlY = fanFraction * 0.045 + randomRange(-0.02, 0.02);
    const spreadEndX = fanFraction * 0.075 + randomRange(-0.02, 0.02);
    const spreadEndY = fanFraction * 0.055 + randomRange(-0.018, 0.018);

    const startX = originX + randomRange(-0.012, 0.012);
    const startY = originY + randomRange(-0.012, 0.012);
    const endX = Math.max(0.02, Math.min(0.98, targetBaseX + spreadEndX));
    const endY = Math.max(0.18, Math.min(0.40, targetBaseY + spreadEndY));
    const ctrlX = startX + (endX - startX) * 0.36 + spreadCtrlX;
    const ctrlY = Math.max(0.05, peakBaseY + spreadCtrlY);

    flock.push({
      progress: 0,
      durationSec: baseDuration * randomRange(0.88, 1.12),
      // Rapid staggered canopy eruption (~0..0.6s)
      delaySec: i * randomRange(0.06, 0.14),
      startX,
      startY,
      ctrlX,
      ctrlY,
      endX,
      endY,
      halfSpan: randomRange(5.0, 8.0), // 10px..16px full wingspan
      flapFreq: randomRange(7.5, 10.5),
      flapPhase: randomRange(0, Math.PI * 2),
      glideFreq: randomRange(0.9, 1.5),
      glidePhase: randomRange(0, Math.PI * 2),
      baseAlpha: randomRange(0.85, 0.92),
      dir,
    });
  }

  return flock;
}

function drawStartledBirdSilhouette(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  halfSpan: number,
  flapAmount: number,
  alpha: number,
  slopeAngle: number
) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.max(-0.34, Math.min(0.34, slopeAngle * 0.52)));

  // Distinct dual-wing V-shape silhouette with dynamic upstroke/downstroke sweep
  const outerY = -halfSpan * 0.62 * flapAmount;
  const innerShoulderY = -halfSpan * 0.36 * (0.25 + 0.75 * flapAmount);

  ctx.strokeStyle = `rgba(7, 11, 17, ${alpha.toFixed(3)})`;
  ctx.fillStyle = `rgba(7, 11, 17, ${(alpha * 0.96).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.35, halfSpan * 0.25);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Left & right swept wings
  ctx.beginPath();
  ctx.moveTo(-halfSpan, outerY);
  ctx.quadraticCurveTo(-halfSpan * 0.48, innerShoulderY, 0, 0.65);
  ctx.quadraticCurveTo(halfSpan * 0.48, innerShoulderY, halfSpan, outerY);
  ctx.stroke();

  // Tiny tapered torso core for crisp visibility against bright blue-hour clouds
  ctx.beginPath();
  ctx.ellipse(0, 0.5, halfSpan * 0.16, halfSpan * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export const AmbientWildlifeLayer = memo(function AmbientWildlifeLayer({
  isFocusMode,
  paused = false,
}: AmbientWildlifeLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isFocusModeRef = useRef(isFocusMode);
  const pausedRef = useRef(paused);
  const syncLoopRef = useRef<(() => void) | null>(null);

  isFocusModeRef.current = isFocusMode;
  pausedRef.current = paused;

  useEffect(() => {
    syncLoopRef.current?.();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let prefersReducedMotion = reducedMotionQuery.matches;

    let rafId: number | null = null;
    let lastTimeMs = 0;
    let elapsedSimSec = 0;
    let focusFactor = isFocusModeRef.current ? 1 : 0;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const fireflies = createFireflies();
    let activeBirds: StartledBird[] = [];
    // Initial startled canopy burst ~3–5s after load, then every 16–28s
    let nextBirdCooldownSec = randomRange(3.0, 5.0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTimeMs = 0;
    };

    const shouldRun = () =>
      !document.hidden && !pausedRef.current && !prefersReducedMotion;

    const renderFrame = (nowMs: number) => {
      rafId = null;
      if (!shouldRun()) {
        lastTimeMs = 0;
        return;
      }

      const dt =
        lastTimeMs === 0 ? 1 / 60 : Math.min(Math.max((nowMs - lastTimeMs) / 1000, 0), 0.1);
      lastTimeMs = nowMs;

      const targetFocus = isFocusModeRef.current ? 1 : 0;
      const lerpStep = 1 - Math.exp(-dt * 2.2);
      focusFactor += (targetFocus - focusFactor) * lerpStep;

      const fireflySpeedScale = 1 - focusFactor * 0.52;
      const fireflyAlphaScale = 1 - focusFactor * 0.58;
      const birdSpeedScale = 1 - focusFactor * 0.35;
      const birdAlphaScale = 1 - focusFactor * 0.45;

      elapsedSimSec += dt * fireflySpeedScale;

      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);

        // 1. Soft golden-amber fireflies drifting across foreground foliage, lake edge & island trees
        for (const f of fireflies) {
          f.baseX += f.driftX * dt * fireflySpeedScale;
          f.baseY += f.driftY * dt * fireflySpeedScale;

          if (f.baseX < 0.025) {
            f.baseX = 0.025;
            f.driftX = Math.abs(f.driftX);
          } else if (f.baseX > 0.975) {
            f.baseX = 0.975;
            f.driftX = -Math.abs(f.driftX);
          }
          if (f.baseY < f.minY) {
            f.baseY = f.minY;
            f.driftY = Math.abs(f.driftY);
          } else if (f.baseY > f.maxY) {
            f.baseY = f.maxY;
            f.driftY = -Math.abs(f.driftY);
          }

          f.x = f.baseX + Math.sin(elapsedSimSec * f.wanderFreqX + f.wanderPhaseX) * f.wanderRadiusX;
          f.y = f.baseY + Math.cos(elapsedSimSec * f.wanderFreqY + f.wanderPhaseY) * f.wanderRadiusY;

          const wave = 0.5 + 0.5 * Math.sin(elapsedSimSec * f.pulseFreq + f.pulsePhase);
          const pulse = Math.pow(wave, 2.35);
          const alpha = f.maxAlpha * (0.08 + 0.92 * pulse) * fireflyAlphaScale;

          if (alpha <= 0.015) continue;

          const px = f.x * width;
          const py = f.y * height;
          const haloRadius = f.coreRadius * f.haloMultiplier * (0.85 + 0.3 * pulse);

          const halo = ctx.createRadialGradient(px, py, 0, px, py, haloRadius);
          halo.addColorStop(0, `rgba(255, 232, 162, ${(alpha * 0.9).toFixed(3)})`);
          halo.addColorStop(0.32, `rgba(242, 186, 84, ${(alpha * 0.42).toFixed(3)})`);
          halo.addColorStop(0.7, `rgba(218, 148, 48, ${(alpha * 0.12).toFixed(3)})`);
          halo.addColorStop(1, "rgba(218, 148, 48, 0)");

          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(px, py, haloRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = `rgba(255, 246, 210, ${Math.min(1, alpha * 1.08).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, f.coreRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // 2. Startled jungle bird bursts erupting from cliff tree canopies (4–7 birds, every 16–28s)
        if (activeBirds.length === 0) {
          nextBirdCooldownSec -= dt;
          if (nextBirdCooldownSec <= 0) {
            activeBirds = spawnStartledBirdBurst();
            nextBirdCooldownSec = randomRange(BIRD_INTERVAL_MIN_SEC, BIRD_INTERVAL_MAX_SEC);
          }
        } else {
          const remaining: StartledBird[] = [];
          for (const b of activeBirds) {
            const stepDt = dt * birdSpeedScale;
            if (b.delaySec > 0) {
              b.delaySec -= stepDt;
              remaining.push(b);
              continue;
            }

            b.progress += stepDt / b.durationSec;
            if (b.progress >= 1) continue;

            // Ease-out curve: fast startled burst out of branches, transitioning to serene glide
            const rawT = b.progress;
            const easedT = 1 - Math.pow(1 - rawT, 1.38);
            const omt = 1 - easedT;

            const nx = omt * omt * b.startX + 2 * omt * easedT * b.ctrlX + easedT * easedT * b.endX;
            const ny = omt * omt * b.startY + 2 * omt * easedT * b.ctrlY + easedT * easedT * b.endY;

            const tx = 2 * omt * (b.ctrlX - b.startX) + 2 * easedT * (b.endX - b.ctrlX);
            const ty = 2 * omt * (b.ctrlY - b.startY) + 2 * easedT * (b.endY - b.ctrlY);
            const slopeAngle = Math.atan2(ty * height, Math.abs(tx) * width + 0.001) * b.dir;

            // Quick canopy emergence (0..0.08) and smooth distant treeline fade-out (0.76..1.0)
            const fadeIn = Math.min(1, rawT / 0.08);
            const fadeOut = Math.min(1, (1 - rawT) / 0.24);
            const alpha = b.baseAlpha * fadeIn * fadeOut * birdAlphaScale;

            if (alpha > 0.02) {
              // Subtle perspective shrink as the flock glides into the distant trees
              const distanceScale = 1 - rawT * 0.34;
              // Rapid startled wingbeats during initial climb (rawT < 0.3), then flap-and-glide rhythm
              const burstEnergy = Math.max(0, 1 - rawT / 0.32);
              const glideMask = Math.max(
                burstEnergy,
                0.35 + 0.65 * Math.max(0, Math.sin(elapsedSimSec * b.glideFreq + b.glidePhase))
              );
              const activeFreq = b.flapFreq * (0.68 + 0.55 * burstEnergy);
              const flapWave = Math.sin(elapsedSimSec * activeFreq + b.flapPhase);
              const flapAmount = 0.16 + flapWave * (0.34 + 0.68 * glideMask);

              drawStartledBirdSilhouette(
                ctx,
                nx * width,
                ny * height,
                b.halfSpan * distanceScale,
                flapAmount,
                alpha,
                slopeAngle
              );
            }

            remaining.push(b);
          }
          activeBirds = remaining;
        }
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    const syncLoop = () => {
      if (shouldRun()) {
        if (rafId === null) {
          lastTimeMs = 0;
          rafId = window.requestAnimationFrame(renderFrame);
        }
      } else {
        stopLoop();
        if (prefersReducedMotion && width > 0 && height > 0) {
          ctx.clearRect(0, 0, width, height);
        }
      }
    };

    syncLoopRef.current = syncLoop;

    resize();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);
    window.addEventListener("resize", resize);

    const handleVisibilityChange = () => {
      syncLoop();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      syncLoop();
    };
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

    syncLoop();

    return () => {
      syncLoopRef.current = null;
      stopLoop();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="ambient-wildlife-layer"
      data-focus-mode={isFocusMode ? "true" : "false"}
      data-paused={paused ? "true" : "false"}
      data-firefly-count={FIREFLY_COUNT}
      aria-hidden="true"
      style={{ display: paused ? "none" : "block" }}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
});
