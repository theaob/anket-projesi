// Server-issued voter identities.
//
// A voter is a random ID in an HttpOnly cookie, signed with a server secret,
// so a script can neither invent IDs nor read them. The server only hands out
// new IDs at a limited rate per client (and, when configured, only after a
// Cloudflare Turnstile check), which is what bounds how many votes one
// person can cast.
const crypto = require('crypto');

const COOKIE_NAME = 'anket_vid';
const COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60; // the longest browsers accept
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function createIdentity(secret) {
    const sign = (id) => crypto.createHmac('sha256', secret).update(id).digest('base64url');

    function issue() {
        const id = crypto.randomBytes(16).toString('hex');
        return { id, cookieValue: `${id}.${sign(id)}` };
    }

    // Returns the voter ID from a Cookie header, or null if absent or forged.
    function fromCookieHeader(header) {
        if (typeof header !== 'string') return null;
        const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([a-f0-9]{32})\\.([A-Za-z0-9_-]{43})(?:;|$)`));
        if (!match) return null;
        const [, id, sig] = match;
        const expected = Buffer.from(sign(id));
        const given = Buffer.from(sig);
        return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? id : null;
    }

    function cookieHeader(cookieValue, secure) {
        return `${COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
    }

    return { issue, fromCookieHeader, cookieHeader };
}

// Checks a Turnstile token with Cloudflare. Any failure (bad token, network
// error, timeout) counts as not verified.
async function verifyTurnstile(secretKey, token, remoteIp) {
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    try {
        const res = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            body: new URLSearchParams({ secret: secretKey, response: token, remoteip: remoteIp || '' }),
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        return data.success === true;
    } catch (err) {
        console.error('Turnstile doğrulaması yapılamadı:', err.message);
        return false;
    }
}

module.exports = { createIdentity, verifyTurnstile };
