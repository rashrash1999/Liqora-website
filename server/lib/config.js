"use strict";

const { AppError } = require("./errors");

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new AppError(`Missing required environment variable: ${name}`, {
            statusCode: 500,
            code: "CONFIGURATION_ERROR"
        });
    }
    return value;
}

function getConfig() {
    const channel = (process.env.UNIFONIC_CHANNEL || "sms").trim().toLowerCase();

    if (!["sms", "whatsapp"].includes(channel)) {
        throw new AppError("UNIFONIC_CHANNEL must be either sms or whatsapp", {
            statusCode: 500,
            code: "CONFIGURATION_ERROR"
        });
    }

    const config = {
        webhookSecret: requiredEnv("PAID_ORDER_WEBHOOK_SECRET"),
        notificationRecipient: requiredEnv("ORDER_ALERT_RECIPIENT"),
        channel,
        idempotencyTtlSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS || 86400)
    };

    if (!Number.isInteger(config.idempotencyTtlSeconds) || config.idempotencyTtlSeconds < 300) {
        throw new AppError("IDEMPOTENCY_TTL_SECONDS must be an integer >= 300", {
            statusCode: 500,
            code: "CONFIGURATION_ERROR"
        });
    }

    if (channel === "sms") {
        config.unifonic = {
            appSid: requiredEnv("UNIFONIC_APP_SID"),
            senderId: requiredEnv("UNIFONIC_SENDER_ID")
        };
    } else {
        config.unifonic = {
            publicId: requiredEnv("UNIFONIC_PUBLIC_ID"),
            secret: requiredEnv("UNIFONIC_SECRET"),
            templateName: requiredEnv("UNIFONIC_WHATSAPP_TEMPLATE"),
            templateLanguage: (process.env.UNIFONIC_WHATSAPP_LANGUAGE || "ar").trim()
        };
    }

    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

    config.redis = upstashUrl && upstashToken
        ? { url: upstashUrl.replace(/\/$/, ""), token: upstashToken }
        : null;

    return config;
}

module.exports = { getConfig, requiredEnv };
