<?php
declare(strict_types=1);
if (!defined('NP_APP')) { http_response_code(404); exit; }

const NP_FOLDER_NAME = 'Notepad';
const NP_WS_NAME = 'workspace.json';
const NP_MAX_CONTENT = 1536 * 1024;

final class NpReauth extends RuntimeException {}
final class NpRateLimited extends RuntimeException {}

/** Executa $fn($token) com renovação do token; 401 do Drive vira reautenticação. */
function np_with_drive(array $req, callable $fn): array {
    $s = np_session($req);
    if ($s === null) { return np_error(401, 'unauthenticated'); }
    foreach ([false, true] as $force) {
        if ($force) { unset($s['at'], $s['atx']); }
        $a = np_access($req, $s);
        if ($a === null) { break; }
        try {
            $res = $fn($a[0]);
            $res['headers'] = array_merge($res['headers'], $a[1]);
            return $res;
        } catch (NpReauth) {
            continue;
        } catch (NpRateLimited) {
            return np_error(429, 'rate_limited', [['Retry-After', '30']]);
        }
    }
    return np_error(401, 'reauth', [np_clear_cookie($req, 'notepad')]);
}

function np_check(array $r, array $ok = [200]): array {
    if ($r['status'] === 401) { throw new NpReauth(); }
    if ($r['status'] === 429 || ($r['status'] === 403 && str_contains($r['body'], 'rateLimitExceeded'))) { throw new NpRateLimited(); }
    if (!in_array($r['status'], $ok, true)) {
        error_log('notepad: drive status ' . $r['status']);
        throw new RuntimeException('drive');
    }
    return $r;
}

function np_json_body(array $req): ?array {
    $d = json_decode($req['body'], true);
    return is_array($d) ? $d : null;
}

function np_ws_find(string $token): ?array {
    $r = np_check(np_drive('GET', '/files', $token, [
        'spaces' => 'appDataFolder',
        'q' => "name='" . NP_WS_NAME . "' and trashed=false",
        'fields' => 'files(id,version)',
        'pageSize' => 1,
    ]));
    return np_drive_json($r)['files'][0] ?? null;
}

function np_h_ws_get(array $req): array {
    return np_with_drive($req, function (string $token): array {
        $f = np_ws_find($token);
        if ($f === null) { return np_json(200, ['exists' => false]); }
        $r = np_check(np_drive('GET', '/files/' . $f['id'], $token, ['alt' => 'media']));
        $data = json_decode($r['body'], true);
        if (!is_array($data)) { return np_error(502, 'bad_remote_data'); }
        return np_json(200, ['exists' => true, 'version' => (string) $f['version'], 'data' => $data]);
    });
}

function np_h_ws_save(array $req): array {
    $in = np_json_body($req);
    if ($in === null || !isset($in['data']) || !is_array($in['data']) || !is_array($in['data']['tabs'] ?? null) || count($in['data']['tabs']) > 200) {
        return np_error(400, 'bad_request');
    }
    $base = isset($in['baseVersion']) && is_string($in['baseVersion']) ? $in['baseVersion'] : null;
    $force = ($in['force'] ?? false) === true;
    $payload = json_encode($in['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return np_with_drive($req, function (string $token) use ($base, $force, $payload): array {
        $f = np_ws_find($token);
        if ($f !== null && !$force && $base !== (string) $f['version']) {
            $r = np_check(np_drive('GET', '/files/' . $f['id'], $token, ['alt' => 'media']));
            return np_json(409, ['error' => 'conflict', 'version' => (string) $f['version'], 'data' => json_decode($r['body'], true)]);
        }
        if ($f === null) {
            [$body, $ct] = np_drive_multipart(['name' => NP_WS_NAME, 'parents' => ['appDataFolder']], $payload);
            $r = np_check(np_drive('POST', '/files', $token, ['uploadType' => 'multipart', 'fields' => 'id,version'], $body, $ct, true));
        } else {
            $r = np_check(np_drive('PATCH', '/files/' . $f['id'], $token, ['uploadType' => 'media', 'fields' => 'id,version'], $payload, 'text/plain; charset=UTF-8', true));
        }
        return np_json(200, ['version' => (string) (np_drive_json($r)['version'] ?? '')]);
    });
}

