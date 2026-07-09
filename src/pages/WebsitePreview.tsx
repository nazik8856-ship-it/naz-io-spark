import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Theme = {
  palette: { bg: string; surface: string; text: string; accent: string; accentSecondary?: string };
  font: { heading: string; body: string };
  vibe?: string;
};

type Section = { type: string; content: Record<string, unknown> };
type Page = {
  id: string;
  slug: string;
  title: string;
  seo_description: string | null;
  sections: Section[];
  order_index: number;
};
type Website = {
  id: string;
  name: string | null;
  tagline: string | null;
  theme: Theme | null;
};

const DEFAULT_THEME: Theme = {
  palette: { bg: "#0B0B0F", surface: "#151520", text: "#F4F4F5", accent: "#00A3FF", accentSecondary: "#7C3AED" },
  font: { heading: "Inter", body: "Inter" },
};

function fieldStr(o: Record<string, unknown>, k: string, fallback = ""): string {
  const v = o[k];
  return typeof v === "string" ? v : fallback;
}
function fieldArr<T = Record<string, unknown>>(o: Record<string, unknown>, k: string): T[] {
  const v = o[k];
  return Array.isArray(v) ? (v as T[]) : [];
}
function fieldStrArr(o: Record<string, unknown>, k: string): string[] {
  const v = o[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export default function WebsitePreview() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [site, setSite] = useState<Website | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlug, setActiveSlug] = useState<string>(params.get("page") ?? "home");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: siteRow, error: siteErr }, { data: pageRows, error: pagesErr }] = await Promise.all([
        supabase.from("websites").select("id, name, tagline, theme").eq("id", id).maybeSingle(),
        supabase.from("website_pages").select("id, slug, title, seo_description, sections, order_index").eq("website_id", id).order("order_index", { ascending: true }),
      ]);
      if (cancelled) return;
      if (siteErr || !siteRow) {
        setError(siteErr?.message ?? "Website not found");
        setLoading(false);
        return;
      }
      setSite(siteRow as unknown as Website);
      setPages((pageRows ?? []) as unknown as Page[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const theme = useMemo<Theme>(() => {
    const t = site?.theme;
    if (!t || typeof t !== "object") return DEFAULT_THEME;
    return {
      palette: { ...DEFAULT_THEME.palette, ...(t.palette ?? {}) },
      font: { ...DEFAULT_THEME.font, ...(t.font ?? {}) },
      vibe: t.vibe,
    };
  }, [site]);

  const activePage = pages.find((p) => p.slug === activeSlug) ?? pages[0];

  useEffect(() => {
    if (!theme) return;
    const heading = theme.font.heading.replace(/\s+/g, "+");
    const body = theme.font.body.replace(/\s+/g, "+");
    const href = `https://fonts.googleapis.com/css2?family=${heading}:wght@400;600;700;800&family=${body}:wght@400;500;600&display=swap`;
    const linkId = "nazai-website-fonts";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [theme]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white gap-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm text-zinc-400">Loading preview…</span>
      </div>
    );
  }
  if (error || !site) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white gap-3">
        <p className="text-sm text-red-400">{error ?? "Site not found"}</p>
        <button onClick={() => navigate("/generator-home")} className="text-xs underline text-zinc-400">
          Back to generator
        </button>
      </div>
    );
  }

  const { bg, surface, text, accent, accentSecondary } = theme.palette;

  return (
    <div style={{ backgroundColor: bg, color: text, fontFamily: `'${theme.font.body}', system-ui, sans-serif` }} className="min-h-screen">
      {/* Preview chrome */}
      <div className="sticky top-0 z-50 flex items-center justify-between gap-4 px-4 py-2.5 border-b border-white/10 backdrop-blur bg-black/60 text-white text-xs">
        <button onClick={() => navigate("/generator-home")} className="flex items-center gap-1.5 text-zinc-300 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="font-mono uppercase tracking-[0.24em] text-zinc-400 truncate">
          {site.name} · preview
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[50%]">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveSlug(p.slug)}
              className={`px-2.5 py-1 rounded-full border whitespace-nowrap ${
                activeSlug === p.slug ? "border-white/60 bg-white/10" : "border-white/10 hover:border-white/30"
              }`}
            >
              {p.title}
            </button>
          ))}
        </div>
      </div>

      {/* Rendered page */}
      <style>{`.nz-h { font-family: '${theme.font.heading}', system-ui, sans-serif; }`}</style>
      {activePage?.sections.map((s, idx) => (
        <SectionBlock
          key={idx}
          section={s}
          palette={{ bg, surface, text, accent, accentSecondary: accentSecondary ?? accent }}
        />
      ))}
      {!activePage?.sections.length && (
        <div className="max-w-3xl mx-auto px-6 py-24 text-center opacity-70">
          <p>This page has no sections yet.</p>
        </div>
      )}

      <footer className="border-t border-white/10 px-6 py-8 text-center text-xs opacity-60">
        © {new Date().getFullYear()} {site.name} · {site.tagline}
      </footer>
    </div>
  );
}

