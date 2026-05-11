const crypto = require("crypto");

function generateTempPassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  return bytes
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, length);
}

module.exports = { generateTempPassword };
