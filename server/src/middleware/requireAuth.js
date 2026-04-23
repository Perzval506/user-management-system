const { verifyAccessToken } = require("../utils/tokens");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Missing access token" });

  try {
    const payload = verifyAccessToken(token);
    req.user = payload; // { id, email, role }
    next();
  } catch {
    return res.status(401).json({ message: "Invalid/expired access token" });
  }
}

module.exports = { requireAuth };
