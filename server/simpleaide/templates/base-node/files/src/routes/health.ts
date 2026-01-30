import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get("/ready", (req, res) => {
  res.json({ ready: true });
});

export default router;
