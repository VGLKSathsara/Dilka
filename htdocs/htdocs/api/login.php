<?php
// ============================================================
// api/login.php
// ============================================================
// REMOVED: error_reporting / display_errors (was breaking JSON)
// KEPT:    MD5 hash (matches your existing DB records)
// ============================================================

if (session_status() === PHP_SESSION_NONE) session_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['success'=>false,'message'=>'Method not allowed']); exit(); }

require_once 'database.php';

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data && !empty($_POST)) $data = $_POST;

if (empty($data['username']) || empty($data['password'])) {
    echo json_encode(['success' => false, 'message' => 'Username and password required']);
    exit();
}

$username = trim($data['username']);
$phash    = md5(trim($data['password']));   // matches existing DB hash

try {
    $stmt = $pdo->prepare(
        "SELECT id, username, full_name, role
         FROM   users
         WHERE  username = ? AND password_hash = ? AND is_active = 1
         LIMIT  1"
    );
    $stmt->execute([$username, $phash]);
    $user = $stmt->fetch();

    if ($user) {
        $_SESSION['user_id']   = $user['id'];
        $_SESSION['username']  = $user['username'];
        $_SESSION['role']      = $user['role'];
        $_SESSION['logged_in'] = true;

        $pdo->prepare("UPDATE users SET last_login = NOW() WHERE id = ?")
            ->execute([$user['id']]);

        echo json_encode([
            'success' => true,
            'user'    => [
                'id'        => $user['id'],
                'username'  => $user['username'],
                'full_name' => $user['full_name'],
                'role'      => $user['role'],
            ],
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid username or password']);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Server error']);
}
