<?php
// ============================================================
// api/terms.php
// GET    — list all terms ordered by display_order
// POST   — add new term
// PUT    — update text / toggle selected / reorder
// DELETE — remove term
// ============================================================

if (session_status() === PHP_SESSION_NONE) session_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

require_once 'database.php';

$method = $_SERVER['REQUEST_METHOD'];

// ── GET ───────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    try {
        $rows = $pdo->query(
            "SELECT id, term_text, is_selected FROM terms ORDER BY display_order ASC, id ASC"
        )->fetchAll();

        echo json_encode(array_map(fn($r) => [
            'id'       => (int)$r['id'],
            'text'     => $r['term_text'],
            'selected' => (bool)$r['is_selected'],
        ], $rows));
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }

// ── POST (add) ────────────────────────────────────────────────────────────────
} elseif ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (empty($data['text'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Term text required']);
        exit();
    }
    try {
        $stmt = $pdo->prepare(
            "INSERT INTO terms (term_text, is_selected, display_order) VALUES (?, ?, ?)"
        );
        $stmt->execute([
            trim($data['text']),
            isset($data['selected']) ? (int)(bool)$data['selected'] : 1,
            intval($data['order'] ?? 99),
        ]);
        echo json_encode(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }

// ── PUT (update) ──────────────────────────────────────────────────────────────
} elseif ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'id required']);
        exit();
    }
    $fields = [];
    $params = [];
    if (isset($data['text']))     { $fields[] = 'term_text = ?';    $params[] = trim($data['text']); }
    if (isset($data['selected'])) { $fields[] = 'is_selected = ?';  $params[] = (int)(bool)$data['selected']; }
    if (isset($data['order']))    { $fields[] = 'display_order = ?';$params[] = intval($data['order']); }

    if (empty($fields)) { echo json_encode(['success' => false, 'message' => 'Nothing to update']); exit(); }

    $params[] = intval($data['id']);
    try {
        $pdo->prepare("UPDATE terms SET " . implode(', ', $fields) . ", updated_at = NOW() WHERE id = ?")
            ->execute($params);
        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }

// ── DELETE ────────────────────────────────────────────────────────────────────
} elseif ($method === 'DELETE') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'id required']);
        exit();
    }
    try {
        $stmt = $pdo->prepare("DELETE FROM terms WHERE id = ?");
        $stmt->execute([intval($data['id'])]);
        echo json_encode(['success' => $stmt->rowCount() > 0]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
