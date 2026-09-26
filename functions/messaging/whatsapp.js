export class WhatsAppError extends Error {
  constructor(message, code = 'unavailable', status = 0) {
    super(message);
    this.name = 'WhatsAppError';
    this.code = code;
    this.status = status;
  }
}

function configuration(value, label, pattern) {
  const result = typeof value === 'function' ? value() : value;
  if (typeof result !== 'string' || !pattern.test(result))
    throw new WhatsAppError(`${label} غير مهيأ.`, 'failed-precondition');
  return result;
}

export function createWhatsAppProvider({
  accessToken,
  phoneNumberId,
  invitationTemplate,
  reminderTemplate,
  apiVersion = 'v22.0',
  fetchImpl = globalThis.fetch,
}) {
  async function sendTemplate({ to, template, variables, languageCode = 'ar' }) {
    const token = configuration(accessToken, 'رمز WhatsApp Business', /^.{40,}$/);
    const sender = configuration(phoneNumberId, 'معرف رقم WhatsApp Business', /^\d{5,30}$/);
    const graphVersion = configuration(apiVersion, 'إصدار Meta Graph API', /^v\d{1,3}\.\d{1,2}$/);
    const templateName = configuration(
      template === 'invitation' ? invitationTemplate : reminderTemplate,
      'قالب رسالة WhatsApp',
      /^[a-z0-9_]{3,80}$/,
    );
    const recipient = String(to || '').replace(/\D/g, '');
    if (!/^9665\d{8}$/.test(recipient))
      throw new WhatsAppError('رقم المستلم غير صالح.', 'invalid-argument');
    if (!Array.isArray(variables) || variables.length < 1 || variables.length > 10)
      throw new WhatsAppError('متغيرات قالب الرسالة غير صحيحة.', 'invalid-argument');
    const response = await fetchImpl(
      `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${sender}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: 'body',
                parameters: variables.map((value) => ({ type: 'text', text: String(value) })),
              },
            ],
          },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.messages?.[0]?.id)
      throw new WhatsAppError(
        payload.error?.message || 'تعذر إرسال رسالة WhatsApp.',
        response.status === 400 ? 'failed-precondition' : 'unavailable',
        response.status,
      );
    return { provider: 'whatsapp-cloud', messageId: payload.messages[0].id };
  }
  return { sendTemplate };
}
