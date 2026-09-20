// Builds a real, standalone static HTML document from a generated website's
// manifest -- previously "Export" only downloaded the raw manifest JSON,
// which isn't something a user can actually host anywhere. This isn't a
// pixel-perfect copy of the live WebsitePreview renderer (no motion, no
// generated SVG signatures), but every page's real copy, links, and basic
// layout are present in plain HTML/CSS a user can open or deploy as-is.
//
// The contact form posts to the same website-form-submit edge function the
// live NazAI-hosted preview uses (verify_jwt=false, so a plain fetch with no
// API key works) -- an exported file used to just alert() and throw the
// submission away, which is the same "lead goes into a black hole" bug the
// live preview had before it got a real backend.
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/client";

type Field = Record<string, unknown>;

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function str(o: Field, k: string): string {
  const v = o?.[k];
  return typeof v === "string" ? v : "";
}
function arr<T = Field>(o: Field, k: string): T[] {
  const v = o?.[k];
  return Array.isArray(v) ? (v as T[]) : [];
}
function strArr(o: Field, k: string): string[] {
  return arr<unknown>(o, k).filter((x): x is string => typeof x === "string");
}
function resolveHref(href: string, pages: { slug: string }[]): string {
  const raw = (href || "").trim();
  if (!raw) return "#";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("#")) return raw;
  const cleaned = raw.replace(/^\//, "").split(/[?#]/)[0];
  return pages.some((p) => p.slug === cleaned) ? `#${cleaned}` : "#";
}
// A page-slug href becomes `#slug`, intercepted by the document-level click
// handler in the exported script below (a single downloadable file can't
// have real multi-page routing without a zip of separate files, so all
// pages ship in one document and switch visibility client-side).

