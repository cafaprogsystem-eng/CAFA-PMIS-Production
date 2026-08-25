import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isRuntimeReady } from "../lib/runtime-readiness";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // Reachability probes must not be answered from an intermediary cache.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.json(data);
});

// Deployment readiness is intentionally separate from the public, lightweight
// connectivity probe above. It reveals no dependency names or diagnostics.
router.get("/readyz", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  if (!isRuntimeReady()) {
    res.status(503).json({ status: "not_ready" });
    return;
  }
  res.json({ status: "ready" });
});

export default router;
