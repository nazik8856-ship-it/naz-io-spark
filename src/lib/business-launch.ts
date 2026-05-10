/**
 * ════════════════════════════════════════════════════════════════════════════════
 * NAZAI BUSINESS FORGE - PREMIUM BUSINESS GENERATION ENGINE
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Advanced business launch detection + premium directive system for NazAI.
 *
 * When the user's prompt clearly signals intent to start, found, or launch a
 * new business / company / startup / SaaS / brand, the Dashboard automatically
 * activates Business Forge mode and prepends a supercharged directive so the AI
 * returns a complete, premium launch package:
 *
 * ✨ Brand Identity (name, tagline, positioning, visual branding)
 * 🎨 Custom Brand System (colors, typography, logo concepts)
 * 🌐 Premium Website (landing page + customer dashboard + admin backend)
 * 📊 Business Plan (comprehensive strategy & positioning)
 * 💰 Financial Projections (12-24 month forecasts)
 * 📱 Marketing Assets (social, email, launch materials)
 * 🗄️ Data Management (basic backend structure)
 *
 * CORE PHILOSOPHY:
 * - Every generation is 100% original and unique
 * - No cached templates, no generic layouts
 * - Premium, luxury-level design aesthetic
 * - Fresh brand identity tailored to the specific business idea
 * - Light, modern, sophisticated design (unless dark mode requested)
 * - Complete full-stack package ready for deployment
 *
 * Version: 2.0.0 (Premium Elite)
 * Deployment: NAZAI_BUSINESS_FORGE_V2_PREMIUM_ELITE
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

// NOTE: Save this file as src/lib/business-launch.ts
// (Dashboard imports from "@/lib/business-launch")
import type { TierId } from "./credit-tiers";

// ════════════════════════════════════════════════════════════════════════════════
// BUSINESS INTENT DETECTION PATTERNS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Comprehensive patterns for detecting business launch intent.
 * Covers: starting, launching, founding, building new businesses/startups/SaaS/brands.
 * Intentionally permissive to catch various user phrasings.
 */
const LAUNCH_PATTERNS: RegExp[] = [
  // Direct launch/start/build/create/found patterns
  /\b(start|starting|launch|launching|found|founding|build|building|create|creating|kick\s*off|bootstrap|establish|establishing|set\s*up|setting\s+up)\s+(a|an|my|our|the)?\s*(new\s+)?(business|company|startup|start[-\s]?up|saas|brand|venture|agency|micro[-\s]?saas|shop|store|firm|studio|platform|app|application)\b/i,

  // Business idea patterns
  /\b(business|startup|saas|company|venture)\s+(idea|concept|plan|blueprint)\s+(for|about|around|on)\b/i,

  // Want/need to start patterns
  /\b(i\s+|we\s+)?(want|wanna|need|would\s+like|am\s+looking|planning|plan)\s+to\s+(start|launch|build|create|found|establish|develop|design)\s+(a|an|my|our|the)?\s*(new\s+)?(business|company|startup|saas|brand|venture|platform|app)\b/i,

  // New business/company patterns
  /\b(new|my\s+new|our\s+new|starting|launching)\s+(business|company|startup|saas|brand|venture|agency|platform|app|product)\b/i,

  // Launch my/the patterns
  /\b(launch|start|build|create)\s+(my|our|the|a|an)\s+(business|company|startup|brand|saas|product|venture|platform|app|service)\b/i,

  // Business plan/blueprint patterns
  /\b(business\s+plan|launch\s+plan|business\s+blueprint|startup\s+blueprint|go[-\s]?to[-\s]?market|gtm\s+strategy)\b/i,

  // SaaS-specific patterns
  /\b(build|create|launch|start)\s+(a|an|my|our)?\s*(saas|software\s+as\s+a\s+service|web\s+app|web\s+application|platform)\b/i,

  // E-commerce/store patterns
  /\b(open|launch|start|build)\s+(a|an|my|our)?\s*(online\s+store|ecommerce|e[-\s]?commerce|shop|storefront|marketplace)\b/i,

  // Agency/service business patterns
  /\b(start|launch|build|create)\s+(a|an|my|our)?\s*(agency|consulting\s+firm|service\s+business|freelance\s+business)\b/i,

  // Product launch patterns
  /\b(launch|release|introduce)\s+(a|an|my|our)?\s*(new\s+)?(product|service|offering)\b/i,

  // Founder/entrepreneur patterns
  /\b(as\s+a\s+founder|as\s+an\s+entrepreneur|startup\s+founder|business\s+founder)\b/i,

  // Acquisition/partnership patterns
  /\b(acquire|partner|merge|joint\s+venture)\s+to\s+(build|create|launch|start)\b/i,
];

