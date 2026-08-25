/**
 * Temporary internal-only route: serves the Project Monthly Reports audit markdown.
 * Read-only. No auth required (internal dev/review tool).
 * Remove this file once the review cycle is complete.
 */
import { Router } from "express";
import { readFileSync } from "fs";
import path from "path";

const router = Router();

router.get("/audit/report-md", (_req, res) => {
  try {
    // process.cwd() = artifacts/api-server; go up two levels to workspace root
    const filePath = path.resolve(
      process.cwd(),
      "../../.local/audit-reports/project-monthly-reports-full-audit.md",
    );
    const content = readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(content);
  } catch {
    res.status(404).json({ error: "audit report file not found" });
  }
});

export default router;
