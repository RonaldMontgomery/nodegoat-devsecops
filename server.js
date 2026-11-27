"use strict";

const express = require("express");
const favicon = require("serve-favicon");
const bodyParser = require("body-parser");
const session = require("express-session");
const { csrfProtection, exposeToken } = require("./app/csrf");
const nunjucks = require("nunjucks"); // Template engine (replaces abandoned swig)
const helmet = require("helmet");
const { connect } = require("./app/data/mongo"); // MongoDB driver 7.x connection helper
const fs = require("fs");
const https = require("https");
const { renderMemo } = require("./app/markdown");
const app = express(); // Web framework to handle routing requests
const routes = require("./app/routes");
const {
    port,
    db,
    cookieSecret,
    tlsKeyFile,
    tlsCertFile,
    sessionMaxAgeMs
} = require("./config/config"); // Application config properties

// Fix for A6 - Sensitive Data Exposure: serve HTTPS only. The key and certificate are
// read at startup from files mounted at runtime (see config/env/all.js); without them
// the app refuses to start rather than falling back to plain HTTP.
const loadTls = () => {
    try {
        return {
            key: fs.readFileSync(tlsKeyFile),
            cert: fs.readFileSync(tlsCertFile)
        };
    } catch (err) {
        console.error(`Error: TLS key/certificate not readable (${err.code}): ${tlsKeyFile}, ${tlsCertFile}`);
        console.error("Run scripts/dev-cert.sh for a local certificate, or set TLS_KEY_FILE and TLS_CERT_FILE.");
        process.exit(1);
    }
};
const httpsOptions = loadTls();

connect(db, (err, db) => {
    if (err) {
        console.log("Error: DB: connect");
        console.log(err);
        process.exit(1);
    }
    console.log(`Connected to the database`);

    // Fix for A5 - Security Misconfiguration: security headers on every response,
    // including static assets. helmet's defaults add a Content-Security-Policy
    // (scripts only from this origin; no inline scripts), Strict-Transport-Security,
    // X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN and Referrer-Policy,
    // and remove X-Powered-By. The tutorial pages embed YouTube videos, so frame-src
    // allows that one origin; the research form redirects to the Yahoo Finance quote page,
    // and form-action also governs redirects after a form submit, so it allows that origin.
    // scripts/smoke-test.sh checks the headers.
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                "frame-src": ["'self'", "https://www.youtube.com"],
                "form-action": ["'self'", "https://finance.yahoo.com"]
            }
        }
    }));

    // Adding/ remove HTTP Headers for security
    app.use(favicon(__dirname + "/app/assets/favicon.ico"));

    // Express middleware to populate "req.body" so we can access POST variables
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        // Mandatory in Express v4
        extended: false
    }));

    // Enable session management using express middleware.
    // Fix for A3/A5: hardened session cookie. Semgrep's express-cookie-settings rules
    // check each attribute; two are excluded in .github/workflows/sast.yml with reasons:
    // expiry is set with maxAge (express-session says not to set expires directly), and
    // no domain is set, which keeps the cookie host-only, stricter than any Domain value.
    // scripts/smoke-test.sh checks the real Set-Cookie header on every CI run.
    app.use(session({
        // genid: (req) => {
        //    return genuuid() // use UUIDs for session IDs
        //},
        secret: cookieSecret,
        // Generic name instead of the default "connect.sid", which identifies Express.
        name: "sessionId",
        // Both mandatory in Express v4
        saveUninitialized: true,
        resave: true,
        // Each response extends the idle timeout.
        rolling: true,
        cookie: {
            // Not readable from page JavaScript (limits session theft through XSS).
            httpOnly: true,
            // Sent only over HTTPS; the server below serves nothing else.
            secure: true,
            // Not sent on cross-site requests (defence in depth against CSRF).
            sameSite: "strict",
            path: "/",
            // Expires after 30 idle minutes instead of living until the browser closes.
            maxAge: sessionMaxAgeMs
        }
    }));

    // Fix for A8 - CSRF. Every POST must carry the session's token in the "_csrf" form
    // field (app/csrf.js, csrf-sync; replaces the archived csurf). The token lives in the
    // server-side session, so a forged cross-site request cannot read or set it. Bad or
    // missing tokens get 403 (app/routes/error.js). SameSite=Strict is a second layer.
    app.use(csrfProtection);
    // Make the token available in templates as {{csrftoken}}
    app.use(exposeToken);

    // Register templating engine.
    // Fix for A3 - XSS and A9: swig 1.4.2 is abandoned with an unfixable file-read CVE
    // (CVE-2023-25345) and ran with autoescape off. Nunjucks uses the same template
    // syntax and escapes every {{ }} by default; only trusted HTML is marked "| safe".
    nunjucks.configure(`${__dirname}/app/views`, {
        autoescape: true,
        express: app
    });
    app.set("view engine", "html");
    // Fix for A5 - Security MisConfig
    // TODO: make sure assets are declared before app.use(session())
    app.use(express.static(`${__dirname}/app/assets`));


    // Fix for A9 - Insecure Dependencies: current marked (the old 0.3.5 had six open
    // CVEs). marked removed its sanitize option, so app/markdown.js escapes raw HTML
    // and refuses unsafe link targets itself. Templates call it as marked(text).
    app.locals.marked = renderMemo;

    // Application routes
    routes(app, db);


    // Fix for A6 - Sensitive Data Exposure: HTTPS only, no plain-HTTP listener.
    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Express https server listening on port ${port}`);
    });

});
