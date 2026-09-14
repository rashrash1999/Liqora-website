"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePaidOrderPayload, normalizeSaudiPhone } = require("../server/lib/validation");

const validPayload = {
    eventId: "evt_123",
    eventType: "payment.succeeded",
    order: {
        id: "LQ-260830-1234",
        amount: 399,
        currency: "SAR",
        customerName: "سارة أحمد",
        paymentMethod: "mada",
        paidAt: "2026-08-30T09:15:00+03:00"
    }
};

test("validates a paid order event", () => {
    const result = validatePaidOrderPayload(validPayload);
    assert.equal(result.order.id, "LQ-260830-1234");
    assert.equal(result.order.amount, 399);
    assert.equal(result.order.currency, "SAR");
});

test("rejects unsupported events", () => {
    assert.throws(
        () => validatePaidOrderPayload({ ...validPayload, eventType: "payment.failed" }),
        (error) => error.code === "UNSUPPORTED_EVENT" && error.statusCode === 422
    );
});

test("normalizes Saudi mobile numbers", () => {
    assert.equal(normalizeSaudiPhone("0501234567"), "966501234567");
    assert.equal(normalizeSaudiPhone("+966 50 123 4567"), "966501234567");
    assert.equal(normalizeSaudiPhone("501234567"), "966501234567");
    assert.equal(normalizeSaudiPhone("123"), "");
});
