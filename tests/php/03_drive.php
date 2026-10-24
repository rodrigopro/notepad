<?php
/** Drive falso em memória (apenas o necessário). */
function fake_drive(array &$store, array &$log): void {
    $GLOBALS['np_http_fake'] = function (string $m, string $url, array $h, ?string $b) use (&$store, &$log): array {
        $log[] = [$m, $url, $h, $b];
        $path = (string) parse_url($url, PHP_URL_PATH);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $q);
        $auth = implode('|', $h);
        if (str_contains($auth, 'Bearer EXPIRED')) { return ['status' => 401, 'body' => '{}']; }
        if (str_contains($url, '/token')) { return ['status' => 200, 'body' => json_encode(['access_token' => 'AT2', 'expires_in' => 3600])]; }
        $json = fn($d, $s = 200) => ['status' => $s, 'body' => json_encode($d)];
        if ($m === 'GET' && $path === '/drive/v3/files') {
            $res = [];
            foreach ($store as $id => $f) {
                $query = $q['q'] ?? '';
                if (str_contains($query, "name='workspace.json'") && $f['space'] === 'app' && $f['name'] === 'workspace.json') { $res[] = ['id' => $id, 'version' => (string) $f['v']]; }
                if (str_contains($query, 'google-apps.folder') && ($f['folder'] ?? false)) { $res[] = ['id' => $id]; }
                if (str_contains($query, "' in parents") && ($f['parent'] ?? '') !== '' && str_contains($query, "'" . $f['parent'] . "'")) { $res[] = ['id' => $id, 'name' => $f['name'], 'version' => (string) $f['v']]; }
            }
            return $json(['files' => $res]);
        }
        if ($m === 'GET' && preg_match('#^/drive/v3/files/([^/]+)$#', $path, $mm)) {
            $f = $store[$mm[1]] ?? null;
            if ($f === null) { return $json([], 404); }
            if (($q['alt'] ?? '') === 'media') { return ['status' => 200, 'body' => $f['content']]; }
            return $json(['id' => $mm[1], 'name' => $f['name'], 'version' => (string) $f['v'], 'size' => (string) strlen($f['content']), 'mimeType' => ($f['folder'] ?? false) ? 'application/vnd.google-apps.folder' : 'text/plain']);
        }
        $content = $b; $meta = [];
        if (str_contains($url, 'uploadType=multipart')) {
            preg_match('/boundary=(\S+)/', implode(' ', $h), $bm);
            $parts = explode('--' . $bm[1], (string) $b);
            $meta = json_decode(trim(explode("\r\n\r\n", $parts[1], 2)[1]), true);
            $content = rtrim(explode("\r\n\r\n", $parts[2], 2)[1], "\r\n");
        }
        if ($m === 'POST' && $path === '/upload/drive/v3/files') {
            $id = 'id' . str_pad((string) (count($store) + 1), 12, 'x');
            $store[$id] = ['name' => $meta['name'], 'content' => (string) $content, 'v' => 1, 'space' => in_array('appDataFolder', $meta['parents'] ?? [], true) ? 'app' : 'drive', 'parent' => ($meta['parents'][0] ?? '')];
            return $json(['id' => $id, 'name' => $meta['name'], 'version' => '1']);
        }
        if ($m === 'POST' && $path === '/drive/v3/files') {
            $d = json_decode((string) $b, true);
            $id = 'fold' . str_pad((string) (count($store) + 1), 12, 'x');
            $store[$id] = ['name' => $d['name'], 'content' => '', 'v' => 1, 'space' => 'drive', 'folder' => true];
            return $json(['id' => $id]);
        }
        if ($m === 'PATCH' && preg_match('#^/upload/drive/v3/files/([^/]+)$#', $path, $mm)) {
            $store[$mm[1]]['content'] = (string) $content;
            if (isset($meta['name'])) { $store[$mm[1]]['name'] = $meta['name']; }
            $store[$mm[1]]['v']++;
            return $json(['id' => $mm[1], 'name' => $store[$mm[1]]['name'], 'version' => (string) $store[$mm[1]]['v']]);
        }
        return $json([], 400);
    };
}
$ws = ['tabs' => [['id' => 't1', 'title' => 'a', 'content' => 'olá']], 'active' => 't1'];

