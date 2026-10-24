<?php
declare(strict_types=1);
if (!defined("NP_APP")) { http_response_code(404); exit; }

const NP_ALLOWED_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'openid-connect.googleapis.com'];

/**
 * Requisição HTTPS a hosts do Google (allowlist). Retorna ['status' => int, 'body' => string].
 * $GLOBALS['np_http_fake'] permite simular a rede nos testes.
 */
function np_http(string $method, string $url, array $headers = [], ?string $body = null): array {
    $host = (string) parse_url($url, PHP_URL_HOST);
    if (parse_url($url, PHP_URL_SCHEME) !== 'https' || !in_array($host, NP_ALLOWED_HOSTS, true)) {
        throw new RuntimeException('host');
    }
    if (isset($GLOBALS['np_http_fake'])) { return ($GLOBALS['np_http_fake'])($method, $url, $headers, $body); }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_MAXFILESIZE => 8 * 1024 * 1024,
    ]);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POSTFIELDS, $body); }
    $out = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($out === false) { throw new RuntimeException('network'); }
    return ['status' => $status, 'body' => (string) $out];
}
