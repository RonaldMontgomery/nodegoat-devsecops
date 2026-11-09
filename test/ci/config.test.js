"use strict";

// Lab 3 unit tests for the Lab 2 secrets handling in config/env/all.js.
// Run with: npm run test:unit   (Node's built-in test runner, no extra dependencies)
// Each case loads the config in a fresh child process so environment changes are isolated.

const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function loadConfig(env, expr) {
    const childEnv = { PATH: process.env.PATH, ...env };
    if (process.env.NODE_PATH) {
        childEnv.NODE_PATH = process.env.NODE_PATH;
    }
    return spawnSync(process.execPath, ["-e", `const c = require("./config/config"); ${expr}`], {
        cwd: ROOT,
        env: childEnv,
        encoding: "utf8"
    });
}

test("production refuses to start without SESSION_SECRET", () => {
    const result = loadConfig({ NODE_ENV: "production", CRYPTO_KEY: "k" }, "");
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Missing required secret SESSION_SECRET/);
});

test("production refuses to start without CRYPTO_KEY", () => {
    const result = loadConfig({ NODE_ENV: "production", SESSION_SECRET: "s" }, "");
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Missing required secret CRYPTO_KEY/);
});

test("secrets come from the environment", () => {
    const result = loadConfig(
        { NODE_ENV: "production", SESSION_SECRET: "from-env-session", CRYPTO_KEY: "from-env-crypto" },
        "process.stderr.write(JSON.stringify([c.cookieSecret, c.cryptoKey]));"
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stderr), ["from-env-session", "from-env-crypto"]);
});

test("development without secrets gets a random value, not a shared default", () => {
    const expr = "process.stderr.write('SECRET=' + c.cookieSecret);";
    const first = loadConfig({ NODE_ENV: "development" }, expr);
    const second = loadConfig({ NODE_ENV: "development" }, expr);
    assert.strictEqual(first.status, 0, first.stderr);
    const a = first.stderr.match(/SECRET=([0-9a-f]+)/)[1];
    const b = second.stderr.match(/SECRET=([0-9a-f]+)/)[1];
    assert.strictEqual(a.length, 64);
    assert.notStrictEqual(a, b);
});

test("startup config log never prints secret values", () => {
    const result = loadConfig(
        { NODE_ENV: "production", SESSION_SECRET: "do-not-log-me", CRYPTO_KEY: "do-not-log-me-either" },
        ""
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /do-not-log-me/);
    assert.match(result.stdout, /\[REDACTED\]/);
});
