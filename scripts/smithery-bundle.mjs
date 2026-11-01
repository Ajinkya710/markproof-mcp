// Smithery reads `tools` from the bundle's manifest and needs each tool's
// inputSchema, which the MCPB manifest spec doesn't allow (mcpb validate
// rejects it). So: take the spec-valid markproof-mcp.mcpb, ask the bundled
// server for its real tool list, and write markproof-mcp.smithery.mcpb with
// the schemas added. Claude Desktop users get the plain bundle.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

function listTools() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["mcpb/server/index.js"], {
      env: { ...process.env, MARKPROOF_API_KEY: "lt_live_bundle_tool_listing" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buffer = "";
    server.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n").slice(0, -1)) {
        const message = JSON.parse(line);
        if (message.id === 2) {
          server.kill();
          resolve(message.result.tools);
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    server.on("error", reject);
    const send = (m) => server.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bundle", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

const live = new Map((await listTools()).map((t) => [t.name, t]));
const files = unzipSync(readFileSync("markproof-mcp.mcpb"));
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
manifest.tools = manifest.tools.map((tool) => {
  const found = live.get(tool.name);
  if (!found) throw new Error(`manifest lists ${tool.name}, which the server doesn't expose`);
  return { ...tool, inputSchema: found.inputSchema, ...(found.annotations ? { annotations: found.annotations } : {}) };
});
files["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync("markproof-mcp.smithery.mcpb", zipSync(files));
console.log(`markproof-mcp.smithery.mcpb: ${manifest.tools.map((t) => t.name).join(", ")} with input schemas`);
