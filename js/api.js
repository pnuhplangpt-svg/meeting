
import { formatApiError } from './utils.js';
import { state } from './state.js';

const API_URL = '/api/proxy';
var API_TIMEOUT_MS = 10000;

async function fetchWithTimeoutAndRetry(url, options, retries) {
    var attempts = retries == null ? 0 : retries;
    var lastError = null;

    for (var i = 0; i <= attempts; i++) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, API_TIMEOUT_MS);

        try {
            var response = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
            clearTimeout(timer);

            if (response.status >= 500 && i < attempts) {
                continue; // Retry on server error
            }
            return response;
        } catch (e) {
            clearTimeout(timer);
            lastError = e;
            if (i >= attempts) {
                throw e;
            }
        }
    }

    throw lastError || new Error('Network request failed');
}

export async function apiGet(action, params = {}) {
    let url = API_URL + '?action=' + encodeURIComponent(action);
    Object.keys(params).forEach(function (key) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
            url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
        }
    });

    const response = await fetchWithTimeoutAndRetry(url, { redirect: 'follow' }, 1);
    if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' (' + action + ')');
    }

    let payload;
    try {
        payload = await response.json();
    } catch (e) {
        throw new Error('JSON parse error (' + action + ')');
    }
    return payload;
}

export async function apiPost(body) {
    const action = body && body.action ? body.action : 'unknown';

    // Inject token if available and not present?
    // Original app passes token explicitly in body.
    // We can keep it that way or auto-inject.
    // For now, assume caller passes it.

    const response = await fetchWithTimeoutAndRetry(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' }, // GAS often needs text/plain to avoid CORS preflight issues or simple handling
        body: JSON.stringify(body)
    }, 0); // No retry for POST usually

    if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' (' + action + ')');
    }

    let payload;
    try {
        payload = await response.json();
    } catch (e) {
        throw new Error('JSON parse error (' + action + ')');
    }
    return payload;
}
