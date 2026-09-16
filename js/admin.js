import { requireUser, authFailure } from './auth.js';
import { watchOrders, watchGuests, call, uploadFile, privateFileUrl } from './firebase-client.js';
import { parseCsv, normalizeGuests, normalizeSaudiPhone } from './domain.js';
import {
  $,
  PACKAGES,
  STATUS_LABELS,
  setText,
  formatDate,
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
    'detail-status': STATUS_LABELS[o.status] || o.status,
    'detail-payment': o.paymentStatus === 'paid' ? 'مدفوع' : 'غير مدفوع',
    'detail-design':
      o.designStatus === 'approved'
        ? 'معتمد'
        : o.designStatus === 'awaiting_approval'
          ? 'بانتظار العميل'
          : 'غير مرفوع',
  }))
    setText(k, v);
  $('contact-client').href =
    `https://wa.me/${normalizeSaudiPhone(o.phone).replace('+', '')}?text=${encodeURIComponent(`مرحبًا ${o.ownerName}، بخصوص الطلب ${o.id}.`)}`;
  $('checkin-link').href = `checkin.html?order=${encodeURIComponent(o.id)}`;
  $('guest-file').value = '';
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
        `تم إنشاء ${links.length} رابط. نزّل الملف وشاركه يدويًا مع الضيوف المقصودين؛ الإرسال الآلي غير مفعّل.`,
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