type Palette = { bg: string; surface: string; text: string; accent: string; accentSecondary: string };

function SectionBlock({ section, palette }: { section: Section; palette: Palette }) {
  const c = section.content ?? {};
  const container = "max-w-6xl mx-auto px-6 py-20";
  const heading = "nz-h text-3xl md:text-4xl font-bold tracking-tight mb-6";

  switch (section.type) {
    case "hero":
      return (
        <section style={{ background: `linear-gradient(135deg, ${palette.bg} 0%, ${palette.surface} 100%)` }} className="border-b border-white/5">
          <div className={`${container} py-28 md:py-36 text-center`}>
            <h1 className="nz-h text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05]">
              {fieldStr(c, "headline", "Welcome")}
            </h1>
            {fieldStr(c, "subheadline") && (
              <p className="mt-6 text-lg md:text-xl opacity-80 max-w-2xl mx-auto">{fieldStr(c, "subheadline")}</p>
            )}
            <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
              {fieldStr(c, "cta_primary") && (
                <button style={{ backgroundColor: palette.accent, color: palette.bg }} className="px-6 py-3 rounded-lg font-semibold">
                  {fieldStr(c, "cta_primary")}
                </button>
              )}
              {fieldStr(c, "cta_secondary") && (
                <button style={{ borderColor: palette.accent, color: palette.text }} className="px-6 py-3 rounded-lg font-semibold border">
                  {fieldStr(c, "cta_secondary")}
                </button>
              )}
            </div>
          </div>
        </section>
      );

    case "about":
      return (
        <section className={container}>
          <h2 className={heading}>{fieldStr(c, "heading", "About")}</h2>
          <p className="text-lg opacity-80 max-w-3xl">{fieldStr(c, "body")}</p>
          {fieldStrArr(c, "bullets").length > 0 && (
            <ul className="mt-6 grid gap-3 md:grid-cols-2">
              {fieldStrArr(c, "bullets").map((b, i) => (
                <li key={i} className="flex gap-3">
                  <span style={{ backgroundColor: palette.accent }} className="mt-2 h-2 w-2 rounded-full shrink-0" />
                  <span className="opacity-90">{b}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      );

    case "services": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y border-white/5">
          <div className={container}>
            <h2 className={heading}>{fieldStr(c, "heading", "Services")}</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {items.map((it, i) => (
                <div key={i} style={{ backgroundColor: palette.bg, borderColor: `${palette.accent}33` }} className="rounded-xl border p-6">
                  <div style={{ color: palette.accent }} className="text-xs uppercase tracking-[0.2em] font-mono mb-3">
                    {fieldStr(it, "icon", `0${i + 1}`)}
                  </div>
                  <h3 className="nz-h font-semibold text-lg mb-2">{fieldStr(it, "title")}</h3>
                  <p className="text-sm opacity-75">{fieldStr(it, "description")}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "testimonials": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container}>
          <h2 className={heading}>{fieldStr(c, "heading", "What clients say")}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {items.map((it, i) => (
              <blockquote key={i} style={{ backgroundColor: palette.surface, borderLeftColor: palette.accent }} className="rounded-lg p-6 border-l-4">
                <p className="italic opacity-90">"{fieldStr(it, "quote")}"</p>
                <footer className="mt-4 text-sm opacity-70">
                  — <span className="font-semibold">{fieldStr(it, "author")}</span>
                  {fieldStr(it, "role") && <span>, {fieldStr(it, "role")}</span>}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      );
    }

    case "gallery": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y border-white/5">
          <div className={container}>
            <h2 className={heading}>{fieldStr(c, "heading", "Gallery")}</h2>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {items.map((it, i) => (
                <div key={i} className="aspect-square rounded-lg overflow-hidden relative"
                  style={{
                    background: `linear-gradient(135deg, ${palette.accent}44 0%, ${palette.accentSecondary}44 100%)`,
                  }}
                >
                  <div className="absolute inset-0 flex items-end p-3">
                    <span className="text-xs font-medium opacity-90">{fieldStr(it, "caption")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "contact":
      return (
        <section className={container}>
          <div className="grid gap-10 md:grid-cols-2 items-start">
            <div>
              <h2 className={heading}>{fieldStr(c, "heading", "Get in touch")}</h2>
              <p className="opacity-80">{fieldStr(c, "body")}</p>
              <ul className="mt-6 space-y-2 text-sm opacity-90">
                {fieldStr(c, "email") && <li>✉ {fieldStr(c, "email")}</li>}
                {fieldStr(c, "phone") && <li>☎ {fieldStr(c, "phone")}</li>}
                {fieldStr(c, "address") && <li>📍 {fieldStr(c, "address")}</li>}
              </ul>
            </div>
            <form style={{ backgroundColor: palette.surface }} className="rounded-xl p-6 space-y-3" onSubmit={(e) => e.preventDefault()}>
              {(fieldStrArr(c, "form_fields").length ? fieldStrArr(c, "form_fields") : ["Name", "Email", "Message"]).map((f, i) => (
                <div key={i}>
                  <label className="block text-xs uppercase tracking-wider opacity-70 mb-1">{f}</label>
                  {f.toLowerCase().includes("message") ? (
                    <textarea rows={4} className="w-full rounded bg-black/30 border border-white/10 px-3 py-2 text-sm" />
                  ) : (
                    <input className="w-full rounded bg-black/30 border border-white/10 px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
              <button type="submit" style={{ backgroundColor: palette.accent, color: palette.bg }} className="w-full rounded-lg py-2.5 font-semibold">
                Send
              </button>
            </form>
          </div>
        </section>
      );

    case "pricing": {
      const tiers = fieldArr<Record<string, unknown>>(c, "tiers");
      return (
        <section style={{ backgroundColor: palette.surface }} className="border-y border-white/5">
          <div className={container}>
            <h2 className={heading}>{fieldStr(c, "heading", "Pricing")}</h2>
            <div className="grid gap-6 md:grid-cols-3">
              {tiers.map((t, i) => {
                const featured = !!t.featured;
                return (
                  <div
                    key={i}
                    style={{
                      backgroundColor: palette.bg,
                      borderColor: featured ? palette.accent : "rgba(255,255,255,0.1)",
                      boxShadow: featured ? `0 20px 60px -20px ${palette.accent}66` : undefined,
                    }}
                    className="rounded-2xl border p-6 flex flex-col"
                  >
                    <div className="text-xs uppercase tracking-[0.2em] font-mono opacity-70">{fieldStr(t, "name")}</div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="nz-h text-4xl font-bold">{fieldStr(t, "price")}</span>
                      {fieldStr(t, "period") && <span className="text-sm opacity-60">/{fieldStr(t, "period")}</span>}
                    </div>
                    <ul className="mt-5 space-y-2 text-sm flex-1">
                      {fieldStrArr(t, "features").map((f, j) => (
                        <li key={j} className="flex gap-2">
                          <span style={{ color: palette.accent }}>✓</span>
                          <span className="opacity-90">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      style={{
                        backgroundColor: featured ? palette.accent : "transparent",
                        color: featured ? palette.bg : palette.text,
                        borderColor: palette.accent,
                      }}
                      className="mt-6 w-full rounded-lg py-2.5 font-semibold border"
                    >
                      {fieldStr(t, "cta", "Choose")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }

    case "faq": {
      const items = fieldArr<Record<string, unknown>>(c, "items");
      return (
        <section className={container}>
          <h2 className={heading}>{fieldStr(c, "heading", "FAQ")}</h2>
          <div className="max-w-3xl space-y-3">
            {items.map((it, i) => (
              <details key={i} style={{ backgroundColor: palette.surface }} className="rounded-lg p-4 group">
                <summary className="cursor-pointer font-semibold flex justify-between items-center">
                  <span>{fieldStr(it, "q")}</span>
                  <span style={{ color: palette.accent }} className="ml-3">+</span>
                </summary>
                <p className="mt-3 opacity-80 text-sm">{fieldStr(it, "a")}</p>
              </details>
            ))}
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}
