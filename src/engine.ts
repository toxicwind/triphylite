/**
 * @geode/triphylite — Core Parallel AST + BM25 + LSP Federation Engine.
 */
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface TrioHit {
  file: string;
  line: number;
  snippet: string;
  source: "ast" | "bm25" | "lsp";
  score: number;
}

export interface FusedTrioHit {
  file: string;
  line: number;
  snippet: string;
  rrfScore: number;
  channels: string[];
}

export async function searchBm25(dir: string, query: string): Promise<TrioHit[]> {
  const hits: TrioHit[] = [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  async function walk(current: string, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!["node_modules", ".git", "dist", ".cache", "archive"].includes(e.name)) {
            await walk(join(current, e.name), depth + 1);
          }
        } else if (e.isFile() && /\.(ts|tsx|js|jsx|json|md|py|go|rs)$/.test(e.name)) {
          const filePath = join(current, e.name);
          const content = await readFile(filePath, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const lineLower = line.toLowerCase();
            let matches = 0;
            for (const t of terms) {
              if (lineLower.includes(t)) matches++;
            }
            if (matches > 0) {
              hits.push({
                file: filePath,
                line: i + 1,
                snippet: line.trim(),
                source: "bm25",
                score: matches / terms.length,
              });
            }
          }
        }
      }
    } catch {}
  }

  await walk(dir);
  return hits.sort((a, b) => b.score - a.score).slice(0, 50);
}

export async function searchAst(dir: string, pattern: string): Promise<TrioHit[]> {
  const hits: TrioHit[] = [];
  const res = spawnSync("ast-grep", ["run", "--pattern", pattern, "--json", dir], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.status === 0 && res.stdout.trim()) {
    try {
      const parsed = JSON.parse(res.stdout) as Array<{
        file: string;
        range: { start: { line: number } };
        lines: string;
      }>;
      for (const p of parsed) {
        hits.push({
          file: p.file,
          line: p.range.start.line,
          snippet: p.lines.split("\n")[0]?.trim() ?? "",
          source: "ast",
          score: 1.0,
        });
      }
    } catch {}
  }
  return hits;
}

