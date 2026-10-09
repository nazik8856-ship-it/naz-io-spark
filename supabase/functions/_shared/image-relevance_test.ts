// Image-relevance quality loop (2026-10-09): real tests for the closed
// loop, including the exact case named in the request -- a cafe in
// Vienna producing space-sky/desert/beach stock photos. Run with:
// deno test --allow-none supabase/functions/_shared/image-relevance_test.ts
import { enforceImageRelevance } from "./image-relevance.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("Vienna cafe case: photo with no asset_url at all is forced to illustration, never left to fall through to Picsum", () => {
  const pages = [{
    slug: "home",
    sections: [{ type: "hero", content: { headline: "x", media_style: "photo", image_prompt: "aesthetic cafe interior, Vienna, warm light" } }],
  }];
  const result = enforceImageRelevance(pages);
  assert(result.repaired === true);
  assert(result.pages[0].sections[0].content.media_style === "illustration");
  assert(result.pages[0].sections[0].content.asset_url === undefined);
});

Deno.test("a real, verified asset_url keeps media_style photo untouched", () => {
  const pages = [{
    slug: "home",
    sections: [{ type: "about", content: { heading: "x", media_style: "photo", asset_url: "https://storage.example.com/real-cafe-photo.jpg" } }],
  }];
  const verified = new Set(["https://storage.example.com/real-cafe-photo.jpg"]);
  const result = enforceImageRelevance(pages, verified);
  assert(result.repaired === false);
  assert(result.pages[0].sections[0].content.media_style === "photo");
  assert(result.pages[0].sections[0].content.asset_url === "https://storage.example.com/real-cafe-photo.jpg");
});

Deno.test("a hallucinated asset_url not in the verified set is stripped and media_style forced away from photo", () => {
  const pages = [{
    slug: "home",
    sections: [{ type: "feature-split", content: { heading: "x", media_style: "photo", asset_url: "https://images.example.com/invented-by-the-model.jpg" } }],
  }];
  const result = enforceImageRelevance(pages, new Set());
  assert(result.repaired === true);
  assert(result.pages[0].sections[0].content.asset_url === undefined);
  assert(result.pages[0].sections[0].content.media_style === "illustration");
});

Deno.test("outer-control mode (no verified set): a dangling photo-with-no-url is repaired without ever second-guessing an already-persisted real url", () => {
  const pages = [{
    slug: "home",
    sections: [
      { type: "hero", content: { headline: "a", media_style: "photo" } },
      { type: "about", content: { heading: "b", media_style: "photo", asset_url: "https://storage.example.com/already-persisted.jpg" } },
    ],
  }];
  const result = enforceImageRelevance(pages);
  assert(result.repaired === true);
  assert(result.pages[0].sections[0].content.media_style === "illustration");
  assert(result.pages[0].sections[1].content.media_style === "photo");
  assert(result.pages[0].sections[1].content.asset_url === "https://storage.example.com/already-persisted.jpg");
});

Deno.test("illustration/gradient/pattern sections are never touched", () => {
  const pages = [{
    slug: "home",
    sections: [
      { type: "hero", content: { headline: "a", media_style: "illustration" } },
      { type: "about", content: { heading: "b", media_style: "pattern" } },
    ],
  }];
  const result = enforceImageRelevance(pages, new Set());
  assert(result.repaired === false);
  assert(result.notes.length === 0);
});

Deno.test("gallery items: a hallucinated per-item asset_url is stripped even though items carry no media_style field of their own", () => {
  const pages = [{
    slug: "home",
    sections: [{
      type: "gallery",
      content: { heading: "Our work", items: [{ caption: "a", image_prompt: "x", asset_url: "https://images.example.com/made-up.jpg" }] },
    }],
  }];
  const result = enforceImageRelevance(pages, new Set());
  assert(result.repaired === true);
  const items = result.pages[0].sections[0].content.items as Record<string, unknown>[];
  assert(items[0].asset_url === undefined);
});

Deno.test("gallery items: a real, verified per-item asset_url is preserved", () => {
  const pages = [{
    slug: "home",
    sections: [{ type: "gallery", content: { heading: "x", items: [{ caption: "a", image_prompt: "x", asset_url: "https://storage.example.com/real-upload.jpg" }] } }],
  }];
  const verified = new Set(["https://storage.example.com/real-upload.jpg"]);
  const result = enforceImageRelevance(pages, verified);
  assert(result.repaired === false);
  const items = result.pages[0].sections[0].content.items as Record<string, unknown>[];
  assert(items[0].asset_url === "https://storage.example.com/real-upload.jpg");
});

Deno.test("the input pages array/objects are never mutated", () => {
  const original = { media_style: "photo", image_prompt: "x" };
  const pages = [{ slug: "home", sections: [{ type: "hero", content: original }] }];
  enforceImageRelevance(pages);
  assert(original.media_style === "photo");
});
