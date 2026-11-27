const AllocationsDAO = require("../data/allocations-dao").AllocationsDAO;
const {
    environmentalScripts
} = require("../../config/config");

function AllocationsHandler(db) {
    "use strict";

    const allocationsDAO = new AllocationsDAO(db);

    this.displayAllocations = (req, res, next) => {
        // Fix for A4 - Insecure Direct Object Reference (BOLA). The user id used to come
        // from the URL, so any logged-in user could read anyone's allocations by changing
        // it. The session decides whose data is read; a URL naming anyone else gets 403.
        // The comparison is on the exact string, so "3abc", "03" or "2.9" never match.
        const {
            userId
        } = req.session;

        if (req.params.userId !== String(userId)) {
            return res.status(403).render("error-template", {
                error: "You can only view your own allocations."
            });
        }

        const {
            threshold
        } = req.query;

        allocationsDAO.getByUserIdAndThreshold(userId, threshold, (err, allocations) => {
            if (err && err.invalidThreshold) {
                return res.status(400).render("allocations", {
                    userId,
                    allocations: [],
                    thresholdError: err.message,
                    environmentalScripts
                });
            }
            if (err) return next(err);
            return res.render("allocations", {
                userId,
                allocations,
                environmentalScripts
            });
        });
    };
}

module.exports = AllocationsHandler;
