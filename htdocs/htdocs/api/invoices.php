<?php
// ============================================================
// api/invoices.php
// GET    ?invoice_no=  — exact single invoice lookup
// GET    ?search=      — search by name / phone / invoice_no
// GET    ?status=      — filter by status
// PUT                  — update status & paid_amount
// DELETE              — delete single or clear_all
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
    $exactNo = isset($_GET['invoice_no']) ? trim($_GET['invoice_no']) : '';
    $search  = isset($_GET['search'])     ? trim($_GET['search'])     : '';
    $status  = isset($_GET['status'])     ? trim($_GET['status'])     : 'all';

    // DATE_FORMAT ensures frontend always receives YYYY-MM-DD  (bug fix)
    $sql    = "SELECT id, invoice_no, customer_name, customer_phone,
                      DATE_FORMAT(invoice_date,'%Y-%m-%d') AS invoice_date,
                      subtotal, discount, total, paid_amount, status,
                      items_json,
                      COALESCE(created_at, NOW()) AS created_at
               FROM   invoices
               WHERE  1=1";
    $params = [];

    if ($exactNo !== '') {
        // Exact lookup — used by print / whatsapp / payment modal
        $sql     .= " AND invoice_no = ?";
        $params[] = $exactNo;
    } elseif ($search !== '') {
        // Broad search across 3 columns
        $sql     .= " AND (customer_name LIKE ? OR customer_phone LIKE ? OR invoice_no LIKE ?)";
        $s        = "%$search%";
        $params[] = $s; $params[] = $s; $params[] = $s;
    }

    if ($status !== 'all' && in_array($status, ['paid','pending','cancelled'])) {
        $sql     .= " AND status = ?";
        $params[] = $status;
    }

    $sql .= " ORDER BY created_at DESC, id DESC LIMIT 1000";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        echo json_encode(array_map(fn($r) => [
            'id'             => (int)$r['id'],
            'invoice_no'     => $r['invoice_no'],
            'customer_name'  => $r['customer_name'],
            'customer_phone' => $r['customer_phone'],
            'invoice_date'   => $r['invoice_date'],     // always YYYY-MM-DD
            'subtotal'       => (float)$r['subtotal'],
            'discount'       => (float)$r['discount'],
            'total'          => (float)$r['total'],
            'paid_amount'    => (float)$r['paid_amount'],
            'status'         => $r['status'],
            'items_json'     => $r['items_json'],
            'created_at'     => $r['created_at'],
        ], $rows));
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }

// ── PUT (update payment / status) ────────────────────────────────────────────
} elseif ($method === 'PUT') {
    $data = json_decode(file_get_contents('php://input'), true);

    if (empty($data['invoice_no'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'invoice_no required']);
        exit();
    }

    $newStatus = $data['status']      ?? 'pending';
    $newPaid   = floatval($data['paid_amount'] ?? 0);

    if (!in_array($newStatus, ['paid','pending','cancelled'])) {
        echo json_encode(['success' => false, 'message' => 'Invalid status']);
        exit();
    }

    try {
        // Fetch current total so we can clamp paid_amount
        $inv = $pdo->prepare("SELECT total FROM invoices WHERE invoice_no = ?");
        $inv->execute([$data['invoice_no']]);
        $row = $inv->fetch();

        if (!$row) {
            echo json_encode(['success' => false, 'message' => 'Invoice not found']);
            exit();
        }

        $total = floatval($row['total']);
        if ($newStatus === 'paid')      $newPaid = $total;
        if ($newStatus === 'cancelled') $newPaid = 0;
        $newPaid = max(0, min($newPaid, $total));

        $pdo->prepare(
            "UPDATE invoices SET status = ?, paid_amount = ?, updated_at = NOW()
             WHERE invoice_no = ?"
        )->execute([$newStatus, $newPaid, $data['invoice_no']]);

        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }

// ── DELETE ────────────────────────────────────────────────────────────────────
} elseif ($method === 'DELETE') {
    $data = json_decode(file_get_contents('php://input'), true);

    if (!$data) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'No data received']);
        exit();
    }

    try {
        if (!empty($data['invoice_no'])) {
            // Delete single invoice (FK cascade removes invoice_items)
            $stmt = $pdo->prepare("DELETE FROM invoices WHERE invoice_no = ?");
            $stmt->execute([$data['invoice_no']]);
            echo json_encode(['success' => $stmt->rowCount() > 0,
                              'message' => $stmt->rowCount() ? '' : 'Invoice not found']);

        } elseif (isset($data['action']) && $data['action'] === 'clear_all') {
            $pdo->beginTransaction();
            $pdo->exec("DELETE FROM invoice_items");
            $pdo->exec("DELETE FROM invoices");
            $pdo->commit();
            echo json_encode(['success' => true]);

        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid delete request']);
        }
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
