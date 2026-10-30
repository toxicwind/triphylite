import { describe, expect, it } from "bun:test";
import { searchRoutes } from "../src/engine.js";

const FIXTURE = new URL("./fixtures/redlight-router", import.meta.url).pathname;

describe("trio route-tracing channel (redlight dispatch idioms)", () => {
  it("matches prefix-family dispatch: 'playback.' in mode hits for playback.media", async () => {
    const hits = await searchRoutes(FIXTURE, "playback.media", 10);
    const routerFiles = hits.filter((h) => h.file.includes("router.py"));
    expect(routerFiles.length).toBeGreaterThan(0);
    // The `elif 'playback.' in mode:` dispatch line must be found
    expect(routerFiles.some((h) => h.snippet.includes("'playback.' in mode"))).toBe(true);
    // And the player_check chain `mode == 'playback.%s' % playback_key()` must surface
    expect(routerFiles.some((h) => h.snippet.includes("playback_key()"))).toBe(true);
  });

  it("matches exact-key dispatch for search.get_key_id", async () => {
    const hits = await searchRoutes(FIXTURE, "search.get_key_id", 10);
    expect(hits.some((h) => h.snippet.includes("'search.get_key_id'"))).toBe(true);
  });

  it("excludes settings-declaration noise (setting_id lines)", async () => {
    const hits = await searchRoutes(FIXTURE, "playback.limit_resolve", 10);
    // Only a route whose key literally IS playback.limit_resolve should match;
    // the settings_cache.py dict declaration must NOT be a route hit.
    expect(hits.filter((h) => h.file.includes("settings_cache.py")).length).toBe(0);
  });

  it("routes share the ROUTE source channel", async () => {
    const hits = await searchRoutes(FIXTURE, "playback.media", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === "route")).toBe(true);
  });
});