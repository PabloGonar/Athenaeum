import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { QuoteItem, TimeFormat } from "../types/athenaeum";
import { formatClockParts } from "../utils/time";

interface ObservatoryClockProps {
  userName: string;
  quotes: QuoteItem[];
  timeFormat: TimeFormat;
}

function getGreeting(hour: number): string {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function ObservatoryClock({
  userName,
  quotes,
  timeFormat,
}: ObservatoryClockProps) {
  const [now, setNow] = useState(() => new Date());
  const [quoteIdx, setQuoteIdx] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (quotes.length <= 1) return;
    const interval = window.setInterval(() => {
      setQuoteIdx((prev) => (prev + 1) % quotes.length);
    }, 32000);
    return () => window.clearInterval(interval);
  }, [quotes.length]);

  const { hours, minutes } = formatClockParts(now, timeFormat);
  const trimmedName = userName.trim();
  const greeting = trimmedName
    ? `${getGreeting(now.getHours())}, ${trimmedName}`
    : getGreeting(now.getHours());
  const validQuotes = quotes.filter((q) => q.text.trim().length > 0);
  const activeQuote =
    validQuotes.length > 0 ? validQuotes[quoteIdx % validQuotes.length] : null;

  return (
    <div className="relative pointer-events-auto flex flex-col items-center text-center select-none px-10 py-4">
      {/* Soft, wide dark radial scrim behind clock, greeting, and daily quote */}
      <div
        aria-hidden="true"
        data-testid="observatory-clock-scrim"
        className="pointer-events-none absolute -inset-x-24 -inset-y-8 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 68% 66% at 50% 48%, rgba(7, 11, 18, 0.72) 0%, rgba(7, 11, 18, 0.44) 48%, rgba(7, 11, 18, 0) 78%)",
        }}
      />

      <div
        className="flex items-baseline justify-center font-editorial tabular-nums font-light tracking-[0.04em] text-[#F3EFE6] leading-none"
        style={{
          fontSize: "clamp(4.4rem, 7.2vw, 6.4rem)",
          textShadow:
            "0 2px 12px rgba(4, 9, 18, 0.78), 0 12px 38px rgba(4, 9, 18, 0.82)",
        }}
        aria-label="Current time"
        data-testid="observatory-clock"
      >
        <span>{hours}</span>
        <span className="opacity-75">:</span>
        <span>{minutes}</span>
      </div>

      <h1
        className="mt-2 font-editorial text-[1.45rem] md:text-[1.75rem] font-normal tracking-[0.05em] text-[#F3EFE6]"
        style={{
          textShadow:
            "0 1px 6px rgba(4, 9, 18, 0.88), 0 5px 24px rgba(4, 9, 18, 0.78)",
        }}
      >
        {greeting}
      </h1>

      {activeQuote ? (
        <button
          type="button"
          onClick={() => setQuoteIdx((prev) => (prev + 1) % validQuotes.length)}
          title="Next personal quote"
          data-testid="observatory-quote"
          className="mt-3 max-w-[42rem] cursor-pointer bg-transparent border-0 px-3 py-0.5 text-center group focus:outline-none"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeQuote.text}-${activeQuote.author}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="font-reading text-[0.95rem] md:text-[1rem] leading-relaxed transition-colors duration-300 group-hover:text-[#F3EFE6]"
              style={{
                color: "rgba(243, 239, 230, 0.94)",
                textShadow:
                  "0 1px 3px rgba(4, 9, 18, 0.96), 0 3px 16px rgba(4, 9, 18, 0.88), 0 0 28px rgba(6, 12, 22, 0.78)",
              }}
            >
              &ldquo;{activeQuote.text}&rdquo;
              {activeQuote.author ? (
                <span className="ml-2 whitespace-nowrap font-ui text-[0.74rem] tracking-[0.14em] uppercase text-[#E2B46D]">
                  · {activeQuote.author}
                </span>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </button>
      ) : null}
    </div>
  );
}