/**
 * Industry-specific patterns for more targeted detection
 */
const INDUSTRY_PATTERNS: Record<string, RegExp> = {
  saas: /\b(saas|software\s+as\s+a\s+service|subscription\s+software|cloud\s+software)\b/i,
  ecommerce: /\b(ecommerce|e[-\s]?commerce|online\s+store|marketplace|dropship|print\s+on\s+demand)\b/i,
  agency: /\b(agency|consulting|freelance|service\s+business|creative\s+studio)\b/i,
  app: /\b(mobile\s+app|web\s+app|application|ios|android)\b/i,
  marketplace: /\b(marketplace|platform|network|community|social)\b/i,
  content: /\b(blog|newsletter|podcast|youtube|content|media|publication)\b/i,
  education: /\b(course|training|bootcamp|school|academy|education|learning)\b/i,
  health: /\b(health|fitness|wellness|medical|clinic|therapy|coaching)\b/i,
};

/**
 * Negative patterns - phrases that suggest iteration, not launch
 */
const ITERATION_PATTERNS: RegExp[] = [
  /\b(fix|improve|update|edit|change|modify|refactor|debug|optimize|enhance|tweak)\b/i,
  /\b(add\s+feature|remove\s+feature|change\s+color|adjust|redesign\s+the)\b/i,
  /\b(make\s+it|make\s+the|change\s+the|update\s+the)\s+(more|less|darker|lighter|bigger|smaller)\b/i,
];

// ════════════════════════════════════════════════════════════════════════════════
// BUSINESS INTENT DETECTION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Detect if prompt indicates a fresh business launch intent
 * Returns true when user clearly wants to start/launch/build a new business
 */
export const detectBusinessIntent = (prompt: string): boolean => {
  const text = (prompt || "").toLowerCase().trim();

  // Minimum length check
  if (text.length < 6) return false;

  // Check if it's an iteration/edit prompt (negative match)
  if (ITERATION_PATTERNS.some((rx) => rx.test(text))) {
    return false;
  }

  // Check main launch patterns
  const hasLaunchIntent = LAUNCH_PATTERNS.some((rx) => rx.test(text));

  if (!hasLaunchIntent) return false;

  // Additional validation: ensure it's not just a random mention
  // Must contain business-related keywords
  const businessKeywords = /\b(business|startup|company|saas|brand|venture|agency|app|platform|store|service)\b/i;
  return businessKeywords.test(text);
};

/**
 * Detect the primary industry from the prompt
 * Used for tailored branding and design recommendations
 */
export const detectIndustry = (prompt: string): string => {
  const text = (prompt || "").toLowerCase();

  for (const [industry, pattern] of Object.entries(INDUSTRY_PATTERNS)) {
    if (pattern.test(text)) {
      return industry;
    }
  }

  return "general"; // Default fallback
};

/**
 * Extract key business details from the prompt
 * Returns structured data about the business idea
 */
export const extractBusinessDetails = (
  prompt: string
): {
  industry: string;
  businessType: string;
  targetAudience?: string;
  uniqueAngle?: string;
} => {
  const text = prompt.toLowerCase();
  const industry = detectIndustry(prompt);

  // Detect business type
  let businessType = "startup";
  if (text.includes("saas")) businessType = "SaaS";
  else if (text.includes("ecommerce") || text.includes("e-commerce") || text.includes("store"))
    businessType = "E-Commerce";
  else if (text.includes("agency")) businessType = "Agency";
  else if (text.includes("app")) businessType = "App";
  else if (text.includes("marketplace")) businessType = "Marketplace";
  else if (text.includes("content") || text.includes("blog")) businessType = "Content";
  else if (text.includes("education") || text.includes("course")) businessType = "EdTech";

  return {
    industry,
    businessType,
    targetAudience: undefined, // Can be extracted with more sophisticated NLP
    uniqueAngle: undefined,
  };
};

