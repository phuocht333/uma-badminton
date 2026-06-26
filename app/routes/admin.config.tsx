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
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireAdmin } from "~/lib/auth.server";
import { getDb, schema } from "~/db/client";
import { getEnv } from "~/lib/env.server";
import {
  CONFIG_KEYS,
  CourtsByWeekdaySchema,
  DEFAULT_MIN_PEOPLE,
  DEFAULT_PEOPLE_PER_HOUR,
  DEFAULT_VOTE_CLOSE_DAY,
  DEFAULT_VOTE_OPEN_DAY,
  PriceTableSchema,
  getActiveWeekdays,
  getCourts,
  getNumber,
  getPrices,
  getString,
  setActiveWeekdays,
  setCourts,
  setNumber,
  setPrices,
  setString,
  type ActiveWeekday,
} from "~/lib/config.server";
import { isValidMomoLink, MOMO_LINK_ERROR } from "~/lib/momo-link";
import { reconcileMonthSessions } from "~/lib/vote.server";
import { inArray } from "drizzle-orm";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireAdmin(request, context);
  const env = getEnv(context);
  const [
    prices,
    courts,
    peoplePerHour,
    minPeople,
    voteOpenDay,
    voteCloseDay,
    adminQrKey,
    activeWeekdays,
    quyMomoLink,
  ] = await Promise.all([
    getPrices(env.DB),
    getCourts(env.DB),
    getNumber(env.DB, CONFIG_KEYS.PEOPLE_PER_HOUR, DEFAULT_PEOPLE_PER_HOUR),
    getNumber(env.DB, CONFIG_KEYS.MIN_PEOPLE_PER_SESSION, DEFAULT_MIN_PEOPLE),
    getNumber(env.DB, CONFIG_KEYS.VOTE_OPEN_DAY, DEFAULT_VOTE_OPEN_DAY),
    getNumber(env.DB, CONFIG_KEYS.VOTE_CLOSE_DAY, DEFAULT_VOTE_CLOSE_DAY),
    getString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, ""),
    getActiveWeekdays(env.DB),
    getString(env.DB, CONFIG_KEYS.QUY_MOMO_LINK, ""),
  ]);
  return json({
    prices,
    courts,
    peoplePerHour,
    minPeople,
    voteOpenDay,
    voteCloseDay,
    activeWeekdays,
    adminQrUrl: adminQrKey ? `/qr/${encodeURIComponent(adminQrKey)}` : null,
    quyMomoLink,
    sendgridConfigured: !!env.SENDGRID_API_KEY,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireAdmin(request, context);
  const env = getEnv(context);
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    // QR upload path — multipart is incompatible with normal formData parsing.
    return handleQrUpload(request, env);
  }

  const form = await request.formData();
  const intent = String(form.get("intent"));

  try {
    if (intent === "prices") {
      const prices = PriceTableSchema.parse({
        thang: {
          nam: Number(form.get("thang_nam")),
          nu: Number(form.get("thang_nu")),
        },
        vang_lai: {
          nam: Number(form.get("vang_lai_nam")),
          nu: Number(form.get("vang_lai_nu")),
        },
      });
      await setPrices(env.DB, prices);
    } else if (intent === "numbers") {
      await setNumber(env.DB, CONFIG_KEYS.PEOPLE_PER_HOUR, Number(form.get("peoplePerHour")));
      await setNumber(env.DB, CONFIG_KEYS.MIN_PEOPLE_PER_SESSION, Number(form.get("minPeople")));
    } else if (intent === "vote-window") {
      const openDay = Math.max(1, Math.min(31, Number(form.get("voteOpenDay"))));
      const closeDay = Math.max(1, Math.min(31, Number(form.get("voteCloseDay"))));
      if (openDay >= closeDay) {
        return json({ error: "Ngày mở phải nhỏ hơn ngày đóng." }, { status: 400 });
      }
      await setNumber(env.DB, CONFIG_KEYS.VOTE_OPEN_DAY, openDay);
      await setNumber(env.DB, CONFIG_KEYS.VOTE_CLOSE_DAY, closeDay);
    } else if (intent === "courts") {
      const courtsJson = String(form.get("courtsJson"));
      const parsed = CourtsByWeekdaySchema.parse(JSON.parse(courtsJson));
      await setCourts(env.DB, parsed);
    } else if (intent === "active-weekdays") {
      const picked = form.getAll("weekday").map((v) => String(v)) as ActiveWeekday[];
      await setActiveWeekdays(env.DB, picked);
      // Reconcile open months so vote options reflect the new config
      // immediately. Locked/done months are immutable — the helper skips
      // them. Sessions with votes or admin-set courts are preserved.
      const active = await getActiveWeekdays(env.DB);
      const db = getDb(env.DB);
      const openMonths = await db.query.months.findMany({
        where: inArray(schema.months.status, ["draft", "voting"]),
      });
      for (const m of openMonths) {
        await reconcileMonthSessions(env.DB, m.id, active);
      }
    } else if (intent === "quy-momo-link") {
      const raw = String(form.get("quyMomoLink") || "").trim();
      if (raw && !isValidMomoLink(raw)) {
        return json({ error: MOMO_LINK_ERROR }, { status: 400 });
      }
      await setString(env.DB, CONFIG_KEYS.QUY_MOMO_LINK, raw);
    } else {
      return json({ error: "intent không hợp lệ" }, { status: 400 });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Lỗi không xác định" }, { status: 400 });
  }
  return redirect("/admin/config?saved=1");
}

async function handleQrUpload(
  request: Request,
  env: { DB: D1Database; R2: R2Bucket },
) {
  const MAX = 2 * 1024 * 1024; // 2MB
  const upload = unstable_composeUploadHandlers(
    unstable_createMemoryUploadHandler({ maxPartSize: MAX }),
  );
  const form = await unstable_parseMultipartFormData(request, upload);
  const file = form.get("qr") as File | null;
  if (!file || file.size === 0) return json({ error: "Chưa chọn ảnh QR" }, { status: 400 });
  if (file.size > MAX) return json({ error: "Ảnh vượt quá 2MB" }, { status: 400 });
  const allowed = ["image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(file.type)) {
    return json({ error: "Chỉ chấp nhận PNG/JPG/WEBP" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `qr/admin-${Date.now()}.${ext}`;
  const buf = await file.arrayBuffer();
  await env.R2.put(key, buf, { httpMetadata: { contentType: file.type } });
  await setString(env.DB, CONFIG_KEYS.ADMIN_QR_IMAGE_KEY, key);
  return redirect("/admin/config?saved=1");
}

export default function AdminConfig() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-hairline bg-canvas-soft p-4 text-body-sm">
        <p className="eyebrow text-muted">Cấu hình hệ thống</p>
        <p className="mt-1 text-ink">Admin có thể cấu hình:</p>
        <ul className="mt-1 ml-5 list-disc space-y-0.5 text-ink">
          <li>Giá tiền vãng lai, vote tháng</li>
          <li>Số người đánh trong 1 giờ sân</li>
          <li>Số người vote tối thiểu để đặt sân</li>
          <li>Ngày giờ hằng tháng sẽ tự động khoá vote</li>
        </ul>
        <p className="mt-2 text-caption text-muted">
          Để chỉnh sân &amp; giờ sân của một ngày cụ thể, vào <strong>Lịch tháng</strong> →
          chọn ngày để thao tác trực tiếp.
        </p>
      </div>
      {actionData && "error" in actionData && (
        <p className="text-sm text-destructive">{actionData.error}</p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Email gửi đi (SendGrid)</CardTitle>
          <p className="text-caption text-muted">
            App dùng SendGrid (free tier 100 mail/ngày) để gửi email. FROM address phải được
            verify qua Single Sender Verification trên SendGrid dashboard.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.sendgridConfigured ? (
            <p className="text-body-sm text-semantic-success">
              ✓ Đã cấu hình <code>SENDGRID_API_KEY</code>. Email sẽ gửi từ FROM address đã verify
              trên SendGrid.
            </p>
          ) : (
            <p className="text-body-sm text-semantic-warn">
              Chưa cấu hình <code>SENDGRID_API_KEY</code>. Tạo API key trên{" "}
              <a
                href="https://app.sendgrid.com/settings/api_keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                SendGrid dashboard
              </a>{" "}
              (Mail Send permission), rồi chạy:{" "}
              <code>wrangler secret put SENDGRID_API_KEY</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">QR MoMo của group (quỹ chung)</CardTitle>
          <p className="text-caption text-muted">
            Ảnh QR này hiện cho member khi đăng ký vãng lai hoặc cần chuyển vào quỹ chung.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.adminQrUrl && (
            <img
              src={data.adminQrUrl}
              alt="QR quỹ group"
              className="max-w-[220px] rounded-md border border-hairline"
            />
          )}
          <Form method="post" encType="multipart/form-data" className="space-y-2">
            <Label htmlFor="qr">Upload QR mới (PNG/JPG/WEBP, ≤ 2MB)</Label>
            <Input
              id="qr"
              type="file"
              name="qr"
              accept="image/png,image/jpeg,image/webp"
              required
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? "Đang upload..." : "Cập nhật QR group"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Link MoMo của quỹ</CardTitle>
          <p className="text-caption text-muted">
            Khi member trả tiền cho quỹ trên điện thoại, họ bấm để mở thẳng app MoMo.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="quy-momo-link" />
            <Label htmlFor="quyMomoLink">Link MoMo</Label>
            <Input
              id="quyMomoLink"
              name="quyMomoLink"
              type="url"
              placeholder="https://quy.momo.vn/abc123"
              defaultValue={data.quyMomoLink}
              pattern="https://[A-Za-z0-9.-]*momo\.vn/.+"
            />
            <details className="text-caption text-muted">
              <summary className="cursor-pointer hover:text-ink">
                Cách lấy link MoMo
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Mở app MoMo trên điện thoại của quỹ.</li>
                <li>
                  Nhấn tab <strong>Cá nhân</strong> (góc dưới phải).
                </li>
                <li>
                  Nhấn tên / mã QR ở đầu màn hình → <strong>Chia sẻ</strong>.
                </li>
                <li>
                  Chọn <strong>Sao chép link</strong> — có dạng{" "}
                  <code className="rounded bg-canvas-soft px-1">
                    https://&lt;subdomain&gt;.momo.vn/...
                  </code>
                  &nbsp;(ví dụ <code>quy.momo.vn</code> hoặc <code>me.momo.vn</code>).
                </li>
                <li>Dán vào ô bên trên rồi bấm "Lưu link".</li>
              </ol>
            </details>
            <Button type="submit" disabled={submitting}>
              Lưu link MoMo
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Giá (VND / buổi)</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="prices" />
            <div className="grid grid-cols-2 gap-3">
              <PriceInput label="Tháng — Nam" name="thang_nam" defaultValue={data.prices.thang.nam} />
              <PriceInput label="Tháng — Nữ" name="thang_nu" defaultValue={data.prices.thang.nu} />
              <PriceInput
                label="Vãng lai — Nam"
                name="vang_lai_nam"
                defaultValue={data.prices.vang_lai.nam}
              />
              <PriceInput
                label="Vãng lai — Nữ"
                name="vang_lai_nu"
                defaultValue={data.prices.vang_lai.nu}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              Lưu giá
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cửa sổ vote (tự động)</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="vote-window" />
            <p className="text-xs text-muted-foreground">
              Mỗi ngày 09:00 VN cron sẽ check ngày hiện tại, nếu trùng "Ngày mở" thì tự mở vote
              cho tháng kế tiếp. Mỗi đêm 23:59 VN check nếu trùng "Ngày đóng" thì đóng vote.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ngày mở (1-31)</Label>
                <Input
                  type="number"
                  name="voteOpenDay"
                  min={1}
                  max={31}
                  defaultValue={data.voteOpenDay}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ngày đóng (1-31)</Label>
                <Input
                  type="number"
                  name="voteCloseDay"
                  min={1}
                  max={31}
                  defaultValue={data.voteCloseDay}
                />
              </div>
            </div>
            <Button type="submit" disabled={submitting}>
              Lưu cửa sổ vote
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Thứ trong tuần đi đánh</CardTitle>
          <p className="text-caption text-muted">
            Áp dụng cho tháng mới và tháng đang mở vote. Tháng đã khoá / đã đặt sân
            không bị ảnh hưởng. Buổi đã có người vote hoặc đã đặt sân sẽ được giữ
            lại, dù thứ đó đã bị bỏ chọn.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="active-weekdays" />
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["T2", "Thứ 2"],
                  ["T3", "Thứ 3"],
                  ["T4", "Thứ 4"],
                  ["T5", "Thứ 5"],
                  ["T6", "Thứ 6"],
                  ["T7", "Thứ 7"],
                  ["CN", "Chủ nhật"],
                ] as const
              ).map(([code, label]) => (
                <label
                  key={code}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-body-sm hover:bg-surface-strong"
                >
                  <input
                    type="checkbox"
                    name="weekday"
                    value={code}
                    defaultChecked={data.activeWeekdays.includes(code)}
                    className="h-4 w-4 rounded border border-hairline-strong text-accent focus:ring-accent"
                  />
                  <span className="font-medium">{label}</span>
                </label>
              ))}
            </div>
            <Button type="submit" disabled={submitting}>
              Lưu
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tham số tính giờ & sân</CardTitle>
          <p className="text-caption text-muted">
            Ba tham số này điều khiển cách app tự tính số giờ sân cần đặt dựa trên số người vote.
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="numbers" />
            <div className="space-y-3">
              <ConfigNumber
                label="Số người chia sẻ 1 giờ sân"
                name="peoplePerHour"
                value={data.peoplePerHour}
                help={`Ví dụ: 3 người = 1 giờ. ${data.peoplePerHour} người vote ⇒ tính ra số giờ = floor(người × 2 / ${data.peoplePerHour}) / 2 (làm tròn xuống 0.5h).`}
              />
              <ConfigNumber
                label="Số người tối thiểu để đặt sân cho 1 buổi"
                name="minPeople"
                value={data.minPeople}
                help={`Nếu một buổi có ít hơn ${data.minPeople} người vote, app sẽ KHÔNG tự đặt sân cho buổi đó (Admin có thể xử lý tay).`}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              Lưu
            </Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ưu tiên sân (JSON)</CardTitle>
          <p className="text-caption text-muted">
            Dùng để tự động gen lịch khi khoá. Vd: 10:00 max 2 thì gen 8:00 - 10:00 (10 - 2)
          </p>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="courts" />
            <p className="text-xs text-muted-foreground">
              Mỗi sân có <code>code</code> (vd: B2), <code>endTime</code> (giờ
              đóng cửa sân tối đa, HH:mm), <code>maxHours</code> (số giờ tối đa
              mỗi lần đặt). Thứ tự trong mảng = thứ tự ưu tiên.
            </p>
            <textarea
              name="courtsJson"
              defaultValue={JSON.stringify(data.courts, null, 2)}
              rows={16}
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
            />
            <Button type="submit" disabled={submitting}>
              Lưu danh sách sân
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

function PriceInput({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" name={name} min={0} step={1000} defaultValue={defaultValue} required />
    </div>
  );
}

function ConfigNumber({
  label,
  name,
  value,
  help,
}: {
  label: string;
  name: string;
  value: number;
  help: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          id={name}
          type="number"
          name={name}
          min={1}
          step={1}
          defaultValue={value}
          className="w-24"
        />
        <span className="text-caption text-muted">{help}</span>
      </div>
    </div>
  );
}
