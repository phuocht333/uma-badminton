import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmForm } from "~/components/confirm-form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getDb, schema } from "~/db/client";
import { requireAdmin } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { sendWelcomeWithSetPassword } from "~/lib/email.server";

const addSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  name: z.string().min(1, "Tên không được trống"),
  phone: z.string().optional(),
  gender: z.enum(["nam", "nu"]),
  role: z.enum(["admin", "member"]).default("member"),
});

const PHONE_RE = /^[0-9+\-\s().]{6,20}$/;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  const users = await db.query.users.findMany({ orderBy: (u, { asc }) => [asc(u.createdAt)] });
  return json({ users });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const admin = await requireAdmin(request, context);
  const env = getEnv(context);
  const db = getDb(env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "add") {
    const parsed = addSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return json({ error: parsed.error.errors[0]?.message ?? "Lỗi" }, { status: 400 });
    }
    const email = parsed.data.email.toLowerCase().trim();
    const dup = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (dup) return json({ error: "Email đã tồn tại" }, { status: 400 });
    const phone = (parsed.data.phone ?? "").trim();
    if (phone && !PHONE_RE.test(phone)) {
      return json({ error: "Số điện thoại không hợp lệ" }, { status: 400 });
    }
    const now = Date.now();
    const id = ulid();
    await db.insert(schema.users).values({
      id,
      email,
      name: parsed.data.name.trim(),
      phone: phone || null,
      gender: parsed.data.gender,
      role: parsed.data.role,
      passwordHash: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await sendWelcomeWithSetPassword(env, { id, name: parsed.data.name.trim(), email });
    } catch (e) {
      console.error("[admin/members] welcome email failed", e);
    }
    return redirect("/admin/members");
  }

  if (intent === "resend") {
    const userId = String(form.get("userId"));
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!u) return json({ error: "Không tìm thấy" }, { status: 404 });
    try {
      await sendWelcomeWithSetPassword(env, { id: u.id, name: u.name, email: u.email });
    } catch (e) {
      console.error("[admin/members] resend email failed", e);
    }
    return json({ ok: "Đã gửi lại email." });
  }

  if (intent === "toggle-active") {
    const userId = String(form.get("userId"));
    if (userId === admin.id) return json({ error: "Không thể tự deactivate" }, { status: 400 });
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!u) return json({ error: "Không tìm thấy" }, { status: 404 });
    await db
      .update(schema.users)
      .set({ isActive: !u.isActive, updatedAt: Date.now() })
      .where(eq(schema.users.id, userId));
    return redirect("/admin/members");
  }

  if (intent === "set-phone") {
    const userId = String(form.get("userId"));
    const phone = String(form.get("phone") ?? "").trim();
    if (phone && !PHONE_RE.test(phone)) {
      return json({ error: "Số điện thoại không hợp lệ" }, { status: 400 });
    }
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!u) return json({ error: "Không tìm thấy" }, { status: 404 });
    await db
      .update(schema.users)
      .set({ phone: phone || null, updatedAt: Date.now() })
      .where(eq(schema.users.id, userId));
    return redirect("/admin/members");
  }

  if (intent === "set-role") {
    const userId = String(form.get("userId"));
    const role = String(form.get("role"));
    if (role !== "admin" && role !== "member") {
      return json({ error: "Role không hợp lệ" }, { status: 400 });
    }
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (!u) return json({ error: "Không tìm thấy" }, { status: 404 });
    if (userId === admin.id && role !== "admin") {
      return json({ error: "Không thể tự hạ quyền chính mình" }, { status: 400 });
    }
    await db
      .update(schema.users)
      .set({ role, updatedAt: Date.now() })
      .where(eq(schema.users.id, userId));
    return redirect("/admin/members");
  }

  return json({ error: "intent không hợp lệ" }, { status: 400 });
}

export default function AdminMembers() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Thêm thành viên</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="add" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Tên</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">SĐT (cho MoMo)</Label>
                <Input id="phone" name="phone" type="tel" placeholder="0912345678" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gender">Giới tính</Label>
                <select
                  id="gender"
                  name="gender"
                  required
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="nam">Nam</option>
                  <option value="nu">Nữ</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Vai trò</Label>
                <select
                  id="role"
                  name="role"
                  defaultValue="member"
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="member">Thành viên</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            {actionData && "error" in actionData && (
              <p className="text-sm text-destructive">{actionData.error}</p>
            )}
            {actionData && "ok" in actionData && (
              <p className="text-sm text-primary">{actionData.ok}</p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Đang thêm..." : "Thêm + gửi link đặt mật khẩu"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách ({data.users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.users.map((u) => (
              <div
                key={u.id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">
                    {u.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({u.gender === "nam" ? "Nam" : "Nữ"}
                      {u.role === "admin" ? ", Admin" : ""})
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                  <Form method="post" className="mt-1 flex items-center gap-2">
                    <input type="hidden" name="intent" value="set-phone" />
                    <input type="hidden" name="userId" value={u.id} />
                    <Input
                      name="phone"
                      type="tel"
                      defaultValue={u.phone ?? ""}
                      placeholder="SĐT (MoMo)"
                      className="h-8 text-xs"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={submitting}>
                      Lưu
                    </Button>
                  </Form>
                  {!u.passwordHash && (
                    <div className="mt-1 text-xs text-amber-700">Chưa đặt mật khẩu</div>
                  )}
                  {!u.isActive && (
                    <div className="mt-1 text-xs text-destructive">Đã ngừng hoạt động</div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmForm
                    fields={{
                      intent: "set-role",
                      userId: u.id,
                      role: u.role === "admin" ? "member" : "admin",
                    }}
                    title="Đổi role"
                    description={`Chuyển ${u.name} thành ${u.role === "admin" ? "Thành viên" : "Admin"}?`}
                    confirmLabel="Đổi role"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                  >
                    {u.role === "admin" ? "Hạ thành viên" : "Lên Admin"}
                  </ConfirmForm>
                  <Form method="post">
                    <input type="hidden" name="intent" value="resend" />
                    <input type="hidden" name="userId" value={u.id} />
                    <Button type="submit" size="sm" variant="outline" disabled={submitting}>
                      Gửi lại link
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-active" />
                    <input type="hidden" name="userId" value={u.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={u.isActive ? "destructive" : "primary"}
                      disabled={submitting}
                    >
                      {u.isActive ? "Tạm ngưng" : "Kích hoạt lại"}
                    </Button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