// ════════════════════════════════════════════════════════════════════════════════
// TIER-BASED FEATURE CEILING SYSTEM
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Tier-aware feature ceiling for the launch package
 * Defines what gets included based on user's subscription tier
 */
const tierCeiling = (tier: TierId) => {
  if (tier === "explorer") {
    return {
      label: "Explorer (Limited)",
      website:
        "Single-page beautiful website with the NazAI watermark in the footer. Include 4 sections: hero with compelling headline, value proposition with 3 key benefits, social proof/testimonials, and strong CTA. Use a single accent color with neutral palette. System fonts with excellent hierarchy.",
      branding:
        "Provide ONE premium logo concept (text-based with icon, monochrome + color variant) + a simple but sophisticated 3-color palette (primary, secondary, neutral). Include color hex codes.",
      plan: "Provide a 5-bullet condensed business plan summary: problem, solution, target audience, business model, key differentiator.",
      financials:
        "Provide a single-year revenue + cost rough estimate with 3 key assumptions (3-5 lines max).",
      marketing:
        "Suggest 3 starter marketing assets: 1 compelling social media headline, 1 email subject line, 1 launch announcement snippet.",
      dashboard:
        "Basic dashboard mockup description (text-based) showing 3 key metrics and user profile section.",
      admin:
        "Admin backend structure (text description): user management, basic analytics, settings.",
      footerNote:
        'End the website footer with: "Built with NazAI — Upgrade to Operator/Titan to unlock full Business Launch with dashboard & admin."',
    };
  }

  if (tier === "operator") {
    return {
      label: "Operator (Full)",
      website:
        "Premium multi-section website (sticky navigation, hero with video/image, trust bar with logos, value proposition with 5+ benefits, features/services section, social proof with testimonials, team/about section, strong CTA, footer with links). Tailored color palette + custom typography pairing. No watermark. Responsive design with smooth interactions.",
      branding:
        "Provide 3 distinct logo concept directions (described visually with style notes), complete color palette (primary, secondary, accent, neutrals — with hex codes and HSL values), typography pairing (heading font + body font with weights), and brand voice description.",
      plan: "Full business plan summary: problem statement, solution, target audience/ICP, unique selling proposition, business model, go-to-market strategy, key milestones (30/60/90/180/365 days), competitive advantages.",
      financials:
        "12-month revenue, cost, and gross margin projection table + key assumptions (CAC, LTV, conversion rate). Include monthly breakdown.",
      marketing:
        "Pack of 6 starter assets: 1 landing page headline set (3 variants), 2 social media posts (with hashtags), 1 cold email template, 1 launch announcement, 1 product hunt launch copy.",
      dashboard:
        "Premium dashboard mockup (HTML description or wireframe): user profile, 5+ key metrics with charts, activity feed, settings, notification center.",
      admin:
        "Admin backend structure: user management with roles, analytics dashboard, content management, settings, reporting, basic API documentation.",
      footerNote: "",
    };
  }

  return {
    label: "Titan (Max)",
    website:
      "Best-in-class bespoke website. Multi-section premium design with sophisticated micro-interactions, refined typography hierarchy, accessible color system, and conversion-optimized copy. Includes: sticky nav with dropdown menus, hero with CTA, trust indicators, detailed features/benefits (with icons), case studies/social proof, pricing tiers, FAQ, team section, blog preview, newsletter signup, footer. No watermark. Mobile-first responsive design with smooth animations.",
    branding:
      "Provide 5 distinct logo concept directions (with detailed descriptions), complete brand system (palette with semantic tokens for UI, typography scale with 6+ sizes, voice & tone guidelines, do/don't examples), motion guidelines (micro-interactions, transitions), and brand story/positioning document.",
    plan: "Comprehensive business plan: problem statement with market size, solution with unique approach, ICP with detailed persona, USP with competitive positioning, competitive analysis (table with 3-5 competitors), revenue model with pricing tiers, GTM strategy with channels, hiring plan for year 1, risk analysis with mitigation, detailed milestones (30/60/90/180/365 days), success metrics.",
    financials:
      "24-month projection table (revenue, COGS, OPEX, gross margin, net profit), CAC/LTV assumptions with calculations, breakeven analysis, sensitivity analysis (best/base/worst case), unit economics, cash flow projections.",
    marketing:
      "Full starter pack: 3 hero copy variants (with A/B testing notes), 5 social media posts (LinkedIn, Twitter, Instagram with captions), 2 cold email sequences (3-email each), 1 launch press release, 1 SEO meta set (title, description, keywords), 1 product hunt launch copy, 1 referral program outline.",
    dashboard:
      "Complete dashboard design (full HTML/CSS mockup): user authentication, comprehensive profile management, 8+ key metrics with interactive charts, activity timeline, notification system, settings with preferences, team collaboration features, export functionality.",
    admin:
      "Full-featured admin backend: user management with roles/permissions, advanced analytics with custom reports, content/data management, A/B testing setup, email campaign management, API keys management, audit logs, settings with feature flags.",
    footerNote: "",
  };
};

