"use strict";

// CSRF protection (fix for A8), synchronizer-token pattern with csrf-sync. This
// replaces csurf, which its maintainers archived. The token lives in the server-side
// session, every POST must send it back in the "_csrf" form field, and forms render it
// as {{csrftoken}}.

const { csrfSync } = require("csrf-sync");

const {
    csrfSynchronisedProtection,
    generateToken,
    invalidCsrfTokenError
} = csrfSync({
    // Forms post the token as a field. Only a string counts (a JSON body could send an
    // object or array).
    getTokenFromRequest: req => (req.body && typeof req.body._csrf === "string" ? req.body._csrf : undefined)
});

// Expose the token to templates. It is a getter, read when a page is rendered rather
// than when the request starts, so a handler that regenerates the session first (sign-up)
// still renders a token that is valid for the new session.
const exposeToken = (req, res, next) => {
    Object.defineProperty(res.locals, "csrftoken", {
        enumerable: true,
        configurable: true,
        get: () => generateToken(req)
    });
    next();
};

const isCsrfError = err => Boolean(err) && (err === invalidCsrfTokenError || err.code === "EBADCSRFTOKEN");

module.exports = {
    csrfProtection: csrfSynchronisedProtection,
    exposeToken,
    generateToken,
    isCsrfError
};
