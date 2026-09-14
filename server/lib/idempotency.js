"use strict";

const { AppError } = require("./errors");

const memoryStore = new Map();

function cleanupMemoryStore(now = Date.now()) {
    for (const [key, expiresAt] of memoryStore.entries()) {
        if (expiresAt <= now) memoryStore.delete(key);
    }
}

async function redisCommand(redis, command) {
    const url = `${redis.url}/${command.map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${redis.token}` }
    });

    if (!response.ok) {
        throw new AppError("Idempotency store is unavailable", {
            statusCode: 503,
            code: "IDEMPOTENCY_STORE_UNAVAILABLE"
        });
    }

    return response.json();
}

async function acquireIdempotencyKey(key, ttlSeconds, redis = null) {
    if (redis) {
        const result = await redisCommand(redis, ["set", key, "1", "EX", String(ttlSeconds), "NX"]);
        return result?.result === "OK";
    }

    cleanupMemoryStore();
    if (memoryStore.has(key)) return false;
    memoryStore.set(key, Date.now() + ttlSeconds * 1000);
    return true;
}

async function releaseIdempotencyKey(key, redis = null) {
    if (redis) {
        await redisCommand(redis, ["del", key]);
        return;
    }
    memoryStore.delete(key);
}

module.exports = { acquireIdempotencyKey, releaseIdempotencyKey };