// ════════════════════════════════════════════════════════════════════════════════
// BRAND IDENTITY GENERATION HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Color palette generator for different industries
 * Returns professional, modern color combinations
 */
export const generateColorPalette = (industry: string) => {
  const palettes: Record<string, { primary: string; secondary: string; accent: string; neutral: string }> = {
    saas: {
      primary: "#0066ff",
      secondary: "#00d9ff",
      accent: "#ff6b6b",
      neutral: "#f8f9fa",
    },
    ecommerce: {
      primary: "#ff6b35",
      secondary: "#f7931e",
      accent: "#fdb833",
      neutral: "#fafafa",
    },
    agency: {
      primary: "#1a1a2e",
      secondary: "#16213e",
      accent: "#0f3460",
      neutral: "#f5f5f5",
    },
    app: {
      primary: "#667eea",
      secondary: "#764ba2",
      accent: "#f093fb",
      neutral: "#f7fafc",
    },
    marketplace: {
      primary: "#2d3748",
      secondary: "#4299e1",
      accent: "#48bb78",
      neutral: "#f7fafc",
    },
    content: {
      primary: "#d946ef",
      secondary: "#ec4899",
      accent: "#f43f5e",
      neutral: "#fafafa",
    },
    education: {
      primary: "#3b82f6",
      secondary: "#06b6d4",
      accent: "#10b981",
      neutral: "#f0f9ff",
    },
    health: {
      primary: "#06b6d4",
      secondary: "#14b8a6",
      accent: "#10b981",
      neutral: "#f0fdfa",
    },
    general: {
      primary: "#0066ff",
      secondary: "#00d9ff",
      accent: "#667eea",
      neutral: "#f8f9fa",
    },
  };

  return palettes[industry] || palettes.general;
};

/**
 * Typography pairing suggestions for different industries
 */
export const generateTypography = (industry: string) => {
  const typographies: Record<string, { heading: string; body: string }> = {
    saas: {
      heading: "Inter, -apple-system, BlinkMacSystemFont",
      body: "Inter, -apple-system, BlinkMacSystemFont",
    },
    ecommerce: {
      heading: "Poppins, sans-serif",
      body: "Roboto, sans-serif",
    },
    agency: {
      heading: "Playfair Display, serif",
      body: "Lato, sans-serif",
    },
    app: {
      heading: "Space Grotesk, sans-serif",
      body: "Inter, sans-serif",
    },
    marketplace: {
      heading: "Sora, sans-serif",
      body: "Inter, sans-serif",
    },
    content: {
      heading: "Montserrat, sans-serif",
      body: "Open Sans, sans-serif",
    },
    education: {
      heading: "Quicksand, sans-serif",
      body: "Nunito, sans-serif",
    },
    health: {
      heading: "Raleway, sans-serif",
      body: "Lato, sans-serif",
    },
    general: {
      heading: "Inter, sans-serif",
      body: "Inter, sans-serif",
    },
  };

  return typographies[industry] || typographies.general;
};

