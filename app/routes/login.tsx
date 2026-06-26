import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getUserFromRequest, login } from "~/lib/auth.server";

const schema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(1, "Chưa nhập mật khẩu"),
});

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request, context);
  if (user) throw redirect("/trang-chu");
  return json({});
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return json({ error: parsed.error.errors[0]?.message ?? "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const result = await login(parsed.data.email, parsed.data.password, context);
  if ("error" in result) {
    return json({ error: result.error }, { status: 401 });
  }
  return redirect("/trang-chu", {
    headers: { "Set-Cookie": result.cookieHeader },
  });
}

export default function LoginPage() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  return (
    <div className="container-mobile flex min-h-screen items-center justify-center py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Đăng nhập</CardTitle>
          <CardDescription>UMABadminton — đăng nhập bằng email nhóm.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {data?.error && <p className="text-sm text-destructive">{data.error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
            </Button>
            <p className="text-center text-sm">
              <a href="/quen-mat-khau" className="text-muted-foreground underline">
                Quên mật khẩu?
              </a>
            </p>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
