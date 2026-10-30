/**
 * triphylite MCP Server entrypoint.
 *
 * Implements standard Model Context Protocol (stdio transport) providing:
 *   - tools/list: registers `read_trio_audit`
 *   - tools/call: executes parallel AST + BM25 + LSP + ROUTE federated code analysis with RRF
 *   - trio_route: structural route-dispatch tracing (mode/action -> handler)
 */
import { executeReadTrioAudit, searchRoutes } from "./engine.js";

// Standard JSON-RPC 2.0 stdio MCP transport
process.stdin.setEncoding("utf8");

let buffer = "";

process.stdin.on("data", async (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      await handleRpcMessage(msg);
    } catch (e: any) {
      sendRpcError(null, -32700, `Parse error: ${e.message}`);
    }
  }
});

function sendRpc(msg: any) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendRpcError(id: any, code: number, message: string) {
  sendRpc({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function handleRpcMessage(msg: any) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    sendRpc({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "@geode/triphylite",
          version: "1.0.0",
        },
      },
    });
    return;
  }

  if (method === "tools/list") {
    sendRpc({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "read_trio_audit",
            description:
              "Parallel AST + BM25 + LSP federated code search and architectural audit. Fuses structural code matches (ast-grep), lexical tokens (BM25), and type/symbol definitions (LSP) using Reciprocal Rank Fusion (RRF).",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Symbol, pattern, or search terms to audit across the codebase",
                },
                path: {
                  type: "string",
                  description: "Root path or directory to search within (defaults to '.')",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of fused hits to return (defaults to 20)",
                },
              },
              required: ["query"],
            },
          },
        ],
      },
    });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "read_trio_audit") {
      try {
        const query = String(args.query ?? "");
        const path = String(args.path ?? ".");
        const limit = Number(args.limit ?? 20);

        const result = await executeReadTrioAudit(query, path, limit);

        sendRpc({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        });
      } catch (err: any) {
        sendRpc({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Execution failed: ${err.message}`,
              },
            ],
          },
        });
      }
      return;
    }


    if (name === "trio_route") {
      try {
        const route = String(args.route ?? "");
        const path = String(args.path ?? ".");
        const limit = Number(args.limit ?? 25);
        const routes = await searchRoutes(path, route, limit);
        sendRpc({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ routes }, null, 2),
              },
            ],
          },
        });
      } catch (err: any) {
        sendRpc({
          jsonrpc: "2.0",
          id,
          result: { isError: true, content: [{ type: "text", text: `Execution failed: ${err.message}` }] },
        });
      }
      return;
    }

    sendRpcError(id, -32601, `Unknown tool: ${name}`);
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  sendRpcError(id, -32601, `Method not found: ${method}`);
},
          {
            name: "trio_route",
            description:
              "Structural route-dispatch tracing: given a mode/action/route key (e.g. 'playback.media', 'search.get_key_id'), find the dispatch-table entries and handler definitions that route to it, across router/navigator/dialogs files. Returns per-file line hits with the dispatch predicate.",
            inputSchema: {
              type: "object",
              properties: {
                route: { type: "string", description: "Mode/action key to trace" },
                path: { type: "string", description: "Directory to search (default .)" },
                limit: { type: "integer", description: "Max hits (default 25)" },
              },
              required: ["route"],
            },
          }
