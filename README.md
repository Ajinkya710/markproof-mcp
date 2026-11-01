<img src="assets/logo-400.png" alt="" width="72" align="right">

# markproof-mcp

[![npm](https://img.shields.io/npm/v/markproof-mcp)](https://www.npmjs.com/package/markproof-mcp) [![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.Ajinkya710%2Fmarkproof-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Ajinkya710/markproof)

An [MCP](https://modelcontextprotocol.io) server that lets AI agents mark the images and audio they generate for the EU AI Act's Article 50, using [Markproof](https://markproof.co): an invisible watermark plus a signed C2PA manifest (Content Credentials), and verification of any file.

> **Is your AI output Article 50-ready?** Drop a file into the [free checker](https://markproof.co/check) (no signup) to see whether it carries a watermark and signed Content Credentials.

## Tools

| Tool | What it does |
|---|---|
| `mark_file` | Watermarks and C2PA-signs a local image (PNG, JPEG, WebP) or audio file (WAV, MP3). Writes the marked copy beside the original as `<name>.marked.png` / `.wav` and returns its watermark code and public verification URL. Optional `visible_label` (`true` or text, images only) also draws a visible "AI-generated" label, at `label_position`. |
| `verify_file` | Checks a file for a Markproof watermark and a C2PA manifest, whether the signature is valid, and whether it matches your account's records. |
| `get_asset` | Looks up a file you marked by its `asset_id`. |

`mark_file` and `verify_file` each count as one API call against your plan. `get_asset` is free.

## Setup

1. Create an API key on your [Markproof dashboard](https://markproof.co/dashboard) (250 free calls a month).
2. Add the server to your MCP client.

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "markproof": {
      "command": "npx",
      "args": ["-y", "markproof-mcp"],
      "env": { "MARKPROOF_API_KEY": "lt_live_..." }
    }
  }
}
```

**Claude Code:**

```sh
claude mcp add markproof --env MARKPROOF_API_KEY=lt_live_... -- npx -y markproof-mcp
```

**Cursor** — `.cursor/mcp.json`: the same `mcpServers` block as Claude Desktop.

Then ask your agent something like *"Generate a product image and mark it with Markproof before saving it."*

## Configuration

| Variable | |
|---|---|
| `MARKPROOF_API_KEY` | Required. |
| `MARKPROOF_BASE_URL` | Optional, for testing against another deployment. Default `https://markproof.co/v1`. |

Keep your key out of shared config files and version control.

## Notes

- Files are sent to Markproof's API, which processes them in the EU and doesn't keep them.
- Direct uploads are limited to about 4.5 MB per file. For bigger files, give `verify_file` a public `url` instead of a `path` (up to 25 MB). Marked audio comes back as WAV, so this matters for clips over about 25 seconds.
- If a result includes `watermark_robust: false`, the image was too smooth or featureless for a robust watermark. It's still marked and signed; rely on the C2PA manifest for that file.

## Claude Desktop extension

Each [release](https://github.com/Ajinkya710/markproof-mcp/releases) has a `markproof-mcp.mcpb` bundle: double-click it to install in Claude Desktop, which asks for your API key and keeps it in the OS keychain.

## Development

```sh
npm install
npm test          # tools against a fake client, no network
npm run build     # dist/ for npm
npm run bundle    # markproof-mcp.mcpb (one-file server + manifest in mcpb/)
npm run bundle:smithery   # same plus tool input schemas, which Smithery needs and the MCPB spec rejects
```

The server is a thin layer over the [`markproof`](https://www.npmjs.com/package/markproof) SDK. Issues and PRs welcome.

## License

MIT
