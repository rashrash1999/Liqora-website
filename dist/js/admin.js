import { requireUser, authFailure } from './auth.js';
import {
  watchOrders,
  watchGuests,
  call,
  uploadFile,
  privateFileUrl,
  getFullOrderReport,
} from './firebase-client.js';
import { parseCsv, normalizeGuests, normalizeSaudiPhone } from './domain.js';
import {
  $,
  PACKAGES,
  STATUS_LABELS,
  setText,
  formatDate,
  formatMoney,
  digits,
  busy,
  showError,
  downloadCsv,
} from './platform.js';
let orders = [],
  current = null,
  guests = [],
  stopGuests,
  stopOrders,
  selection = 0;
const QUOTE_INPUTS = ['quote-additional', 'quote-discount', 'quote-tax', 'quote-valid-days'];
const paymentLabels = Object.freeze({
  unpaid: 'غير مدفوع',
  pending: 'بانتظار إكمال الدفع',
  processing: 'قيد التحقق',
  paid: 'مدفوع ومؤكد',
  failed: 'لم يكتمل',
  cancelled: 'ملغي',
  refunded: 'مسترد',
});
const automaticAmount = (order) =>
  Number(order.automaticPricing?.subtotalHalalas || order.baseAmountHalalas || 0);
function asMillis(value) {
  if (Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
  return NaN;
}
function toHalalas(value, label) {
  const normalized = digits(value).trim().replace(',', '.');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(`${label}: أدخل مبلغًا موجبًا بدقة هللتين كحد أقصى.`);
  const [riyals, fraction = ''] = normalized.split('.');
  const result = Number(riyals) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100_000_000)
    throw new Error(`${label}: المبلغ أكبر من الحد المسموح.`);
  return result;
}
function inputMoney(value) {
  return (Number(value || 0) / 100).toFixed(2).replace(/\.00$/, '');
}
function quoteValues() {
  return {
    additionalAmountHalalas: toHalalas($('quote-additional').value, 'التخصيص والإضافات'),
    discountHalalas: toHalalas($('quote-discount').value, 'الخصم'),
    taxHalalas: toHalalas($('quote-tax').value, 'الضريبة'),
  };
}
function quotePreview() {
  if (!current) return;
  try {
    const amounts = quoteValues();
    const subtotal = automaticAmount(current) + amounts.additionalAmountHalalas;
    if (amounts.discountHalalas > subtotal) throw new Error('الخصم يتجاوز المجموع.');
    const total = subtotal - amounts.discountHalalas + amounts.taxHalalas;
    setText('quote-summary', `الإجمالي الذي سيدفعه العميل: ${formatMoney(total / 100)}`);
  } catch (error) {
    setText('quote-summary', error.message);
  }
}
function renderPricing(order) {
  const pricing = order.pricing;
  const itemTotal = Array.isArray(pricing?.items)
    ? pricing.items.reduce((sum, item) => sum + Number(item.amountHalalas || 0), 0)
    : automaticAmount(order);
  $('quote-additional').value = inputMoney(Math.max(0, itemTotal - automaticAmount(order)));
  $('quote-discount').value = inputMoney(pricing?.discountHalalas);
  $('quote-tax').value = inputMoney(pricing?.taxHalalas);
  setText('quote-base', formatMoney(automaticAmount(order) / 100));
  const expiresAt = asMillis(pricing?.expiresAt);
  setText(
    'pricing-status',
    pricing?.status === 'approved'
      ? `السعر الحالي معتمد: ${formatMoney(pricing.totalHalalas / 100)}${Number.isFinite(expiresAt) ? ` — صالح حتى ${formatDate(expiresAt)}` : ''}`
      : 'لم يعتمد السعر النهائي بعد.',
  );
  const locked =
    ['paid', 'pending', 'processing'].includes(order.paymentStatus) ||
    ['active', 'cancelled', 'completed'].includes(order.status) ||
    asMillis(order.eventAt) <= Date.now();
  for (const id of QUOTE_INPUTS) $(id).disabled = locked;
  $('approve-pricing').disabled = locked;
  quotePreview();
}
function render() {
  const term = $('order-search').value.trim().toLowerCase(),
    status = $('status-filter').value;
  const visible = orders.filter(
    (o) =>
      (status === 'all' || o.status === status) &&
      `${o.id} ${o.ownerName} ${o.honorees}`.toLowerCase().includes(term),
  );
  $('orders-body').replaceChildren(
    ...visible.map((o) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-selected', o.id === current?.id);
      const td = document.createElement('td'),
        button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = `${o.ownerName} — ${o.id}`;
      button.addEventListener('click', () => select(o.id).catch(showError));
      td.append(button);
      tr.append(td);
      for (const v of [
        o.honorees,
        formatDate(o.eventDate),
        PACKAGES[o.packageId]?.name,
        STATUS_LABELS[o.status] || o.status,
      ]) {
        const n = document.createElement('td');
        n.textContent = v;
        tr.append(n);
      }
      return tr;
    }),
  );
  setText('orders-count', orders.length);
}
async function select(id) {
  current = orders.find((o) => o.id === id);
  if (!current) return;
  const epoch = ++selection;
  stopGuests?.();
  guests = [];
  const o = current;
  $('order-detail').hidden = false;
  for (const [k, v] of Object.entries({
    'detail-id': o.id,
    'detail-name': o.ownerName,
    'detail-event': o.honorees,
    'detail-date': formatDate(o.eventDate),
    'detail-package': PACKAGES[o.packageId]?.name,
    'detail-guests': o.guestCount || 0,
    'detail-seats': `${o.acceptedSeats || 0} / ${o.seatCapacity || o.expectedGuests || 0}`,
    'detail-status': STATUS_LABELS[o.status] || o.status,
    'detail-payment': paymentLabels[o.paymentStatus] || 'تحتاج مراجعة',
    'detail-design':
      o.designStatus === 'approved'
        ? 'معتمد'
        : o.designStatus === 'awaiting_approval'
          ? 'بانتظار العميل'
          : 'غير مرفوع',
  }))
    setText(k, v);
  $('detail-organization').hidden = !o.organizationName;
  setText(
    'detail-organization',
    o.organizationName
      ? `الجهة: ${o.organizationName}${o.contactEmail ? ` — ${o.contactEmail}` : ''}`
      : '',
  );
  $('contact-client').href =
    `https://wa.me/${normalizeSaudiPhone(o.phone).replace('+', '')}?text=${encodeURIComponent(`مرحبًا ${o.ownerName}، بخصوص الطلب ${o.id}.`)}`;
  $('checkin-link').href = `checkin.html?order=${encodeURIComponent(o.id)}`;
  $('guest-file').value = '';
  renderPricing(o);
  setText('upload-help', 'ارفع ملف CSV وفق القالب المرفق.');
  $('reference-links').replaceChildren(
    ...(o.referencePaths || []).map((path, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = `تنزيل الملف المرجعي ${i + 1}`;
      button.addEventListener('click', () =>
        busy(button, async () => {
          try {
            const url = await privateFileUrl(path);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reference-${i + 1}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            showError(error);
          }
        }),
      );
      return button;
    }),
  );
  render();
  const unsubscribe = await watchGuests(
    id,
    (items) => {
      if (epoch === selection) {
        guests = items;
        setText('pending-guests', items.filter((g) => g.rsvpState === 'pending').length);
      }
    },
    (error) => {
      if (epoch === selection) showError(error);
    },
  );
  if (epoch === selection) stopGuests = unsubscribe;
  else unsubscribe();
}
$('order-search').addEventListener('input', render);
$('status-filter').addEventListener('change', render);
for (const id of QUOTE_INPUTS) $(id).addEventListener('input', quotePreview);
$('approve-pricing').addEventListener('click', () =>
  busy($('approve-pricing'), async () => {
    try {
      if (!current) return;
      const days = Number($('quote-valid-days').value);
      const now = Date.now();
      const eventAt = asMillis(current.eventAt);
      if (!Number.isFinite(eventAt) || eventAt <= now + 5 * 60_000)
        throw new Error('موعد المناسبة قريب جدًا أو غير صالح لاعتماد عرض جديد.');
      const expiresAt = Math.min(now + days * 24 * 60 * 60_000, eventAt);
      const result = await call('approvePricing', {
        orderId: current.id,
        ...quoteValues(),
        expiresAt,
      });
      setText(
        'pricing-status',
        `تم اعتماد ${formatMoney(result.pricing.totalHalalas / 100)} وإتاحة الدفع للعميل.`,
      );
    } catch (error) {
      showError(error);
    }
  }),
);
$('import-guests').addEventListener('click', () =>
  busy($('import-guests'), async () => {
    let added = 0,
      skipped = 0;
    try {
      if (!current) return;
      const selected = current,
        file = $('guest-file').files[0];
      if (!file || !file.name.toLowerCase().endsWith('.csv') || file.size > 2 * 1024 * 1024)
        throw new Error('اختر ملف CSV لا يتجاوز 2MB.');
      const rows = parseCsv(await file.text()),
        seen = new Set();
      for (const row of rows) {
        const phone = normalizeSaudiPhone(row.phone);
        if (seen.has(phone)) throw new Error('يوجد رقم مكرر داخل الملف. أصلحه قبل الرفع.');
        seen.add(phone);
      }
      for (let i = 0; i < rows.length; i += 200) normalizeGuests(rows.slice(i, i + 200), selected);
      for (let i = 0; i < rows.length; i += 200) {
        const result = await call('importGuests', {
          orderId: selected.id,
          rows: rows.slice(i, i + 200),
        });
        added += result.added;
        skipped += result.skipped;
        setText('upload-help', `تم حفظ ${added} ضيف وتجاوز ${skipped} رقم موجود.`);
      }
      if (current?.id === selected.id) $('guest-file').value = '';
    } catch (error) {
      showError(
        new Error(
          `${added ? `حُفظ ${added} ضيف قبل التوقف؛ إعادة الملف لا تكررهم. ` : ''}${error.message}`,
        ),
      );
    }
  }),
);
$('upload-design').addEventListener('click', () =>
  busy($('upload-design'), async () => {
    try {
      if (!current) return;
      await uploadFile(current.id, $('design-file').files[0], 'design');
      $('design-file').value = '';
      setText('design-upload-status', 'تم رفع التصميم لإتاحة اعتماده من العميل.');
    } catch (error) {
      showError(error);
    }
  }),
);
$('issue-links').addEventListener('click', () =>
  busy($('issue-links'), async () => {
    const links = [];
    try {
      if (!current) return;
      const orderId = current.id,
        pending = guests.filter((g) => g.rsvpState === 'pending');
      if (!pending.length) throw new Error('لا يوجد ضيوف بانتظار الرد.');
      if (
        pending.some((g) => g.issuedAt) &&
        !confirm('سيُلغي تجديد الروابط الروابط السابقة للضيوف الذين لم يردوا. هل تريد المتابعة؟')
      )
        return;
      for (let i = 0; i < pending.length; i += 100) {
        const result = await call('issueInvitations', {
          orderId,
          guestIds: pending.slice(i, i + 100).map((g) => g.id),
        });
        links.push(...result.links);
      }
      setText(
        'links-status',
        `تم إنشاء ${links.length} رابط وتنزيل نسخة احتياطية. يمكنك الآن الإرسال عبر WhatsApp.`,
      );
    } catch (error) {
      showError(
        new Error(
          `${links.length ? `أُنشئ ${links.length} رابط وحُفظ في الملف الجزئي. ` : ''}${error.message}`,
        ),
      );
    } finally {
      if (links.length)
        downloadCsv('invitation-links.csv', [
          ['name', 'phone', 'invitation_url'],
          ...links.map((item) => {
            const url = new URL('invitation.html', location.href);
            url.hash = new URLSearchParams({ token: item.token });
            return [item.name, item.phone, url.href];
          }),
        ]);
    }
  }),
);
$('send-whatsapp').addEventListener('click', () =>
  busy($('send-whatsapp'), async () => {
    let sent = 0,
      failed = 0,
      skipped = 0;
    try {
      if (!current) return;
      const selected = current;
      const ready = guests.filter(
        (guest) => guest.rsvpState === 'pending' && guest.inviteVersion && guest.inviteHash,
      );
      if (!ready.length)
        throw new Error('أنشئ روابط الدعوات أولًا، ثم انتظر ظهورها واضغط الإرسال.');
      for (let index = 0; index < ready.length; index += 25) {
        const result = await call('sendInvitations', {
          orderId: selected.id,
          guestIds: ready.slice(index, index + 25).map((guest) => guest.id),
        });
        sent += result.sent;
        failed += result.failed;
        skipped += result.skipped;
        setText(
          'links-status',
          `تم إرسال ${sent}، تعذر ${failed}، وتجاوز ${skipped} رسالة مرسلة مسبقًا.`,
        );
      }
      if (failed)
        throw new Error(
          `تعذر إرسال ${failed} رسالة. راجع إعداد WhatsApp والقالب ثم أعد المحاولة؛ الرسائل الناجحة لن تتكرر.`,
        );
    } catch (error) {
      showError(error);
    }
  }),
);
$('download-order-report').addEventListener('click', () =>
  busy($('download-order-report'), async () => {
    try {
      if (!current) return;
      const report = await getFullOrderReport(current.id);
      downloadCsv(`admin-report-${current.id}.csv`, [
        [
          'الاسم',
          'رقم الجوال',
          'الرد',
          'أسماء المرافقين',
          'المقاعد',
          'الدخول',
          'عدم الحضور',
          'الرسالة',
          'المصدر',
        ],
        ...report.guests.map((guest) => [
          guest.name,
          guest.phone,
          guest.response,
          guest.companionNames.join('، '),
          guest.seats,
          guest.checkedIn ? 'نعم' : 'لا',
          guest.noShow ? 'نعم' : 'لا',
          guest.message,
          guest.source,
        ]),
      ]);
    } catch (error) {
      showError(error);
    }
  }),
);
$('export-orders').addEventListener('click', () =>
  downloadCsv('orders.csv', [
    ['معرف الطلب', 'العميل', 'المناسبة', 'التاريخ', 'حالة الدفع', 'الحالة'],
    ...orders.map((o) => [o.id, o.ownerName, o.honorees, o.eventDate, o.paymentStatus, o.status]),
  ]),
);
(async () => {
  const session = await requireUser('admin');
  if (!session) return;
  stopOrders = await watchOrders(
    session.user,
    true,
    (items) => {
      orders = items;
      render();
      $('empty-orders').hidden = items.length > 0;
      if (items.length)
        select(items.some((o) => o.id === current?.id) ? current.id : items[0].id).catch(showError);
    },
    showError,
  );
})().catch(authFailure);
addEventListener('pagehide', () => {
  stopGuests?.();
  stopOrders?.();
});