function renderSection(section: Field, pages: { slug: string }[], websiteId: string, pageSlug: string): string {
  const c = (section.content as Field) || {};
  const type = str(section, "type");
  const href = (v: string) => esc(resolveHref(v, pages));

  switch (type) {
    case "hero":
      return `<section class="hero"><p class="eyebrow">${esc(str(c, "eyebrow"))}</p><h1>${esc(str(c, "headline")).replace(/~([^~]+)~/g, "<em>$1</em>")}</h1><p class="lead">${esc(str(c, "subheadline"))}</p><div class="cta-row">${str(c, "cta_primary") ? `<a class="btn btn-primary" href="${href(str(c, "cta_primary_href"))}">${esc(str(c, "cta_primary"))}</a>` : ""}${str(c, "cta_secondary") ? `<a class="btn btn-ghost" href="${href(str(c, "cta_secondary_href"))}">${esc(str(c, "cta_secondary"))}</a>` : ""}</div></section>`;
    case "about":
      return `<section><h2>${esc(str(c, "heading"))}</h2><p>${esc(str(c, "body"))}</p><ul>${strArr(c, "bullets").map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>`;
    case "services":
      return `<section><h2>${esc(str(c, "heading"))}</h2><div class="grid">${arr(c, "items").map((it) => `<div class="card"><h3>${esc(str(it, "title"))}</h3><p>${esc(str(it, "description"))}</p></div>`).join("")}</div></section>`;
    case "testimonials":
      return `<section><h2>${esc(str(c, "heading"))}</h2><div class="grid">${arr(c, "items").map((it) => `<blockquote><p>“${esc(str(it, "quote"))}”</p><footer>${esc(str(it, "author"))}${str(it, "role") ? `, ${esc(str(it, "role"))}` : ""}</footer></blockquote>`).join("")}</div></section>`;
    case "gallery":
      return `<section><h2>${esc(str(c, "heading"))}</h2><div class="grid">${arr(c, "items").map((it) => `<figure>${str(it, "asset_url") ? `<img src="${esc(str(it, "asset_url"))}" alt="${esc(str(it, "caption"))}"/>` : ""}<figcaption>${esc(str(it, "caption"))}</figcaption></figure>`).join("")}</div></section>`;
    case "contact":
      return `<section><h2>${esc(str(c, "heading"))}</h2><p>${esc(str(c, "body"))}</p><ul class="meta">${str(c, "email") ? `<li>${esc(str(c, "email"))}</li>` : ""}${str(c, "phone") ? `<li>${esc(str(c, "phone"))}</li>` : ""}${str(c, "address") ? `<li>${esc(str(c, "address"))}</li>` : ""}</ul><form onsubmit="return handleLeadFormSubmit(event)" data-website-id="${esc(websiteId)}" data-page-slug="${esc(pageSlug)}" data-section-kind="contact">${(strArr(c, "form_fields").length ? strArr(c, "form_fields") : ["Name", "Email", "Message"]).map((f) => `<label>${esc(f)}${f.toLowerCase().includes("message") ? `<textarea name="${esc(f)}" rows="4"></textarea>` : `<input name="${esc(f)}"/>`}</label>`).join("")}<button type="submit">Send</button></form></section>`;
    case "pricing":
      return `<section><h2>${esc(str(c, "heading"))}</h2><div class="grid">${arr(c, "items").length ? "" : arr(c, "tiers").map((t) => `<div class="card"><h3>${esc(str(t, "name"))}</h3><p class="price">${esc(str(t, "price"))}${str(t, "period") ? `/${esc(str(t, "period"))}` : ""}</p><ul>${strArr(t, "features").map((f) => `<li>${esc(f)}</li>`).join("")}</ul><a class="btn btn-primary" href="${href(str(t, "cta_href"))}">${esc(str(t, "cta") || "Choose")}</a></div>`).join("")}</div></section>`;
    case "faq":
      return `<section><h2>${esc(str(c, "heading"))}</h2>${arr(c, "items").map((it) => `<details><summary>${esc(str(it, "q"))}</summary><p>${esc(str(it, "a"))}</p></details>`).join("")}</section>`;
    case "stats":
      return `<section><h2>${esc(str(c, "heading"))}</h2><div class="stats">${arr(c, "items").map((it) => `<div><strong>${esc(str(it, "value"))}</strong><span>${esc(str(it, "label"))}</span></div>`).join("")}</div></section>`;
    case "process":
      return `<section><h2>${esc(str(c, "heading"))}</h2><ol>${arr(c, "steps").map((s) => `<li><strong>${esc(str(s, "title"))}</strong> — ${esc(str(s, "description"))}</li>`).join("")}</ol></section>`;
    case "cta":
      return `<section class="cta"><h2>${esc(str(c, "headline")).replace(/~([^~]+)~/g, "<em>$1</em>")}</h2><p>${esc(str(c, "subheadline"))}</p><div class="cta-row">${str(c, "cta_primary") ? `<a class="btn btn-primary" href="${href(str(c, "cta_primary_href"))}">${esc(str(c, "cta_primary"))}</a>` : ""}${str(c, "cta_secondary") ? `<a class="btn btn-ghost" href="${href(str(c, "cta_secondary_href"))}">${esc(str(c, "cta_secondary"))}</a>` : ""}</div></section>`;
    case "logos":
      return `<section><p class="eyebrow">${esc(str(c, "heading"))}</p><div class="logos">${arr(c, "items").map((it) => `<span>${esc(str(it, "name"))}</span>`).join("")}</div></section>`;
    case "feature-split":
      return `<section><h2>${esc(str(c, "heading"))}</h2><p>${esc(str(c, "body"))}</p><ul>${strArr(c, "bullets").map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>`;
    case "custom": {
      const kind = str(c, "kind");
      if (kind === "map" && str(c, "address")) {
        return `<section><h2>${esc(str(c, "heading") || "Find us")}</h2><iframe src="https://www.google.com/maps?q=${encodeURIComponent(str(c, "address"))}&output=embed" style="width:100%;height:360px;border:0" loading="lazy"></iframe></section>`;
      }
      if (kind === "embed" && /^https:\/\//i.test(str(c, "embed_url"))) {
        return `<section><h2>${esc(str(c, "heading") || "")}</h2><iframe src="${esc(str(c, "embed_url"))}" style="width:100%;height:480px;border:0" loading="lazy"></iframe></section>`;
      }
      return `<section><h2>${esc(str(c, "heading") || kind)}</h2><p>${esc(str(c, "body"))}</p></section>`;
    }
    default:
      return "";
  }
}

