"use strict";

const express = require("express");
const favicon = require("serve-favicon");
const bodyParser = require("body-parser");
const session = require("express-session");
const csrf = require("csurf");
const consolidate = require("consolidate"); // Templating library adapter for Express
const swig = require("swig");
// const helmet = require("helmet");
const { connect } = require("./app/data/mongo"); // MongoDB driver 7.x connection helper
const fs = require("fs");
const https = require("https");
const marked = require("marked");
//const nosniff = require('dont-sniff-mimetype');
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

    /*
    // Fix for A5 - Security MisConfig
    // TODO: Review the rest of helmet options, like "xssFilter"
    // Remove default x-powered-by response header
    app.disable("x-powered-by");

    // Prevent opening page in frame or iframe to protect from clickjacking
    app.use(helmet.frameguard()); //xframe deprecated

    // Prevents browser from caching and storing page
    app.use(helmet.noCache());

    // Allow loading resources only from white-listed domains
    app.use(helmet.contentSecurityPolicy()); //csp deprecated

    // Allow communication only on HTTPS
    app.use(helmet.hsts());

    // TODO: Add another vuln: https://github.com/helmetjs/helmet/issues/26
    // Enable XSS filter in IE (On by default)
    // app.use(helmet.iexss());
    // Now it should be used in hit way, but the README alerts that could be
    // dangerous, like specified in the issue.
    // app.use(helmet.xssFilter({ setOnOldIE: true }));

    // Forces browser to only use the Content-Type set in the response header instead of sniffing or guessing it
    app.use(nosniff());
    */

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

    // Fix for A8 - CSRF. Every POST must carry the session's token in the "_csrf"
    // form field; the secret lives in the server-side session (not a cookie), so a
    // forged cross-site request cannot read or set it. Bad or missing tokens get 403
    // (app/routes/error.js). SameSite=Strict on the session cookie is a second layer.
    app.use(csrf());
    // Make csrf token available in templates as {{csrftoken}}
    app.use((req, res, next) => {
        res.locals.csrftoken = req.csrfToken();
        next();
    });

    // Register templating engine
    app.engine(".html", consolidate.swig);
    app.set("view engine", "html");
    app.set("views", `${__dirname}/app/views`);
    // Fix for A5 - Security MisConfig
    // TODO: make sure assets are declared before app.use(session())
    app.use(express.static(`${__dirname}/app/assets`));


    // Initializing marked library
    // Fix for A9 - Insecure Dependencies
    marked.setOptions({
        sanitize: true
    });
    app.locals.marked = marked;

    // Application routes
    routes(app, db);

    // Template system setup
    swig.setDefaults({
        // Autoescape disabled
        autoescape: false
        /*
        // Fix for A3 - XSS, enable auto escaping
        autoescape: true // default value
        */
    });

    // Fix for A6 - Sensitive Data Exposure: HTTPS only, no plain-HTTP listener.
    https.createServer(httpsOptions, app).listen(port, () => {
        console.log(`Express https server listening on port ${port}`);
    });

});
