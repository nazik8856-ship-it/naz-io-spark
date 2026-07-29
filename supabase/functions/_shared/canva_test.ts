import {
  buildAuthUrl,
  generatePkce,
  generateRandomBase64Url,
  resolveCanvaScopes,
} from "./canva.ts";
import { assert, assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("Canva PKCE creates a real RFC 7636 S256 challenge", async () => {
  const first = await generatePkce();
  const second = await generatePkce();

  assertEquals(first.verifier.length, 128);
  assertMatch(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assertMatch(first.challenge, /^[A-Za-z0-9_-]{43}$/);
  assertNotEquals(first.verifier, second.verifier);
  assertNotEquals(first.challenge, second.challenge);

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(first.verifier));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(first.challenge, expected);
});

Deno.test("Canva state is opaque and independent from the verifier", async () => {
  const { verifier } = await generatePkce();
  const state = generateRandomBase64Url(32);

  assertEquals(state.length, 43);
  assertMatch(state, /^[A-Za-z0-9_-]+$/);
  assert(!state.includes(verifier));
});

Deno.test("Canva authorization URL includes selected scopes and real PKCE", async () => {
  const state = generateRandomBase64Url(32);
  const { challenge } = await generatePkce();
  const scopes = resolveCanvaScopes(["designs", "profile"]);
  const url = new URL(buildAuthUrl(state, scopes, challenge));

  assertEquals(url.searchParams.get("state"), state);
  assertEquals(url.searchParams.get("code_challenge"), challenge);
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertEquals(url.searchParams.get("scope"), scopes.join(" "));
  assert(!url.toString().includes("%3CCODE_CHALLENGE%3E"));
});