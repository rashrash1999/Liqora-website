"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSmsBody, buildWhatsAppPayload } = require("../server/lib/unifonic");

const order = {
    id: "LQ-260830-1234",
    amount: 399,
    currency: "SAR",
    customerName: "سارة أحمد",
    paymentMethod: "mada",
    paidAt: "2026-08-30T09:15:00+03:00"
};

test("builds a readable SMS alert", () => {
    const message = buildSmsBody(order);
    assert.match(message, /LQ-260830-1234/);
    assert.match(message, /399 SAR/);
    assert.match(message, /mada/);
});

test("builds the configured WhatsApp template payload", () => {
    const payload = buildWhatsAppPayload("+966501234567", order, {
        templateName: "paid_order_alert",
        templateLanguage: "ar"
    });

    assert.equal(payload.recipient.channel, "whatsapp");
    assert.equal(payload.content.name, "paid_order_alert");
    assert.equal(payload.content.components[0].parameters.length, 6);
});
