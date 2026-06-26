/**
 * SendGrid sender — single HTTPS POST, no OAuth, no token refresh.
 *
 * Setup (one-time, in https://app.sendgrid.com):
 *   1. Sign up (free tier: 100 mail/day).
 *   2. Settings → Sender Authentication → Single Sender Verification
 *        → add the FROM address (e.g. phuocht.test@gmail.com)
 *        → confirm via the verification email Sendgrid sends.
 *   3. Settings → API Keys → Create API Key
 *        - Name: "uma-badminton-worker"
 *        - Permission: "Restricted Access" → only enable "Mail Send"
 *        - Copy the key (shown once).
 *   4. wrangler secret put SENDGRID_API_KEY  → paste.
 *
 * Free tier permanence: API key doesn't expire; the only ongoing rule is that
 * the FROM address must stay verified (Sendgrid will re-verify yearly).
 */
export interface SendGridEnv {
  SENDGRID_API_KEY: string;
}

export interface SendGridArgs {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function isSendGridConfigured(env: SendGridEnv): boolean {
  return !!env.SENDGRID_API_KEY;
}

export async function sendViaSendGrid(
  env: SendGridEnv,
  args: SendGridArgs,
): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: args.to }] }],
      from: { email: args.fromAddress, name: args.fromName },
      subject: args.subject,
      content: [
        // Plain-text part FIRST per RFC 1341 §7.2.3 — mail clients pick the
        // last alternative they can render, so html (richer) should follow.
        { type: "text/plain", value: args.text },
        { type: "text/html", value: args.html },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid send failed: ${res.status} ${text}`);
  }
}
