// Notifications by email (same scheme and SMTP account as the Cross_Chain relayer).
// The backend writes into an outbox table; a loop sends pending messages. Bodies never contain personal data:
// only event codes, UP addresses, transaction hashes, tickets and counts.
import nodemailer from "nodemailer";

const PREFIX = { problem: "[PROBLEM]", event: "[EVENT]", info: "[INFO]" };

export function notify(db, { kind, severity, subject, body }, now = Date.now()) {
  db.prepare("INSERT INTO notifications (ts, kind, severity, subject, body) VALUES (?, ?, ?, ?, ?)").run(
    now,
    kind,
    severity,
    subject,
    body,
  );
}

/** @returns {null | {to: string, send: (subject: string, text: string) => Promise<void>}} */
export function createMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.NOTIFICATION_EMAIL) return null;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    secure: env.SMTP_SECURE !== "false",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    to: env.NOTIFICATION_EMAIL,
    send: (subject, text) => transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to: env.NOTIFICATION_EMAIL, subject, text }),
  };
}

/** Sends pending notifications. Returns the number sent. Without a mailer, messages stay queued. */
export async function flushNotifications(db, mailer, { label = "up-cie-link", now = Date.now } = {}) {
  if (!mailer) return 0;
  const pending = db.prepare("SELECT * FROM notifications WHERE sent_at IS NULL AND attempts < 10 ORDER BY id LIMIT 20").all();
  let sent = 0;
  for (const n of pending) {
    try {
      await mailer.send(`${PREFIX[n.severity]} ${label}: ${n.subject}`, `${n.body}\n\n(${new Date(n.ts).toISOString()})`);
      db.prepare("UPDATE notifications SET sent_at = ?, attempts = attempts + 1 WHERE id = ?").run(now(), n.id);
      sent++;
    } catch {
      db.prepare("UPDATE notifications SET attempts = attempts + 1 WHERE id = ?").run(n.id);
    }
  }
  return sent;
}
