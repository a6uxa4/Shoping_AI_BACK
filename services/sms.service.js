const { sendEmail } = require("./email.service");

/**
 * "SMS" delivery service.
 *
 * Per business requirement, SMS notifications are delivered as an email
 * to the recipient's email address (carrier-style email gateway is not used
 * in this MVP). The "to" argument is expected to be an email address.
 *
 * If `to` looks like a phone number and `process.env.SMS_FALLBACK_EMAIL`
 * is set, the message is forwarded to that mailbox so the operator can
 * relay it manually.
 */
async function sendSms({ to, text, subject }) {
  const trimmed = String(to || "").trim();
  const looksLikeEmail = trimmed.includes("@");
  const target = looksLikeEmail
    ? trimmed
    : process.env.SMS_FALLBACK_EMAIL || "";

  if (!target) {
    console.log("SMS skipped (no email target):", { to: trimmed, text });
    return;
  }

  try {
    await sendEmail({
      to: target,
      subject: subject || "SMS notification",
      text: looksLikeEmail
        ? text
        : `SMS for ${trimmed}:\n\n${text}`,
    });
  } catch (err) {
    console.error("Failed to deliver SMS via email gateway:", err.message || err);
  }
}

module.exports = { sendSms };
