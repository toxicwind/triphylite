# triphylite — Parallel AST + BM25 + LSP Code Intelligence MCP Server

A mineral-grade product in `pens/geode/products/triphylite`.

## Architecture & Doctrine

Three orthogonal code representations run concurrently:
1. **AST Pattern Matcher:** Structural node matching via ast-grep
2. **BM25 Lexical Engine:** Token and frequency ranker
3. **LSP Symbol Intelligence:** Declarations, references, and exported types via Bun.Transpiler / compiler tokens

The three orthogonal candidate lists are fused using **Reciprocal Rank Fusion (RRF)**:
$$RRF(d) = \sum_{m \in \{AST, BM25, LSP\}} \frac{1}{60 + r_m(d)}$$

## MCP Surface
- Tool: `read_trio_audit(query: string, path?: string, limit?: number)`
- Output: Structured JSON + provenance score + source channel flags
