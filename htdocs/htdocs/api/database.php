<?php
// ============================================================
// api/database.php — DB connection ONLY
// NO headers here — every api file sets its own headers once
// InfinityFree: tries sql101 first, falls back to localhost
// ============================================================

$DB_NAME = 'if0_41659003_techno_pos_database';
$DB_USER = 'if0_41659003';
$DB_PASS = 'lanishka123';

// InfinityFree — try the assigned SQL host first, then localhost
$hosts = [
    'sql101.infinityfree.com',
    'localhost',
    '127.0.0.1',
];

$pdo       = null;
$lastError = '';

foreach ($hosts as $host) {
    try {
        $pdo = new PDO(
            "mysql:host=$host;dbname=$DB_NAME;charset=utf8mb4",
            $DB_USER,
            $DB_PASS,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_TIMEOUT            => 5,
            ]
        );
        // Connection succeeded — stop trying
        break;
    } catch (PDOException $e) {
        $lastError = $e->getMessage();
        $pdo       = null;
        continue;
    }
}

if (!$pdo) {
    http_response_code(500);
    echo json_encode([
        'error'   => 'DB connection failed',
        'details' => $lastError,
    ]);
    exit();
}