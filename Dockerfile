# For MCP directories (Glama) that run the server in a container to check it
# starts and lists its tools. Installs the published npm package; pass
# MARKPROOF_API_KEY at runtime (docker run -i -e MARKPROOF_API_KEY=...).
# Without a key it still starts and lists tools; calls explain the missing key.
FROM node:22-alpine
RUN npm install -g markproof-mcp@0.3.3 && npm cache clean --force
USER node
ENTRYPOINT ["markproof-mcp"]
