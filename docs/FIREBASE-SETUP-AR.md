# إعداد Firebase وWhatsApp ونشر المشروع

المشروع المشار إليه في الإعداد العام هو `medadaltahaya`، ومنطقة الدوال `me-central2`. نفّذ كل خطوة أولًا على بيئة اختبار، ولا تضع الأسرار في Git أو المحادثات.

## 1. المتطلبات

- Node.js 22 وJava 21 أو أحدث.
- Firebase على خطة تدعم Cloud Functions وCloud Scheduler وPhone Authentication، مع تنبيه ميزانية.
- Authentication: فعّل Phone للعملاء وEmail/Password للموظفين.
- Firestore وStorage وWeb App وApp Check عبر reCAPTCHA Enterprise.
- حساب Moyasar تجريبي، وحساب Meta Business مع رقم WhatsApp Cloud API وقالبين عربيين معتمدين.

أضف `medadtahaya.com` و`www.medadtahaya.com` ونطاق Cloudflare Pages الفعلي إلى Authorized domains. انسخ إعداد Web App العام فقط إلى `js/firebase-config.js`، وضع مفتاح App Check العام في `appCheckSiteKey`.

## 2. الاختبارات المحلية

```sh
npm ci
npm test
npm run test:integration
```

التكامل يستخدم مشروع المحاكي `demo-medad-audit` ولا ينبغي أن يتصل بالإنتاج.

## 3. الأسرار

```sh
npx firebase login
npx firebase use medadaltahaya
npx firebase functions:secrets:set TICKET_SIGNING_KEY --project medadaltahaya
npx firebase functions:secrets:set MOYASAR_SECRET_KEY --project medadaltahaya
npx firebase functions:secrets:set MOYASAR_WEBHOOK_TOKEN --project medadaltahaya
npx firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN --project medadaltahaya
```

- `TICKET_SIGNING_KEY`: قيمة عشوائية مستقلة لا تقل عن 32 بايت.
- `MOYASAR_SECRET_KEY`: ابدأ بـ`sk_test_...`.
- `MOYASAR_WEBHOOK_TOKEN`: قيمة عشوائية مستقلة لا تقل عن 32 بايت.
- `WHATSAPP_ACCESS_TOKEN`: رمز خادمي دائم أو مُدار لحساب WhatsApp، وليس رمزًا قصير العمر للاختبار عند الإنتاج.

لا تستخدم قيمة واحدة لأكثر من سر، ولا تغيّر مفتاح التذاكر مع مناسبات نشطة.

## 4. معاملات الدوال

تقرأ الدوال هذه المعاملات:

| المعامل                        | مثال                      |
| ------------------------------ | ------------------------- |
| `PUBLIC_SITE_ORIGIN`           | `https://medadtahaya.com` |
| `WHATSAPP_PHONE_NUMBER_ID`     | معرف رقم Meta الرقمي      |
| `WHATSAPP_INVITATION_TEMPLATE` | `medad_invitation_ar`     |
| `WHATSAPP_REMINDER_TEMPLATE`   | `medad_reminder_ar`       |
| `WHATSAPP_GRAPH_API_VERSION`   | إصدار تدعمه Meta حاليًا   |

قد يطلب Firebase هذه القيم أثناء أول نشر ويحفظها في ملف بيئة خاص بالمشروع. لا تضع Access Token في معاملات نصية؛ مكانه Secret Manager. يجب أن يكون أصل الموقع HTTPS دون مسار أو query.

رتب متغيرات القوالب في Meta بالترتيب الموجود في `functions/messaging/whatsapp.js` واختبر العربية والروابط على رقم تجريبي قبل النشر العام.
تحقق من وثائق Meta وقت النشر واضبط `WHATSAPP_GRAPH_API_VERSION` على إصدار Graph API المدعوم في حسابك؛ لا تعتمد على القيمة الافتراضية بعد انتهاء دعمها.

## 5. النشر

```sh
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project medadaltahaya
```

تحقق بعد النشر من وجود العمليات الأساسية، خصوصًا:

- `createOrder`, `publishEvent`, `registerPublicGuest`
- `createPaymentSession`, `syncPaymentSession`, `moyasarInvoiceCallback`
- `sendInvitations`, `dispatchScheduledReminders`
- `getOrderReport`, `checkInTicket`

تحتاج الدالة المجدولة إلى Cloud Scheduler. راقب سجلها وتأكد أن الفهرس المركب `status + nextReminderAt` اكتمل بناؤه.

تعتمد روابط التصميم الخاصة المؤقتة على توقيع Storage V4. تأكد أن هوية تشغيل الدوال تملك صلاحية توقيع blobs وقراءة كائنات الحاوية، ثم اختبر الرابط من نافذة خاصة؛ لا تجعل ملفات التصاميم عامة كحل بديل.

طبّق CORS على Storage بعد استبدال اسم الحاوية:

```sh
gcloud storage buckets update gs://BUCKET_NAME --cors-file=storage.cors.json
```

CORS ليس صلاحية؛ قواعد Storage تظل الحاجز الفعلي.

## 6. أدوار الموظفين

أنشئ الحسابات، ثم من جهاز مسؤول مع Application Default Credentials:

```sh
gcloud auth application-default login
node scripts/set-role.mjs medadaltahaya ADMIN_UID admin
node scripts/set-role.mjs medadaltahaya GATE_UID gate
node scripts/assign-gate.mjs medadaltahaya GATE_UID ORDER_ID grant
```

استخدم `revoke` لسحب تعيين مناسبة. تغيير الدور يبطل رموز التحديث وعلى الموظف تسجيل الدخول مجددًا.

## 7. Cloudflare Pages

- Branch: فرع الإنتاج المعتمد.
- Build command: `npm run build`.
- Output: `dist`.
- Node.js: `22`.

لا تنشر الجذر. تأكد أن `_headers` موجود في الناتج وأن الصفحات الحساسة `no-store`.

## 8. اختبار ما قبل الإنتاج

1. عميل: SMS، إنشاء طلب، محاولة إرسال هاتف مختلف وحقول مزورة.
2. السعر: حدود كل باقة والزيادات والإضافات وعرض الأعمال.
3. الدفع: نجاح وفشل وإلغاء وانتهاء ورجوع وCallback مكرر عبر Sandbox.
4. التصميم: رفع واعتماد ثم ظهور الصورة للضيف، ورفض نسخة قديمة.
5. التسجيل المفتوح: رقم جديد، رقم مكرر، مرافقان، امتلاء المقاعد والانتظار، وامتلاء حد الأرقام.
6. القائمة الخاصة: CSV فيه أرقام مكررة وغير صحيحة ثم إصدار وتدوير الروابط.
7. WhatsApp: نجاح وفشل وإعادة محاولة وعدم تكرار الناجح.
8. التذكيرات: 72/48/24 ساعة مع ساعة اختبار ومراقبة سجل Scheduler.
9. البوابة: موظف غير معيّن، تذكرة لمناسبة أخرى، مسح متزامن، ونافذة الوقت.
10. التقرير: أكثر من 500 ضيف للتأكد من pagination، وصلاحية عميل ثانٍ.

بعد النجاح فقط بدّل Moyasar إلى Live، وثبّت قناة مراقبة وتنبيهات تكلفة وأخطاء.
