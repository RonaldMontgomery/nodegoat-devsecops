"use strict";

// Bank routing validation must be correct and must run in linear time (ReDoS).
// Run with: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { isValidBankRouting } = require("../../app/validation");

test("accepts digits followed by #", () => {
    for (const value of ["123456789#", "1#", "12345678901234567#"]) assert.ok(isValidBankRouting(value), value);
});

test("rejects anything else, including partial matches the old regex allowed", () => {
    const invalid = ["", "123456789", "#", "abc123#", "123#abc", "12 34#", "123456789012345678#", null, ["1#"], 7];
    for (const value of invalid) assert.ok(!isValidBankRouting(value), JSON.stringify(value));
});

test("ReDoS payloads are rejected quickly", () => {
    // The old /([0-9]+)+\#/ needs exponential time on these; 32 digits took minutes.
    const payloads = ["1".repeat(32) + "!", "1".repeat(10000) + "!", "1".repeat(100000)];
    for (const payload of payloads) {
        const start = process.hrtime.bigint();
        assert.ok(!isValidBankRouting(payload));
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        assert.ok(ms < 50, `${payload.length}-character payload took ${ms.toFixed(1)} ms`);
    }
});
