// Diagnostic: gọi thẳng SendGrid API với SENDGRID_API_KEY, in nguyên response.
// Dùng để phân biệt 401/403/429/202 mà không cần deploy hay log Cloudflare.
//
// Chạy:
//   SENDGRID_API_KEY="SG.xxx" node scripts/test-sendgrid.mjs
//
// Hoặc override from/to:
//   SENDGRID_API_KEY="SG.xxx" FROM=a@b.com TO=c@d.com node scripts/test-sendgrid.mjs

const key = process.env.SENDGRID_API_KEY;
if (!key) {
  console.error("Thiếu SENDGRID_API_KEY env var.");
  process.exit(1);
}

// FROM phải là Single Sender đã verify trên SendGrid (đăng ký = phuocht.test@gmail.com).
// TO là mailbox kiểm tra (phuocht.jobs@gmail.com).
const from = process.env.FROM ?? "phuocht.test@gmail.com";
const to = process.env.TO ?? "phuocht.jobs@gmail.com";

console.log(`[test] FROM=${from}  TO=${to}`);

const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: "UMABadminton Test" },
    subject: `[Uma test] ${new Date().toISOString()}`,
    content: [
      { type: "text/plain", value: "Test gửi mail qua SendGrid." },
      { type: "text/html", value: "<p>Test gửi mail qua SendGrid.</p>" },
    ],
  }),
});

console.log(`[test] status=${res.status} ${res.statusText}`);
console.log(`[test] x-message-id=${res.headers.get("x-message-id") ?? "(none)"}`);

const body = await res.text();
if (body) {
  console.log(`[test] body:\n${body}`);
} else {
  console.log(`[test] body: (empty — 202 Accepted bình thường có body rỗng)`);
}

if (!res.ok) {
  process.exit(2);
}
