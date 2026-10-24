<?php
declare(strict_types=1);
if (!defined('NP_APP')) { http_response_code(404); exit; }

const NP_MAX_BODY = 2 * 1024 * 1024;
const NP_SESSION_TTL = 60 * 60 * 24 * 30;

function np_security_headers(): array {
    return [
        ['Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"],
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', 'no-referrer'],
        ['Cross-Origin-Opener-Policy', 'same-origin'],
        ['Cache-Control', 'no-store'],
    ];
}

function np_cookie_name(array $req, string $base): string {
    return ($req['https'] ? '__Host-' : '') . $base;
}

function np_set_cookie(array $req, string $base, string $value, int $maxAge, string $sameSite): array {
    $parts = [np_cookie_name($req, $base) . '=' . $value, 'Path=/', 'HttpOnly', 'SameSite=' . $sameSite, 'Max-Age=' . $maxAge];
    if ($req['https']) { $parts[] = 'Secure'; }
    return ['Set-Cookie', implode('; ', $parts)];
}

function np_clear_cookie(array $req, string $base): array {
    return np_set_cookie($req, $base, '', 0, 'Strict');
}

/** Retorna a sessão decifrada ou null. */
function np_session(array $req): ?array {
    $v = $req['cookies'][np_cookie_name($req, 'notepad')] ?? '';
    return is_string($v) && $v !== '' ? np_open($v, 'session') : null;
}

function np_seal_session(array $req, array $s): array {
    return np_set_cookie($req, 'notepad', np_seal($s, 'session', NP_SESSION_TTL), NP_SESSION_TTL, 'Strict');
}

/**
 * Valida um access token (renovando se preciso). Retorna [token, headersExtras] ou null
 * se a sessão não puder mais acessar o Google.
 */
function np_access(array $req, array $s): ?array {
    if (isset($s['at'], $s['atx']) && $s['atx'] > time() + 60) { return [$s['at'], []]; }
    $t = np_refresh((string) ($s['rt'] ?? ''));
    if ($t === null) { return null; }
    $s['at'] = $t['access_token'];
    $s['atx'] = time() + (int) ($t['expires_in'] ?? 3000);
    return [$s['at'], [np_seal_session($req, $s)]];
}

/** Checagens de entrada comuns a toda requisição. Retorna resposta de erro ou null. */
function np_guard(array $req): ?array {
    $ct = strtolower((string) ($req['headers']['content-type'] ?? ''));
    if (str_starts_with($ct, 'multipart/')) { return np_error(415, 'unsupported_media_type'); }
    if (!in_array($req['method'], ['GET', 'HEAD', 'POST', 'PUT'], true)) { return np_error(405, 'method_not_allowed'); }
    if (strlen($req['body']) > NP_MAX_BODY || (int) ($req['headers']['content-length'] ?? 0) > NP_MAX_BODY) { return np_error(413, 'payload_too_large'); }
    if ($req['method'] === 'GET' || $req['method'] === 'HEAD') { return null; }

    if (!str_starts_with($ct, 'application/json')) { return np_error(415, 'unsupported_media_type'); }
    if (($req['headers']['x-notepad'] ?? '') !== '1') { return np_error(403, 'forbidden'); }
    $origin = strtolower((string) ($req['headers']['origin'] ?? ''));
    $expected = np_origin_of((string) (np_config()['redirect_uri'] ?? ''));
    if ($expected === '') { $expected = ($req['https'] ? 'https://' : 'http://') . strtolower($req['host']); }
    if ($origin === '' || $origin !== $expected) { return np_error(403, 'forbidden'); }
    return null;
}

function np_dispatch(array $req): array {
    $res = np_route($req);
    $res['headers'] = array_merge(np_security_headers(), $res['headers']);
    return $res;
}

function np_route(array $req): array {
    try {
        $route = (string) ($req['query']['r'] ?? '');
        $table = [
            'health' => ['GET', 'np_h_health'],
            'auth/start' => ['GET', 'np_h_auth_start'],
            'auth/exchange' => ['POST', 'np_h_auth_exchange'],
            'auth/me' => ['GET', 'np_h_auth_me'],
            'auth/logout' => ['POST', 'np_h_auth_logout'],
            'drive/workspace' => ['GET', 'np_h_ws_get'],
            'drive/workspace/save' => ['POST', 'np_h_ws_save'],
            'drive/files' => ['GET', 'np_h_files_list'],
            'drive/file' => ['GET', 'np_h_file_get'],
            'drive/file/save' => ['POST', 'np_h_file_save'],
        ];
        if ($err = np_guard($req)) { return $err; }
        if (!isset($table[$route])) { return np_error(404, 'not_found'); }
        [$method, $fn] = $table[$route];
        $m = $req['method'] === 'HEAD' ? 'GET' : ($req['method'] === 'PUT' ? 'POST' : $req['method']);
        if ($m !== $method) { return np_error(405, 'method_not_allowed'); }
        return $fn($req);
    } catch (Throwable $e) {
        error_log('notepad: ' . get_class($e) . ' ' . $e->getMessage());
        return np_error(500, 'server_error');
    }
}

function np_h_health(array $req): array {
    return np_json(200, ['ok' => true, 'php' => np_php_patched() ? 'ok' : 'outdated']);
}
