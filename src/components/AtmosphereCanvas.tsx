import { useEffect, useRef } from "react";

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface MistVeil {
  x: number;
  y: number;
  rx: number;
  ry: number;
  vx: number;
  alpha: number;
}

export function AtmosphereCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let rafId = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const motes: Mote[] = [];
    const veils: MistVeil[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (motes.length === 0 && width > 0 && height > 0) {
        for (let i = 0; i < 34; i++) {
          motes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.35) * 0.14,
            vy: -0.04 - Math.random() * 0.1,
            radius: 0.7 + Math.random() * 1.6,
            baseAlpha: 0.08 + Math.random() * 0.18,
            phase: Math.random() * Math.PI * 2,
            speed: 0.005 + Math.random() * 0.008,
          });
        }

        for (let i = 0; i < 5; i++) {
          veils.push({
            x: (i / 5) * width + Math.random() * 240,
            y: height * (0.62 + Math.random() * 0.22),
            rx: 260 + Math.random() * 280,
            ry: 38 + Math.random() * 44,
            vx: 0.08 + Math.random() * 0.11,
            alpha: 0.032 + Math.random() * 0.028,
          });
        }
      }
    };

    resize();
    window.addEventListener("resize", resize);

    let tick = 0;
    const render = () => {
      tick += 1;
      ctx.clearRect(0, 0, width, height);

      // Barely perceptible drifting lake mist ribbons
      for (const v of veils) {
        v.x += v.vx;
        if (v.x - v.rx > width + 80) {
          v.x = -v.rx - 80;
        }
        const grad = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.rx);
        grad.addColorStop(0, `rgba(143, 184, 163, ${v.alpha})`);
        grad.addColorStop(0.55, `rgba(143, 184, 163, ${v.alpha * 0.35})`);
        grad.addColorStop(1, "rgba(143, 184, 163, 0)");

        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.scale(1, v.ry / v.rx);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, v.rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Faint floating atmospheric light motes
      for (const m of motes) {
        m.x += m.vx + Math.sin(tick * 0.003 + m.phase) * 0.06;
        m.y += m.vy;
        if (m.y < -10) {
          m.y = height + 10;
          m.x = Math.random() * width;
        }
        if (m.x < -10) m.x = width + 10;
        if (m.x > width + 10) m.x = -10;

        const twinkle = 0.65 + 0.35 * Math.sin(tick * m.speed + m.phase);
        const alpha = m.baseAlpha * twinkle;

        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(225, 232, 222, ${alpha.toFixed(3)})`;
        ctx.fill();
      }

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
