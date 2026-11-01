#!/usr/bin/env node
/**
 * Markproof MCP server (stdio). Configure your MCP client to run
 * `npx -y markproof-mcp` with MARKPROOF_API_KEY set — see README.md.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Markproof } from "markproof";
import { createServer } from "./server";

const apiKey = process.env.MARKPROOF_API_KEY;
if (!apiKey) {
  // stderr only: stdout carries the MCP protocol.
  console.error("markproof-mcp: set MARKPROOF_API_KEY (create one at https://markproof.co/dashboard).");
  process.exit(1);
}

const client = new Markproof({ apiKey, baseUrl: process.env.MARKPROOF_BASE_URL });
await createServer(client).connect(new StdioServerTransport());
