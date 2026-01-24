const lastSeen = new Map(); // key: userId, value: timestamp (ms)

function enforceIdleTimeout(req, res, next) {
  if (!req.user?.id) return next();

  const idleMinutes = Number(process.env.SESSION_IDLE_MINUTES || 15);
  const now = Date.now();
  const prev = lastSeen.get(req.user.id);

  if (prev) {
    const diffMin = (now - prev) / 60000;
    if (diffMin > idleMinutes) {
      lastSeen.delete(req.user.id);
      return res.status(401).json({ message: "Session timed out (idle)" });
    }
  }

  lastSeen.set(req.user.id, now);
  next();
}

module.exports = { enforceIdleTimeout };
