/**
 * Pre-loaded "FitForge" fitness SaaS sample — shown on the dashboard the
 * very first time a user lands with no prior generation. Production-grade
 * standalone HTML that renders in iframe srcDoc.
 */
export const FITNESS_SAAS_PROMPT =
  "FitForge — an AI fitness SaaS that builds personalized training plans, tracks PRs, and matches members with elite coaches.";

export const FITNESS_SAAS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FitForge — AI Fitness SaaS</title>
<style>
:root{--bg:#06070d;--panel:rgba(15,18,28,.72);--line:rgba(255,255,255,.08);--text:#f8fafc;--muted:#94a3b8;--accent:#22d3ee;--accent-2:#a855f7;--lime:#a3e635}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(circle at 12% 0%,rgba(34,211,238,.18),transparent 38%),radial-gradient(circle at 88% 8%,rgba(168,85,247,.22),transparent 36%),var(--bg)}
a{color:inherit;text-decoration:none}
.nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:18px clamp(18px,5vw,72px);background:rgba(6,7,13,.78);border-bottom:1px solid var(--line);backdrop-filter:blur(18px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.04em}
.mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--lime));box-shadow:0 0 30px rgba(34,211,238,.55)}
.links{display:flex;gap:22px;color:var(--muted);font-size:13px}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;border-radius:12px;border:1px solid rgba(34,211,238,.45);background:linear-gradient(135deg,rgba(34,211,238,.28),rgba(168,85,247,.24));color:white;font-weight:800;box-shadow:0 0 34px rgba(34,211,238,.26)}
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(280px,.95fr);gap:clamp(28px,5vw,72px);padding:clamp(58px,9vw,118px) clamp(18px,5vw,72px) 52px;align-items:center}
.eyebrow{display:inline-flex;gap:8px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:999px;color:var(--accent);background:rgba(255,255,255,.04);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em}
h1{margin:20px 0 18px;font-size:clamp(46px,8vw,92px);line-height:.88;letter-spacing:-.07em}
.lead{max-width:680px;color:#cbd5e1;font-size:clamp(17px,2.2vw,22px);line-height:1.55}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.secondary{border-color:var(--line);background:rgba(255,255,255,.055);box-shadow:none}
.glass{border:1px solid var(--line);background:var(--panel);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 30px 80px rgba(0,0,0,.32);backdrop-filter:blur(22px)}
.console{border-radius:24px;padding:20px}
.metric{display:grid;grid-template-columns:1fr auto;gap:8px;padding:14px;margin-top:10px;border-radius:16px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08)}
.metric strong{font-size:28px}
section{padding:80px clamp(18px,5vw,72px)}
.section-title{font-size:clamp(30px,4.5vw,54px);letter-spacing:-.05em;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.card{border-radius:22px;padding:26px;min-height:220px}
.card h3{margin:14px 0 10px;font-size:20px}
.card p,.pricing p{color:var(--muted);line-height:1.55}
.icon{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,rgba(34,211,238,.24),rgba(168,85,247,.22));display:grid;place-items:center;color:var(--accent);font-size:20px;font-weight:900}
.tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px}
.tier{border-radius:22px;padding:28px}
.tier h3{margin:0 0 6px;font-size:22px}
.tier .amount{font-size:48px;font-weight:950;letter-spacing:-.05em;margin:8px 0 14px}
.tier ul{list-style:none;padding:0;margin:0 0 18px;color:var(--muted);font-size:14px;line-height:1.9}
.tier.featured{border-color:rgba(34,211,238,.45);box-shadow:0 0 60px rgba(34,211,238,.18)}
footer{padding:34px clamp(18px,5vw,72px);color:var(--muted);border-top:1px solid var(--line)}
@media (max-width:760px){.hero,.tiers,.grid{grid-template-columns:1fr}.links{display:none}h1{font-size:52px}}
</style>
</head>
<body>
<nav class="nav"><a class="brand" href="#home"><span class="mark"></span><span>FitForge</span></a><div class="links"><a href="#features">Features</a><a href="#coaches">Coaches</a><a href="#pricing">Pricing</a></div><a class="cta" href="#pricing">Start free trial</a></nav>
<main id="home" class="hero">
  <div>
    <span class="eyebrow">AI Fitness OS</span>
    <h1>Train smarter. Lift heavier. Recover faster.</h1>
    <p class="lead">FitForge generates a personalized training plan from your goals, history, and recovery — then matches you with elite coaches who hold you accountable in real time.</p>
    <div class="actions"><a class="cta" href="#pricing">Start 14-day trial</a><a class="cta secondary" href="#features">See how it works</a></div>
  </div>
  <aside class="console glass">
    <div class="metric"><span>Plan adherence</span><strong>94%</strong></div>
    <div class="metric"><span>PR progression</span><strong>+18%</strong></div>
    <div class="metric"><span>Avg. coach reply</span><strong>4 min</strong></div>
    <div class="metric"><span>Recovery score</span><strong>87</strong></div>
  </aside>
</main>
<section id="features"><h2 class="section-title">An entire performance team in one app.</h2>
  <div class="grid">
    <article class="card glass"><div class="icon">⚡</div><h3>Adaptive Programming</h3><p>Plans recalibrate weekly using your wearables, fatigue, and lift logs.</p></article>
    <article class="card glass"><div class="icon">◎</div><h3>PR Tracking</h3><p>Every set, every rep — tracked with form-check video review.</p></article>
    <article class="card glass"><div class="icon">✦</div><h3>Coach Match</h3><p>Get paired with vetted strength, hypertrophy, and endurance coaches.</p></article>
  </div>
</section>
<section id="pricing"><h2 class="section-title">Pricing built for serious athletes.</h2>
  <div class="tiers">
    <div class="tier glass"><h3>Starter</h3><div class="amount">$19</div><ul><li>AI training plan</li><li>Basic PR tracking</li><li>Community access</li></ul><a class="cta secondary" href="#">Start free</a></div>
    <div class="tier glass featured"><h3>Athlete</h3><div class="amount">$49</div><ul><li>Adaptive weekly plans</li><li>Wearable sync</li><li>Form-check videos</li><li>Recovery scoring</li></ul><a class="cta" href="#">Most popular</a></div>
    <div class="tier glass"><h3>Coached</h3><div class="amount">$129</div><ul><li>Everything in Athlete</li><li>1:1 elite coach match</li><li>Weekly check-ins</li><li>Priority support</li></ul><a class="cta secondary" href="#">Get matched</a></div>
  </div>
</section>
<footer>© ${new Date().getFullYear()} FitForge. Built with NazAI.</footer>
</body>
</html>`;
