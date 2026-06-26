import {
  json,
  redirect,
  unstable_composeUploadHandlers,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AppShell } from "~/components/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getDb, schema } from "~/db/client";
import { invalidateAllSessionsForUser, requireUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { hashPassword, verifyPassword } from "~/lib/crypto.server";
import { isValidMomoLink, MOMO_LINK_ERROR } from "~/lib/momo-link";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(request, context);
  return json({
    user,
    qrUrl: user.qrImageKey ? `/qr/${encodeURIComponent(user.qrImageKey)}` : null,
  });
}

const passSchema = z
  .object({
    current: z.string().min(1),
    next: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
    confirm: z.string().min(8),
  })
  .refine((d) => d.next === d.confirm, { message: "Mật khẩu không khớp", path: ["confirm"] });

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireUser(request, context);
  const env = getEnv(context);
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    return handleUpload(request, env, user.id);
  }
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "save-phone") {
    const raw = String(form.get("phone") ?? "").trim();
    if (raw && !/^[0-9+\-\s().]{6,20}$/.test(raw)) {
      return json({ error: "Số điện thoại không hợp lệ" }, { status: 400 });
    }
    const db = getDb(env.DB);
    await db
      .update(schema.users)
      .set({ phone: raw || null, updatedAt: Date.now() })
      .where(eq(schema.users.id, user.id));
    return redirect("/profile");
  }
  if (intent === "save-momo-link") {
    const raw = String(form.get("momoLink") ?? "").trim();
    // Accept empty (clears the field) or any momo.vn deep-link (me.momo.vn,
    // quy.momo.vn, …) — see `isValidMomoLink`.
    if (raw && !isValidMomoLink(raw)) {
      return json({ error: MOMO_LINK_ERROR }, { status: 400 });
    }
    const db = getDb(env.DB);
    await db
      .update(schema.users)
      .set({ momoLink: raw || null, updatedAt: Date.now() })
      .where(eq(schema.users.id, user.id));
    return redirect("/profile");
  }
  if (intent === "change-password") {
    const parsed = passSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return json({ error: parsed.error.errors[0]?.message ?? "Dữ liệu không hợp lệ" }, { status: 400 });
    }
    const db = getDb(env.DB);
    if (!user.passwordHash || !(await verifyPassword(parsed.data.current, user.passwordHash))) {
      return json({ error: "Mật khẩu hiện tại không đúng" }, { status: 400 });
    }
    const newHash = await hashPassword(parsed.data.next);
    await db
      .update(schema.users)
      .set({ passwordHash: newHash, updatedAt: Date.now() })
      .where(eq(schema.users.id, user.id));
    // Drop sessions on other devices — they'll need to re-login with the new password.
    await invalidateAllSessionsForUser(context, user.id);
    return redirect("/login?changed=ok");
  }
  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

