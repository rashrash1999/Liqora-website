import { requireUser, authFailure } from './auth.js';
import { watchOrders, watchGuests, call, privateFileUrl, uploadFile } from './firebase-client.js';
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
      g.rsvpState === 'yes' ? 'حاضر' : g.rsvpState === 'no' ? 'معتذر' : 'لم يرد',
      g.companions,
      g.checkedInAt ? 'دخل' : '—',
      g.message || '',
    ]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    return tr;
  });
  $('guests-body').replaceChildren(...rows);
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
  const values = {
    'dashboard-title': `مناسبة ${order.honorees}`,
    'dashboard-status': STATUS_LABELS[order.status] || 'قيد المراجعة',
    'payment-status': order.paymentStatus === 'paid' ? 'الدفع مؤكد' : 'لم يتم الدفع',
    'order-id': id,
    'event-date': `${formatDate(order.eventDate)}، ${order.eventTime} بتوقيت الرياض`,
    'event-venue': `${order.venueName}، ${order.city}`,
    'package-name': PACKAGES[order.packageId]?.name,
    'order-total': formatMoney(order.baseAmountHalalas / 100),
    'guest-total': order.guestCount || 0,
    'guest-accepted': order.acceptedCount || 0,
    'guest-declined': order.declinedCount || 0,
    'guest-checked': order.checkedInCount || 0,
    'guest-pending': Math.max(
      0,
      (order.guestCount || 0) - (order.acceptedCount || 0) - (order.declinedCount || 0),
    ),
    'reminder-status':
      order.reminderStatus === 'requested'
        ? 'طلب محفوظ؛ لم تتم جدولة الإرسال'
        : 'لا يوجد طلب تذكير',
    'design-status':
      order.designStatus === 'approved'
        ? 'اعتمدت التصميم'
        : order.designStatus === 'awaiting_approval'
          ? 'تصميم بانتظار اعتمادك'
          : 'لم يجهز التصميم بعد',
  };
  Object.entries(values).forEach(([k, v]) => setText(k, v));
  $('checkout-link').href = `checkout.html?order=${encodeURIComponent(id)}`;
  $('contact-admin').href =
    `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(`أرغب بمتابعة طلبي ${id}`)}`;
  $('reminder-hours').value = String(order.reminderHours || 48);
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
      await call('saveReminderPreference', {
        orderId: current.id,
        hours: Number($('reminder-hours').value),
      });
      setText('reminder-status', 'تم حفظ طلب التذكير. الإرسال الآلي غير متاح حاليًا.');
    } catch (error) {
      showError(error);
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
  downloadCsv('guests.csv', [
    ['الاسم', 'الجوال المخفي', 'الرد', 'المرافقون', 'الدخول'],
    ...guests.map((g) => [
      g.displayName,
      g.phoneMasked,
      g.rsvpState,
      g.companions,
      g.checkedInAt ? 'نعم' : 'لا',
    ]),
  ]),
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
