"use strict";

const { AppError } = require("./errors");
const { normalizeSaudiPhone } = require("./validation");

const SMS_ENDPOINT = "https://el.cloud.unifonic.com/rest/SMS/messages";
const WHATSAPP_ENDPOINT = "https://apis.unifonic.com/v1/messages";

function formatPaidAt(isoDate) {
    return new Intl.DateTimeFormat("ar-SA", {
        timeZone: "Asia/Riyadh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(isoDate));
}

function buildSmsBody(order) {
    return [
        "🟢 طلب مدفوع جديد",
        `رقم الطلب: ${order.id}`,
        `المبلغ: ${order.amount} ${order.currency}`,
        `العميل: ${order.customerName}`,
        `طريقة الدفع: ${order.paymentMethod}`,
        `وقت الدفع: ${formatPaidAt(order.paidAt)}`
    ].join("\n");
}

function buildWhatsAppPayload(recipient, order, unifonic) {
    return {
        recipient: {
            contact: recipient,
            channel: "whatsapp"
        },
        content: {
            type: "template",
            name: unifonic.templateName,
            language: { code: unifonic.templateLanguage },
            components: [
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: order.id },
                        { type: "text", text: String(order.amount) },
                        { type: "text", text: order.currency },
                        { type: "text", text: order.customerName },
                        { type: "text", text: order.paymentMethod },
                        { type: "text", text: formatPaidAt(order.paidAt) }
                    ]
                }
            ]
        }
    };
}

async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text.slice(0, 500) };
    }
}

async function sendSmsAlert({ recipient, order, unifonic, fetchImpl = fetch }) {
    const normalizedRecipient = normalizeSaudiPhone(recipient);
    if (!normalizedRecipient) {
        throw new AppError("ORDER_ALERT_RECIPIENT must be a valid Saudi mobile number", {
            statusCode: 500,
            code: "CONFIGURATION_ERROR"
        });
    }

    const body = new URLSearchParams({
        AppSid: unifonic.appSid,
        SenderID: unifonic.senderId,
        Recipient: normalizedRecipient,
        Body: buildSmsBody(order),
        CorrelationID: `paid-order:${order.id}`
    });

    const response = await fetchImpl(SMS_ENDPOINT, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    });

    const payload = await parseResponse(response);
    if (!response.ok || payload?.success === false) {
        throw new AppError("Unifonic SMS request failed", {
            statusCode: 502,
            code: "UNIFONIC_ERROR",
            details: { status: response.status, errorCode: payload?.errorCode || null }
        });
    }

    return {
        channel: "sms",
        providerMessageId: payload?.data?.MessageID ? String(payload.data.MessageID) : null
    };
}

async function sendWhatsAppAlert({ recipient, order, unifonic, fetchImpl = fetch }) {
    const normalizedRecipient = normalizeSaudiPhone(recipient);
    if (!normalizedRecipient) {
        throw new AppError("ORDER_ALERT_RECIPIENT must be a valid Saudi mobile number", {
            statusCode: 500,
            code: "CONFIGURATION_ERROR"
        });
    }

    const response = await fetchImpl(WHATSAPP_ENDPOINT, {
        method: "POST",
        headers: {
            PublicId: unifonic.publicId,
            Secret: unifonic.secret,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(buildWhatsAppPayload(`+${normalizedRecipient}`, order, unifonic))
    });

    const payload = await parseResponse(response);
    if (!response.ok) {
        throw new AppError("Unifonic WhatsApp request failed", {
            statusCode: 502,
            code: "UNIFONIC_ERROR",
            details: { status: response.status }
        });
    }

    return {
        channel: "whatsapp",
        providerMessageId: payload?.messageId ? String(payload.messageId) : null
    };
}

async function sendPaidOrderAlert(options) {
    if (options.channel === "whatsapp") return sendWhatsAppAlert(options);
    return sendSmsAlert(options);
}

module.exports = {
    SMS_ENDPOINT,
    WHATSAPP_ENDPOINT,
    buildSmsBody,
    buildWhatsAppPayload,
    sendSmsAlert,
    sendWhatsAppAlert,
    sendPaidOrderAlert
};
