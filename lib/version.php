<?php
declare(strict_types=1);
if (!defined("NP_APP")) { http_response_code(404); exit; }

/** Versões mínimas que corrigem PHP2Shell (CVE-2026-109618 / CVE-2026-109619). */
const NP_MIN_PATCHED = ['8.2' => '8.2.35', '8.3' => '8.3.36', '8.4' => '8.4.27', '8.5' => '8.5.12'];

function np_php_patched(string $version = PHP_VERSION): bool {
    if (!preg_match('/^(\d+)\.(\d+)\.(\d+)/', $version, $m)) { return false; }
    $branch = $m[1] . '.' . $m[2];
    if (isset(NP_MIN_PATCHED[$branch])) { return version_compare($m[0], NP_MIN_PATCHED[$branch], '>='); }
    return version_compare($m[1] . '.' . $m[2], '8.5', '>');
}
