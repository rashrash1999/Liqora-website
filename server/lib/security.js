"use strict";

const crypto = require("node:crypto");

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ""));
    const rightBuffer = Buffer.from(String(right || ""));

    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySharedSecret(receivedSecret, expectedSecret) {
    return Boolean(receivedSecret && expectedSecret && safeEqual(receivedSecret, expectedSecret));
}

module.exports = { safeEqual, verifySharedSecret };
