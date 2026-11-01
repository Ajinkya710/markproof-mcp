import { readFile, stat, writeFile, access } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Markproof, MarkproofError } from "markproof";

export const VERSION = "0.3.2";

/** Matches the API's own limit for URL input; direct uploads are capped lower by the host (~4.5 MB). */
const MAX_BYTES = 25 * 1024 * 1024;

type Client = Pick<Markproof, "mark" | "verify" | "getAsset">;

export const MISSING_KEY_MESSAGE =
  "MARKPROOF_API_KEY is not set. Create a key at https://markproof.co/dashboard and add it to this server's env.";

/**
 * Stands in for the SDK client when no key is configured, so the server
 * still starts and lists its tools (MCP directories check this), and each
 * tool call explains what's missing instead of the process exiting.
 */
export function missingKeyClient(): Client {
  const reject = async (): Promise<never> => {
    throw new Error(MISSING_KEY_MESSAGE);
  };
  return { mark: reject, verify: reject, getAsset: reject };
}

async function loadFile(path: string): Promise<{ data: Buffer; filename: string; absolute: string }> {
  const absolute = resolve(path);
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) throw new Error(`No file at ${absolute}`);
  if (info.size > MAX_BYTES) throw new Error(`${absolute} is ${(info.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB.`);
  return { data: await readFile(absolute), filename: basename(absolute), absolute };
}

/** "photo.jpg" + image/png → "photo.marked.png": marked images come back as PNG and audio as WAV. */
export function defaultOutputPath(input: string, contentType: string | undefined): string {
  const ext = contentType?.includes("wav") ? ".wav" : contentType?.includes("png") ? ".png" : extname(input) || ".bin";
  return join(dirname(input), `${basename(input, extname(input))}.marked${ext}`);
}

const exists = (p: string) => access(p).then(() => true, () => false);

function ok(text: string, structured: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent: structured };
}

function fail(err: unknown) {
  const message =
    err instanceof MarkproofError ? `Markproof API error (${err.status}): ${err.message}` : err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createServer(client: Client): McpServer {
  const server = new McpServer({ name: "markproof", version: VERSION });

  server.registerTool(
    "mark_file",
    {
      title: "Mark an AI-generated file",
      description:
        "Adds an invisible watermark and a signed C2PA manifest (Content Credentials) to an AI-generated image (PNG, JPEG, WebP) or audio file (WAV, MP3), " +
        "marking it as AI-generated for EU AI Act Article 50. Writes the marked copy next to the original (images as PNG, audio as WAV) and returns its " +
        "watermark code and public verification URL. Use this on every image or audio file you generate before handing it to a user. Counts as one API call.",
      inputSchema: {
        path: z.string().describe("Path to the local image or audio file to mark."),
        output_path: z.string().optional().describe("Where to write the marked copy. Defaults to <name>.marked.<ext> beside the original."),
        overwrite: z.boolean().optional().describe("Allow replacing an existing file at output_path. Defaults to false."),
        generator_name: z.string().optional().describe("Name of the app or system that generated the file; recorded in the C2PA manifest."),
        model_name: z.string().optional().describe("Name of the model that generated the file."),
        visible_label: z
          .union([z.boolean(), z.string().min(1).max(40)])
          .optional()
          .describe(
            "Images only. Also draw a visible label on the image (EU AI Act Art. 50(4), e.g. for deepfakes): true for \"AI-generated\", or custom text up to 40 characters.",
          ),
        label_position: z
          .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
          .optional()
          .describe("Corner for visible_label. Defaults to bottom-right."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ path, output_path, overwrite, generator_name, model_name, visible_label, label_position }) => {
      try {
        const file = await loadFile(path);
        const result = await client.mark(
          { data: file.data, filename: file.filename },
          { generatorName: generator_name, modelName: model_name, visibleLabel: visible_label, labelPosition: label_position },
        );
        if (!result.file) throw new Error("The API didn't return a marked file.");
        const out = resolve(output_path ?? defaultOutputPath(file.absolute, result.contentType));
        if (!overwrite && (await exists(out))) throw new Error(`${out} already exists. Pass overwrite: true or choose another output_path.`);
        await writeFile(out, result.file);

        const robustNote =
          result.watermarkRobust === false
            ? "\nNote: this image is very smooth or featureless, so the watermark may not survive heavy editing. The C2PA manifest is intact; rely on it for this file."
            : "";
        return ok(
          `Marked ${file.filename} → ${out}\nWatermark code: ${result.watermarkCode}\nVerify: ${result.verifyUrl}${robustNote}`,
          {
            output_path: out,
            asset_id: result.assetId,
            watermark_code: result.watermarkCode,
            kind: result.kind,
            verify_url: result.verifyUrl,
            c2pa_manifest_label: result.c2paManifestLabel,
            watermark_robust: result.watermarkRobust,
          },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "verify_file",
    {
      title: "Check a file for AI marking",
      description:
        "Checks an image or audio file for a Markproof watermark and a C2PA manifest, and reports whether its signature is valid and whether it matches " +
        "a record in this Markproof account. Use it to confirm a file is marked before publishing, or to inspect a file of unknown origin. Counts as one API call.",
      inputSchema: {
        path: z.string().optional().describe("Path to the local image or audio file to check. Uploads are limited to about 4.5 MB."),
        url: z
          .string()
          .optional()
          .describe("Public https URL of the file, instead of path. Use it for files over 4.5 MB (up to 25 MB), e.g. marked audio, which is WAV."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, url }) => {
      try {
        if (!path === !url) throw new Error("Pass exactly one of path or url.");
        const r = url
          ? await client.verify({ url })
          : await client.verify(await loadFile(path!).then((file) => ({ data: file.data, filename: file.filename })));
        return ok(r.summary, {
          watermark_detected: r.watermark.detected,
          watermark_code: r.watermark.watermarkCode,
          watermark_confidence: r.watermark.confidence,
          c2pa_present: r.c2pa.present,
          c2pa_signature_valid: r.c2pa.signatureValid,
          c2pa_trusted: r.c2pa.trusted,
          matched_asset_id: r.matchedAsset?.id ?? null,
          summary: r.summary,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_asset",
    {
      title: "Look up a marked file",
      description: "Fetches the record for a file this account marked, by the asset_id that mark_file returned. Doesn't count toward the quota.",
      inputSchema: { asset_id: z.string().describe("The asset_id returned by mark_file.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ asset_id }) => {
      try {
        const a = await client.getAsset(asset_id);
        return ok(`${a.kind} ${a.watermarkCode}, marked ${a.createdAt}`, {
          asset_id: a.id,
          watermark_code: a.watermarkCode,
          kind: a.kind,
          generator_name: a.generatorName,
          model_name: a.modelName,
          c2pa_manifest_label: a.c2paManifestLabel,
          created_at: a.createdAt,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