// ════════════════════════════════════════════════════════════════════════════════
// BUSINESS LAUNCH DIRECTIVE BUILDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Build the supercharged Business Launch system directive
 * Prepended to the normal master prompt
 * Returns "" when intent is not detected — caller can unconditionally concatenate
 */
export const buildBusinessLaunchDirective = (
  prompt: string,
  tier: TierId,
): string => {
  if (!detectBusinessIntent(prompt)) return "";

  const ceil = tierCeiling(tier);
  const businessDetails = extractBusinessDetails(prompt);
  const colorPalette = generateColorPalette(businessDetails.industry);
  const typography = generateTypography(businessDetails.industry);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return (
    `[PRIORITY_DIRECTIVE: BUSINESS_FORGE_MODE | TIER: ${ceil.label} | NONCE: ${nonce}]\n` +
    `[INDUSTRY: ${businessDetails.industry.toUpperCase()} | TYPE: ${businessDetails.businessType}]\n\n` +
    `🚀 NAZAI BUSINESS FORGE - PREMIUM BUSINESS GENERATION\n\n` +
    `The user is launching a brand-new business. Treat this as a COMPLETE, ` +
    `PREMIUM launch package — not a single deliverable. IGNORE any previous ` +
    `generations, cached templates, saved comfort designs, or prior style ` +
    `tokens. Build everything FRESH and ORIGINAL from the user's specific idea.\n\n` +
    `CORE REQUIREMENTS:\n` +
    `✨ Every element must be 100% unique and custom to this business\n` +
    `✨ No generic templates, no reused layouts, no AI-sounding copy\n` +
    `✨ Premium, luxury-level design aesthetic\n` +
    `✨ Light, modern, sophisticated design (unless dark mode specifically requested)\n` +
    `✨ Complete full-stack package ready for deployment\n` +
    `✨ Specific to the user's exact business idea — every word and pixel reflects it\n\n` +
    `SUGGESTED BRAND DIRECTION (for reference):\n` +
    `• Primary Color: ${colorPalette.primary}\n` +
    `• Secondary Color: ${colorPalette.secondary}\n` +
    `• Accent Color: ${colorPalette.accent}\n` +
    `• Heading Font: ${typography.heading}\n` +
    `• Body Font: ${typography.body}\n` +
    `(Feel free to adjust based on your creative judgment)\n\n` +
    `## REQUIRED SECTIONS (in order)\n\n` +
    `1. **Idea Understanding** — 2-3 sentences confirming the business concept, ` +
    `target audience, and unique angle you inferred from the prompt.\n\n` +
    `2. **Brand Identity** — Propose 3 business name options (pick the strongest), ` +
    `a compelling tagline, and a one-line positioning statement that captures ` +
    `the unique value proposition.\n\n` +
    `3. **Visual Branding** — ${ceil.branding}\n\n` +
    `4. **Website** — ${ceil.website}\n` +
    `   Output the website as ONE complete standalone HTML document inside a ` +
    `single \`\`\`html fenced code block (inline CSS/JS, renders in iframe srcDoc). ` +
    `No prose inside the fence. The site must be 100% original — unique palette, ` +
    `typography, section order, and copy crafted specifically for THIS business. ` +
    `Use modern, clean design with glassmorphism accents, smooth gradients, and ` +
    `excellent whitespace. Ensure full responsiveness and accessibility.\n` +
    `${ceil.footerNote ? `   ${ceil.footerNote}\n` : ""}\n` +
    `5. **Customer Dashboard** — ${ceil.dashboard}\n\n` +
    `6. **Admin Backend** — ${ceil.admin}\n\n` +
    `7. **Business Plan Summary** — ${ceil.plan}\n\n` +
    `8. **Financial Projections** — ${ceil.financials}\n` +
    `   Use clean Markdown tables for all financial data.\n\n` +
    `9. **Initial Marketing Assets** — ${ceil.marketing}\n\n` +
    `QUALITY STANDARDS:\n` +
    `• This output must feel like a senior founder + designer + strategist team ` +
    `handed the user a turnkey launch kit\n` +
    `• No filler, no generic templates, no AI-sounding copy\n` +
    `• No reused layouts or "comfort design" patterns\n` +
    `• Be SPECIFIC to the user's idea — every word and pixel must reflect it\n` +
    `• Website copy must be compelling, benefit-focused, and conversion-optimized\n` +
    `• Design must feel premium, modern, and trustworthy\n` +
    `• All code must be production-ready and fully functional\n\n` +
    `DESIGN PHILOSOPHY:\n` +
    `• Light, modern, sophisticated aesthetic (unless dark mode requested)\n` +
    `• Clean typography hierarchy with excellent whitespace\n` +
    `• Subtle gradients and glassmorphism accents for depth\n` +
    `• Smooth micro-interactions and transitions\n` +
    `• Mobile-first responsive design\n` +
    `• Accessible color contrasts and semantic HTML\n` +
    `• Professional imagery descriptions (use Unsplash/Pexels references)\n\n` +
    `Now proceed with the complete business launch package. Make it exceptional.\n`
  );
};

