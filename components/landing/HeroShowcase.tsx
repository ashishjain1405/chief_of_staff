"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

const INTERVAL = 5000;
const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

// The hero walks through the product - spending, then Ask AI, then tasks -
// and pauses while hovered or focused. With reduced motion it waits for a click.
export function HeroShowcase({ slides }: { slides: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const still = useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => false);
  const playing = !paused && !still;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % slides.length), INTERVAL);
    return () => clearTimeout(t);
  }, [active, playing, slides.length]);

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div role="tablist" aria-label="What it does" className="mb-4 flex w-fit gap-1 rounded-full bg-muted/70 p-1">
        {slides.map((s, i) => (
          <button key={s.label} type="button" role="tab" id={`hero-tab-${i}`} aria-selected={i === active} aria-controls={`hero-slide-${i}`} onClick={() => setActive(i)}
            className={`relative overflow-hidden rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${i === active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {s.label}
            {i === active && playing && (
              <span key={active} aria-hidden className="absolute inset-x-3 bottom-0.5 h-0.5 origin-left rounded-full bg-sky-600"
                style={{ animation: `hero-progress ${INTERVAL}ms linear` }} />
            )}
          </button>
        ))}
      </div>
      <div className="grid">
        {slides.map((s, i) => (
          <div key={s.label} id={`hero-slide-${i}`} role="tabpanel" aria-labelledby={`hero-tab-${i}`} inert={i !== active}
            className={`[grid-area:1/1] transition duration-500 ease-out motion-reduce:transition-none [&>*]:h-full ${i === active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}>
            {s.content}
          </div>
        ))}
      </div>
    </div>
  );
}
