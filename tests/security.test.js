"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { verifySharedSecret } = require("../server/lib/security");

test("verifies matching webhook secrets", () => {
    assert.equal(verifySharedSecret("secret-123", "secret-123"), true);
});

test("rejects missing or different webhook secrets", () => {
    assert.equal(verifySharedSecret("secret-124", "secret-123"), false);
    assert.equal(verifySharedSecret("", "secret-123"), false);
});
