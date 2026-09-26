import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppProvider, WhatsAppError } from '../../functions/messaging/whatsapp.js';

const validConfiguration = {
  accessToken: () => 'a'.repeat(64),
  phoneNumberId: () => '123456789012345',
  invitationTemplate: () => 'medad_invitation_ar',
  reminderTemplate: () => 'medad_reminder_ar',
};

test('WhatsApp Cloud provider sends only approved templates with normalized Saudi recipients', async () => {
  let request;
  const provider = createWhatsAppProvider({
    ...validConfiguration,
    apiVersion: () => 'v23.0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { messages: [{ id: 'wamid.test-message' }] };
        },
      };
    },
  });
  const result = await provider.sendTemplate({
    to: '+966 50 000 0001',
    template: 'invitation',
    variables: ['ضيف', 'مناسبة', '2030-10-20', '20:00', 'قاعة', 'https://example.test'],
  });
  assert.deepEqual(result, { provider: 'whatsapp-cloud', messageId: 'wamid.test-message' });
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456789012345/messages');
  assert.equal(request.options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.to, '966500000001');
  assert.equal(body.template.name, 'medad_invitation_ar');
  assert.equal(body.template.components[0].parameters.length, 6);
});

test('WhatsApp provider rejects unsafe configuration, recipients and provider failures', async () => {
  const invalid = createWhatsAppProvider({
    ...validConfiguration,
    accessToken: () => 'short',
    fetchImpl: async () => {
      throw new Error('must not call fetch');
    },
  });
  await assert.rejects(
    invalid.sendTemplate({ to: '+966500000001', template: 'invitation', variables: ['x'] }),
    (error) => error instanceof WhatsAppError && error.code === 'failed-precondition',
  );
  const invalidVersion = createWhatsAppProvider({
    ...validConfiguration,
    apiVersion: () => 'latest',
    fetchImpl: async () => {
      throw new Error('must not call fetch');
    },
  });
  await assert.rejects(
    invalidVersion.sendTemplate({
      to: '+966500000001',
      template: 'invitation',
      variables: ['x'],
    }),
    (error) => error instanceof WhatsAppError && error.code === 'failed-precondition',
  );
  const provider = createWhatsAppProvider({
    ...validConfiguration,
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: { message: 'Template is not approved' } };
      },
    }),
  });
  await assert.rejects(
    provider.sendTemplate({ to: '+12025550123', template: 'reminder', variables: ['x'] }),
    (error) => error instanceof WhatsAppError && error.code === 'invalid-argument',
  );
  await assert.rejects(
    provider.sendTemplate({ to: '+966500000001', template: 'reminder', variables: ['x'] }),
    (error) =>
      error instanceof WhatsAppError &&
      error.code === 'failed-precondition' &&
      error.message === 'Template is not approved',
  );
});
