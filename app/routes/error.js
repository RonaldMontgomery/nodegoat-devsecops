// Error handling middleware
const { isCsrfError } = require("../csrf");

const errorHandler = (err, req, res,next) => {

    "use strict";

    // Fix for A8 - CSRF: a missing or forged token is a refused request, not a server error.
    if (isCsrfError(err)) {
        console.error(`CSRF token rejected: ${req.method} ${req.path}`);
        res.status(403);
        return res.render("error-template", {
            error: "Request refused: missing or invalid CSRF token. Reload the page and try again."
        });
    }

    console.error(err.message);
    console.error(err.stack);
    res.status(500);
    res.render("error-template", {
        error: err
    });
};

module.exports = { errorHandler };
