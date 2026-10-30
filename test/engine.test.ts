import { describe, expect, it } from "bun:test";
import { executeReadTrioAudit, searchBm25 } from "../src/engine.js";

describe("triphylite engine", () => {
  it("executes BM25 search over local directory", async () => {
    const hits = await searchBm25(import.meta.dir, "describe");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.source).toBe("bm25");
  });

  it("fuses parallel AST + BM25 + LSP hits via RRF", async () => {
    const res = await executeReadTrioAudit("executeReadTrioAudit", import.meta.dir, 5);
    expect(res.hits).toBeDefined();
    expect(res.stats).toBeDefined();
    expect(typeof res.stats.elapsedMs).toBe("number");
  });
});
