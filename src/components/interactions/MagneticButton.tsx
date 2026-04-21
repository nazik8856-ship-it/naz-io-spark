import React, { useRef, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

interface MagneticButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Maximum pull radius in px before the magnetic effect triggers */
  radius?: number;
  /** How strongly the element is pulled toward the cursor (0–1) */
  strength?: number;
  /** Optional override for the wrapper element */
  as?: "div" | "span";
  children: React.ReactNode;
}

const SPRING = { stiffness: 400, damping: 10, mass: 0.4 };

/**
 * A wrapper that applies a "magnetic" pull toward the cursor when within `radius`.
 * The child element scales to 1.05 on hover with weighted spring physics.
 *
 * Usage:
 *   <MagneticButton><button>Go</button></MagneticButton>
 */
const MagneticButton: React.FC<MagneticButtonProps> = ({
  radius = 80,
  strength = 0.35,
  as = "div",
  children,
  className,
  ...rest
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, SPRING);
  const sy = useSpring(y, SPRING);
  const [hover, setHover] = useState(false);

  const scale = useSpring(1, SPRING);

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < radius) {
      x.set(dx * strength);
      y.set(dy * strength);
    } else {
      x.set(0);
      y.set(0);
    }
  };

  const reset = () => {
    x.set(0);
    y.set(0);
    scale.set(1);
    setHover(false);
  };

  const onEnter = () => {
    setHover(true);
    scale.set(1.05);
  };

  const Tag: any = as === "span" ? motion.span : motion.div;

  return (
    <Tag
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={onEnter}
      onMouseLeave={reset}
      style={{ x: sx, y: sy, scale, display: "inline-block" }}
      className={className}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default MagneticButton;
