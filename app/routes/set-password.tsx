import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getDb, schema } from "~/db/client";
import { invalidateAllSessionsForUser } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";
import { hashPassword } from "~/lib/crypto.server";

const passSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Mật khẩu xác nhận không khớp",
    path: ["confirm"],
  });

async function validateToken(db: ReturnType<typeof getDb>, token: string) {
  if (!token) return { error: "Thiếu token" as const };
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(schema.passwordResetTokens.token, token),
      gt(schema.passwordResetTokens.expiresAt, Date.now()),
      isNull(schema.passwordResetTokens.usedAt),
    ),
  });
  if (!row) return { error: "Link đã hết hạn hoặc không hợp lệ" as const };
  return { userId: row.userId };
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const env = getEnv(context);
  const db = getDb(env.DB);
  const result = await validateToken(db, token);
  if ("error" in result) {
    return json({ ok: false as const, error: result.error, token });
  }
  return json({ ok: true as const, error: null, token });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const parsed = passSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return json({ error: parsed.error.errors[0]?.message ?? "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const env = getEnv(context);
  const db = getDb(env.DB);
  const validate = await validateToken(db, parsed.data.token);
  if ("error" in validate) return json({ error: validate.error }, { status: 400 });

  const hash = await hashPassword(parsed.data.password);
  const now = Date.now();
  await db
    .update(schema.users)
    .set({ passwordHash: hash, updatedAt: now })
    .where(eq(schema.users.id, validate.userId));
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(schema.passwordResetTokens.token, parsed.data.token));

  // Reset always invalidates every active session for this user — forces
  // re-login everywhere with the new password.
  await invalidateAllSessionsForUser(context, validate.userId);

  return redirect("/login?reset=ok");
}

export default function SetPassword() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  if (!data.ok) {
    return (
      <div className="container-mobile flex min-h-screen items-center justify-center py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Link không hợp lệ</CardTitle>
            <CardDescription>{data.error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Liên hệ Admin để nhận link mới.{" "}
              <a href="/login" className="underline">
                Về đăng nhập
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container-mobile flex min-h-screen items-center justify-center py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Đặt mật khẩu mới</CardTitle>
          <CardDescription>Chọn mật khẩu cho tài khoản của bạn (≥ 8 ký tự).</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="token" value={data.token} />
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu mới</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Nhập lại mật khẩu</Label>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
            </div>
            {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Đang lưu..." : "Lưu mật khẩu"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
