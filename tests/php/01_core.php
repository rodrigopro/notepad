<?php
test('versão: corrigidas passam', function () {
    foreach (['8.2.35', '8.3.36', '8.4.27', '8.5.12', '8.5.99', '8.6.0', '9.0.0', '8.4.27-1ubuntu'] as $v) { ok(np_php_patched($v), $v); }
});
test('versão: vulneráveis falham', function () {
    foreach (['8.2.34', '8.3.35', '8.4.26', '8.5.11', '8.1.99', '7.4.33', 'lixo'] as $v) { ok(!np_php_patched($v), $v); }
});
test('crypto: ida e volta', function () {
    reset_env();
    $t = np_seal(['a' => 1], 'session', 60);
    eq(np_open($t, 'session')['a'], 1);
});
test('crypto: adulteração, propósito e chave errados', function () {
    reset_env();
    $t = np_seal(['a' => 1], 'session', 60);
    $raw = np_b64u_decode($t); $raw[40] = $raw[40] ^ "\x01";
    eq(np_open(np_b64u_encode($raw), 'session'), null, 'adulterado');
    eq(np_open($t, 'oauth'), null, 'propósito');
    $GLOBALS['np_config_override'] = ['client_secret' => 'outra-chave-xxxxxxxx'];
    eq(np_open($t, 'session'), null, 'chave');
    eq(np_open('###', 'session'), null, 'lixo');
});
test('crypto: expirado', function () {
    reset_env();
    eq(np_open(np_seal(['a' => 1], 'session', -5), 'session'), null);
});
test('dispatch: health não revela versão', function () {
    reset_env();
    $r = np_dispatch(req(['query' => ['r' => 'health']]));
    eq($r['status'], 200);
    ok(!str_contains($r['body'], PHP_VERSION), 'vazou versão');
    eq(json_decode($r['body'], true)['ok'], true);
});
test('dispatch: cabeçalhos de segurança', function () {
    reset_env();
    $r = np_dispatch(req(['query' => ['r' => 'health']]));
    $csp = hdr($r, 'Content-Security-Policy')[0];
    ok(!str_contains($csp, 'unsafe-inline') && !str_contains($csp, 'unsafe-eval'));
    ok(str_contains($csp, "frame-ancestors 'none'"));
    eq(hdr($r, 'X-Content-Type-Options'), ['nosniff']);
    ok(count(hdr($r, 'Referrer-Policy')) === 1);
});
test('dispatch: multipart → 415 em qualquer rota', function () {
    reset_env();
    foreach (['GET', 'POST'] as $m) {
        $r = np_dispatch(req(['method' => $m, 'query' => ['r' => 'health'], 'headers' => ['content-type' => 'multipart/form-data; boundary=x']]));
        eq($r['status'], 415, $m);
    }
});
test('dispatch: content-type não JSON → 415', function () {
    reset_env();
    $r = np_dispatch(post('auth/logout', [], ['headers' => ['content-type' => 'text/plain', 'x-notepad' => '1', 'origin' => 'https://example.test']]));
    eq($r['status'], 415);
});
test('dispatch: CSRF (sem header / origem externa / sem origem) → 403', function () {
    reset_env();
    $h = ['content-type' => 'application/json', 'x-notepad' => '1', 'origin' => 'https://example.test'];
    eq(np_dispatch(post('auth/logout', [], ['headers' => array_diff_key($h, ['x-notepad' => 1])]))['status'], 403);
    eq(np_dispatch(post('auth/logout', [], ['headers' => ['origin' => 'https://evil.test'] + $h]))['status'], 403);
    eq(np_dispatch(post('auth/logout', [], ['headers' => array_diff_key($h, ['origin' => 1])]))['status'], 403);
    eq(np_dispatch(post('auth/logout'))['status'], 200);
});
test('dispatch: tamanho, método e rota', function () {
    reset_env();
    eq(np_dispatch(post('auth/logout', [], ['body' => str_repeat('a', NP_MAX_BODY + 1)]))['status'], 413);
    eq(np_dispatch(req(['method' => 'DELETE', 'query' => ['r' => 'health']]))['status'], 405);
    eq(np_dispatch(req(['query' => ['r' => 'nada']]))['status'], 404);
    eq(np_dispatch(req(['query' => ['r' => 'auth/logout']]))['status'], 405);
    eq(np_dispatch(req(['query' => ['r' => '../lib/util']]))['status'], 404);
});
test('guarda: arquivos de app respondem 404 se acessados diretamente', function () {
    $code = null;
    $out = shell_exec('php ' . escapeshellarg(NP_APP_DIR . '/lib/util.php') . ' 2>&1');
    eq(trim((string) $out), '');
});