async function handleUpload(request: Request, env: { DB: D1Database; R2: R2Bucket }, userId: string) {
  const MAX = 2 * 1024 * 1024; // 2MB
  const upload = unstable_composeUploadHandlers(unstable_createMemoryUploadHandler({ maxPartSize: MAX }));
  const form = await unstable_parseMultipartFormData(request, upload);
  const file = form.get("qr") as File | null;
  if (!file || file.size === 0) return json({ error: "Chưa chọn ảnh QR" }, { status: 400 });
  if (file.size > MAX) return json({ error: "Ảnh vượt quá 2MB" }, { status: 400 });
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) return json({ error: "Chỉ chấp nhận PNG/JPG/WEBP" }, { status: 400 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `qr/user-${userId}-${Date.now()}.${ext}`;
  const buf = await file.arrayBuffer();
  await env.R2.put(key, buf, { httpMetadata: { contentType: file.type } });

  const db = getDb(env.DB);
  await db
    .update(schema.users)
    .set({ qrImageKey: key, updatedAt: Date.now() })
    .where(eq(schema.users.id, userId));
  return redirect("/profile");
}

export default function ProfilePage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  return (
    <AppShell user={data.user as never}>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Tài khoản</h1>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Thông tin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Tên:</span> {data.user.name}
            </div>
            <div>
              <span className="text-muted-foreground">Email:</span> {data.user.email}
            </div>
            <div>
              <span className="text-muted-foreground">Giới tính:</span>{" "}
              {data.user.gender === "nam" ? "Nam" : "Nữ"}
            </div>
            <div>
              <span className="text-muted-foreground">Vai trò:</span>{" "}
              {data.user.role === "admin" ? "Admin" : "Thành viên"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Số điện thoại (cho MoMo)</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-2">
              <input type="hidden" name="intent" value="save-phone" />
              <Label htmlFor="phone">Số điện thoại</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="0912345678"
                defaultValue={data.user.phone ?? ""}
              />
              <p className="text-caption text-muted">
                Admin sẽ dùng số này để request thu tiền qua MoMo khi cần.
              </p>
              <Button type="submit" size="sm" disabled={submitting}>
                Lưu số điện thoại
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Link MoMo</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-2">
              <input type="hidden" name="intent" value="save-momo-link" />
              <Label htmlFor="momoLink">Link nhận tiền qua MoMo</Label>
              <Input
                id="momoLink"
                name="momoLink"
                type="url"
                placeholder="https://me.momo.vn/abc123"
                defaultValue={data.user.momoLink ?? ""}
                pattern="https://[A-Za-z0-9.-]*momo\.vn/.+"
              />
              <p className="text-caption text-muted">
                Khi người khác trả tiền cho bạn trên điện thoại, họ sẽ bấm nút mở
                trực tiếp app MoMo.
              </p>
              <details className="text-caption text-muted">
                <summary className="cursor-pointer hover:text-ink">
                  Cách lấy link MoMo
                </summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>Mở app MoMo trên điện thoại.</li>
                  <li>
                    Nhấn tab <strong>Cá nhân</strong> (góc dưới phải).
                  </li>
                  <li>
                    Nhấn vào tên của bạn / mã QR ở đầu màn hình →{" "}
                    <strong>Chia sẻ</strong>.
                  </li>
                  <li>
                    Chọn <strong>Sao chép link</strong> — link có dạng{" "}
                    <code className="rounded bg-canvas-soft px-1">
                      https://&lt;subdomain&gt;.momo.vn/...
                    </code>
                    &nbsp;(ví dụ <code>me.momo.vn</code> hoặc <code>quy.momo.vn</code>).
                  </li>
                  <li>Dán vào ô bên trên rồi bấm "Lưu link MoMo".</li>
                </ol>
              </details>
              <Button type="submit" size="sm" disabled={submitting}>
                Lưu link MoMo
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">QR chuyển khoản của bạn</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.qrUrl && (
              <img src={data.qrUrl} alt="QR" className="max-w-[220px] rounded-md border" />
            )}
            <Form method="post" encType="multipart/form-data" className="space-y-2">
              <Label htmlFor="qr">Upload QR mới (PNG/JPG/WEBP, ≤ 2MB)</Label>
              <Input id="qr" type="file" name="qr" accept="image/png,image/jpeg,image/webp" required />
              <Button type="submit" disabled={submitting}>
                {submitting ? "Đang upload..." : "Cập nhật QR"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Đổi mật khẩu</CardTitle>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="change-password" />
              <div className="space-y-1.5">
                <Label htmlFor="current">Mật khẩu hiện tại</Label>
                <Input id="current" type="password" name="current" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="next">Mật khẩu mới</Label>
                <Input id="next" type="password" name="next" required minLength={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Nhập lại</Label>
                <Input id="confirm" type="password" name="confirm" required minLength={8} />
              </div>
              {actionData && "error" in actionData && (
                <p className="text-sm text-destructive">{actionData.error}</p>
              )}
              <Button type="submit" disabled={submitting}>
                Lưu mật khẩu
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
