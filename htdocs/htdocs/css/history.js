// ============================================================
// Techno Mobile POS — history.js v4.0 (Backend Connected)
// ALL localStorage replaced with api/invoices.php calls
// ============================================================

if (!window.API_BASE) {
  window.API_BASE = window.location.origin + '/api/'
}

let _chartMode     = 'daily'
let _chartInstance = null

// ─── Utilities ────────────────────────────────────────────────────────────────
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function _fmt(n) {
  return (parseFloat(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

// Today as YYYY-MM-DD — used to compare against DB invoice_date (also YYYY-MM-DD)
// FIX: old code compared DB's "2026-04-14" against locale "Apr 14, 2026" — always wrong
function _todayISO() {
  const d = new Date()
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0')
}

// Parse YYYY-MM-DD into a Date object without timezone offset issues
// FIX: new Date("2026-04-14") parses as UTC midnight → wrong day in local TZ
function _parseISO(str) {
  if (!str) return null
  const s = String(str).slice(0, 10).split('-').map(Number)
  if (s.length !== 3 || !s[0]) return null
  return new Date(s[0], s[1] - 1, s[2])
}

// Format YYYY-MM-DD for UI display: "Apr 14, 2026"
function _displayDate(str) {
  const d = _parseISO(str)
  return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : (str || 'N/A')
}

function _balanceDue(inv) {
  if (inv.status === 'paid' || inv.status === 'cancelled') return 0
  return Math.max(0, (parseFloat(inv.total) || 0) - (parseFloat(inv.paid_amount) || 0))
}

function _paidAmount(inv) {
  return inv.status === 'paid'
    ? parseFloat(inv.total) || 0
    : parseFloat(inv.paid_amount) || 0
}

function _statusBadge(inv) {
  const s = inv.status || 'pending'
  if (s === 'paid')
    return `<span class="status-badge paid"><i class="fas fa-check-circle"></i> Paid</span>`
  if (s === 'cancelled')
    return `<span class="status-badge cancelled"><i class="fas fa-times-circle"></i> Cancelled</span>`
  const bal = _balanceDue(inv)
  return bal > 0
    ? `<span class="status-badge pending"><i class="fas fa-clock"></i> Pending &middot; Rs.${_fmt(bal)}</span>`
    : `<span class="status-badge paid"><i class="fas fa-check-circle"></i> Paid</span>`
}

// Safe fetch — throws readable error on non-JSON server response
async function _apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  const ct  = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const txt = await res.text()
    console.error('Non-JSON from', url, ':', txt.slice(0, 400))
    throw new Error('Server error — check API logs')
  }
  return res.json()
}

function showToast(msg, type = '') {
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg
  t.className   = 'toast show' + (type ? ' ' + type : '')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.remove('show'), 3200)
}

