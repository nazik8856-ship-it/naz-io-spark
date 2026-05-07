import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Rocket } from "lucide-react";
import { detectBusinessIntent } from "@/lib/business-launch";

/**
 * IntentHintChip — listens to a text value and, after the user stops
 * typing for 800ms, surfaces a subtle chip confirming NazAI detected a
 * business-launch intent. Purely informational; the actual auto-activation
 * happens when the message is sent.
 */
const IntentHintChip: React.FC<{ value: string }> = ({ value }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const v = (value || "").trim();
    if (v.length < 6) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => {
      setShow(detectBusinessIntent(v));
    }, 800);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.96 }}
          transition={{ duration: 0.22 }}
          className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{
            background: "linear-gradient(90deg, rgba(6,182,212,0.12), rgba(168,85,247,0.12))",
            border: "1px solid rgba(6,182,212,0.45)",
            color: "#67e8f9",
            boxShadow: "0 0 18px rgba(6,182,212,0.25)",
          }}
        >
          <Rocket size={11} />
          Business launch intent detected · auto-activating Pro Designer + Antifragile
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default IntentHintChip;