export function buildStaticSiteHtml(website: Field, pages: Field[]): string {
  const theme = (website.theme as Field) || {};
  const palette = (theme.palette as Field) || {};
  const font = (theme.font as Field) || {};
  const bg = str(palette, "bg") || "#0b0b0f";
  const text = str(palette, "text") || "#f4f4f5";
  const accent = str(palette, "accent") || "#00a3ff";
  const surface = str(palette, "surface") || "#151520";
  const headingFont = str(font, "heading") || "Inter";
  const bodyFont = str(font, "body") || "Inter";
  const pageList = pages.map((p) => ({ slug: str(p, "slug") || "home" }));
  const name = str(website, "name") || "Website";
  const tagline = str(website, "tagline");

  const nav = `<nav>${pageList.map((p, i) => {
    const title = str(pages[i], "title") || p.slug;
    return `<a href="#${p.slug}"${i === 0 ? ' class="active"' : ""}>${esc(title)}</a>`;
  }).join("")}</nav>`;

  const css = `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: ${bg}; color: ${text}; font-family: '${bodyFont}', system-ui, sans-serif; line-height: 1.6; }
    h1, h2, h3, .eyebrow { font-family: '${headingFont}', system-ui, sans-serif; }
    em { color: ${accent}; font-style: normal; }
    header { padding: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    nav { display: flex; gap: 16px; flex-wrap: wrap; }
    nav a { color: ${text}; opacity: 0.8; text-decoration: none; font-size: 14px; }
    nav a:hover { opacity: 1; }
    main { max-width: 960px; margin: 0 auto; padding: 0 24px; }
    section { padding: 56px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .hero { text-align: left; }
    .hero h1 { font-size: 48px; margin: 0 0 16px; }
    .lead { opacity: 0.85; font-size: 18px; max-width: 640px; }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.15em; font-size: 12px; opacity: 0.6; }
    .cta-row { display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }
    .btn { display: inline-block; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
    .btn-primary { background: ${accent}; color: #000; }
    .btn-ghost { border: 1px solid rgba(255,255,255,0.25); color: ${text}; }
    .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 24px; }
    .card { background: ${surface}; border-radius: 12px; padding: 20px; }
    .stats { display: flex; gap: 32px; flex-wrap: wrap; margin-top: 16px; }
    .stats div { display: flex; flex-direction: column; }
    .stats strong { font-size: 28px; color: ${accent}; }
    blockquote { background: ${surface}; border-radius: 12px; padding: 20px; margin: 0; }
    figure { margin: 0; }
    figure img { width: 100%; border-radius: 12px; }
    form { display: grid; gap: 12px; max-width: 480px; margin-top: 16px; }
    form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; opacity: 0.8; }
    input, textarea { background: ${surface}; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; color: ${text}; font: inherit; }
    button[type="submit"] { justify-self: start; }
    footer { padding: 32px 24px; text-align: center; font-size: 13px; opacity: 0.6; }
    .logos { display: flex; gap: 24px; flex-wrap: wrap; opacity: 0.7; margin-top: 16px; }
    nav a.active { opacity: 1; border-bottom: 2px solid ${accent}; }
    main > div[data-page] { display: none; }
    main > div[data-page].active { display: block; }
  `;

  const fontLink = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFont)}:wght@400;700&family=${encodeURIComponent(bodyFont)}:wght@400;500&display=swap" rel="stylesheet">`;

  // All pages ship in one file, switched client-side (isPageHref/showPage) --
  // a single download that works when opened directly (file://) or hosted
  // anywhere, with no server-side routing required.
  const websiteId = str(website, "id");
  const pageBlocks = pageList.map((p, i) => {
    const page = pages[i] as Field;
    const sections = arr(page, "sections");
    return `<div data-page="${esc(p.slug)}" class="${i === 0 ? "active" : ""}">${sections.map((s) => renderSection(s as Field, pageList, websiteId, p.slug)).join("\n")}</div>`;
  }).join("\n");

  const pageSlugs = JSON.stringify(pageList.map((p) => p.slug));
  const script = `
    var PAGE_SLUGS = ${pageSlugs};
    var LEAD_FORM_ENDPOINT = ${JSON.stringify(`${SUPABASE_FUNCTIONS_URL}/website-form-submit`)};
    function handleLeadFormSubmit(e) {
      e.preventDefault();
      var form = e.target;
      var btn = form.querySelector('button[type="submit"]');
      var fields = {};
      Array.prototype.forEach.call(form.querySelectorAll('input[name], textarea[name]'), function (el) {
        fields[el.name] = el.value;
      });
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      fetch(LEAD_FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId: form.getAttribute('data-website-id'),
          pageSlug: form.getAttribute('data-page-slug'),
          sectionKind: form.getAttribute('data-section-kind'),
          fields: fields,
        }),
      }).then(function (res) {
        if (!res.ok) throw new Error('submit failed');
        form.innerHTML = '<p style="opacity:.85">Thanks — we\\'ll be in touch.</p>';
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
        alert('Something went wrong sending this — please try again or contact us directly.');
      });
      return false;
    }
    function showPage(slug) {
      document.querySelectorAll('main > div[data-page]').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-page') === slug);
      });
      document.querySelectorAll('nav a').forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + slug);
      });
      window.scrollTo(0, 0);
    }
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var slug = a.getAttribute('href').slice(1);
      if (PAGE_SLUGS.indexOf(slug) === -1) return;
      e.preventDefault();
      showPage(slug);
    });
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(name)}</title>
<meta name="description" content="${esc(tagline)}"/>
${fontLink}
<style>${css}</style>
</head>
<body>
<header><strong>${esc(name)}</strong>${nav}</header>
<main>${pageBlocks}</main>
<footer>© ${new Date().getFullYear()} ${esc(name)}${tagline ? ` · ${esc(tagline)}` : ""} — exported from NazAI</footer>
<script>${script}</script>
</body>
</html>`;
}
