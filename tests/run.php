<?php
declare(strict_types=1);

// Mini runner sem dependências. Uso: php tests/run.php
define('NP_APP', true);
define('NP_APP_DIR', dirname(__DIR__));
foreach (['lib/util', 'lib/version', 'lib/crypto', 'lib/http', 'lib/google', 'lib/dispatch', 'auth/handlers', 'api/drive'] as $f) {
    require NP_APP_DIR . '/' . $f . '.php';
}

$GLOBALS['np_tests'] = [];
$GLOBALS['np_fail'] = 0;

function test(string $name, callable $fn): void {
    try { $fn(); echo "  ok   $name\n"; }
    catch (Throwable $e) { $GLOBALS['np_fail']++; echo "  FAIL $name: " . $e->getMessage() . "\n"; }
}
function eq(mixed $a, mixed $b, string $m = ''): void {
    if ($a !== $b) { throw new RuntimeException(($m ? "$m: " : '') . 'esperado ' . json_encode($b) . ' obtido ' . json_encode($a)); }
}
function ok(bool $c, string $m = 'condição falsa'): void { if (!$c) { throw new RuntimeException($m); } }

const NP_TEST_CFG = ['client_id' => 'cid', 'client_secret' => 'sec-test-1234567890', 'redirect_uri' => 'https://example.test/notepad/api.php?r=auth/callback'];

function reset_env(): void {
    $GLOBALS['np_config_override'] = NP_TEST_CFG;
    unset($GLOBALS['np_http_fake']);
}
function req(array $o = []): array {
    return $o + ['method' => 'GET', 'query' => [], 'headers' => [], 'cookies' => [], 'body' => '', 'https' => true, 'host' => 'example.test'];
}
function post(string $route, array $body = [], array $o = []): array {
    return req($o + [
        'method' => 'POST', 'query' => ['r' => $route], 'body' => json_encode($body),
        'headers' => ['content-type' => 'application/json', 'x-notepad' => '1', 'origin' => 'https://example.test'],
    ]);
}
function hdr(array $res, string $name): array {
    $o = [];
    foreach ($res['headers'] as [$n, $v]) { if (strcasecmp($n, $name) === 0) { $o[] = $v; } }
    return $o;
}
function cookie_value(array $res, string $name): ?string {
    foreach (hdr($res, 'Set-Cookie') as $c) {
        if (str_starts_with($c, $name . '=')) { return explode(';', substr($c, strlen($name) + 1))[0]; }
    }
    return null;
}
function session_cookies(array $extra = []): array {
    $GLOBALS['np_config_override'] = NP_TEST_CFG;
    $tok = np_seal($extra + ['sub' => '1', 'name' => 'Ana', 'picture' => 'https://x/p.png', 'rt' => 'RT', 'at' => 'AT', 'atx' => time() + 3000], 'session', 3600);
    return ['__Host-notepad' => $tok];
}

foreach (glob(__DIR__ . '/php/*.php') as $file) {
    echo basename($file) . "\n";
    reset_env();
    require $file;
}
echo $GLOBALS['np_fail'] === 0 ? "\nTodos os testes passaram\n" : "\n{$GLOBALS['np_fail']} falha(s)\n";
exit($GLOBALS['np_fail'] === 0 ? 0 : 1);
