<?php
function fake_google(array &$log, array $overrides = []): void {
    $GLOBALS['np_http_fake'] = function (string $m, string $url, array $h, ?string $b) use (&$log, $overrides): array {
        $log[] = [$m, $url, $b];
        foreach ($overrides as $needle => $resp) { if (str_contains($url, $needle)) { return is_callable($resp) ? $resp($m, $url, $b) : $resp; } }
        if (str_contains($url, '/token')) {
            parse_str((string) $b, $p);
            if (($p['grant_type'] ?? '') === 'refresh_token') { return ['status' => 200, 'body' => json_encode(['access_token' => 'AT2', 'expires_in' => 3600])]; }
            return ['status' => 200, 'body' => json_encode(['access_token' => 'AT', 'refresh_token' => 'RTOKEN-SECRET-VALUE', 'expires_in' => 3600])];
        }
        if (str_contains($url, 'userinfo')) { return ['status' => 200, 'body' => json_encode(['sub' => '42', 'name' => 'Ana', 'picture' => 'https://lh3/p.png'])]; }
        return ['status' => 200, 'body' => '{}'];
    };
}

test('auth/start: PKCE S256, state e cookie Lax', function () {
    reset_env();
    $r = np_dispatch(req(['query' => ['r' => 'auth/start']]));
    eq($r['status'], 302);
    $loc = hdr($r, 'Location')[0];
    parse_str((string) parse_url($loc, PHP_URL_QUERY), $q);
    eq($q['code_challenge_method'], 'S256');
    eq($q['response_type'], 'code');
    ok(str_contains($q['scope'], 'drive.file') && str_contains($q['scope'], 'drive.appdata'));
    ok(!str_contains($q['scope'], 'auth/drive '), 'escopo drive completo');
    $c = hdr($r, 'Set-Cookie')[0];
    ok(str_contains($c, 'HttpOnly') && str_contains($c, 'Secure') && str_contains($c, 'SameSite=Lax') && str_starts_with($c, '__Host-notepad-oauth='));
    $flow = np_open(cookie_value($r, '__Host-notepad-oauth'), 'oauth');
    eq($flow['state'], $q['state']);
    eq(np_b64u_encode(hash('sha256', $flow['v'], true)), $q['code_challenge']);
});
test('auth/start: sem configuração → 500', function () {
    $GLOBALS['np_config_override'] = [];
    eq(np_dispatch(req(['query' => ['r' => 'auth/start']]))['status'], 500);
});
function exchange_req(string $oauthCookie, array $body): array {
    return post('auth/exchange', $body, ['cookies' => ['__Host-notepad-oauth' => $oauthCookie]]);
}
test('auth/start: usa o relé como redirect_uri quando configurado; o exchange envia o mesmo', function () {
    reset_env(); $log = []; fake_google($log);
    $GLOBALS['np_config_override'] = NP_TEST_CFG + ['oauth_redirect' => 'https://relay.test/notepad/callback.html'];
    $start = np_dispatch(req(['query' => ['r' => 'auth/start']]));
    parse_str((string) parse_url(hdr($start, 'Location')[0], PHP_URL_QUERY), $q);
    eq($q['redirect_uri'], 'https://relay.test/notepad/callback.html');
    ok(!isset($q['response_mode']));
    $oauth = cookie_value($start, '__Host-notepad-oauth');
    np_dispatch(exchange_req($oauth, ['code' => 'abc', 'state' => np_open($oauth, 'oauth')['state']]));
    ok(str_contains($log[0][2], rawurlencode('https://relay.test/notepad/callback.html')), 'redirect_uri do relé no exchange');
});
test('auth/exchange: sucesso cria sessão cifrada sem expor tokens', function () {
    reset_env(); $log = []; fake_google($log);
    $start = np_dispatch(req(['query' => ['r' => 'auth/start']]));
    $oauth = cookie_value($start, '__Host-notepad-oauth');
    $state = np_open($oauth, 'oauth')['state'];
    $r = np_dispatch(exchange_req($oauth, ['code' => 'abc', 'state' => $state]));
    eq($r['status'], 200);
    $sess = cookie_value($r, '__Host-notepad');
    ok($sess !== null && !str_contains($sess, 'RTOKEN'), 'cookie');
    $c = array_values(array_filter(hdr($r, 'Set-Cookie'), fn($x) => str_starts_with($x, '__Host-notepad=')))[0];
    ok(str_contains($c, 'HttpOnly') && str_contains($c, 'SameSite=Strict') && str_contains($c, 'Secure'));
    ok(str_contains(implode(' ', hdr($r, 'Set-Cookie')), '__Host-notepad-oauth=; '), 'cookie oauth limpo');
    eq(np_open($sess, 'session')['rt'], 'RTOKEN-SECRET-VALUE');
    ok(str_contains($log[0][2], 'code_verifier='), 'verifier enviado');
    ok(!str_contains($r['body'], 'RTOKEN') && !str_contains($r['body'], '"AT"'));
    $me = np_dispatch(req(['query' => ['r' => 'auth/me'], 'cookies' => ['__Host-notepad' => $sess]]));
    $md = json_decode($me['body'], true);
    eq([$md['authenticated'], $md['name'], $md['picture']], [true, 'Ana', 'https://lh3/p.png']);
    eq($md['uid'], substr(hash('sha256', '42'), 0, 16));
    ok(!str_contains($me['body'], '"42"'), 'sub cru exposto');
});
test('auth/exchange: state inválido, ausente ou sem cookie não cria sessão', function () {
    reset_env(); $log = []; fake_google($log);
    $oauth = cookie_value(np_dispatch(req(['query' => ['r' => 'auth/start']])), '__Host-notepad-oauth');
    foreach ([['code' => 'abc', 'state' => 'errado'], ['code' => 'abc'], ['state' => 'x'], ['code' => ['a'], 'state' => 'x'], []] as $b) {
        $r = np_dispatch(exchange_req($oauth, $b));
        eq($r['status'], 400);
        eq(cookie_value($r, '__Host-notepad'), null);
    }
    $r = np_dispatch(post('auth/exchange', ['code' => 'abc', 'state' => 'x']));
    eq($r['status'], 400, 'sem cookie');
    eq(count($log), 0, 'sem chamadas ao Google');
});
test('auth/exchange: exige CSRF e rejeita GET', function () {
    reset_env();
    $h = ['content-type' => 'application/json', 'origin' => 'https://evil.test', 'x-notepad' => '1'];
    eq(np_dispatch(post('auth/exchange', ['code' => 'a', 'state' => 'b'], ['headers' => $h]))['status'], 403);
    eq(np_dispatch(req(['query' => ['r' => 'auth/exchange']]))['status'], 405);
    eq(np_dispatch(req(['query' => ['r' => 'auth/callback']]))['status'], 404, 'rota antiga removida');
});
test('auth/exchange: falha na troca de código', function () {
    reset_env(); $log = [];
    $oauth = cookie_value(np_dispatch(req(['query' => ['r' => 'auth/start']])), '__Host-notepad-oauth');
    $GLOBALS['np_http_fake'] = fn() => ['status' => 400, 'body' => '{"error":"invalid_grant"}'];
    $r = np_dispatch(exchange_req($oauth, ['code' => 'abc', 'state' => np_open($oauth, 'oauth')['state']]));
    eq($r['status'], 400);
    eq(cookie_value($r, '__Host-notepad'), null);
});
test('auth/me: sem sessão e com cookie adulterado', function () {
    reset_env();
    eq(json_decode(np_dispatch(req(['query' => ['r' => 'auth/me']]))['body'], true), ['authenticated' => false]);
    $r = np_dispatch(req(['query' => ['r' => 'auth/me'], 'cookies' => ['__Host-notepad' => 'xyz']]));
    eq(json_decode($r['body'], true), ['authenticated' => false]);
});
test('auth/me: cookie de OAuth não vale como sessão', function () {
    reset_env();
    $t = np_seal(['state' => 's', 'v' => 'v'], 'oauth', 60);
    eq(json_decode(np_dispatch(req(['query' => ['r' => 'auth/me'], 'cookies' => ['__Host-notepad' => $t]]))['body'], true), ['authenticated' => false]);
});
test('auth/logout: revoga token e limpa cookie', function () {
    reset_env(); $log = []; fake_google($log);
    $r = np_dispatch(post('auth/logout', [], ['cookies' => session_cookies()]));
    eq($r['status'], 200);
    ok(str_contains(hdr($r, 'Set-Cookie')[0], 'Max-Age=0'));
    ok(str_contains($log[0][1], '/revoke') && str_contains($log[0][2], 'RT'));
});
test('http: bloqueia hosts fora da allowlist e http', function () {
    foreach (['https://evil.test/x', 'http://accounts.google.com/x', 'https://accounts.google.com.evil.test/'] as $u) {
        $thrown = false;
        try { np_http('GET', $u); } catch (RuntimeException) { $thrown = true; }
        ok($thrown, $u);
    }
});

test('auth/exchange: userinfo falha → usa o id_token (iss/aud conferidos)', function () {
    reset_env(); $log = [];
    $b64 = fn(array $a) => rtrim(strtr(base64_encode(json_encode($a)), '+/', '-_'), '=');
    $mk = fn(string $aud) => 'h.' . $b64(['iss' => 'https://accounts.google.com', 'aud' => $aud, 'sub' => '77', 'name' => 'Bia']) . '.s';
    foreach (['cid' => 200, 'outro' => 400] as $aud => $want) {
        fake_google($log, [
            'userinfo' => ['status' => 401, 'body' => '{}'],
            '/token' => ['status' => 200, 'body' => json_encode(['access_token' => 'AT', 'refresh_token' => 'R', 'id_token' => $mk($aud)])],
        ]);
        $start = np_dispatch(req(['query' => ['r' => 'auth/start']]));
        $oauth = cookie_value($start, '__Host-notepad-oauth');
        $r = np_dispatch(exchange_req($oauth, ['code' => 'abc', 'state' => np_open($oauth, 'oauth')['state']]));
        eq($r['status'], $want);
    }
});
