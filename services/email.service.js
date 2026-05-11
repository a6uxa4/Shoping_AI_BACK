const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporter;
}

function logEmailFallback({ to, subject, text, reason }) {
  const banner = "═".repeat(70);
  const header =
    reason === "smtp-not-configured"
      ? "📭  EMAIL NOT SENT — SMTP is not configured in .env"
      : `📭  EMAIL NOT DELIVERED — ${reason}`;
  console.log(
    `\n${banner}\n` +
      `${header}\n` +
      `    To: ${to}\n` +
      `    Subject: ${subject}\n` +
      `${banner}\n` +
      `${text}\n` +
      `${banner}\n`,
  );
}

async function sendEmail({ to, subject, text }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const tx = getTransporter();

  if (!tx) {
    logEmailFallback({ to, subject, text, reason: "smtp-not-configured" });
    return { sent: false, reason: "smtp-not-configured" };
  }

  try {
    const info = await tx.sendMail({ from, to, subject, text });
    console.log(
      `✉️  Email sent to ${to} | subject: "${subject}" | id: ${info.messageId}`,
    );
    return { sent: true, info };
  } catch (err) {
    const reason = err.message || String(err);
    console.error(
      `❌ Failed to send email to ${to} | subject: "${subject}" | ${reason}`,
    );
    // Still print the message so the operator can recover credentials manually.
    logEmailFallback({ to, subject, text, reason: reason.slice(0, 200) });
    throw err;
  }
}

module.exports = { sendEmail };
