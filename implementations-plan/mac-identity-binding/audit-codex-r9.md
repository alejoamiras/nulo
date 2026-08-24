APPROVE.

Verified the r8 navigation objection closed: `advancePastAuth()` is the single post-unlock advance for both the submit handler and the isLogined watcher — synchronous claim flag (atomic election regardless of when the real router moves the hash), exact-path check (`hash.split("?")[0] === "#/popup/auth"`, killing the `?from=/popup/auth` substring match), and a resolved `NavigationFailure` releases the claim so a later attempt can still advance.

Q-sweep: no interleaving yields two successful pushes or a permanent strand (a released claim re-arms resubmit / a later login transition); the exact-path comparison rejects no hash the app actually produces for the auth route (canonical `/popup/auth`, no query or trailing-slash producers). Named residual, explicitly ruled speculative hardening rather than a blocker: a THROWN (not resolved-failure) `router.push` would retain the claim — no current post-bootstrap guard throws on this path.

Test note: the race pin's router mock deliberately does NOT move the hash, so only the claim election can stop the second push (the pin fails against the previous hash-only implementation); a second pin covers the query-bearing import route.
