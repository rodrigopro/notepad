<?php
// Integração: monta dist/ com config falsa e sobe `php -S` para checar a superfície exposta.
$out = sys_get_temp_dir() . '/np-dist-' . bin2hex(random_bytes(4));
$port = random_int(20000, 40000);
$env = ['GOOGLE_CLIENT_ID' => 'cid', 'GOOGLE_CLIENT_SECRET' => 'sec-test-1234567890', 'GOOGLE_REDIRECT_URI' => "http://127.0.0.1:$port/api.php?r=auth/callback", 'PATH' => getenv('PATH')];
exec('GOOGLE_CLIENT_ID=cid GOOGLE_CLIENT_SECRET=sec-test-1234567890 GOOGLE_REDIRECT_URI=' . escapeshellarg($env['GOOGLE_REDIRECT_URI']) . ' bash ' . escapeshellarg(NP_APP_DIR . '/scripts/build.sh') . ' ' . escapeshellarg($out) . ' 2>&1', $o, $code);
$proc = proc_open(['php', '-S', "127.0.0.1:$port", '-t', $out], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, $env);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) { usleep(100000); }

function http(int $port, string $method, string $path, array $headers = [], string $body = ''): array {
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body, 'ignore_errors' => true, 'timeout' => 5]]);
    $b = @file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
    preg_match('/ (\d{3})/', $http_response_header[0] ?? '', $m);
    return ['status' => (int) ($m[1] ?? 0), 'body' => (string) $b, 'headers' => $http_response_header ?? []];
}

test('build: dist sem arquivos de dev e com config gerada', function () use ($out, $code) {
    eq($code, 0);
    foreach (['tests', 'vendor', 'node_modules', 'openspec', '.git', '.github', '.claude', '.opencode', 'scripts', 'package.json'] as $x) { ok(!file_exists("$out/$x"), $x); }
    ok(is_file("$out/api.php") && is_file("$out/index.html") && is_file("$out/app/config.local.php") && is_file("$out/app/.htaccess"));
    eq(substr(sprintf('%o', fileperms("$out/app/config.local.php")), -3), '600');
});
test('server: health responde 200 com cabeçalhos', function () use ($port) {
    $r = http($port, 'GET', '/api.php?r=health');
    eq($r['status'], 200);
    ok(str_contains(implode("\n", $r['headers']), 'Content-Security-Policy'));
    ok(!str_contains(implode("\n", $r['headers']), 'X-Powered-By'), 'X-Powered-By exposto');
});
test('server: arquivos internos não vazam (lib, auth, api, config, tests)', function () use ($port) {
    foreach (['/app/config.local.php', '/app/lib/util.php', '/app/lib/crypto.php', '/app/auth/handlers.php', '/app/api/drive.php', '/tests/run.php', '/lib/util.php', '/../lib/util.php', '/%2e%2e/lib/util.php'] as $p) {
        $r = http($port, 'GET', $p);
        // php -S devolve index.html para caminhos inexistentes; o que não pode é vazar código/segredo.
        ok($r['status'] === 404 || $r['status'] === 403 || $r['body'] === '' || str_contains($r['body'], '<title>Notepad</title>'), "$p → {$r['status']}");
        ok(!str_contains($r['body'], 'sec-test') && !str_contains($r['body'], '<?php'), "$p vazou conteúdo");
    }
});
test('server: multipart → 415 e POST sem CSRF → 403', function () use ($port) {
    $r = http($port, 'POST', '/api.php?r=auth/logout', ['Content-Type: multipart/form-data; boundary=x'], "--x--");
    eq($r['status'], 415);
    $r = http($port, 'POST', '/api.php?r=auth/logout', ['Content-Type: application/json'], '{}');
    eq($r['status'], 403);
    $r = http($port, 'POST', '/api.php?r=auth/logout', ['Content-Type: application/json', 'X-Notepad: 1', "Origin: http://127.0.0.1:$port"], '{}');
    eq($r['status'], 200);
});
test('server: auth/start redireciona ao Google sem expor segredo', function () use ($port) {
    $r = http($port, 'GET', '/api.php?r=auth/start');
    ok(!str_contains(implode("\n", $r['headers']), 'sec-test'));
});

proc_terminate($proc);
exec('rm -rf ' . escapeshellarg($out));
