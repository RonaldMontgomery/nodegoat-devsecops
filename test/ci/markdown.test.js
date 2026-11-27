"use strict";

// Memo rendering must not let a memo inject markup or script (A9 / stored XSS).
// Run with: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { renderMemo } = require("../../app/markdown");

test("markdown still formats memos", () => {
    assert.match(renderMemo("**bold** and _italic_"), /<strong>bold<\/strong> and <em>italic<\/em>/);
    assert.match(renderMemo("[OWASP](https://owasp.org)"), /<a href="https:\/\/owasp\.org">OWASP<\/a>/);
    assert.match(renderMemo("[home](/dashboard)"), /href="\/dashboard"/);
});

test("raw HTML in a memo is shown as text, not rendered", () => {
    const payloads = [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "hello <b onclick=alert(1)>there</b>",
        "<iframe src=https://evil.example></iframe>",
        "<svg onload=alert(1)>"
    ];
    for (const payload of payloads) {
        const html = renderMemo(payload);
        assert.doesNotMatch(html, /<(script|img|b |iframe|svg)/i, `rendered markup for ${payload}: ${html}`);
    }
});

test("links and images cannot use script or data URLs", () => {
    const payloads = [
        "[x](javascript:alert(1))",
        "[x](JaVaScRiPt:alert(1))",
        "[x](jav&#x61;script:alert(1))",
        "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
        "[x](vbscript:msgbox(1))",
        "[x](//evil.example)",
        "![x](javascript:alert(1))"
    ];
    for (const payload of payloads) {
        const html = renderMemo(payload);
        assert.doesNotMatch(html, /(javascript|vbscript|data):|evil\.example/i,
            `unsafe URL kept for ${payload}: ${html}`);
        assert.match(html, /(href|src)="#"/, `link not neutralised for ${payload}: ${html}`);
    }
});

test("empty and non-string memos render without throwing", () => {
    assert.strictEqual(renderMemo(undefined), "");
    assert.strictEqual(renderMemo(""), "");
    assert.match(renderMemo(42), /42/);
});
