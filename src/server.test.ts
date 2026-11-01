import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MarkproofError } from "markproof";
import { createServer, defaultOutputPath, MISSING_KEY_MESSAGE, missingKeyClient } from "./server";

type Fake = Parameters<typeof createServer>[0];

const fakeClient = (overrides: Partial<Fake> = {}): Fake => ({
  mark: async () => ({
    assetId: "asset-1",
    watermarkCode: "ABC12345",
    kind: "image",
    verifyUrl: "https://markproof.co/v/ABC12345",
    c2paManifestLabel: "urn:c2pa:1",
    watermarkRobust: true,
    contentType: "image/png",
    file: Buffer.from("MARKED"),
  }),
  verify: async () => ({
    watermark: { detected: true, watermarkCode: "ABC12345", confidence: null },
    c2pa: { present: true, signatureValid: true, trusted: false, manifestLabel: "urn:c2pa:1" },
    matchedAsset: null,
    summary: "Watermark detected code ABC12345.",
  }),
  getAsset: async () => ({
    id: "asset-1",
    watermarkCode: "ABC12345",
    kind: "image",
    generatorName: "agent",
    modelName: null,
    c2paManifestLabel: "urn:c2pa:1",
    createdAt: "2026-10-27T00:00:00Z",
  }),
  ...overrides,
});

async function connect(client: Fake) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(client).connect(serverSide);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
  return mcp;
}

async function tempFile(name: string, body = "ORIGINAL") {
  const dir = await mkdtemp(join(tmpdir(), "markproof-mcp-"));
  const path = join(dir, name);
  await writeFile(path, body);
  return { dir, path };
}

describe("markproof MCP server", () => {
  it("lists the three tools, with mark_file flagged as writing and the others read-only", async () => {
    const { tools } = await (await connect(fakeClient())).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_asset", "mark_file", "verify_file"]);
    expect(tools.find((t) => t.name === "verify_file")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "mark_file")?.annotations?.readOnlyHint).toBe(false);
  });

  it("mark_file writes the marked copy beside the original and returns its code", async () => {
    const { dir, path } = await tempFile("render.jpg");
    const res = await (await connect(fakeClient())).callTool({ name: "mark_file", arguments: { path } });
    expect(res.isError).toBeFalsy();
    const out = join(dir, "render.marked.png");
    expect(await readFile(out, "utf8")).toBe("MARKED");
    expect(await readFile(path, "utf8")).toBe("ORIGINAL");
    expect(res.structuredContent).toMatchObject({ output_path: out, watermark_code: "ABC12345", watermark_robust: true });
  });

  it("refuses to overwrite an existing output unless asked", async () => {
    const { dir, path } = await tempFile("render.png");
    await writeFile(join(dir, "render.marked.png"), "KEEP ME");
    const mcp = await connect(fakeClient());
    const res = await mcp.callTool({ name: "mark_file", arguments: { path } });
    expect(res.isError).toBe(true);
    expect(await readFile(join(dir, "render.marked.png"), "utf8")).toBe("KEEP ME");
    const forced = await mcp.callTool({ name: "mark_file", arguments: { path, overwrite: true } });
    expect(forced.isError).toBeFalsy();
  });

  it("tells the agent when a watermark isn't robust", async () => {
    const { path } = await tempFile("flat.png");
    const base = fakeClient();
    const mcp = await connect(fakeClient({ mark: async (...a) => ({ ...(await base.mark(...a)), watermarkRobust: false }) }));
    const res = await mcp.callTool({ name: "mark_file", arguments: { path } });
    expect(JSON.stringify(res.content)).toContain("rely on it for this file");
  });

  it("passes visible_label and label_position through to the client", async () => {
    const { path } = await tempFile("face.png");
    const base = fakeClient();
    const seen: unknown[] = [];
    const mcp = await connect(
      fakeClient({
        mark: async (file, options) => {
          seen.push(options);
          return base.mark(file, options);
        },
      }),
    );
    await mcp.callTool({ name: "mark_file", arguments: { path, visible_label: true, label_position: "top-left" } });
    expect(seen[0]).toMatchObject({ visibleLabel: true, labelPosition: "top-left" });

    const tooLong = await mcp.callTool({ name: "mark_file", arguments: { path, visible_label: "x".repeat(41), overwrite: true } });
    expect(tooLong.isError).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("reports API errors as tool errors rather than throwing", async () => {
    const { path } = await tempFile("x.png");
    const mcp = await connect(
      fakeClient({
        mark: async () => {
          throw new MarkproofError("Monthly quota exceeded (250/250).", 429, null);
        },
      }),
    );
    const res = await mcp.callTool({ name: "mark_file", arguments: { path } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("429");
  });

  it("reports a missing file clearly", async () => {
    const res = await (await connect(fakeClient())).callTool({ name: "verify_file", arguments: { path: "/no/such/file.png" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("No file at");
  });

  it("without a key, lists tools and explains the missing key on each call", async () => {
    const mcp = await connect(missingKeyClient());
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_asset", "mark_file", "verify_file"]);
    const res = await mcp.callTool({ name: "get_asset", arguments: { asset_id: "a" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(MISSING_KEY_MESSAGE);
  });

  it("verify_file passes a url through instead of reading a file", async () => {
    let seen: unknown;
    const mcp = await connect(
      fakeClient({
        verify: async (input) => {
          seen = input;
          return fakeClient().verify(input);
        },
      }),
    );
    const v = await mcp.callTool({ name: "verify_file", arguments: { url: "https://cdn.example.com/a.wav" } });
    expect(v.isError).toBeFalsy();
    expect(seen).toEqual({ url: "https://cdn.example.com/a.wav" });
  });

  it("verify_file needs exactly one of path or url", async () => {
    const mcp = await connect(fakeClient());
    expect((await mcp.callTool({ name: "verify_file", arguments: {} })).isError).toBe(true);
    const both = await mcp.callTool({ name: "verify_file", arguments: { path: "/x.png", url: "https://cdn.example.com/a.wav" } });
    expect(both.isError).toBe(true);
  });

  it("verify_file and get_asset return structured results", async () => {
    const { path } = await tempFile("m.png");
    const mcp = await connect(fakeClient());
    const v = await mcp.callTool({ name: "verify_file", arguments: { path } });
    expect(v.structuredContent).toMatchObject({ watermark_detected: true, c2pa_signature_valid: true });
    const a = await mcp.callTool({ name: "get_asset", arguments: { asset_id: "asset-1" } });
    expect(a.structuredContent).toMatchObject({ watermark_code: "ABC12345", generator_name: "agent" });
  });
});

describe("defaultOutputPath", () => {
  it("uses the returned format's extension", () => {
    expect(defaultOutputPath(join("a", "voice.mp3"), "audio/wav")).toBe(join("a", "voice.marked.wav"));
    expect(defaultOutputPath(join("a", "photo.jpeg"), "image/png")).toBe(join("a", "photo.marked.png"));
  });
});
