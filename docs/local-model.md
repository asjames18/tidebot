# First chat with a local model

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

Use a fresh TideBot checkout (no existing `.env` or `data/`) for this smoke test. Install the locked dependencies and build the application first (`npm ci && npm run build`). You also need llama.cpp's `llama-server` and a local GGUF file. The tested model was Qwen2.5-0.5B-Instruct, Q4_K_M.

Start the model on the same machine as the TideBot backend, substituting your model path:

```sh
llama-server -m /path/to/qwen.gguf --alias qwen-local --host 127.0.0.1 --port 19326 -c 16384 -t 4 --parallel 1
```

Wait for `curl -f http://127.0.0.1:19326/health` to succeed. In another terminal at the repo root, start TideBot:

```sh
HOST=127.0.0.1 PORT=8787 LLM_PROVIDER=custom LLM_BASE_URL=http://127.0.0.1:19326/v1 LLM_MODEL=qwen-local node server/dist/index.js
```

Open `http://127.0.0.1:8787`, sign in, and create a bot using the configured default model. Ask “What is 2 plus 3? Answer with the digit only.” The verified reply was `5`, with no provider API key. Restart TideBot with the same command and reopen the chat to check transcript persistence. Stop both processes after testing.

If llama.cpp returns `Cannot use tools with stream`, TideBot retries as plain streaming chat without tool definitions. A successful reply in this mode verifies chat, not tool execution. Keep the unauthenticated model endpoint bound to loopback.

## Troubleshooting a local Ollama model

Run these read-only checks from the TideBot **backend’s network environment**. Loopback inside a container is not the host’s loopback. For a same-machine setup, keep Ollama bound to loopback; don't expose an unauthenticated server to fix a connection error.

```sh
curl -fsS --max-time 5 http://127.0.0.1:11434/api/tags
curl -fsS --max-time 5 http://127.0.0.1:11434/api/ps
```

- **Connection refused:** check that Ollama is running and that the backend can reach the correct address and port. This does not mean the model is missing.
- **Requested tag absent from `/api/tags`:** choose an installed `models[].name` or deliberately install the missing model. In TideBot’s custom provider settings, use the exact installed name including its tag, and the chat base URL `http://127.0.0.1:11434/v1`.
- **Tag installed but absent from `/api/ps`:** it is idle, not missing. Try a chat; Ollama can load it on demand. There is no need to download it again.

The [installed models](https://docs.ollama.com/api/tags) and [running models](https://docs.ollama.com/api/ps) APIs use the server root, not `/v1`.

## See also

- [Self-host TideBot](self-host.md) — run the server on your own machine or server, connect devices, and back up your data.
- [Architecture](ARCHITECTURE.md) — how the server, agent loop, and BYOM engine fit together.
- [Orgo builder's guide](orgo-builder-guide.md) — how the Orgo cloud desktops behind the computer tools work.
- [xAI API and Composio](xai-and-composio.md) — builder's reference for the xAI and Composio integrations.
