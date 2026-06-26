import { json, type ActionFunctionArgs } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getDb, schema } from "~/db/client";
import { getEnv } from "~/lib/env.server";
import { sendPasswordResetEmail } from "~/lib/email.server";

const schemaInput = z.object({ email: z.string().email() });

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const parsed = schemaInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return json({ message: "Nếu email tồn tại, link đặt lại đã được gửi." });
  }
  const env = getEnv(context);
  const db = getDb(env.DB);
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, parsed.data.email.toLowerCase().trim()),
  });
  if (user && user.isActive) {
    try {
      await sendPasswordResetEmail(env, { id: user.id, name: user.name, email: user.email });
    } catch (e) {
      console.error("[forgot-password] email failed", e);
    }
  }
  // Always return the same response (don't leak email existence)
  return json({ message: "Nếu email tồn tại, link đặt lại đã được gửi." });
}

export default function ForgotPassword() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  return (
    <div className="container-mobile flex min-h-screen items-center justify-center py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Quên mật khẩu</CardTitle>
          <CardDescription>Nhập email — chúng tôi sẽ gửi link đặt lại.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            {data?.message && <p className="text-sm">{data.message}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Đang gửi..." : "Gửi link đặt lại"}
            </Button>
            <p className="text-center text-sm">
              <a href="/login" className="underline">
                Về trang đăng nhập
              </a>
            </p>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
