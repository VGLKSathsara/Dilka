<?php
// ============================================================
// api/inventory.php
// GET    — list all products
// POST   — add new product
// PUT    — update product (name / price / quantity)
// DELETE — remove product
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

// ── GET ──────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $search   = isset($_GET['search'])   ? trim($_GET['search'])   : '';
    $category = isset($_GET['category']) ? trim($_GET['category']) : '';

    $sql    = "SELECT id, product_name AS name, price, quantity, category
               FROM   inventory
               WHERE  1=1";
    $params = [];

    if ($search !== '') {
        $sql     .= " AND product_name LIKE ?";
        $params[] = "%$search%";
    }
    if ($category !== '') {
        $sql     .= " AND category = ?";
        $params[] = $category;
    }
    $sql .= " ORDER BY product_name ASC";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        echo json_encode(array_map(fn($r) => [
            'id'       => (int)$r['id'],
            'name'     => $r['name'],
            'price'    => (float)$r['price'],
            'quantity' => (int)$r['quantity'],
            'category' => $r['category'],
        ], $rows));
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }

// ── POST (add) ────────────────────────────────────────────────────────────────
} elseif ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    if (empty($data['name'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Product name required']);
        exit();
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO inventory (product_name, price, quantity, category)
             VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([
            trim($data['name']),
            floatval($data['price']    ?? 0),
            intval($data['quantity']   ?? 0),
            trim($data['category']     ?? 'accessory'),
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

    if (isset($data['name']))     { $fields[] = 'product_name = ?'; $params[] = trim($data['name']); }
    if (isset($data['price']))    { $fields[] = 'price = ?';        $params[] = floatval($data['price']); }
    if (isset($data['quantity'])) { $fields[] = 'quantity = ?';     $params[] = intval($data['quantity']); }
    if (isset($data['category'])) { $fields[] = 'category = ?';     $params[] = trim($data['category']); }

    if (empty($fields)) {
        echo json_encode(['success' => false, 'message' => 'Nothing to update']);
        exit();
    }

    $params[] = intval($data['id']);
    try {
        $pdo->prepare("UPDATE inventory SET " . implode(', ', $fields) . ", updated_at = NOW() WHERE id = ?")
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
        $stmt = $pdo->prepare("DELETE FROM inventory WHERE id = ?");
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
