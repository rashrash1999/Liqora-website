"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function configureEnvironment() {
    process.env.PAID_ORDER_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.ORDER_ALERT_RECIPIENT = "0501234567";
    process.env.UNIFONIC_CHANNEL = "sms";
    process.env.UNIFONIC_APP_SID = "test-app-sid";
    process.env.UNIFONIC_SENDER_ID = "LIQORA";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

function createRequest({ secret = "test-webhook-secret", eventId = "evt_handler_1" } = {}) {
    return new Request("https://example.test/api/orders/paid", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-liqora-webhook-secret": secret
        },
        body: JSON.stringify({
            eventId,
            eventType: "payment.succeeded",
            order: {
                id: "LQ-260830-9999",
                amount: 699,
                currency: "SAR",
                customerName: "عميلة اختبار",
                paymentMethod: "mada",
                paidAt: "2026-08-30T09:15:00+03:00"
            }
        })
    });
}

test("sends one notification and treats a repeated event as duplicate", async () => {
    configureEnvironment();
    const { default: endpoint } = await import("../api/orders/paid.mjs");
    const originalFetch = global.fetch;
    const calls = [];

    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            success: true,
            data: { MessageID: 123456 }
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    };

    try {
        const firstResponse = await endpoint.fetch(createRequest());
        const firstPayload = await firstResponse.json();

        assert.equal(firstResponse.status, 200);
        assert.equal(firstPayload.ok, true);
        assert.equal(firstPayload.duplicate, false);
        assert.equal(firstPayload.notification.channel, "sms");
        assert.equal(calls.length, 1);

        const secondResponse = await endpoint.fetch(createRequest());
        const secondPayload = await secondResponse.json();

        assert.equal(secondResponse.status, 200);
        assert.equal(secondPayload.duplicate, true);
        assert.equal(calls.length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test("rejects an invalid webhook secret", async () => {
    configureEnvironment();
    const { default: endpoint } = await import("../api/orders/paid.mjs");
    const response = await endpoint.fetch(createRequest({
        secret: "wrong-secret",
        eventId: "evt_handler_2"
    }));

    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "UNAUTHORIZED");
});