// ─── DISPLAY HISTORY — main entry point ───────────────────────────────────────
window.displayHistory = async function () {
  const query  = (document.getElementById('historySearch')?.value || '').trim()
  const status = document.getElementById('statusFilter')?.value || 'all'

  // Show spinner while loading
  const listEl = document.getElementById('historyList')
  if (listEl) listEl.innerHTML = `<div class="empty-state">
    <i class="fas fa-spinner fa-spin" style="font-size:28px;opacity:.4"></i>
    <p>Loading invoices...</p></div>`

  try {
    let url = window.API_BASE + 'invoices.php?'
    if (query)          url += 'search='  + encodeURIComponent(query)  + '&'
    if (status !== 'all') url += 'status=' + encodeURIComponent(status) + '&'

    const data     = await _apiFetch(url)
    const invoices = Array.isArray(data) ? data : (data.data || [])

    _renderStats(invoices)
    _renderChart(invoices)
    _renderList(invoices)
  } catch (err) {
    console.error('displayHistory error:', err)
    showToast('Failed to load invoices: ' + err.message, 'error')
    if (listEl) listEl.innerHTML = `<div class="empty-state">
      <i class="fas fa-exclamation-triangle"></i>
      <p>Could not load invoices.<br><small>${_esc(err.message)}</small></p></div>`
  }
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function _renderStats(invoices) {
  const el = document.getElementById('historyStats')
  if (!el) return

  const totalRev = invoices.reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0)
  const avg      = invoices.length ? totalRev / invoices.length : 0
  const today    = _todayISO()

  // Compare YYYY-MM-DD strings directly — no locale conversion (bug fixed)
  const todayRev = invoices
    .filter(inv => inv.invoice_date && inv.invoice_date.slice(0, 10) === today)
    .reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0)

  const pendingInvs    = invoices.filter(inv => inv.status === 'pending')
  const pendingBal     = pendingInvs.reduce((s, inv) => s + _balanceDue(inv), 0)
  const paidCount      = invoices.filter(inv => inv.status === 'paid').length
  const pendingCount   = invoices.filter(inv => inv.status === 'pending').length
  const cancelledCount = invoices.filter(inv => inv.status === 'cancelled').length

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Invoices</div>
      <div class="stat-value blue">${invoices.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Revenue</div>
      <div class="stat-value green">Rs. ${_fmt(totalRev)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg. Invoice</div>
      <div class="stat-value">Rs. ${_fmt(avg)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Today's Revenue</div>
      <div class="stat-value" style="color:var(--warning)">Rs. ${_fmt(todayRev)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Pending Balance</div>
      <div class="stat-value" style="color:var(--danger)">
        Rs. ${_fmt(pendingBal)}
        ${pendingInvs.length ? `<span style="font-size:12px;opacity:.7"> (${pendingInvs.length})</span>` : ''}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Paid / Pending / Cancelled</div>
      <div class="stat-value" style="font-size:16px">
        <span style="color:var(--secondary)">${paidCount}</span> /
        <span style="color:var(--warning)">${pendingCount}</span> /
        <span style="color:var(--danger)">${cancelledCount}</span>
      </div>
    </div>`
}

// ─── CHART ────────────────────────────────────────────────────────────────────
function _renderChart(invoices) {
  const container = document.getElementById('revenueChartContainer')
  const canvas    = document.getElementById('revenueChart')
  if (!container || !canvas) return

  if (!invoices.length) { container.style.display = 'none'; return }
  container.style.display = 'block'

  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark'
  const gridClr = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
  const lblClr  = isDark ? '#94a3b8' : '#64748b'

  const { labels, paid, partial } = _buildChartData(invoices, _chartMode)

  if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null }

  _chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Paid',             data: paid,    backgroundColor: isDark ? 'rgba(16,185,129,0.75)' : 'rgba(5,150,105,0.7)',   borderRadius: 6 },
        { label: 'Partial / Pending',data: partial, backgroundColor: isDark ? 'rgba(251,191,36,0.7)'  : 'rgba(245,158,11,0.65)', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: lblClr, font: { family: 'Outfit', size: 12, weight: '600' } } },
        tooltip: { callbacks: { label: c => ` Rs. ${_fmt(c.parsed.y)}` }, backgroundColor: isDark ? '#1e293b' : '#0f172a', padding: 12, cornerRadius: 10 },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: lblClr, font: { family: 'Outfit', size: 11 } } },
        y: { stacked: true, grid: { color: gridClr  }, ticks: { color: lblClr, font: { family: 'Outfit', size: 11 }, callback: v => 'Rs.' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v) } },
      },
    },
  })
}

// FIX: All date comparisons use ISO strings or _parseISO — never locale strings
function _buildChartData(invoices, mode) {
  const now = new Date()
  const labels = [], paid = [], partial = []

  if (mode === 'daily') {
    for (let i = 13; i >= 0; i--) {
      const d   = new Date(now); d.setDate(d.getDate() - i)
      const iso = d.getFullYear() + '-'
        + String(d.getMonth()+1).padStart(2,'0') + '-'
        + String(d.getDate()).padStart(2,'0')
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
      const day = invoices.filter(inv => inv.invoice_date && inv.invoice_date.slice(0,10) === iso)
      paid.push(day.filter(inv => inv.status === 'paid').reduce((s,inv) => s+(parseFloat(inv.total)||0), 0))
      partial.push(day.filter(inv => inv.status !== 'paid').reduce((s,inv) => s+(parseFloat(inv.paid_amount)||0), 0))
    }
  } else if (mode === 'weekly') {
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(now); ws.setDate(ws.getDate() - ws.getDay() - i*7); ws.setHours(0,0,0,0)
      const we = new Date(ws); we.setDate(we.getDate()+6); we.setHours(23,59,59,999)
      labels.push(`Wk ${12 - i}`)
      const wk = invoices.filter(inv => { const d = _parseISO(inv.invoice_date); return d && d >= ws && d <= we })
      paid.push(wk.filter(inv => inv.status === 'paid').reduce((s,inv) => s+(parseFloat(inv.total)||0), 0))
      partial.push(wk.filter(inv => inv.status !== 'paid').reduce((s,inv) => s+(parseFloat(inv.paid_amount)||0), 0))
    }
  } else {
    // monthly
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1)
      labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }))
      const mo = invoices.filter(inv => { const pd = _parseISO(inv.invoice_date); return pd && pd.getMonth()===d.getMonth() && pd.getFullYear()===d.getFullYear() })
      paid.push(mo.filter(inv => inv.status === 'paid').reduce((s,inv) => s+(parseFloat(inv.total)||0), 0))
      partial.push(mo.filter(inv => inv.status !== 'paid').reduce((s,inv) => s+(parseFloat(inv.paid_amount)||0), 0))
    }
  }
  return { labels, paid, partial }
}

window.setChartMode = function (mode) {
  _chartMode = mode
  document.querySelectorAll('.chart-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
  displayHistory()
}

// ─── HISTORY LIST ─────────────────────────────────────────────────────────────
function _renderList(invoices) {
  const el = document.getElementById('historyList')
  if (!el) return

  if (!invoices.length) {
    el.innerHTML = `<div class="empty-state">
      <i class="fas fa-receipt"></i>
      <p>No invoices found. Try adjusting your search or filters.</p></div>`
    return
  }

  el.innerHTML = invoices.map((inv, idx) => {
    const phone = inv.customer_phone && inv.customer_phone !== 'Not Provided' ? inv.customer_phone : ''
    return `
    <div class="history-item ${inv.status || 'pending'}">
      <div class="history-num">${idx + 1}</div>
      <div class="history-info">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <h4>${_esc(inv.customer_name || 'Walk-in Customer')}</h4>
          ${_statusBadge(inv)}
        </div>
        <div class="history-meta">
          <span><i class="fas fa-hashtag"></i> ${_esc(inv.invoice_no || 'N/A')}</span>
          <span><i class="fas fa-calendar-alt"></i> ${_esc(_displayDate(inv.invoice_date))}</span>
          ${phone ? `<span><i class="fas fa-phone"></i> ${_esc(phone)}</span>` : ''}
        </div>
      </div>
      <div class="history-amount">Rs. ${_fmt(inv.total || 0)}</div>
      <div class="history-actions">
        <button class="history-btn view"          onclick="printInvoice('${_esc(inv.invoice_no)}')"        title="Print / PDF"><i class="fas fa-print"></i></button>
        <button class="history-btn whatsapp"      onclick="shareWhatsApp('${_esc(inv.invoice_no)}')"       title="WhatsApp"><i class="fab fa-whatsapp"></i></button>
        <button class="history-btn status-toggle" onclick="openPaymentModal('${_esc(inv.invoice_no)}')"   title="Manage Payment"><i class="fas fa-credit-card"></i></button>
        <button class="history-btn delete"        onclick="deleteFromHistory('${_esc(inv.invoice_no)}')"  title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </div>`
  }).join('')
}

// ─── FETCH SINGLE INVOICE — exact lookup by invoice_no ────────────────────────
// FIX: old code used ?search= which could match wrong invoice if customer name
//      contained invoice-number-like text. Now uses ?invoice_no= exact param.
async function _fetchOne(invoiceNo) {
  const data = await _apiFetch(window.API_BASE + 'invoices.php?invoice_no=' + encodeURIComponent(invoiceNo))
  const list = Array.isArray(data) ? data : (data.data || [])
  return list.find(i => i.invoice_no === invoiceNo) || null
}

// ─── PRINT INVOICE ────────────────────────────────────────────────────────────
window.printInvoice = async function (invoiceNo) {
  try {
    showToast('Loading invoice...', '')
    const inv = await _fetchOne(invoiceNo)
    if (!inv) { showToast('Invoice not found', 'error'); return }

    let itemsArr = []
    try { itemsArr = JSON.parse(inv.items_json || '[]') } catch (e) {}

    const itemsHTML = itemsArr.length
      ? itemsArr.map(item => `
          <tr>
            <td style="text-align:left">${_esc(item.name||'Item')}</td>
            <td style="text-align:center">${item.qty||1}</td>
            <td style="text-align:right">Rs. ${_fmt(item.price||0)}</td>
            <td style="text-align:right">Rs. ${_fmt(item.total||0)}</td>
          </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8">No items recorded</td></tr>'

    document.getElementById('printCustomerName').innerText  = inv.customer_name || 'Walk-in Customer'
    document.getElementById('printCustomerPhone').innerText = inv.customer_phone !== 'Not Provided' ? (inv.customer_phone || '') : ''
    document.getElementById('printInvoiceNo').innerText     = inv.invoice_no || 'N/A'
    document.getElementById('printDate').innerText          = _displayDate(inv.invoice_date)
    document.getElementById('printItemsBody').innerHTML     = itemsHTML
    document.getElementById('printSubTotal').innerText      = `Rs. ${_fmt(inv.subtotal||0)}`
    document.getElementById('printDiscount').innerText      = `-Rs. ${_fmt(inv.discount||0)}`
    document.getElementById('printGrandTotal').innerText    = `Rs. ${_fmt(inv.total||0)}`

    const s    = inv.status || 'pending'
    const paid = _paidAmount(inv)
    const bal  = _balanceDue(inv)
    const sd   = document.getElementById('printPaymentStatus')

    if (s === 'paid') {
      sd.innerHTML = `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:13px 18px;margin:0 0 14px;display:flex;justify-content:space-between;align-items:center">
        <div><strong style="color:#15803d">✓ PAID IN FULL</strong><div style="font-size:11px;color:#166534;margin-top:3px">Payment received — Thank you!</div></div>
        <strong style="color:#15803d;font-size:16px">Rs. ${_fmt(paid)}</strong></div>`
    } else if (s === 'pending' && bal > 0) {
      sd.innerHTML = `<div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;padding:13px 18px;margin:0 0 14px">
        <strong style="color:#92400e">⏳ PARTIAL PAYMENT — BALANCE DUE</strong>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          <span style="color:#78350f">Paid: <strong>Rs. ${_fmt(paid)}</strong></span>
          <span style="color:#991b1b;font-weight:700">Balance: Rs. ${_fmt(bal)}</span>
        </div></div>`
    } else if (s === 'cancelled') {
      sd.innerHTML = `<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:13px 18px;margin:0 0 14px">
        <strong style="color:#991b1b">✕ INVOICE CANCELLED</strong></div>`
    } else { sd.innerHTML = '' }

    // Terms from API
    try {
      const terms    = await _apiFetch(window.API_BASE + 'terms.php')
      const selected = Array.isArray(terms) ? terms.filter(t => t.selected) : []
      document.getElementById('printTermsList').innerHTML = selected.length
        ? selected.map(t => `<li><i class="fas fa-check-circle" style="color:#10b981"></i> ${_esc(t.text)}</li>`).join('')
        : '<li>No terms selected</li>'
    } catch (e) {
      document.getElementById('printTermsList').innerHTML = '<li>Terms unavailable</li>'
    }

    const content = document.getElementById('printTemplate').innerHTML
    const win     = window.open('', '_blank')
    if (!win) { showToast('Pop-up blocked! Please allow pop-ups.', 'error'); return }

    win.document.write(`<!DOCTYPE html><html><head>
      <title>Invoice ${_esc(inv.invoice_no)}</title><meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      <style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Outfit',sans-serif;background:#f8fafc;padding:24px}
        .invoice-wrap{max-width:210mm;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.12)}
        .print-header{background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:24px 28px;color:#fff}
        .print-header-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:14px}
        .print-brand{display:flex;align-items:center;gap:16px}
        .print-brand-icon{width:52px;height:52px;background:#fff;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#2563eb;font-size:22px;font-weight:800}
        .print-brand-text h1{font-size:22px;font-weight:800;color:#fff;margin:0}.print-brand-text p{font-size:10px;opacity:.8;margin:3px 0 0}
        .print-badge{background:rgba(255,255,255,.15);padding:10px 22px;border-radius:40px;border:1px solid rgba(255,255,255,.2)}
        .print-badge h2{font-size:20px;font-weight:700;margin:0;color:#fff}
        .print-info{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        .print-bill-to,.print-invoice-details{background:rgba(255,255,255,.1);padding:14px 16px;border-radius:10px}
        .print-invoice-details{display:flex;justify-content:space-between;gap:20px}
        .print-label{font-size:9px;text-transform:uppercase;letter-spacing:.5px;opacity:.8;margin-bottom:5px;font-weight:700}
        .print-value{font-size:14px;font-weight:700}.print-phone{font-size:12px;opacity:.9;margin-top:4px}
        .print-body{padding:24px 28px;background:#fff}
        .print-table{width:100%;border-collapse:collapse;margin:14px 0}
        .print-table th{background:#f8fafc;padding:12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0;text-align:left}
        .print-table td{padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:13px}
        .print-totals{display:flex;justify-content:flex-end;margin:18px 0}
        .print-totals-box{width:280px;background:#f8fafc;padding:16px 20px;border-radius:12px}
        .print-total-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #cbd5e1;font-size:13px}
        .print-grand-total{display:flex;justify-content:space-between;padding:12px 0 0;margin-top:8px;border-top:2px solid #1e293b;font-size:16px;font-weight:800}
        .print-grand-total span:last-child{color:#2563eb;font-size:18px}
        .print-footer{display:grid;grid-template-columns:1.5fr 1fr;gap:20px;margin-top:24px;padding-top:20px;border-top:2px solid #e2e8f0}
        .print-thankyou h3{font-size:15px;font-weight:700;color:#1e293b;margin:0 0 8px}
        .print-thankyou p{font-size:11px;color:#64748b;line-height:1.5;margin:0}
        .print-terms{background:#f8fafc;padding:14px 18px;border-radius:12px}
        .print-terms h4{font-size:12px;font-weight:700;color:#1e293b;margin:0 0 10px}
        .print-terms ul{list-style:none;padding:0;margin:0}
        .print-terms li{font-size:11px;color:#475569;margin-bottom:7px;display:flex;align-items:flex-start;gap:6px;line-height:1.4}
        .print-btn{display:block;margin:20px auto 0;padding:12px 32px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif}
        @media print{body{padding:0;background:#fff}.print-btn{display:none}.invoice-wrap{box-shadow:none;border-radius:0}.print-header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
        @page{size:A4;margin:12mm}
        @media(max-width:600px){.print-info,.print-footer{grid-template-columns:1fr}}
      </style></head><body>
      <div class="invoice-wrap">${content}</div>
      <button class="print-btn" onclick="window.print()"><i class="fas fa-print"></i> Print / Save as PDF</button>
      <script>setTimeout(()=>window.print(),600)<\/script>
    </body></html>`)
    win.document.close()
    showToast('Opening print preview...', 'success')
  } catch (err) {
    console.error('printInvoice error:', err)
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
window.shareWhatsApp = async function (invoiceNo) {
  try {
    const inv = await _fetchOne(invoiceNo)
    if (!inv) { showToast('Invoice not found', 'error'); return }

    let itemsArr = []
    try { itemsArr = JSON.parse(inv.items_json || '[]') } catch (e) {}
    const itemsText = itemsArr.map(item => `  • ${item.name||'Item'} ×${item.qty||1} — Rs. ${_fmt(item.total||0)}\n`).join('')

    const s    = inv.status || 'pending'
    const paid = _paidAmount(inv)
    const bal  = _balanceDue(inv)
    const stB  = s==='paid' ? `✅ PAID IN FULL — Rs. ${_fmt(paid)}` : s==='cancelled' ? '❌ CANCELLED' : `⏳ PENDING — Paid: Rs. ${_fmt(paid)} | Balance: Rs. ${_fmt(bal)}`
    const ph   = inv.customer_phone !== 'Not Provided' ? inv.customer_phone : ''
    const msg  = `📱 *TECHNO MOBILE*\n━━━━━━━━━━━━━━━━━━\n🧾 Invoice: ${inv.invoice_no}\n📅 Date: ${_displayDate(inv.invoice_date)}\n👤 Customer: ${inv.customer_name||'Walk-in Customer'}${ph?`\n📞 Phone: ${ph}`:''}\n\n🛒 *Items:*\n${itemsText||'  No items\n'}\n💰 Subtotal: Rs. ${_fmt(inv.subtotal||0)}${parseFloat(inv.discount)?`\n🏷️ Discount: -Rs. ${_fmt(inv.discount)}`:''}\n💵 *TOTAL: Rs. ${_fmt(inv.total||0)}*\n\n${stB}\n\n🙏 Thank you for choosing Techno Mobile!`

    const raw   = (ph||'').replace(/\D/g,'')
    const phone = raw.length>=9 ? (raw.startsWith('0') ? '94'+raw.slice(1) : raw) : ''
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    showToast('Opening WhatsApp...', 'success')
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── PAYMENT MODAL ────────────────────────────────────────────────────────────
let _pmInvoice = null

window.openPaymentModal = async function (invoiceNo) {
  try {
    const inv = await _fetchOne(invoiceNo)
    if (!inv) { showToast('Invoice not found', 'error'); return }
    _pmInvoice = inv

    const s    = inv.status || 'pending'
    const paid = _paidAmount(inv)
    const bal  = _balanceDue(inv)

    document.getElementById('pmInvoiceNo').innerText    = inv.invoice_no || 'N/A'
    document.getElementById('pmCustomerName').innerText = inv.customer_name || 'Walk-in Customer'
    document.getElementById('pmTotal').innerText        = `Rs. ${_fmt(inv.total||0)}`
    document.getElementById('pmPaid').innerText         = `Rs. ${_fmt(paid)}`
    document.getElementById('pmBalance').innerText      = `Rs. ${_fmt(bal)}`

    const amtEl = document.getElementById('pmAmount')
    if (amtEl) { amtEl.value = ''; amtEl.placeholder = bal>0 ? `Max Rs. ${_fmt(bal)}` : 'No balance due'; amtEl.max = bal; amtEl.min = 0 }

    document.querySelectorAll('.pm-status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === s))

    const amtRow = document.getElementById('pmAmountRow')
    if (amtRow) amtRow.style.display = (s==='pending' && bal>0) ? 'flex' : 'none'

    const hint = document.querySelector('.pm-hint')
    if (hint) hint.innerHTML = (bal>0 && s==='pending')
      ? `<i class="fas fa-info-circle"></i> Current balance: Rs. ${_fmt(bal)}. Enter amount to record.`
      : `<i class="fas fa-check-circle"></i> No balance remaining.`

    document.getElementById('paymentModal').style.display = 'flex'
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

window.closePaymentModal = function () {
  document.getElementById('paymentModal').style.display = 'none'
  const a = document.getElementById('pmAmount'); if (a) a.value = ''
  _pmInvoice = null
}

window.pmSetStatus = function (status) {
  document.querySelectorAll('.pm-status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status))
  const amtRow = document.getElementById('pmAmountRow')
  const hint   = document.querySelector('.pm-hint')
  if (amtRow && _pmInvoice) {
    const bal = _balanceDue(_pmInvoice)
    if (status === 'pending' && bal > 0) {
      amtRow.style.display = 'flex'
      const a = document.getElementById('pmAmount'); if (a) { a.placeholder=`Max Rs. ${_fmt(bal)}`; a.max=bal }
      if (hint) hint.innerHTML = `<i class="fas fa-info-circle"></i> Balance: Rs. ${_fmt(bal)}. Enter amount to record.`
    } else {
      amtRow.style.display = 'none'
      if (hint) hint.innerHTML = status==='paid'
        ? `<i class="fas fa-check-circle"></i> Invoice will be marked as paid in full.`
        : status==='cancelled' ? `<i class="fas fa-times-circle"></i> Invoice will be cancelled.`
        : `<i class="fas fa-info-circle"></i> No payment changes.`
    }
  }
}

window.savePayment = async function () {
  if (!_pmInvoice) return

  const activeBtn   = document.querySelector('.pm-status-btn.active')
  const newStatus   = activeBtn ? activeBtn.dataset.status : 'pending'
  const amtInput    = parseFloat(document.getElementById('pmAmount')?.value) || 0
  const currentPaid = parseFloat(_pmInvoice.paid_amount) || 0
  const totalAmt    = parseFloat(_pmInvoice.total) || 0

  let newPaid = currentPaid
  let finalStatus = newStatus

  if (newStatus === 'paid') {
    newPaid = totalAmt
  } else if (newStatus === 'cancelled') {
    newPaid = 0
  } else if (newStatus === 'pending') {
    if (amtInput <= 0) { showToast('Please enter a valid payment amount', 'error'); return }
    if (amtInput > totalAmt - currentPaid + 0.01) {
      showToast(`Amount exceeds remaining balance of Rs. ${_fmt(totalAmt - currentPaid)}`, 'error'); return
    }
    newPaid = parseFloat((currentPaid + amtInput).toFixed(2))
    if (newPaid >= totalAmt - 0.01) { newPaid = totalAmt; finalStatus = 'paid' }
  }

  const btn = document.querySelector('#paymentModal .btn-primary')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>' }

  try {
    const result = await _apiFetch(window.API_BASE + 'invoices.php', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invoice_no: _pmInvoice.invoice_no, status: finalStatus, paid_amount: newStatus==='cancelled' ? 0 : newPaid }),
    })
    if (result.success) {
      closePaymentModal()
      await displayHistory()
      if (finalStatus === 'paid') showToast('✅ Invoice marked as Paid in Full!', 'success')
      else if (newStatus === 'cancelled') showToast('Invoice cancelled')
      else showToast(`⏳ Payment of Rs. ${_fmt(amtInput)} recorded! Remaining: Rs. ${_fmt(totalAmt - newPaid)}`, 'success')
    } else {
      showToast(result.message || 'Update failed', 'error')
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Payment' }
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
window.deleteFromHistory = async function (invoiceNo) {
  if (!confirm(`Delete invoice ${invoiceNo}? This cannot be undone.`)) return
  try {
    const result = await _apiFetch(window.API_BASE + 'invoices.php', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invoice_no: invoiceNo }),
    })
    if (result.success) { await displayHistory(); showToast('Invoice deleted') }
    else showToast(result.message || 'Delete failed', 'error')
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
window.exportHistoryCSV = async function () {
  try {
    const data     = await _apiFetch(window.API_BASE + 'invoices.php')
    const invoices = Array.isArray(data) ? data : (data.data || [])
    if (!invoices.length) { showToast('No invoices to export', 'error'); return }

    const hdr  = ['Invoice No','Customer','Phone','Date','Subtotal','Discount','Total','Status','Paid','Balance']
    const rows = invoices.map(inv => [
      inv.invoice_no||'', inv.customer_name||'Walk-in Customer', inv.customer_phone||'',
      inv.invoice_date||'', _fmt(inv.subtotal||0), _fmt(inv.discount||0), _fmt(inv.total||0),
      inv.status||'pending', _fmt(_paidAmount(inv)), _fmt(_balanceDue(inv)),
    ])

    const csv = [hdr,...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a   = document.createElement('a')
    a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    a.download = `TM_Invoices_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    showToast('Exported as CSV!', 'success')
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error')
  }
}
