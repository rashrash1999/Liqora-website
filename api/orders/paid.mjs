import { randomUUID } from "node:crypto";
import configModule from "../../server/lib/config.js";
import errorsModule from "../../server/lib/errors.js";
import idempotencyModule from "../../server/lib/idempotency.js";
import securityModule from "../../server/lib/security.js";
import unifonicModule from "../../server/lib/unifonic.js";
import validationModule from "../../server/lib/validation.js";

const { getConfig } = configModule;
const { AppError } = errorsModule;
const { acquireIdempotencyKey, releaseIdempotencyKey } = idempotencyModule;
const { verifySharedSecret } = securityModule;
const { sendPaidOrderAlert } = unifonicModule;
const { validatePaidOrderPayload } = validationModule;

function jsonResponse(status, payload, extraHeaders = {}) {
    return Response.json(payload, {
        status,
        headers: {
            "Cache-Control": "no-store",
            ...extraHeaders
        }
    });
}

async function parseJsonBody(request) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
        throw new AppError("Content-Type must be application/json", {
            statusCode: 415,
            code: "UNSUPPORTED_MEDIA_TYPE"
        });
    }

    try {
        return await request.json();
    } catch {
        throw new AppError("Invalid JSON body", {
            statusCode: 400,
            code: "INVALID_JSON"
        });
    }
}

async function handlePaidOrder(request) {
    const requestId = randomUUID();
    let idempotencyKey = null;
    let config = null;

    try {
        if (request.method !== "POST") {
            return jsonResponse(405, {
                ok: false,
                requestId,
                error: {
                    code: "METHOD_NOT_ALLOWED",
                    message: "Method not allowed"
                }
            }, { Allow: "POST" });
        }

        config = getConfig();
        const receivedSecret = request.headers.get("x-liqora-webhook-secret") || "";

        if (!verifySharedSecret(receivedSecret, config.webhookSecret)) {
            throw new AppError("Unauthorized webhook", {
                statusCode: 401,
                code: "UNAUTHORIZED"
            });
        }

        const event = validatePaidOrderPayload(await parseJsonBody(request));
        idempotencyKey = `liqora:paid-order:${event.eventId}`;

        const acquired = await acquireIdempotencyKey(
            idempotencyKey,
            config.idempotencyTtlSeconds,
            config.redis
        );

        if (!acquired) {
            return jsonResponse(200, {
                ok: true,
                duplicate: true,
                requestId,
                eventId: event.eventId
            });
        }

        const notification = await sendPaidOrderAlert({
            channel: config.channel,
            recipient: config.notificationRecipient,
            order: event.order,
            unifonic: config.unifonic
        });

        console.info("paid_order_notification_sent", {
            requestId,
            eventId: event.eventId,
            orderId: event.order.id,
            channel: notification.channel,
            providerMessageId: notification.providerMessageId
        });

        return jsonResponse(200, {
            ok: true,
            duplicate: false,
            requestId,
            eventId: event.eventId,
            orderId: event.order.id,
            notification
        });
    } catch (error) {
        if (idempotencyKey && config) {
            try {
                await releaseIdempotencyKey(idempotencyKey, config.redis);
            } catch (releaseError) {
                console.error("idempotency_release_failed", {
                    requestId,
                    message: releaseError.message
                });
            }
        }

        const appError = error instanceof AppError
            ? error
            : new AppError("Unexpected server error");

        console.error("paid_order_notification_failed", {
            requestId,
            code: appError.code,
            statusCode: appError.statusCode,
            message: appError.message
        });

        return jsonResponse(appError.statusCode, {
            ok: false,
            requestId,
            error: {
                code: appError.code,
                message: appError.statusCode >= 500
                    ? "تعذر معالجة التنبيه حاليًا."
                    : appError.message,
                ...(appError.statusCode < 500 && appError.details
                    ? { details: appError.details }
                    : {})
            }
        });
    }
}

export async function POST(request) {
    return handlePaidOrder(request);
}

export default {
    async fetch(request) {
        return handlePaidOrder(request);
    }
};