test('drive: sem sessão → 401', function () {
    reset_env();
    eq(np_dispatch(req(['query' => ['r' => 'drive/workspace']]))['status'], 401);
});
test('workspace: vazio, criar, ler, atualizar', function () use ($ws) {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies();
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => $c]));
    eq(json_decode($r['body'], true), ['exists' => false]);
    $r = np_dispatch(post('drive/workspace/save', ['data' => $ws, 'baseVersion' => null], ['cookies' => $c]));
    eq($r['status'], 200); $v1 = json_decode($r['body'], true)['version'];
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => $c]));
    $d = json_decode($r['body'], true);
    eq($d['data'], $ws); eq($d['version'], $v1);
    $r = np_dispatch(post('drive/workspace/save', ['data' => $ws, 'baseVersion' => $v1], ['cookies' => $c]));
    eq($r['status'], 200);
    ok(json_decode($r['body'], true)['version'] !== $v1, 'versão deve mudar');
});
test('workspace: conflito não sobrescreve; force sobrescreve', function () use ($ws) {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies();
    np_dispatch(post('drive/workspace/save', ['data' => $ws, 'baseVersion' => null], ['cookies' => $c]));
    $other = ['tabs' => [['id' => 'z', 'title' => 'z', 'content' => 'remoto']], 'active' => 'z'];
    $r = np_dispatch(post('drive/workspace/save', ['data' => $other, 'baseVersion' => '999'], ['cookies' => $c]));
    eq($r['status'], 409);
    eq(json_decode($r['body'], true)['data'], $ws, 'devolve versão remota');
    $r = np_dispatch(post('drive/workspace/save', ['data' => $other, 'baseVersion' => null], ['cookies' => $c]));
    eq($r['status'], 409, 'sem baseVersion também conflita');
    $r = np_dispatch(post('drive/workspace/save', ['data' => $other, 'force' => true], ['cookies' => $c]));
    eq($r['status'], 200);
});
test('workspace: validação de entrada', function () {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies();
    foreach ([['data' => 'x'], ['data' => ['tabs' => 'x']], ['x' => 1], ['data' => ['tabs' => array_fill(0, 201, [])]]] as $b) {
        eq(np_dispatch(post('drive/workspace/save', $b, ['cookies' => $c]))['status'], 400);
    }
    eq(count($log), 0, 'nenhuma chamada ao Drive');
});
test('token: expirado é renovado e cookie atualizado; 401 persistente → reauth', function () use ($ws) {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies(['at' => 'EXPIRED', 'atx' => time() + 3000]);
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => $c]));
    eq($r['status'], 200, 'renovou após 401');
    ok(cookie_value($r, '__Host-notepad') !== null, 'cookie atualizado');
    $c = session_cookies(['rt' => 'RT', 'at' => 'x', 'atx' => 0]);
    $GLOBALS['np_http_fake'] = fn() => ['status' => 400, 'body' => '{"error":"invalid_grant"}'];
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => $c]));
    eq($r['status'], 401);
    eq(json_decode($r['body'], true)['error'], 'reauth');
});
test('files: criar, listar, abrir, atualizar com conflito', function () {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies();
    eq(json_decode(np_dispatch(req(['query' => ['r' => 'drive/files'], 'cookies' => $c]))['body'], true), ['files' => []]);
    $r = np_dispatch(post('drive/file/save', ['name' => 'nota.md', 'content' => '# oi'], ['cookies' => $c]));
    eq($r['status'], 200); $f = json_decode($r['body'], true);
    $l = json_decode(np_dispatch(req(['query' => ['r' => 'drive/files'], 'cookies' => $c]))['body'], true);
    eq($l['files'][0]['name'], 'nota.md');
    $g = json_decode(np_dispatch(req(['query' => ['r' => 'drive/file', 'id' => $f['id']], 'cookies' => $c]))['body'], true);
    eq($g['content'], '# oi');
    $r = np_dispatch(post('drive/file/save', ['id' => $f['id'], 'name' => 'nota.md', 'content' => 'novo', 'baseVersion' => $f['version']], ['cookies' => $c]));
    eq($r['status'], 200);
    $r = np_dispatch(post('drive/file/save', ['id' => $f['id'], 'name' => 'nota.md', 'content' => 'velho', 'baseVersion' => $f['version']], ['cookies' => $c]));
    eq($r['status'], 409);
});
test('files: IDs e nomes inválidos são rejeitados antes do Drive', function () {
    $store = []; $log = []; fake_drive($store, $log);
    $c = session_cookies();
    foreach (["../x", "abc'def", 'curto', str_repeat('a', 200), ''] as $id) {
        eq(np_dispatch(req(['query' => ['r' => 'drive/file', 'id' => $id], 'cookies' => $c]))['status'], 400, $id);
    }
    foreach (['', 'a/b', "a\x00b", str_repeat('n', 121), '..\\x'] as $n) {
        eq(np_dispatch(post('drive/file/save', ['name' => $n, 'content' => 'x'], ['cookies' => $c]))['status'], 400);
    }
    eq(np_dispatch(post('drive/file/save', ['name' => 'a', 'content' => 'x', 'id' => '../etc'], ['cookies' => $c]))['status'], 400);
    eq(count($log), 0);
});
test('files: pasta não é aberta como arquivo', function () {
    $store = ['foldxxxxxxxxxxxx' => ['name' => 'Notepad', 'content' => '', 'v' => 1, 'space' => 'drive', 'folder' => true]]; $log = [];
    fake_drive($store, $log);
    eq(np_dispatch(req(['query' => ['r' => 'drive/file', 'id' => 'foldxxxxxxxxxxxx'], 'cookies' => session_cookies()]))['status'], 415);
});
test('erro interno não vaza detalhes', function () {
    $GLOBALS['np_http_fake'] = fn() => ['status' => 500, 'body' => 'segredo interno'];
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => session_cookies()]));
    eq($r['status'], 500);
    ok(!str_contains($r['body'], 'segredo'));
});
test('429 do Drive vira rate_limited com Retry-After', function () {
    $GLOBALS['np_http_fake'] = fn() => ['status' => 429, 'body' => '{}'];
    $r = np_dispatch(req(['query' => ['r' => 'drive/workspace'], 'cookies' => session_cookies()]));
    eq($r['status'], 429);
    eq(hdr($r, 'Retry-After'), ['30']);
});
