// Test fixtures for .semgrep/custom-rules.yml. Run with: semgrep --test .semgrep/
// These lines are intentional violations; .semgrepignore keeps them out of the main scan.
/* eslint-disable */
const session = require("express-session");

// ruleid: no-child-process-exec
require("child_process").exec("ls " + userInput);
// ok: no-child-process-exec
require("child_process").execFile("ls", [userInput]);

// ruleid: express-session-hardcoded-secret
app.use(session({ secret: "keyboard cat", resave: false }));
// ruleid: express-session-hardcoded-secret
module.exports = { port: 4000, cookieSecret: "not-a-real-secret-value" };
// ok: express-session-hardcoded-secret
app.use(session({ secret: process.env.SESSION_SECRET, resave: false }));
// ok: express-session-hardcoded-secret
module.exports = { cookieSecret: requiredSecret("SESSION_SECRET") };
// ok: express-session-hardcoded-secret
app.use(session({ name: "sessionId", resave: false }));

function handler(req, res) {
    // ruleid: eval-of-request-input
    const preTax = eval(req.body.preTax);
    // ok: eval-of-request-input
    const afterTax = parseInt(req.body.afterTax, 10);
    // ok: eval-of-request-input
    const constant = eval("1 + 1");
}
