import { requireUser, authFailure } from './auth.js';
import {
  watchOrders,
  watchGuests,
  call,
  privateFileUrl,
  uploadFile,
  getFullOrderReport,
} from './firebase-client.js';
import {
  $,
  PACKAGES,
  CONFIG,
  STATUS_LABELS,
  setText,
  formatDate,
  formatMoney,
  busy,
  showError,
  downloadCsv,
} from './platform.js';
let orders = [],
  current = null,
  guests = [],
  stopGuests,
  stopOrders,
  designObjectUrl,
  selection = 0,
  loadedDesignVersion = null;
function renderGuests(items) {
  guests = items;
  const rows = items.map((g) => {
    const tr = document.createElement('tr');
    for (const value of [
      g.displayName,
      g.phoneMasked,
      g.rsvpState === 'yes'
        ? 'حاضر'
        : g.rsvpState === 'no'
          ? 'معتذر'
          : g.rsvpState === 'waitlist'
            ? 'قائمة انتظار'
            : 'لم يرد',
      (g.companionNames || []).join('، ') || (g.companions ? `${g.companions} مرافق` : '—'),
      g.checkedInAt ? 'دخل' : '—',
      g.message || '',
    ]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    const actionCell = document.createElement('td');
    if (g.rsvpState !== 'pending') {
      const reopen = document.createElement('button');
      reopen.type = 'button';
      reopen.className = 'text-button';
      reopen.textContent = 'إعادة فتح الرد';
      reopen.addEventListener('click', () =>
        busy(reopen, async () => {
          try {
            await call('reopenRsvp', { orderId: current.id, guestId: g.id });
          } catch (error) {
            showError(error);
          }
        }),
      );
      actionCell.append(reopen);
    } else actionCell.textContent = '—';
    tr.append(actionCell);
    return tr;
  });
  $('guests-body').replaceChildren(...rows);
}
function setShareLink(token, mode) {
  const url = new URL('join.html', location.href);
  url.hash = new URLSearchParams({ token });
  $('share-link').value = url.href;
  $('copy-share-link').disabled = false;
  setText(
    'share-help',
    mode === 'open'
      ? 'شارك هذا الرابط؛ يتحقق الضيف من جواله ثم يسجل رده ومرافقيه.'
      : 'هذا رابط تعريف بالمناسبة فقط. استخدم الروابط الشخصية للضيوف الموجودين في قائمتك.',
  );
}
async function select(id) {
  const order = orders.find((o) => o.id === id);
  if (!order) return;
  current = order;
  const epoch = ++selection;
  loadedDesignVersion = null;
  if (stopGuests) stopGuests();
  if (designObjectUrl) {
    URL.revokeObjectURL(designObjectUrl);
    designObjectUrl = null;
  }
  $('order-content').hidden = false;
  $('customer-orders').value = id;
  const seatCapacity = order.seatCapacity || order.expectedGuests || 1;
  const capacityRatio = (order.acceptedSeats || 0) / seatCapacity;
  const capacityAlert =
    capacityRatio >= 1
      ? ' تنبيه: اكتملت السعة.'
      : capacityRatio >= 0.9
        ? ' تنبيه: تجاوز الحجز 90% من السعة.'
        : capacityRatio >= 0.8
          ? ' تنبيه: تجاوز الحجز 80% من السعة.'
          : '';
  const values = {
    'dashboard-title': `مناسبة ${order.honorees}`,
    'dashboard-status': STATUS_LABELS[order.status] || 'قيد المراجعة',
    'payment-status': order.paymentStatus === 'paid' ? 'الدفع مؤكد' : 'لم يتم الدفع',
    'order-id': id,
    'event-date': `${formatDate(order.eventDate)}، ${order.eventTime} بتوقيت الرياض`,
    'event-venue': `${order.venueName}، ${order.city}`,
    'package-name': PACKAGES[order.packageId]?.name,
    'order-total': formatMoney(
      (order.pricing?.totalHalalas ||
        order.automaticPricing?.subtotalHalalas ||
        order.baseAmountHalalas) / 100,
    ),
    'guest-total': order.guestCount || 0,
    'guest-accepted': order.acceptedSeats || 0,
    'guest-declined': order.declinedCount || 0,
    'guest-checked': order.checkedInSeats || order.checkedInCount || 0,
    'guest-pending': Math.max(
      0,
      (order.guestCount || 0) -
        (order.acceptedCount || 0) -
        (order.declinedCount || 0) -
        (order.waitlistCount || 0),
    ),
    'reminder-status':
      order.reminderStatus === 'scheduled'
        ? 'التذكيرات مجدولة للمناسبة المنشورة.'
        : order.reminderStatus === 'configured'
          ? 'تم حفظ المواعيد؛ تبدأ الجدولة عند نشر المناسبة.'
          : order.reminderStatus === 'completed'
            ? 'اكتمل جدول التذكيرات.'
            : 'لم يحفظ الجدول بعد.',
    'design-status':
      order.designStatus === 'approved'
        ? 'اعتمدت التصميم'
        : order.designStatus === 'awaiting_approval'
          ? 'تصميم بانتظار اعتمادك'
          : order.designStatus === 'awaiting_design'
            ? 'بانتظار تجهيز التصميم المخصص'
            : 'لم يجهز التصميم بعد',
    'capacity-value': `${order.acceptedSeats || 0} / ${order.seatCapacity || order.expectedGuests || 0}`,
    'capacity-note': `أرقام مسجلة: ${order.guestCount || 0} من ${order.invitationLimit || order.expectedGuests}. قائمة الانتظار: ${order.waitlistCount || 0}.${capacityAlert}`,
  };
  Object.entries(values).forEach(([k, v]) => setText(k, v));
  $('checkout-link').href = `checkout.html?order=${encodeURIComponent(id)}`;
  $('contact-admin').href =
    `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(`أرغب بمتابعة طلبي ${id}`)}`;
  const reminderValues = new Set(
    Array.isArray(order.reminderHours)
      ? order.reminderHours.map(Number)
      : [Number(order.reminderHours || 48)],
  );
  document
    .querySelectorAll('#dashboard-reminders input')
    .forEach((input) => (input.checked = reminderValues.has(Number(input.value))));
  $('capacity-progress').value = Math.min(
    100,
    Math.round(((order.acceptedSeats || 0) / seatCapacity) * 100),
  );
  $('publish-event').disabled =
    order.paymentStatus !== 'paid' ||
    order.designStatus !== 'approved' ||
    (order.registrationMode === 'private' && !(order.guestCount > 0));
  $('share-link').value = '';
  $('copy-share-link').disabled = true;
  $('approve-design').disabled = true;
  $('design-preview').hidden = true;
  renderGuests([]);
  const unsubscribe = await watchGuests(
    id,
    (items) => {
      if (epoch === selection) renderGuests(items);
    },
    (error) => {
      if (epoch === selection) showError(error);
    },
  );
  if (epoch !== selection) {
    unsubscribe();
    return;
  }
  stopGuests = unsubscribe;
  if (order.designPath) {
    try {
      const url = await privateFileUrl(order.designPath);
      if (epoch !== selection) {
        URL.revokeObjectURL(url);
        return;
      }
      designObjectUrl = url;
      $('design-preview').src = url;
      $('design-preview').hidden = false;
      loadedDesignVersion = order.designVersion;
      $('approve-design').disabled =
        order.designStatus === 'approved' || order.paymentStatus !== 'paid';
    } catch (error) {
      if (epoch === selection) showError(error);
    }
  }
  if (order.status === 'active') {
    try {
      const published = await call('publishEvent', { orderId: order.id });
      if (epoch === selection) setShareLink(published.token, published.registrationMode);
    } catch (error) {
      if (epoch === selection) setText('share-status', error.message);
    }
  }
}
async function receive(items) {
  orders = items;
  $('empty-orders').hidden = items.length > 0;
  if (!items.length) {
    current = null;
    $('order-content').hidden = true;
    return;
  }
  const options = items.map((o) => {
    const n = document.createElement('option');
    n.value = o.id;
    n.textContent = `${o.honorees} — ${o.id}`;
    return n;
  });
  $('customer-orders').replaceChildren(...options);
  const requested = new URLSearchParams(location.search).get('order');
  const id = items.some((o) => o.id === current?.id)
    ? current.id
    : items.some((o) => o.id === requested)
      ? requested
      : items[0].id;
  await select(id);
}
$('customer-orders').addEventListener('change', (event) =>
  select(event.target.value).catch(showError),
);
$('save-reminder').addEventListener('click', () =>
  busy($('save-reminder'), async () => {
    try {
      if (!current) return;
      const hours = [...document.querySelectorAll('#dashboard-reminders input:checked')].map(
        (input) => Number(input.value),
      );
      if (!hours.length) throw new Error('اختر موعد تذكير واحدًا على الأقل.');
      await call('saveReminderPreference', {
        orderId: current.id,
        hours,
      });
      setText(
        'reminder-status',
        current.status === 'active'
          ? 'تم تحديث جدول التذكيرات للمناسبة المنشورة.'
          : 'تم حفظ المواعيد؛ تبدأ الجدولة عند نشر المناسبة وربط مزود الرسائل.',
      );
    } catch (error) {
      showError(error);
    }
  }),
);
$('publish-event').addEventListener('click', () =>
  busy($('publish-event'), async () => {
    try {
      if (!current) return;
      const published = await call('publishEvent', { orderId: current.id });
      setShareLink(published.token, published.registrationMode);
      setText(
        'share-status',
        published.replayed ? 'المناسبة منشورة بالفعل.' : 'تم نشر المناسبة بنجاح.',
      );
    } catch (error) {
      showError(error);
    }
  }),
);
$('copy-share-link').addEventListener('click', () =>
  busy($('copy-share-link'), async () => {
    try {
      await navigator.clipboard.writeText($('share-link').value);
      setText('share-status', 'تم نسخ الرابط.');
    } catch {
      $('share-link').select();
      setText('share-status', 'حدّد الرابط وانسخه يدويًا.');
    }
  }),
);
$('approve-design').addEventListener('click', () =>
  busy($('approve-design'), async () => {
    try {
      if (!current || !loadedDesignVersion) return;
      await call('approveDesign', { orderId: current.id, version: loadedDesignVersion });
      setText('design-status', 'تم اعتماد التصميم.');
    } catch (error) {
      showError(error);
    }
  }),
);
$('upload-reference').addEventListener('click', () =>
  busy($('upload-reference'), async () => {
    try {
      if (!current) return;
      await uploadFile(current.id, $('reference-file').files[0]);
      $('reference-file').value = '';
      setText('reference-status', 'تم حفظ الملف المرجعي.');
    } catch (error) {
      showError(error);
    }
  }),
);
$('export-guests').addEventListener('click', () =>
  busy($('export-guests'), async () => {
    try {
      if (!current) return;
      const report = await getFullOrderReport(current.id);
      downloadCsv(`report-${current.id}.csv`, [
        [
          'الاسم',
          'رقم الجوال',
          'الرد',
          'أسماء المرافقين',
          'عدد المقاعد',
          'الدخول',
          'عدم الحضور',
          'الرسالة',
        ],
        ...report.guests.map((g) => [
          g.name,
          g.phone,
          g.response,
          g.companionNames.join('، '),
          g.seats,
          g.checkedIn ? 'نعم' : 'لا',
          g.noShow ? 'نعم' : 'لا',
          g.message,
        ]),
      ]);
    } catch (error) {
      showError(error);
    }
  }),
);
(async () => {
  const session = await requireUser();
  if (!session) return;
  stopOrders = await watchOrders(
    session.user,
    false,
    (items) => receive(items).catch(showError),
    showError,
  );
})().catch(authFailure);
addEventListener('pagehide', () => {
  stopGuests?.();
  stopOrders?.();
  if (designObjectUrl) URL.revokeObjectURL(designObjectUrl);
});
