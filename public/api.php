<?php
declare(strict_types=1);

// Único ponto de entrada PHP. Os demais arquivos de app ficam em ./app (deploy) ou ../ (desenvolvimento).
define('NP_APP', true);
define('NP_APP_DIR', is_dir(__DIR__ . '/app') ? __DIR__ . '/app' : dirname(__DIR__));

ini_set('display_errors', '0');
ini_set('session.upload_progress.enabled', '0');
ini_set('file_uploads', '0');

foreach (['lib/util', 'lib/version', 'lib/crypto', 'lib/http', 'lib/google', 'lib/dispatch', 'auth/handlers', 'api/drive'] as $f) {
    require NP_APP_DIR . '/' . $f . '.php';
}

$headers = [];
foreach ($_SERVER as $k => $v) {
    if (str_starts_with($k, 'HTTP_')) { $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = (string) $v; }
}
foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $k => $h) {
    if (isset($_SERVER[$k])) { $headers[$h] = (string) $_SERVER[$k]; }
}

$len = (int) ($headers['content-length'] ?? 0);
$body = ($len > 0 && $len <= NP_MAX_BODY) ? (string) file_get_contents('php://input', false, null, 0, NP_MAX_BODY + 1) : '';

$res = np_dispatch([
    'method' => strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
    'query' => $_GET,
    'headers' => $headers,
    'cookies' => $_COOKIE,
    'body' => $body,
    'https' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
    'host' => (string) ($_SERVER['HTTP_HOST'] ?? ''),
]);

http_response_code($res['status']);
header_remove('X-Powered-By');
foreach ($res['headers'] as [$name, $value]) { header($name . ': ' . $value, strcasecmp($name, 'Set-Cookie') !== 0); }
echo $res['body'];
