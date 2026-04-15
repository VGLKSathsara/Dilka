<?php
// ============================================================
// api/save_invoice.php
// POST — save a new invoice + its line items
// ============================================================

if (session_status() === PHP_SESSION_NONE) session_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit();
}

require_once 'database.php';

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data && !empty($_POST)) {
    $data = $_POST;
    if (isset($data['items']) && is_string($data['items']))
        $data['items'] = json_decode($data['items'], true);
}

if (!$data) {
    echo json_encode(['success' => false, 'message' => 'No data received']);
    exit();
}
if (empty($data['invoice_no'])) {
    echo json_encode(['success' => false, 'message' => 'Invoice number required']);
    exit();
}

// ── Duplicate check ────────────────────────────────────────────────────────
try {
    $dup = $pdo->prepare("SELECT id FROM invoices WHERE invoice_no = ? LIMIT 1");
    $dup->execute([$data['invoice_no']]);
    if ($dup->fetch()) {
        echo json_encode([
            'success'    => true,
            'duplicate'  => true,
            'invoice_no' => $data['invoice_no'],
            'message'    => 'Invoice number already exists',
        ]);
        exit();
    }
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
    exit();
}

// ── Sanitise values ────────────────────────────────────────────────────────
$customerName  = trim($data['customer_name']  ?? '') ?: 'Walk-in Customer';
$customerPhone = trim($data['customer_phone'] ?? '') ?: 'Not Provided';
$subtotal      = floatval($data['subtotal']    ?? 0);
$discount      = floatval($data['discount']    ?? 0);
$total         = floatval($data['total']       ?? 0);
$paidAmount    = floatval($data['paid_amount'] ?? 0);
$status        = $data['status'] ?? 'pending';
$items         = is_array($data['items'] ?? null) ? $data['items'] : [];

if (!in_array($status, ['paid','pending','cancelled'])) $status = 'pending';
if ($status === 'paid')      $paidAmount = $total;
if ($status === 'cancelled') $paidAmount = 0;
$paidAmount = max(0, min($paidAmount, $total));

// Parse & validate invoice_date → always store as YYYY-MM-DD
$invoiceDate = date('Y-m-d');
if (!empty($data['invoice_date'])) {
    $parsed = date_create(trim($data['invoice_date']));
    if ($parsed) $invoiceDate = date_format($parsed, 'Y-m-d');
}

// ── Insert ──────────────────────────────────────────────────────────────────
try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare(
        "INSERT INTO invoices
             (invoice_no, customer_name, customer_phone, invoice_date,
              subtotal, discount, total, paid_amount, status, items_json,
              created_at, updated_at)
         VALUES
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
    );
    $stmt->execute([
        $data['invoice_no'],
        $customerName,
        $customerPhone,
        $invoiceDate,
        $subtotal,
        $discount,
        $total,
        $paidAmount,
        $status,
        json_encode($items),
    ]);
    $invoiceId = (int)$pdo->lastInsertId();

    // Insert line items
    if (!empty($items)) {
        $iStmt = $pdo->prepare(
            "INSERT INTO invoice_items
                 (invoice_id, item_name, quantity, price, total, item_type)
             VALUES (?, ?, ?, ?, ?, ?)"
        );
        foreach ($items as $item) {
            $name = trim($item['name'] ?? '') ?: 'Item';
            $qty  = max(1, intval($item['qty']   ?? 1));
            $pr   = floatval($item['price'] ?? 0);
            $tot  = floatval($item['total'] ?? $qty * $pr);
            $type = $item['type'] ?? 'accessory';
            $iStmt->execute([$invoiceId, $name, $qty, $pr, $tot, $type]);
        }
    }

    $pdo->commit();
    echo json_encode(['success' => true, 'id' => $invoiceId, 'invoice_no' => $data['invoice_no']]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