/**
 * Extended directive for dashboard/admin generation
 * Used when generating the customer dashboard and admin backend
 */
export const buildDashboardDirective = (
  businessName: string,
  industry: string,
  tier: TierId,
): string => {
  const ceil = tierCeiling(tier);

  return (
    `[PRIORITY_DIRECTIVE: DASHBOARD_GENERATION | BUSINESS: ${businessName} | TIER: ${ceil.label}]\n\n` +
    `Generate a premium, custom dashboard for "${businessName}" (${industry} industry).\n\n` +
    `REQUIREMENTS:\n` +
    `${ceil.dashboard}\n\n` +
    `OUTPUT FORMAT:\n` +
    `Provide the complete dashboard as a standalone React/HTML component with:\n` +
    `• Full responsive design (mobile, tablet, desktop)\n` +
    `• Authentication/login flow\n` +
    `• User profile management\n` +
    `• Key metrics and analytics\n` +
    `• Activity/notification system\n` +
    `• Settings and preferences\n` +
    `• Clean, modern UI matching the brand identity\n\n` +
    `Make it production-ready with proper error handling and loading states.\n`
  );
};

/**
 * Extended directive for admin backend generation
 */
export const buildAdminDirective = (
  businessName: string,
  industry: string,
  tier: TierId,
): string => {
  const ceil = tierCeiling(tier);

  return (
    `[PRIORITY_DIRECTIVE: ADMIN_BACKEND_GENERATION | BUSINESS: ${businessName} | TIER: ${ceil.label}]\n\n` +
    `Generate a premium admin backend for "${businessName}" (${industry} industry).\n\n` +
    `REQUIREMENTS:\n` +
    `${ceil.admin}\n\n` +
    `OUTPUT FORMAT:\n` +
    `Provide the complete admin backend as a standalone React/Next.js component with:\n` +
    `• User management with roles and permissions\n` +
    `• Analytics and reporting dashboard\n` +
    `• Content/data management interface\n` +
    `• Settings and configuration\n` +
    `• API integration examples\n` +
    `• Audit logs and activity tracking\n` +
    `• Clean, professional UI\n\n` +
    `Make it production-ready with proper authentication, error handling, and data validation.\n`
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS FOR BUSINESS GENERATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique business name suggestion
 * Based on industry and key concepts
 */
export const generateBusinessNameSuggestions = (
  industry: string,
  keywords: string[] = []
): string[] => {
  const suggestions: Record<string, string[]> = {
    saas: [
      "CloudFlow",
      "DataSync",
      "StreamHub",
      "VelocityPro",
      "NexusAI",
      "FlowForce",
      "QuantumShift",
    ],
    ecommerce: [
      "ShopFlow",
      "CartHub",
      "VendorPro",
      "MarketForce",
      "TradeHub",
      "SellerSync",
      "CommerceHub",
    ],
    agency: [
      "CreativeForce",
      "StudioHub",
      "DesignFlow",
      "BrandForge",
      "PixelStudio",
      "CreativeSync",
      "DesignHub",
    ],
    app: [
      "AppFlow",
      "DevHub",
      "CodeForce",
      "AppForge",
      "DigitalHub",
      "TechFlow",
      "AppSync",
    ],
    marketplace: [
      "MarketHub",
      "TradeFlow",
      "ConnectHub",
      "VendorHub",
      "ExchangeHub",
      "MarketForce",
      "TradeSync",
    ],
    content: [
      "ContentHub",
      "StoryFlow",
      "CreativeHub",
      "PublishHub",
      "MediaFlow",
      "ContentForce",
      "StorySync",
    ],
    education: [
      "LearnHub",
      "SkillFlow",
      "EduForce",
      "AcademyHub",
      "CourseFlow",
      "LearnForce",
      "EducationHub",
    ],
    health: [
      "WellHub",
      "HealthFlow",
      "WellForce",
      "CareHub",
      "WellnessHub",
      "HealthSync",
      "VitaHub",
    ],
    general: [
      "InnovatHub",
      "ForgeHub",
      "FlowHub",
      "SyncHub",
      "VenturHub",
      "LaunchHub",
      "BuildHub",
    ],
  };

  return suggestions[industry] || suggestions.general;
};

/**
 * Generate a compelling tagline for the business
 */
export const generateTagline = (businessType: string, industry: string): string => {
  const taglines: Record<string, Record<string, string>> = {
    SaaS: {
      general: "Powerful software, simplified.",
      saas: "Enterprise-grade simplicity.",
      app: "Build faster, ship smarter.",
    },
    "E-Commerce": {
      general: "Sell smarter, grow faster.",
      ecommerce: "Your marketplace, your rules.",
      retail: "Commerce made simple.",
    },
    Agency: {
      general: "Creative excellence, delivered.",
      agency: "Design that drives results.",
      studio: "Ideas into impact.",
    },
    App: {
      general: "Experience the difference.",
      app: "Innovation in your pocket.",
      mobile: "Built for the modern user.",
    },
    Marketplace: {
      general: "Connect, trade, thrive.",
      marketplace: "Where buyers meet sellers.",
      platform: "Your trusted trading hub.",
    },
    Content: {
      general: "Stories that matter.",
      content: "Your voice, amplified.",
      media: "Content that converts.",
    },
    EdTech: {
      general: "Learn at your pace.",
      education: "Education reimagined.",
      training: "Skills for tomorrow.",
    },
    general: {
      general: "Innovate. Create. Succeed.",
      startup: "The future starts here.",
      venture: "Transform your business.",
    },
  };

  return (
    taglines[businessType]?.[industry] ||
    taglines[businessType]?.general ||
    taglines.general.general
  );
};

/**
 * Validate business launch request
 * Returns validation result with feedback
 */
export const validateBusinessLaunchRequest = (
  prompt: string
): {
  isValid: boolean;
  hasIntent: boolean;
  industry: string;
  feedback: string;
} => {
  const hasIntent = detectBusinessIntent(prompt);
  const industry = detectIndustry(prompt);

  if (!hasIntent) {
    return {
      isValid: false,
      hasIntent: false,
      industry: "unknown",
      feedback:
        "This doesn't appear to be a business launch request. Please describe the business you want to create.",
    };
  }

  if (prompt.length < 20) {
    return {
      isValid: false,
      hasIntent: true,
      industry,
      feedback:
        "Please provide more details about your business idea. Include what problem it solves and who your target audience is.",
    };
  }

  return {
    isValid: true,
    hasIntent: true,
    industry,
    feedback: "✅ Ready to generate your premium business launch package!",
  };
};

// ════════════════════════════════════════════════════════════════════════════════
// USAGE GUIDE
// ════════════════════════════════════════════════════════════════════════════════
//
// Save this file as: src/lib/business-launch.ts
//
// Dashboard already imports:
//   import { detectBusinessIntent, buildBusinessLaunchDirective }
//     from "@/lib/business-launch";
//
// All functions are exported inline above with `export const`.
// TierId is re-exported below for consumers that need the type directly.
//
// Usage in handleSendMessage:
//   const _businessLaunch = !_isIteration && detectBusinessIntent(visiblePrompt);
//   const BUSINESS_FORGE_PREFIX = _businessLaunch
//     ? buildBusinessLaunchDirective(visiblePrompt, _launchTier)
//     : "";
//
// ════════════════════════════════════════════════════════════════════════════════

// Re-export TierId so consumers can import it from this file if needed
export type { TierId };