function np_folder_find(string $token, bool $create): ?string {
    $r = np_check(np_drive('GET', '/files', $token, [
        'q' => "mimeType='application/vnd.google-apps.folder' and name='" . NP_FOLDER_NAME . "' and trashed=false",
        'fields' => 'files(id)',
        'pageSize' => 1,
    ]));
    $id = np_drive_json($r)['files'][0]['id'] ?? null;
    if ($id !== null || !$create) { return $id; }
    $r = np_check(np_drive('POST', '/files', $token, ['fields' => 'id'], json_encode(['name' => NP_FOLDER_NAME, 'mimeType' => 'application/vnd.google-apps.folder']), 'application/json'));
    return np_drive_json($r)['id'] ?? null;
}

function np_h_files_list(array $req): array {
    return np_with_drive($req, function (string $token): array {
        $folder = np_folder_find($token, false);
        if ($folder === null || !np_valid_id($folder)) { return np_json(200, ['files' => []]); }
        $r = np_check(np_drive('GET', '/files', $token, [
            'q' => "'" . $folder . "' in parents and trashed=false",
            'fields' => 'files(id,name,modifiedTime,version)',
            'orderBy' => 'modifiedTime desc',
            'pageSize' => 100,
        ]));
        return np_json(200, ['files' => np_drive_json($r)['files'] ?? []]);
    });
}

function np_h_file_get(array $req): array {
    $id = $req['query']['id'] ?? null;
    if (!np_valid_id($id)) { return np_error(400, 'bad_request'); }
    return np_with_drive($req, function (string $token) use ($id): array {
        $m = np_drive_json(np_check(np_drive('GET', '/files/' . $id, $token, ['fields' => 'id,name,version,size,mimeType'])));
        if (($m['mimeType'] ?? '') === 'application/vnd.google-apps.folder' || (int) ($m['size'] ?? 0) > NP_MAX_CONTENT) {
            return np_error(415, 'unsupported_file');
        }
        $r = np_check(np_drive('GET', '/files/' . $id, $token, ['alt' => 'media']));
        if (!mb_check_encoding($r['body'], 'UTF-8')) { return np_error(415, 'unsupported_file'); }
        return np_json(200, ['id' => $m['id'], 'name' => $m['name'], 'version' => (string) $m['version'], 'content' => $r['body']]);
    });
}

function np_valid_name(mixed $n): bool {
    return is_string($n) && $n !== '' && mb_strlen($n) <= 120 && preg_match('/[\x00-\x1f\/\\\\]/', $n) === 0;
}

function np_h_file_save(array $req): array {
    $in = np_json_body($req);
    $id = $in['id'] ?? null;
    if ($in === null || !np_valid_name($in['name'] ?? null) || !is_string($in['content'] ?? null)
        || strlen($in['content']) > NP_MAX_CONTENT || ($id !== null && !np_valid_id($id))) {
        return np_error(400, 'bad_request');
    }
    $base = isset($in['baseVersion']) && is_string($in['baseVersion']) ? $in['baseVersion'] : null;
    $force = ($in['force'] ?? false) === true;

    return np_with_drive($req, function (string $token) use ($in, $id, $base, $force): array {
        if ($id === null) {
            $folder = np_folder_find($token, true);
            if ($folder === null || !np_valid_id($folder)) { return np_error(502, 'drive_error'); }
            [$body, $ct] = np_drive_multipart(['name' => $in['name'], 'parents' => [$folder], 'mimeType' => 'text/plain'], $in['content']);
            $r = np_check(np_drive('POST', '/files', $token, ['uploadType' => 'multipart', 'fields' => 'id,name,version'], $body, $ct, true));
        } else {
            $m = np_drive_json(np_check(np_drive('GET', '/files/' . $id, $token, ['fields' => 'version'])));
            if (!$force && $base !== (string) ($m['version'] ?? '')) {
                return np_json(409, ['error' => 'conflict', 'version' => (string) ($m['version'] ?? '')]);
            }
            [$body, $ct] = np_drive_multipart(['name' => $in['name']], $in['content']);
            $r = np_check(np_drive('PATCH', '/files/' . $id, $token, ['uploadType' => 'multipart', 'fields' => 'id,name,version'], $body, $ct, true));
        }
        $d = np_drive_json($r) ?? [];
        return np_json(200, ['id' => $d['id'] ?? $id, 'name' => $d['name'] ?? $in['name'], 'version' => (string) ($d['version'] ?? '')]);
    });
}
