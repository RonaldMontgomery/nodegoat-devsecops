const {
    environmentalScripts
} = require("../../config/config");

// Fix for SSRF (Server-Side Request Forgery). Upstream fetched req.query.url +
// req.query.symbol on the server with needle and copied the response into this site's
// page. Any user could make the server request any address it can reach (internal
// services; on EC2 the instance metadata endpoint, which hands out IAM credentials)
// and read the result, and the remote HTML ran with this site's origin.
//
// The server no longer fetches anything: it validates the symbol and sends the browser
// to the quote page. The destination host is fixed and the symbol is URL-encoded into
// the path, so this is not an open redirect either.
const QUOTE_URL = "https://finance.yahoo.com/quote/";
// Tickers: letters, digits and a few separators used by indices and share classes.
const SYMBOL_RE = /^[A-Za-z0-9.^=-]{1,12}$/;

function ResearchHandler(db) {
    "use strict";

    this.displayResearch = (req, res) => {
        const { symbol } = req.query;

        if (symbol !== undefined) {
            if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) {
                return res.status(400).render("research", {
                    symbolError: "Enter a stock symbol: letters, digits, '.', '-', '^' or '=' (up to 12).",
                    environmentalScripts
                });
            }
            return res.redirect(QUOTE_URL + encodeURIComponent(symbol));
        }

        return res.render("research", {
            environmentalScripts
        });
    };
}

module.exports = ResearchHandler;
