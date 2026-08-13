import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Strictness = "loose" | "balanced" | "strict";

const OPTIONS: { value: Strictness; label: string; blurb: string }[] = [
  { value: "loose", label: "Loose", blurb: "More runs on its own, fewer stops for you." },
  { value: "balanced", label: "Balanced", blurb: "Escalates low-confidence and high-risk work." },
  { value: "strict", label: "Strict", blurb: "Narrow confidence bands, unclear fit gets parked." },
];

/**
 * ORG STRICTNESS — one dial that scales risk scoring, fit scoring and the
 * confidence-escalation gate across the whole control engine.
 */
export default function StrictnessPanel() {
  const { user } = useAuth();
  const [value, setValue] = useState<Strictness>("balanced");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("control_strictness")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const v = (data as { control_strictness?: string } | null)?.control_strictness;
        if (v === "loose" || v === "strict" || v === "balanced") setValue(v);
      });
  }, [user]);

  const pick = async (next: Strictness) => {
    if (!user || next === value) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ control_strictness: next } as never)
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setValue(prev);
      toast({ title: "Couldn't save that", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Strictness: ${next}`, description: "Applies to every decision from now on." });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-6 py-2 text-[11px]">
      <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider text-zinc-400">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Strictness
      </span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => pick(o.value)}
          disabled={saving}
          title={o.blurb}
          className={`rounded border px-2.5 py-1 font-mono uppercase tracking-wider disabled:opacity-50 ${
            value === o.value
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
      <span className="text-zinc-500">{OPTIONS.find((o) => o.value === value)?.blurb}</span>
    </div>
  );
}
