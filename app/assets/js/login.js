/* global $ */
"use strict";

// Warn when cookies are disabled (login needs the session cookie).
const areCookiesEnabled = () => {
    const cookieEnabled = navigator.cookieEnabled;

    // When cookieEnabled flag is present and false then cookies are disabled.
    if (!cookieEnabled) return false;

    // try to set a test cookie if we can't see any cookies and we're using
    // either a browser that doesn't support navigator.cookieEnabled
    // or IE (which always returns true for navigator.cookieEnabled)
    if (!document.cookie && cookieEnabled === null) {
        document.cookie = "testcookie=1";

        if (!document.cookie) return false;

        document.cookie = "testcookie=; expires=" + new Date(0).toUTCString();

    }

    return true;
};

$(document).ready(() => {
    if (!areCookiesEnabled()) {
        $("#page-wrapper").prepend(
            "<div class=\"row\"><div class=\"col-lg-12\"><div class=\"alert alert-danger\">" +
            "Cookies are not enabled on your browser. " +
            "Please enable cookies in your browser preferences to continue.</div></div></div>"
        );
    }
});
