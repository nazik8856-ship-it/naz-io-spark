import React, { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { Wand2, Upload, Trash2, Move, AlertCircle, Sparkles, Maximize2, Minimize2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  AURA_PROFILE,
  BrandAsset,
  PlacedAsset,
  DropTarget,
  GuardianResult,
  extractDominantColor,
  findVibeMatches,
  inferTags,
  runGuardian,
  snapToGrid,
  GRID_COLUMNS,
} from "@/lib/brand-engine";

const SPRING = { type: "spring" as const, damping: 22, stiffness: 320, mass: 0.8 };

// Canvas text blocks (mock content over which assets get composed)
const TEXT_BLOCKS: (DropTarget & { id: string; label: string; color: { r: number; g: number; b: number } })[] = [
  { id: "t1", label: "NEURAL ARCHITECTURE", x: 80, y: 60, width: 360, height: 56, type: "text", color: { r: 255, g: 255, b: 255 } },
  { id: "t2", label: "Autonomous orchestration for the post-software era.", x: 80, y: 130, width: 420, height: 32, type: "text", color: { r: 200, g: 220, b: 255 } },
];

const GuardianCanvas: React.FC = () => {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [library, setLibrary] = useState<BrandAsset[]>([]);
  const [placed, setPlaced] = useState<PlacedAsset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [guardianFlash, setGuardianFlash] = useState<GuardianResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [vibeIdx, setVibeIdx] = useState(0);

  const containerWidth = 720;
  const containerHeight = 420;
  const containerAspect = containerWidth / containerHeight;

  // ── Upload handler ──────────────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || !user) return;
      setUploading(true);
      const newAssets: BrandAsset[] = [];
      for (const file of Array.from(files)) {
        const path = `${user.id}/guardian/${Date.now()}-${file.name}`;
        const { data, error } = await supabase.storage.from("mission-assets").upload(path, file);
        if (error) continue;
        const { data: pub } = supabase.storage.from("mission-assets").getPublicUrl(data.path);
        const url = pub.publicUrl;
        const dominantColor = await extractDominantColor(url);
        const img = new Image();
        const aspect = await new Promise<number>((res) => {
          img.onload = () => res(img.naturalWidth / Math.max(img.naturalHeight, 1));
          img.onerror = () => res(1);
          img.src = url;
        });
        const tags = inferTags(dominantColor, aspect);
        newAssets.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url,
          tags,
          dominantColor,
          aspectRatio: aspect,
        });
      }
      setLibrary((prev) => [...prev, ...newAssets]);
      setUploading(false);
    },
    [user]
  );

  // ── Place asset on canvas ──────────────────────────────────────────────────
  const placeOnCanvas = useCallback((asset: BrandAsset) => {
    const colWidth = containerWidth / GRID_COLUMNS;
    const placedAsset: PlacedAsset = {
      ...asset,
      x: 4 * colWidth,
      y: 220,
      width: 4, // 4 columns wide
      height: Math.round((4 * colWidth) / Math.max(asset.aspectRatio, 0.4)),
    };
    setPlaced((prev) => [...prev, placedAsset]);
    setActiveId(placedAsset.id);
  }, []);

  // ── Magic Wand: cycle vibe-matched assets ──────────────────────────────────
  const triggerMagicWand = useCallback(() => {
    if (!activeId) return;
    const current = placed.find((p) => p.id === activeId);
    if (!current) return;
    const matches = findVibeMatches(current, library);
    if (!matches.length) return;
    const next = matches[vibeIdx % matches.length];
    setVibeIdx((i) => i + 1);
    setPlaced((prev) =>
      prev.map((p) =>
        p.id === activeId
          ? {
              ...p,
              url: next.url,
              tags: next.tags,
              dominantColor: next.dominantColor,
              aspectRatio: next.aspectRatio,
            }
          : p
      )
    );
  }, [activeId, placed, library, vibeIdx]);

  // ── Drag handlers with magnetic snap + guardian ────────────────────────────
  const handleDrag = useCallback(
    (id: string, _e: any, info: PanInfo) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const item = placed.find((p) => p.id === id);
      if (!item) return;
      const rawX = info.point.x - rect.left;
      const rawY = info.point.y - rect.top;
      const colWidth = containerWidth / GRID_COLUMNS;
      const snap = snapToGrid(rawX - (item.width * colWidth) / 2, rawY - item.height / 2, containerWidth, 24);
      setGhost({ x: snap.x, y: snap.y, w: item.width * colWidth, h: item.height });
    },
    [placed]
  );

  const handleDragEnd = useCallback(
    (id: string, _e: any, info: PanInfo) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const item = placed.find((p) => p.id === id);
      if (!item) {
        setGhost(null);
        setDragging(null);
        return;
      }
      const colWidth = containerWidth / GRID_COLUMNS;
      const rawX = info.point.x - rect.left - (item.width * colWidth) / 2;
      const rawY = info.point.y - rect.top - item.height / 2;
      const snap = snapToGrid(rawX, rawY, containerWidth, 24);

      // Guardian validation
      const drop = { x: snap.x, y: snap.y, width: item.width * colWidth, height: item.height };
      const textBlocksUnder = TEXT_BLOCKS.filter(
        (t) =>
          drop.x < t.x + t.width &&
          drop.x + drop.width > t.x &&
          drop.y < t.y + t.height &&
          drop.y + drop.height > t.y
      );
      const result = runGuardian({
        asset: item,
        drop,
        containerAspect,
        textBlocksUnder,
        nearbyTargets: TEXT_BLOCKS,
      });

      setPlaced((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                x: snap.x,
                y: snap.y,
                filter: result.filterCss || undefined,
                overlay: result.overlay,
              }
            : p
        )
      );
      setGhost(null);
      setDragging(null);
      if (result.actions.length) {
        setGuardianFlash(result);
        setTimeout(() => setGuardianFlash(null), 4500);
      }
    },
    [placed, containerAspect]
  );

  // ── Fit / Fill correction ──────────────────────────────────────────────────
  const applyFit = useCallback(
    (id: string, mode: "fit" | "fill") => {
      const colWidth = containerWidth / GRID_COLUMNS;
      setPlaced((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const targetWidthPx = p.width * colWidth;
          const newHeight = mode === "fit" ? targetWidthPx / Math.max(p.aspectRatio, 0.4) : p.height;
          const newWidth = mode === "fill" ? Math.round(p.height * p.aspectRatio / colWidth) : p.width;
          return { ...p, height: newHeight, width: Math.max(2, Math.min(GRID_COLUMNS, newWidth)) };
        })
      );
      setGuardianFlash(null);
    },
    []
  );

  const removeAsset = useCallback((id: string) => {
    setPlaced((prev) => prev.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const colWidth = containerWidth / GRID_COLUMNS;
  const activeAsset = placed.find((p) => p.id === activeId);
  const vibeMatchCount = activeAsset ? findVibeMatches(activeAsset, library).length : 0;

  return (
    <section className="py-20 px-4 md:px-8 border-t border-white/5 bg-black/40">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#00A3FF]/30 bg-[#00A3FF]/5 mb-4">
            <Sparkles size={12} className="text-[#00A3FF]" />
            <span className="text-[10px] font-mono font-bold tracking-[0.3em] text-[#00A3FF]">DESIGN_GUARDIAN_v1</span>
          </div>
          <h2 className="text-white text-2xl md:text-4xl font-black uppercase tracking-[0.15em] mb-3">
            Brand-Snap Canvas
          </h2>
          <p className="text-white/40 text-xs md:text-sm font-mono max-w-xl mx-auto">
            Upload assets — drop them anywhere. The Guardian enforces contrast, brand palette, and grid integrity.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-xl">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !user}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-[10px] font-mono font-bold tracking-wider text-white/80 disabled:opacity-40"
          >
            <Upload size={12} />
            {uploading ? "UPLOADING..." : user ? "UPLOAD_ASSET" : "SIGN_IN_TO_UPLOAD"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={triggerMagicWand}
            disabled={!activeId || vibeMatchCount === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-[10px] font-mono font-bold tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              borderColor: activeId && vibeMatchCount ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.1)",
              background: activeId && vibeMatchCount ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)",
              color: activeId && vibeMatchCount ? "#22c55e" : "rgba(255,255,255,0.5)",
            }}
          >
            <Wand2 size={12} />
            MAGIC_WAND {vibeMatchCount > 0 ? `(${vibeMatchCount})` : ""}
          </motion.button>

          <div className="ml-auto flex items-center gap-3 text-[9px] font-mono text-white/40 tracking-wider">
            <span>GRID:{GRID_COLUMNS}</span>
            <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse" />
            <span>GUARDIAN:ACTIVE</span>
          </div>
        </div>

        {/* Library row */}
        {library.length > 0 && (
          <div className="flex gap-2 mb-4 p-3 rounded-2xl border border-white/10 bg-white/[0.02] overflow-x-auto">
            <span className="text-[9px] font-mono text-white/30 tracking-wider self-center pr-2 shrink-0">LIBRARY//</span>
            {library.map((a) => (
              <motion.button
                key={a.id}
                whileHover={{ scale: 1.08, y: -2 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => placeOnCanvas(a)}
                className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-white/20 hover:border-[#00A3FF]/60 transition-all"
              >
                <img src={a.url} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/70 text-[7px] font-mono text-[#00A3FF] truncate">
                  {a.tags[0]?.toUpperCase()}
                </div>
              </motion.button>
            ))}
          </div>
        )}

        {/* CANVAS */}
        <div className="relative mx-auto" style={{ width: containerWidth, maxWidth: "100%" }}>
          <div
            ref={canvasRef}
            className="relative rounded-2xl overflow-hidden border-2 border-white/10"
            style={{
              width: "100%",
              height: containerHeight,
              background: `linear-gradient(135deg, rgb(${AURA_PROFILE.obsidian.r},${AURA_PROFILE.obsidian.g},${AURA_PROFILE.obsidian.b}) 0%, #0a1428 100%)`,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setActiveId(null);
            }}
          >
            {/* 12-column grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: GRID_COLUMNS - 1 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-white/[0.04]"
                  style={{ left: `${((i + 1) / GRID_COLUMNS) * 100}%` }}
                />
              ))}
            </div>

            {/* Text blocks */}
            {TEXT_BLOCKS.map((t) => (
              <div
                key={t.id}
                className="absolute pointer-events-none"
                style={{ left: t.x, top: t.y, width: t.width, color: `rgb(${t.color.r},${t.color.g},${t.color.b})` }}
              >
                {t.id === "t1" ? (
                  <h3 className="text-2xl font-black uppercase tracking-[0.15em]" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>
                    {t.label}
                  </h3>
                ) : (
                  <p className="text-sm font-mono mt-2 opacity-90" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
                    {t.label}
                  </p>
                )}
              </div>
            ))}

            {/* Ghost zone */}
            <AnimatePresence>
              {ghost && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute pointer-events-none rounded-lg border-2 border-dashed"
                  style={{
                    left: ghost.x,
                    top: ghost.y,
                    width: ghost.w,
                    height: ghost.h,
                    borderColor: "#22c55e",
                    background: "rgba(34,197,94,0.08)",
                    boxShadow: "0 0 20px rgba(34,197,94,0.4)",
                  }}
                />
              )}
            </AnimatePresence>

            {/* Placed assets */}
            {placed.map((p) => {
              const isActive = activeId === p.id;
              const isDragging = dragging === p.id;
              return (
                <motion.div
                  key={p.id}
                  drag
                  dragMomentum={false}
                  dragElastic={0.05}
                  onDragStart={() => {
                    setDragging(p.id);
                    setActiveId(p.id);
                  }}
                  onDrag={(e, info) => handleDrag(p.id, e, info)}
                  onDragEnd={(e, info) => handleDragEnd(p.id, e, info)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveId(p.id);
                  }}
                  initial={false}
                  animate={{
                    x: p.x,
                    y: p.y,
                    scale: isDragging ? 1.04 : 1,
                  }}
                  transition={SPRING}
                  className="absolute cursor-grab active:cursor-grabbing rounded-lg overflow-hidden"
                  style={{
                    width: p.width * colWidth,
                    height: p.height,
                    boxShadow: isActive
                      ? "0 0 0 2px #00A3FF, 0 12px 40px rgba(0,163,255,0.4)"
                      : isDragging
                      ? "0 20px 50px rgba(0,0,0,0.6)"
                      : "0 8px 24px rgba(0,0,0,0.4)",
                    zIndex: isDragging ? 50 : isActive ? 20 : 10,
                  }}
                >
                  <img
                    src={p.url}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover pointer-events-none select-none"
                    style={{ filter: p.filter || undefined }}
                  />
                  {p.overlay && p.overlay > 0 && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: `rgba(0,0,0,${p.overlay})` }}
                    />
                  )}
                  {isActive && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeAsset(p.id); }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-md bg-black/70 border border-white/20 flex items-center justify-center hover:bg-red-500/40"
                      >
                        <Trash2 size={11} className="text-white/80" />
                      </button>
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[8px] font-mono text-[#00A3FF] flex items-center gap-1">
                        <Move size={9} /> {p.width}col
                      </div>
                    </>
                  )}
                </motion.div>
              );
            })}

            {/* Empty state */}
            {placed.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                <div className="text-[10px] font-mono text-white/30 tracking-[0.3em] mb-2">[ CANVAS_IDLE ]</div>
                <div className="text-white/50 text-xs font-mono">
                  {user ? "Upload assets, then click thumbnails to compose." : "Sign in to upload and compose assets."}
                </div>
              </div>
            )}
          </div>

          {/* Guardian toast */}
          <AnimatePresence>
            {guardianFlash && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={SPRING}
                className="absolute left-1/2 -translate-x-1/2 -bottom-4 translate-y-full w-[92%] max-w-md rounded-xl border border-[#22c55e]/40 bg-black/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(34,197,94,0.25)] p-4 z-30"
              >
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={14} className="text-[#22c55e]" />
                  <span className="text-[10px] font-mono font-bold tracking-[0.25em] text-[#22c55e]">GUARDIAN_ACTIONS</span>
                </div>
                <ul className="space-y-1.5 mb-3">
                  {guardianFlash.actions.map((a, i) => (
                    <li key={i} className="text-[11px] font-mono text-white/70 leading-snug">
                      <span className="text-[#00A3FF]">›</span> {a.reason}
                    </li>
                  ))}
                </ul>
                {guardianFlash.fitSuggestion && activeId && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => applyFit(activeId, "fit")}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-[#00A3FF]/40 bg-[#00A3FF]/10 hover:bg-[#00A3FF]/20 text-[10px] font-mono font-bold text-[#00A3FF] tracking-wider transition-all"
                    >
                      <Minimize2 size={10} /> APPLY_FIT
                    </button>
                    <button
                      onClick={() => applyFit(activeId, "fill")}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-[10px] font-mono font-bold text-white/80 tracking-wider transition-all"
                    >
                      <Maximize2 size={10} /> APPLY_FILL
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
};

export default GuardianCanvas;
