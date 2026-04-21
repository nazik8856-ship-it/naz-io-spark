import React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  show: boolean;
  color?: string;
  duration?: number;
}

/**
 * A horizontal scanning beam that sweeps top-to-bottom over its parent.
 * Parent must be `position: relative` and `overflow: hidden`.
 */
const ScanBeam: React.FC<Props> = ({ show, color = "#06b6d4", duration = 0.9 }) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ y: "-10%", opacity: 0 }}
        animate={{ y: "110%", opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none absolute inset-x-0 z-30"
        style={{
          height: 36,
          background: `linear-gradient(180deg, transparent 0%, ${color}66 45%, ${color} 50%, ${color}66 55%, transparent 100%)`,
          boxShadow: `0 0 30px ${color}, 0 0 60px ${color}80`,
          mixBlendMode: "screen",
        }}
      />
    )}
  </AnimatePresence>
);

export default ScanBeam;
