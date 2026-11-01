#!/usr/bin/env node
/**
 * Markproof MCP server (stdio). Configure your MCP client to run
 * `npx -y markproof-mcp` with MARKPROOF_API_KEY set — see README.md.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Markproof } from "markproof";
import { createServer, MISSING_KEY_MESSAGE, missingKeyClient } from "./server";

const apiKey = process.env.MARKPROOF_API_KEY;
if (!apiKey) {
  // stderr only: stdout carries the MCP protocol. Keep running so clients and
  // directories can still list the tools; each call returns this message.
  console.error(`markproof-mcp: ${MISSING_KEY_MESSAGE}`);
}

const client = apiKey ? new Markproof({ apiKey, baseUrl: process.env.MARKPROOF_BASE_URL }) : missingKeyClient();
await createServer(client).connect(new StdioServerTransport());
