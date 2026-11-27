"use strict";

// CSRF middleware contract (app/csrf.js, csrf-sync). Run with: npm run test:unit
// The smoke test checks the same behaviour end to end against the running app.

const test = require("node:test");
const assert = require("node:assert");
const { csrfProtection, exposeToken, generateToken, isCsrfError } = require("../../app/csrf");

const run = (middleware, req) => new Promise(resolve => {
    middleware(req, {}, err => resolve(err));
});
const request = (method, session, body) => ({ method, session, body: body || {}, headers: {} });

test("a session keeps one token, and different sessions get different tokens", () => {
    const a = {};
    const b = {};
    const tokenA = generateToken(request("GET", a));
    assert.ok(tokenA && tokenA.length >= 16, "token too short");
    assert.strictEqual(generateToken(request("GET", a)), tokenA);
    assert.notStrictEqual(generateToken(request("GET", b)), tokenA);
});

test("GET requests pass without a token", async () => {
    assert.strictEqual(await run(csrfProtection, request("GET", {})), undefined);
});

test("a POST with the session's token passes", async () => {
    const session = {};
    const token = generateToken(request("GET", session));
    assert.strictEqual(await run(csrfProtection, request("POST", session, { _csrf: token })), undefined);
});

test("a POST without a token, with a wrong one, or with a non-string is refused with 403", async () => {
    const session = {};
    const token = generateToken(request("GET", session));
    const bodies = [{}, { _csrf: "forged-token" }, { _csrf: [token] }, { _csrf: { $ne: null } }];
    for (const body of bodies) {
        const err = await run(csrfProtection, request("POST", session, body));
        assert.ok(isCsrfError(err), `not refused: ${JSON.stringify(body)}`);
        assert.strictEqual(err.status || err.statusCode, 403);
    }
});

test("another session's token is refused", async () => {
    const mine = {};
    const theirs = {};
    generateToken(request("GET", mine));
    const theirToken = generateToken(request("GET", theirs));
    assert.ok(isCsrfError(await run(csrfProtection, request("POST", mine, { _csrf: theirToken }))));
});

test("templates read the token when the page renders, not when the request starts", () => {
    const req = request("GET", { id: "old" });
    const res = { locals: {} };
    exposeToken(req, res, () => {});
    req.session = {}; // e.g. sign-up regenerated the session before rendering
    const rendered = Object.assign({}, res.locals).csrftoken;
    assert.strictEqual(rendered, generateToken(req));
});
