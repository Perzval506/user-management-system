const jwt = require("jsonwebtoken");

function signAccessToken(user, accessMinutes) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: `${accessMinutes}m` }
  );
}

function signRefreshToken(user, refreshDays) {
  return jwt.sign(
    { id: user.id, type: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: `${refreshDays}d` }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
