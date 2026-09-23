// Per-client rate limiting for a server reachable from the internet.
const net = require('net');

// The key a client is limited by. IPv4 addresses are used as they are; IPv6
// clients usually control a whole /64 and could rotate through it, so they
// are grouped by that prefix.
function clientKey(ip) {
    if (typeof ip !== 'string') return 'unknown';
    const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4) return v4[1];
    if (!net.isIPv6(ip)) return ip;
    const [head, tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = ip.includes('::')
        ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
        : left;
    return groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Token bucket: each key may spend `burst` tokens at once, refilled at
// `perHour` tokens per hour.
function createLimiter({ burst, perHour }) {
    const buckets = new Map();
    const refillPerMs = perHour / 3600000;

    function take(key) {
        const now = Date.now();
        const b = buckets.get(key) || { tokens: burst, at: now };
        b.tokens = Math.min(burst, b.tokens + (now - b.at) * refillPerMs);
        b.at = now;
        buckets.set(key, b);
        if (b.tokens < 1) {
            return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerMs / 1000) };
        }
        b.tokens -= 1;
        return { ok: true };
    }

    // Full buckets carry no information; dropping them keeps memory bounded
    // no matter how many different addresses show up.
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, b] of buckets) {
            if (b.tokens + (now - b.at) * refillPerMs >= burst) buckets.delete(key);
        }
    }, 10 * 60 * 1000);
    sweep.unref();

    return { take, size: () => buckets.size };
}

module.exports = { clientKey, createLimiter };
