"use strict";

const { AppError } = require("./errors");

const MAX_TEXT_LENGTH = 200;

function asString(value, field, { required = true, maxLength = MAX_TEXT_LENGTH } = {}) {
    if (value === undefined || value === null || value === "") {
        if (!required) return "";
        throw new AppError(`Missing field: ${field}`, {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field }
        });
    }

    const text = String(value).trim();
    if (!text && required) {
        throw new AppError(`Missing field: ${field}`, {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field }
        });
    }

    if (text.length > maxLength) {
        throw new AppError(`Field is too long: ${field}`, {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field, maxLength }
        });
    }

    return text;
}

function normalizeAmount(value) {
    const amount = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new AppError("order.amount must be a non-negative number", {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field: "order.amount" }
        });
    }
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(value) {
    const currency = asString(value || "SAR", "order.currency", { maxLength: 3 }).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new AppError("order.currency must be a 3-letter ISO currency code", {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field: "order.currency" }
        });
    }
    return currency;
}

function normalizeIsoDate(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError("order.paidAt must be a valid date", {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field: "order.paidAt" }
        });
    }
    return date.toISOString();
}

function validatePaidOrderPayload(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new AppError("Request body must be a JSON object", {
            statusCode: 400,
            code: "INVALID_PAYLOAD"
        });
    }

    const eventType = asString(input.eventType, "eventType", { maxLength: 80 });
    if (eventType !== "payment.succeeded") {
        throw new AppError("Unsupported eventType", {
            statusCode: 422,
            code: "UNSUPPORTED_EVENT",
            details: { eventType }
        });
    }

    const order = input.order;
    if (!order || typeof order !== "object" || Array.isArray(order)) {
        throw new AppError("Missing field: order", {
            statusCode: 400,
            code: "INVALID_PAYLOAD",
            details: { field: "order" }
        });
    }

    return {
        eventId: asString(input.eventId, "eventId", { maxLength: 120 }),
        eventType,
        order: {
            id: asString(order.id, "order.id", { maxLength: 120 }),
            amount: normalizeAmount(order.amount),
            currency: normalizeCurrency(order.currency),
            customerName: asString(order.customerName || "غير محدد", "order.customerName", {
                required: false,
                maxLength: 120
            }) || "غير محدد",
            customerPhone: asString(order.customerPhone, "order.customerPhone", {
                required: false,
                maxLength: 30
            }),
            paymentMethod: asString(order.paymentMethod || "غير محدد", "order.paymentMethod", {
                required: false,
                maxLength: 80
            }) || "غير محدد",
            paidAt: normalizeIsoDate(order.paidAt)
        }
    };
}

function normalizeSaudiPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (/^9665\d{8}$/.test(digits)) return digits;
    if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
    if (/^5\d{8}$/.test(digits)) return `966${digits}`;
    return "";
}

module.exports = {
    validatePaidOrderPayload,
    normalizeSaudiPhone,
    normalizeAmount,
    normalizeCurrency
};
