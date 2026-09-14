# Liqora Website

واجهة موقع الدعوات مع طبقة Backend آمنة لإرسال تنبيه عند نجاح دفع طلب جديد عبر Unifonic.

## الحالة الحالية

- الواجهة الحالية Static HTML/CSS/JavaScript.
- إرسال الطلب الأولي الموجود في الموقع ما زال عبر WhatsApp كما كان.
- تمت إضافة endpoint خادمي آمن: `POST /api/orders/paid`.
- يدعم تنبيه Unifonic عبر SMS أو WhatsApp Template.
- توجد حماية shared secret، validation، ومعالجة أخطاء، ومنع تكرار webhook.
- توجد اختبارات تلقائية وGitHub Actions.

> ملاحظة: لا يوجد مزود دفع مربوط داخل النسخة الأصلية من المشروع. عند اختيار مزود الدفع نضيف Adapter يتحقق من توقيع مزود الدفع ثم يحول الحدث إلى `payment.succeeded` القياسي.

## التشغيل المحلي

```bash
npm install
npm run check
npm test
npm run build
```

انسخ `.env.example` إلى `.env` في بيئة الـBackend فقط وأضف بياناتك الحقيقية. لا ترفع `.env` إلى GitHub.

## بنية الإضافة الجديدة

```text
api/orders/paid.mjs            # Vercel server endpoint
server/lib/config.js           # Environment configuration
server/lib/security.js         # Secret verification
server/lib/validation.js       # Payload validation/normalization
server/lib/idempotency.js      # Duplicate webhook protection
server/lib/unifonic.js         # SMS / WhatsApp integration
server/lib/http.js             # HTTP helpers
tests/                         # Unit tests
.github/workflows/quality.yml  # GitHub CI
docs/PAID_ORDER_NOTIFICATIONS.md
```

## التوثيق

اقرأ `docs/PAID_ORDER_NOTIFICATIONS.md` لمعرفة صيغة الحدث، متغيرات البيئة، وقالب WhatsApp المقترح.

## قاعدة أمنية مهمة

نجاح الدفع لا يتم اعتماده من JavaScript في المتصفح. يجب التحقق منه في Backend باستخدام توقيع/واجهة مزود الدفع، وبعدها فقط يتم إرسال تنبيه Unifonic.

## النشر من GitHub

اربط المستودع مع Vercel، ثم أضف متغيرات البيئة من `.env.example` داخل Project Settings. ملف `vercel.json` يضبط بناء ملفات الواجهة من `dist/` وتشغيل وظيفة `/api/orders/paid`.
