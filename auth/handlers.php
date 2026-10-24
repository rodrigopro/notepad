<?php
declare(strict_types=1);
if (!defined('NP_APP')) { http_response_code(404); exit; }

function np_redirect(string $url, array $extra = []): array {
    return ['status' => 302, 'headers' => array_merge([['Location', $url]], $extra), 'body' => ''];
}

/** URL base do app (pasta do api.php), derivada do redirect URI configurado. */
function np_app_base(): string {
    $uri = (string) (np_config()['redirect_uri'] ?? '');
    $path = (string) parse_url($uri, PHP_URL_PATH);
    $dir = rtrim(str_replace('\\', '/', dirname($path === '' ? '/' : $path)), '/');
    return np_origin_of($uri) . $dir . '/';
}

function np_h_auth_start(array $req): array {
    $c = np_config();
    if (empty($c['client_id']) || empty($c['client_secret']) || empty($c['redirect_uri'])) { return np_error(500, 'not_configured'); }
    $state = np_b64u_encode(random_bytes(32));
    $verifier = np_b64u_encode(random_bytes(48));
    $challenge = np_b64u_encode(hash('sha256', $verifier, true));
    $cookie = np_set_cookie($req, 'notepad-oauth', np_seal(['state' => $state, 'v' => $verifier], 'oauth', 600), 600, 'Lax');
    return np_redirect(np_auth_url($state, $challenge), [$cookie]);
}

/** Troca o código recebido pela página callback.html (via fragmento) por uma sessão. */
function np_h_auth_exchange(array $req): array {
    $clear = np_clear_cookie($req, 'notepad-oauth');
    // `why` é um motivo curto e sem dados sensíveis, para diagnosticar falhas de login.
    $fail = static fn(int $status, string $code, string $why = ''): array => np_json($status, ['error' => $code] + ($why !== '' ? ['why' => $why] : []), [$clear]);

    $in = json_decode($req['body'], true);
    $code = is_array($in) ? ($in['code'] ?? null) : null;
    $state = is_array($in) ? ($in['state'] ?? null) : null;
    $flow = np_open((string) ($req['cookies'][np_cookie_name($req, 'notepad-oauth')] ?? ''), 'oauth');
    if ($flow === null) { return $fail(400, 'invalid_login', 'no_flow_cookie'); }
    if (!is_string($state) || !hash_equals($flow['state'], $state)) { return $fail(400, 'invalid_login', 'state_mismatch'); }
    if (!is_string($code) || $code === '' || strlen($code) > 2048) { return $fail(400, 'invalid_login', 'bad_code'); }
    $t = np_exchange_code($code, $flow['v']);
    if ($t === null) { return $fail(400, 'invalid_login', 'token_' . ($GLOBALS['np_token_error'] ?? 'failed')); }
    if (empty($t['refresh_token'])) { return $fail(400, 'invalid_login', 'no_refresh_token'); }
    $u = np_userinfo($t['access_token']);
    if ($u === null) { return $fail(400, 'invalid_login', 'userinfo_failed'); }

    $session = [
        'sub' => (string) $u['sub'],
        'name' => mb_substr((string) ($u['name'] ?? $u['email'] ?? ''), 0, 100),
        'picture' => (string) ($u['picture'] ?? ''),
        'rt' => $t['refresh_token'],
        'at' => $t['access_token'],
        'atx' => time() + (int) ($t['expires_in'] ?? 3000),
    ];
    return np_json(200, ['ok' => true], [$clear, np_seal_session($req, $session)]);
}

function np_h_auth_me(array $req): array {
    $s = np_session($req);
    if ($s === null) { return np_json(200, ['authenticated' => false]); }
    $pic = str_starts_with($s['picture'], 'https://') ? $s['picture'] : '';
    return np_json(200, ['authenticated' => true, 'name' => $s['name'], 'picture' => $pic, 'uid' => substr(hash('sha256', (string) $s['sub']), 0, 16)]);
}

function np_h_auth_logout(array $req): array {
    $s = np_session($req);
    if ($s !== null) { np_revoke((string) $s['rt']); }
    return np_json(200, ['ok' => true], [np_clear_cookie($req, 'notepad')]);
}
