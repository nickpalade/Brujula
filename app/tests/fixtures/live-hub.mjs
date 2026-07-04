import express from "express";

import { hubRouter } from "../../../server/routes/hub.js";
import * as store from "../../../server/store.js";

const PORT = Number.parseInt(process.env.E2E_HUB_PORT ?? "8021", 10);

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "25mb" }));

app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      provider: "mock",
      model: "mock-provider",
      ollama_reachable: true,
      compute_mode: "mock",
      summary_language: "en",
      gpu_in_use: false,
      detail: "playwright live hub",
    },
    error: null,
  });
});

app.post("/__test/reset", (req, res) => {
  res.json({ success: true, data: store.reset(), error: null });
});

app.use(hubRouter);

store.reset();

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`PLAYWRIGHT_LIVE_HUB_READY http://127.0.0.1:${PORT}`);
});

function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
