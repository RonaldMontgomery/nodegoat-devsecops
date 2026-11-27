"use strict";

// Memo rendering (fix for A9 and the memo XSS): current marked, made safe for
// untrusted input. marked 0.3.5 had six open CVEs; newer versions dropped the
// `sanitize` option, so this module does what sanitize used to:
//   - raw HTML in a memo is shown as text, never rendered as markup
//   - links and images may only point to http(s), mailto, same-site paths or #
//     (an allow-list, so javascript:, data:, vbscript: and encoded variants fail)

const { Marked } = require("marked");

const escapeHtml = text => String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// "/" but not "//" (protocol-relative links leave the site).
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

const marked = new Marked({
    gfm: true,
    renderer: {
        // Older marked passes a string, newer passes a token with .text.
        html(token) {
            return escapeHtml(typeof token === "string" ? token : token.text);
        }
    },
    walkTokens(token) {
        if ((token.type === "link" || token.type === "image") && !SAFE_URL.test(token.href || "")) {
            token.href = "#";
        }
    }
});

const renderMemo = text => marked.parse(String(text || ""));

module.exports = { renderMemo, escapeHtml };