export async function searchLsp(dir: string, symbol: string): Promise<TrioHit[]> {
  const hits: TrioHit[] = [];
  const script = `
    import { readdir, readFile } from "node:fs/promises";
    import { join } from "node:path";
    
    async function scan(current) {
      try {
        const entries = await readdir(current, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !["node_modules", ".git", "dist"].includes(e.name)) {
            await scan(join(current, e.name));
          } else if (e.isFile() && /\\.(ts|tsx)$/.test(e.name)) {
            const path = join(current, e.name);
            const transpiler = new Bun.Transpiler({ loader: e.name.endsWith("tsx") ? "tsx" : "ts" });
            const code = await readFile(path, "utf8");
            try {
              const lines = code.split("\\n");
              lines.forEach((l, idx) => {
                if (l.includes("${symbol}") && (l.includes("function") || l.includes("class") || l.includes("const") || l.includes("export") || l.includes("import"))) {
                  console.log(JSON.stringify({ file: path, line: idx + 1, snippet: l.trim() }));
                }
              });
            } catch {}
          }
        }
      } catch {}
    }
    await scan("${dir}");
  `;

  const res = spawnSync("bun", ["-e", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (res.status === 0 && res.stdout.trim()) {
    for (const line of res.stdout.trim().split("\n")) {
      try {
        const parsed = JSON.parse(line);
        hits.push({
          file: parsed.file,
          line: parsed.line,
          snippet: parsed.snippet,
          source: "lsp",
          score: 0.95,
        });
      } catch {}
    }
  }
  return hits;
}

/**
 * Route-dispatch channel — finds `mode == "x" → handler` dispatch entries
 * (router.py / dialogs.py / navigator.py style) and call-chain references.
 * Answers "what handler runs for mode X" structurally instead of as grep noise.
 */
export async function searchRoutes(dir: string, mode: string, limit = 25): Promise<TrioHit[]> {
  const hits: TrioHit[] = [];
  const needle = mode.trim();
  if (!needle) return hits;

  async function walk(current: string, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!["node_modules", ".git", "dist", ".cache", "archive"].includes(e.name)) {
            await walk(join(current, e.name), depth + 1);
          }
        } else if (e.isFile() && /\.(py|ts|js)$/.test(e.name)) {
          const filePath = join(current, e.name);
          const content = await readFile(filePath, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            // Match exact needle OR a routed prefix family: 'playback.' matches
            // playback.media / playback.choose / … (router dispatch idiom)
            const needlePrefix = needle.includes(".") ? needle.split(".")[0] + "." : needle;
            const lineHasNeedle = line.includes(needle) || (needlePrefix !== needle && line.includes(needlePrefix));
            if (lineHasNeedle) {
              // settings_cache.py declares 'playback.*' SETTING IDs — not dispatch routes.
              // Skip lines that are setting declarations (setting_id/'setting_default').
              if (/setting_id|setting_default|setting_type|'playback\.\w+'\s*,\s*'setting/.test(line) && !/(?:elif|if)\s+/.test(line)) {
                continue;
              }
              // Dispatch-table entries: mode == 'x' or mode == "x" or 'x' in (...) or key: 'x'
              const isDispatch =
                /(?:mode|action)\s*(?:==|!=|in|not in)\s*['"]/.test(line) ||
                (/(?:mode|action)\s*==\s*['"]?[^'"]*%s/.test(line) && lineHasNeedle) ||
                (/(?:mode|action)\s*(?:in|not in)\s+\(?\s*'[^']*'/m.test(line) && lineHasNeedle) ||
                (/['"][^'"]*['"]\s+in\s+(?:mode|action|params|self\.params|plugin)/.test(line) && lineHasNeedle) ||
                (/mode\.(?:startswith|endswith)\s*\(/.test(line) && lineHasNeedle) ||
                (/^\s*(?:elif|if|case)\s+['"]/.test(line) && lineHasNeedle) ||
                /['"][^'"]+['"]\s*:\s*(?:['"]|exec|return|def\b|function)/.test(line) ||
                /(\bmode\b|\baction\b).*(?:==|in|:)\s*['"]/.test(line) ||
                /def\s+\w*/.test(line) && /(?:params|mode|action)/.test(line);
              const isCallSite =
                /(?:exec|run|go_to|build_url|redirect|navigate|functools\.partial|window_function)/.test(line) &&
                /(?:mode|action|'[^']*'|"[^"]*")/.test(line) &&
                line.includes(needle) === false;
              if (isDispatch || /mode\s*==/.test(line) && line.includes(needle) || line.includes(`'${needle}'`) || line.includes(`"${needle}"`)) {
                hits.push({
                  file: filePath,
                  line: i + 1,
                  snippet: line.trim().slice(0, 200),
                  source: "route",
                  score: isDispatch ? 1.0 : 0.8,
                });
              } else if (/(?:elif|if|case)\s+/.test(line) && lineHasNeedle) {
                hits.push({
                  file: filePath,
                  line: i + 1,
                  snippet: line.trim().slice(0, 200),
                  source: "route",
                  score: 0.7,
                });
              }
            }
          }
        }
      }
    } catch {}
  }
  await walk(dir);
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function executeReadTrioAudit(
  query: string,
  targetDir = ".",
  limit = 20,
): Promise<{ hits: FusedTrioHit[]; stats: { ast: number; bm25: number; lsp: number; route: number; elapsedMs: number }; routes: FusedTrioHit[] }> {
  const t0 = performance.now();
  const absDir = resolve(targetDir);

  const [astHits, bm25Hits, lspHits, routeHits] = await Promise.all([
    searchAst(absDir, query),
    searchBm25(absDir, query),
    searchLsp(absDir, query),
    searchRoutes(absDir, query),
  ]);

  const K = 60;
  const fusionMap = new Map<string, { hit: TrioHit; rrf: number; channels: Set<string> }>();

  function addRanked(list: TrioHit[], channel: string) {
    for (let r = 0; r < list.length; r++) {
      const item = list[r]!;
      const key = `${item.file}:${item.line}`;
      const score = 1 / (K + r + 1);
      const existing = fusionMap.get(key);
      if (existing) {
        existing.rrf += score;
        existing.channels.add(channel);
      } else {
        fusionMap.set(key, { hit: item, rrf: score, channels: new Set([channel]) });
      }
    }
  }

  addRanked(astHits, "AST");
  addRanked(bm25Hits, "BM25");
  addRanked(lspHits, "LSP");
  addRanked(routeHits, "ROUTE");

  const hits: FusedTrioHit[] = [...fusionMap.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map((entry) => ({
      file: entry.hit.file,
      line: entry.hit.line,
      snippet: entry.hit.snippet,
      rrfScore: Number(entry.rrf.toFixed(4)),
      channels: [...entry.channels],
    }));

  return {
    hits,
    routes: routeHits.map((r) => ({
      file: r.file,
      line: r.line,
      snippet: r.snippet,
      rrfScore: Number(r.score.toFixed(4)),
      channels: ["ROUTE"],
    })),
    stats: {
      ast: astHits.length,
      bm25: bm25Hits.length,
      lsp: lspHits.length,
      route: routeHits.length,
      elapsedMs: Number((performance.now() - t0).toFixed(1)),
    },
  };
}
