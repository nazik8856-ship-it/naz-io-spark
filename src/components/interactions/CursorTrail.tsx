import React, { useEffect, useRef, useState } from "react";

interface Point {
  id: number;
  x: number;
  y: number;
}

/**
 * A faint cyan "Neural Trail" that follows the cursor only while it's over an element
 * marked with `data-cursor-trail`. Fades out automatically when the cursor leaves.
 *
 * Mount once near the root of the page that contains trail-eligible zones.
 */
const CursorTrail: React.FC<{ color?: string; maxPoints?: number }> = ({
  color = "#06b6d4",
  maxPoints = 14,
}) => {
  const [points, setPoints] = useState<Point[]>([]);
  const [active, setActive] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let pendingMove = false;

    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const inZone = !!target?.closest("[data-cursor-trail]");
      if (!inZone) {
        if (active) setActive(false);
        return;
      }
      if (!active) setActive(true);
      lastX = e.clientX;
      lastY = e.clientY;
      if (!pendingMove) {
        pendingMove = true;
        raf = requestAnimationFrame(() => {
          pendingMove = false;
          setPoints((prev) => {
            const next = [
              ...prev,
              { id: idRef.current++, x: lastX, y: lastY },
            ];
            return next.slice(-maxPoints);
          });
        });
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [active, maxPoints]);

  // Decay points when inactive
  useEffect(() => {
    if (active) return;
    if (!points.length) return;
    const t = setTimeout(() => setPoints([]), 220);
    return () => clearTimeout(t);
  }, [active, points.length]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{ mixBlendMode: "screen" }}
    >
      {points.map((p, i) => {
        const t = (i + 1) / points.length;
        const size = 6 + t * 10;
        return (
          <span
            key={p.id}
            style={{
              position: "absolute",
              left: p.x - size / 2,
              top: p.y - size / 2,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity: t * 0.45,
              filter: `blur(${(1 - t) * 6 + 2}px)`,
              transition: "opacity 200ms linear",
            }}
          />
        );
      })}
    </div>
  );
};

export default CursorTrail;
