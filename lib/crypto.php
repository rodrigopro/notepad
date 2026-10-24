<?php
declare(strict_types=1);
if (!defined("NP_APP")) { http_response_code(404); exit; }

function np_key(): string {
    $secret = (string) (np_config()['client_secret'] ?? '');
    if ($secret === '') { throw new RuntimeException('config'); }
    return hash_hkdf('sha256', $secret, 32, 'notepad-cookie-v1');
}

/** Cifra (AES-256-GCM) um payload; $purpose entra como AAD e impede reuso entre cookies. */
function np_seal(array $payload, string $purpose, int $ttl): string {
    $payload['exp'] = time() + $ttl;
    $iv = random_bytes(12);
    $ct = openssl_encrypt(json_encode($payload), 'aes-256-gcm', np_key(), OPENSSL_RAW_DATA, $iv, $tag, $purpose);
    if ($ct === false) { throw new RuntimeException('crypto'); }
    return np_b64u_encode($iv . $tag . $ct);
}

function np_open(string $token, string $purpose): ?array {
    $raw = np_b64u_decode($token);
    if ($raw === null || strlen($raw) < 29) { return null; }
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', np_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16), $purpose);
    if ($pt === false) { return null; }
    $data = json_decode($pt, true);
    if (!is_array($data) || ($data['exp'] ?? 0) < time()) { return null; }
    return $data;
}
