<?php
declare(strict_types=1);
if (!defined('NP_APP')) { http_response_code(404); exit; }

const NP_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';

function np_auth_url(string $state, string $challenge): string {
    $c = np_config();
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => $c['client_id'],
        'redirect_uri' => np_oauth_redirect(),
        'response_type' => 'code',
        'scope' => NP_SCOPES,
        'state' => $state,
        'code_challenge' => $challenge,
        'code_challenge_method' => 'S256',
        'access_type' => 'offline',
        'prompt' => 'consent',
        'include_granted_scopes' => 'false',
    ], '', '&', PHP_QUERY_RFC3986);
}

function np_token_request(array $params): ?array {
    $c = np_config();
    $params += ['client_id' => $c['client_id'], 'client_secret' => $c['client_secret']];
    $r = np_http('POST', 'https://oauth2.googleapis.com/token', ['Content-Type: application/x-www-form-urlencoded'], http_build_query($params));
    $d = json_decode($r['body'], true);
    return ($r['status'] === 200 && is_array($d) && isset($d['access_token'])) ? $d : null;
}

function np_exchange_code(string $code, string $verifier): ?array {
    return np_token_request([
        'grant_type' => 'authorization_code',
        'code' => $code,
        'redirect_uri' => np_oauth_redirect(),
        'code_verifier' => $verifier,
    ]);
}

function np_refresh(string $refreshToken): ?array {
    return np_token_request(['grant_type' => 'refresh_token', 'refresh_token' => $refreshToken]);
}

function np_userinfo(string $accessToken): ?array {
    $r = np_http('GET', 'https://openid-connect.googleapis.com/v1/userinfo', ['Authorization: Bearer ' . $accessToken]);
    $d = json_decode($r['body'], true);
    return ($r['status'] === 200 && is_array($d) && isset($d['sub'])) ? $d : null;
}

function np_revoke(string $token): void {
    try {
        np_http('POST', 'https://oauth2.googleapis.com/revoke', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['token' => $token]));
    } catch (Throwable) {
        // Revogação é best-effort: o cookie é invalidado de qualquer forma.
    }
}

/** Chamada à Drive API. Retorna ['status' => int, 'body' => string]. */
function np_drive(string $method, string $path, string $token, array $query = [], ?string $body = null, ?string $contentType = null, bool $upload = false): array {
    $base = $upload ? 'https://www.googleapis.com/upload/drive/v3' : 'https://www.googleapis.com/drive/v3';
    $url = $base . $path . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    $headers = ['Authorization: Bearer ' . $token];
    if ($contentType !== null) { $headers[] = 'Content-Type: ' . $contentType; }
    return np_http($method, $url, $headers, $body);
}

function np_drive_json(array $r): ?array {
    $d = json_decode($r['body'], true);
    return is_array($d) ? $d : null;
}

function np_drive_multipart(array $meta, string $content): array {
    $b = 'np' . bin2hex(random_bytes(12));
    $body = "--$b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" . json_encode($meta)
        . "\r\n--$b\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" . $content . "\r\n--$b--";
    return [$body, 'multipart/related; boundary=' . $b];
}
