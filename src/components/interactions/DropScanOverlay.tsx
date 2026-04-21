import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ScanBeam from "./ScanBeam";

interface Props {
  /** Monotonic count of placed assets — when it increases, the beam fires. */
  count: number;
  color?: string;
}

/**
 * Drop into a `position: relative; overflow: hidden` container.
 * Watches `count`; when it grows, fires a scanning beam followed by a brief celebratory flash.
 */
const DropScanOverlay: React.FC<Props> = ({ count, color = "#06b6d4" }) => {
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState(false);
  const last = useRef(count);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      last.current = count;
      return;
    }
    if (count > last.current) {
      setScanning(true);
      const a = setTimeout(() => {
        setScanning(false);
        setFlash(true);
      }, 900);
      const b = setTimeout(() => setFlash(false), 1500);
      return () => {
        clearTimeout(a);
        clearTimeout(b);
      };
    }
    last.current = count;
  }, [count]);

  // keep ref in sync (after the conditional above resolves)
  useEffect(() => {
    last.current = count;
  }, [count]);

  return (
    <>
      <ScanBeam show={scanning} color={color} />
      <AnimatePresence>
        {flash && (
          <motion.div
            key="snap-flash"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="pointer-events-none absolute inset-0 z-20 rounded-2xl"
            style={{
              boxShadow: `inset 0 0 36px ${color}55, 0 0 24px ${color}66`,
              border: `1px solid ${color}`,
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default DropScanOverlay;
