# Installing markproof-mcp (for AI agents such as Cline)

markproof-mcp is a stdio MCP server published on npm. Nothing needs to be cloned or built.

## 1. Get an API key

The user needs a Markproof API key. Ask them for it, or ask them to create one at https://markproof.co/dashboard (free account, 250 calls a month). Keys start with `lt_live_`. Never print the key back or commit it.

## 2. Add the server to the MCP settings

Add this entry to the client's MCP settings file (for Cline: `cline_mcp_settings.json`), replacing the key:

```json
{
  "mcpServers": {
    "markproof": {
      "command": "npx",
      "args": ["-y", "markproof-mcp"],
      "env": {
        "MARKPROOF_API_KEY": "lt_live_..."
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

On Windows, if `npx` isn't found, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "markproof-mcp"]`.

Requires Node.js 18 or newer (`node --version`).

## 3. Check it works

The server exposes three tools: `mark_file`, `verify_file` and `get_asset`. To test without using quota, call `get_asset` with `00000000-0000-4000-8000-000000000000`: a `404` error means the server started and the key was accepted; `Markproof API error (401)` means the key is wrong. If a call returns "MARKPROOF_API_KEY is not set", the `env` entry is missing.

## Tools

- `mark_file` (`path`, optional `generator_name`, `model_name`, `visible_label`, `label_position`): watermarks and C2PA-signs a local image (PNG, JPEG, WebP) or audio file (WAV, MP3) and writes `<name>.marked.png` / `.wav` next to it. One API call.
- `verify_file` (`path` or `url`): checks a file for a Markproof watermark and a C2PA manifest. Use `url` for files over about 4.5 MB. One API call.
- `get_asset` (`asset_id`): looks up a file the account marked. Free.
