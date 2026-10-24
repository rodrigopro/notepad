<?php
declare(strict_types=1);
if (!defined("NP_APP")) { http_response_code(404); exit; }

function np_b64u_encode(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }

function np_b64u_decode(string $s): ?string {
    $r = base64_decode(strtr($s, '-_', '+/'), true);
    return $r === false ? null : $r;
}

function np_config(): array {
    static $cfg = null;
    if (isset($GLOBALS['np_config_override'])) { return $GLOBALS['np_config_override']; }
    if ($cfg !== null) { return $cfg; }
    $file = NP_APP_DIR . '/config.local.php';
    $cfg = is_file($file) ? (array) require $file : [];
    foreach (['client_id' => 'GOOGLE_CLIENT_ID', 'client_secret' => 'GOOGLE_CLIENT_SECRET', 'redirect_uri' => 'GOOGLE_REDIRECT_URI'] as $k => $env) {
        if (empty($cfg[$k]) && (string) getenv($env) !== '') { $cfg[$k] = (string) getenv($env); }
    }
    return $cfg;
}

function np_origin_of(string $url): string {
    $p = parse_url($url);
    if (!$p || empty($p['scheme']) || empty($p['host'])) { return ''; }
    return strtolower($p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : ''));
}

function np_valid_id(mixed $id): bool {
    return is_string($id) && preg_match('/^[A-Za-z0-9_-]{10,128}$/', $id) === 1;
}

/** Resposta padrão: [status, headers, body]. */
function np_json(int $status, array $data, array $headers = []): array {
    $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    return ['status' => $status, 'headers' => array_merge([['Content-Type', 'application/json; charset=utf-8']], $headers), 'body' => $body === false ? '{}' : $body];
}

function np_error(int $status, string $code, array $headers = []): array {
    return np_json($status, ['error' => $code], $headers);
}
