# ربط Firebase خطوة بخطوة

## الوضع الحالي

المشروع المستهدف من صورتك هو `medadaltahaya`. أُعدت الشيفرة للربط، لكن `enabled:false` مقصود لأن إعداد التطبيق غير متاح. لم يتم الدخول إلى حسابك أو إنشاء قاعدة أو تعديل خطة أو نشر ملفات. يمكن إبقاء الواجهة على GitHub Pages.

## 1. تجهيز مشروع تجريبي والخدمات

- استخدم Node.js 22 وJava 21 فأعلى. نفّذ `npm ci` ثم `npm test` ثم `npm run test:integration`، وعالج أي فشل قبل النشر.
- من Firebase > Project settings > Your apps أضف تطبيق Web إذا لم يوجد، وانسخ كائن `firebaseConfig` كما هو إلى `js/firebase-config.js`. لا تخمّن storageBucket أو appId.
- الإعداد المطلوب: apiKey وauthDomain وprojectId وstorageBucket وmessagingSenderId وappId. هذا إعداد تطبيق عام؛ لا تضع فيه حساب خدمة أو مفتاحًا خاصًا أو أسرار الدفع.
- فعّل Authentication: Phone للعملاء وEmail/Password للإدارة والبوابة. أضف `rashrash1999.github.io` إلى Authorized domains، وأي نطاق آخر تستضيف عليه. استخدم أرقام الاختبار الرسمية في مرحلة التطوير.
- أنشئ Firestore وStorage، واختر منطقة البيانات بعناية. الدوال معدة على `europe-west1`؛ إن غيّرتها فطابق `functions/index.js` و`js/firebase-config.js`.
- سجّل تطبيق الويب في App Check باستخدام reCAPTCHA Enterprise، واضبط النطاق ثم ضع مفتاح الموقع العام في appCheckSiteKey. الدوال تفرض App Check في الإنتاج؛ لا تعطّله لتجاوز مشكلة الإعداد.
- يتطلب هذا التصميم خطة Blaze لتشغيل Cloud Functions وSMS؛ راجع متطلبات Storage الحالية أيضًا. لا تغيّر الخطة دون قرارك، وضع تنبيهات ميزانية. التنبيه ليس حدًا مضمونًا لإيقاف الإنفاق.

## 2. المفتاح الخادمي والنشر

بعد تسجيل الدخول بحساب مالك المشروع من جهاز موثوق:

```sh
npx firebase login
npx firebase use medadaltahaya
npx firebase functions:secrets:set TICKET_SIGNING_KEY --project medadaltahaya
```

أدخل سرًا عشوائيًا قويًا بطول 32 بايت على الأقل. لا تضعه في الواجهة أو GitHub أو ترسله في المحادثة. احتفظ به بأمان؛ تغييره يؤثر في بطاقات قائمة.

```sh
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project medadaltahaya
```

النشر أعلاه خطوة ينفذها المشغّل بعد نجاح الاختبارات. قد يطلب Firebase منح Storage صلاحية قراءة Firestore للتحقق من حجوزات الرفع. راجع رسائل CLI ولا تنشر قواعد مفتوحة لتجاوزها.

طبّق CORS للوصول إلى الملفات الخاصة من الواجهة، مع استبدال BUCKET_NAME بالقيمة الفعلية من firebaseConfig:

```sh
gcloud storage buckets update gs://BUCKET_NAME --cors-file=storage.cors.json
```

CORS لا يمنح صلاحية قراءة البيانات؛ قواعد Storage هي التي تحكمها. أضف نطاقك الفعلي إلى ملف CORS عند استخدام نطاق آخر.

## 3. إعداد موظفي الإدارة والبوابة

أنشئ حسابات الموظفين من Authentication. الأدوات التالية تعمل من جهاز مسؤول باستخدام Application Default Credentials موثوقة وصلاحيات مناسبة. لا تضع ملف الاعتماد في المشروع أو المتصفح.

```sh
gcloud auth application-default login
node scripts/set-role.mjs medadaltahaya ADMIN_UID admin
node scripts/set-role.mjs medadaltahaya GATE_UID gate
node scripts/assign-gate.mjs medadaltahaya GATE_UID ORDER_ID grant
```

استبدل القيم بمعرفات الحسابات والطلب الصحيحة. إعادة دور customer تسحب admin/gate. تغيير الدور يلغي جلسات التحديث؛ يسجل الموظف الدخول من جديد. استخدم revoke بدل grant لسحب تعيين البوابة.

## 4. تفعيل الواجهة والتحقق

بعد نشر الخلفية وضبط Auth وApp Check وCORS، اجعل enabled:true ثم نفّذ npm run build وارفع ملفات الواجهة إلى استضافتك. لا ترفع node_modules أو ملفات اعتماد. تشمل الملفات المنشورة js/vendor/firebase.js.

تحقق في مشروع تجريبي من: دخول SMS، رفض صاحب حساب آخر لطلب لا يملكه، إنشاء الطلب مرة واحدة عند النقر المتكرر، رفع خاص صحيح ورفض ملف غير مسموح، رفض إنشاء روابط قبل الدفع والاعتماد، رد متزامن مرة واحدة، ورفض موظف غير معيّن وتذكرة لمناسبة أخرى.

لأن بوابة الدفع لم تُنفذ، لا يوجد حاليًا مسار تجاري مكتمل من طلب جديد إلى دعوة نشطة. يمكن إعداد بيانات الاختبار بواسطة أدوات موثوقة في مشروع تجريبي فقط؛ لا تعتمد تغيير حالة الدفع يدويًا كعملية إنتاج.

## ما تحتاج إرساله لاستكمال إعداد الشيفرة

انسخ firebaseConfig من إعداد تطبيق الويب، وأرسل مفتاح موقع App Check العام إن تم إنشاؤه. لا ترسل كلمة مرورك أو مفاتيح خاصة أو JSON لحساب الخدمة. يلزم أيضًا اختيار مزود الدفع والرسائل إذا أردت تنفيذ هذين المسارين.

## مراجع رسمية

- [إعداد تطبيق الويب](https://firebase.google.com/docs/web/setup)
- [الدخول بالجوال](https://firebase.google.com/docs/auth/web/phone-auth)
- [حصص المصادقة ومتطلبات SMS](https://firebase.google.com/docs/auth/limits)
- [إعداد الدوال ومتطلب Blaze](https://firebase.google.com/docs/functions/get-started)
- [اختبارات قواعد الأمان](https://firebase.google.com/docs/rules/unit-tests)
- [App Check للدوال](https://firebase.google.com/docs/app-check/cloud-functions)
- [الصلاحيات المخصصة](https://firebase.google.com/docs/auth/admin/custom-claims)
