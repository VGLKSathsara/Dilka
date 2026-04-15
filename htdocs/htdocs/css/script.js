// ============================================================
// Techno Mobile POS — script.js v4.0 (Backend Connected)
// ALL localStorage replaced with API calls
// ============================================================

// ─── API base URL ─────────────────────────────────────────────────────────────
// index.html sets window.API_BASE before this script loads.
// Fallback in case it doesn't:
if (!window.API_BASE) {
  window.API_BASE = window.location.origin + '/api/'
}

// ─── State ────────────────────────────────────────────────────────────────────
let _currentSubtotal = 0
let _currentDiscount = 0
let _currentPayment  = 0
let _currentTotal    = 0

// ─── Utility: HTML escape ─────────────────────────────────────────────────────
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Utility: fetch JSON from backend ────────────────────────────────────────
// Throws a readable error if the server returns non-JSON (e.g. PHP fatal)
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  const ct  = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const txt = await res.text()
    console.error('Non-JSON response from', url, ':\n', txt.slice(0, 500))
    throw new Error('Server error — check API / PHP logs')
  }
  return res.json()
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.className   = 'toast show' + (type ? ' ' + type : '')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => (t.className = 'toast'), 3200)
}

// ─── Login ────────────────────────────────────────────────────────────────────
window.togglePassword = function () {
  const pw   = document.getElementById('password')
  const icon = document.getElementById('pwEyeIcon')
  pw.type       = pw.type === 'password' ? 'text' : 'password'
  icon.className = pw.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash'
}

window.login = async function () {
  const username = document.getElementById('username').value.trim()
  const password = document.getElementById('password').value
  const errEl    = document.getElementById('loginError')
  const btn      = document.querySelector('.login-btn')

  if (!username || !password) {
    errEl.style.display = 'flex'
    errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Please enter username and password'
    return
  }

  const origHtml  = btn.innerHTML
  btn.innerHTML   = '<i class="fas fa-spinner fa-spin"></i> Signing in...'
  btn.disabled    = true

  try {
    const result = await apiFetch(window.API_BASE + 'login.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })

    if (result.success) {
      errEl.style.display = 'none'
      sessionStorage.setItem('tm_user', JSON.stringify(result.user))
      document.getElementById('loginPage').style.display = 'none'
      document.getElementById('posSystem').style.display = 'flex'
      document.getElementById('loggedUser').innerText =
        result.user.full_name || result.user.username
      await initializePOS()
      showToast('Welcome, ' + (result.user.full_name || result.user.username) + '!', 'success')
    } else {
      errEl.style.display = 'flex'
      errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' +
        _esc(result.message || 'Invalid username or password')
      document.getElementById('password').value = ''
      // Shake the login card
      const card = document.querySelector('.login-card')
      card.style.animation = 'none'
      card.offsetHeight
      card.style.animation = 'shakeX 0.5s ease'
    }
  } catch (err) {
    errEl.style.display = 'flex'
    errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Connection error: ' + _esc(err.message)
    console.error('Login error:', err)
  } finally {
    btn.innerHTML = origHtml
    btn.disabled  = false
  }
}

window.logout = function () {
  if (confirm('Logout from the system?')) {
    sessionStorage.removeItem('tm_user')
    document.getElementById('loginPage').style.display = 'flex'
    document.getElementById('posSystem').style.display = 'none'
    document.getElementById('username').value = ''
    document.getElementById('password').value = ''
  }
}

// Shake keyframe (injected once)
;(function () {
  const s = document.createElement('style')
  s.textContent = `@keyframes shakeX{0%,100%{transform:translateX(0)}15%{transform:translateX(-10px)}30%{transform:translateX(10px)}45%{transform:translateX(-8px)}60%{transform:translateX(8px)}75%{transform:translateX(-4px)}90%{transform:translateX(4px)}}`
  document.head.appendChild(s)
})()

// ─── POS Initialise ───────────────────────────────────────────────────────────
async function initializePOS() {
  _applyTheme(localStorage.getItem('techno_theme') || 'light')

  const now = new Date()
  document.getElementById('inDate').valueAsDate = now
  document.getElementById('inDate').max = now.toISOString().split('T')[0] // block future dates
  document.getElementById('liveDate').innerText = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  document.getElementById('inNo').innerText      = generateInvoiceNumber()
  document.getElementById('inDiscount').value    = 0
  document.getElementById('inPayment').value     = 0
  document.getElementById('inName').value        = ''
  document.getElementById('inPhone').value       = ''
  document.getElementById('invoiceStatus').value = 'pending'
  _syncStatusButtons('pending')

  // Clear device rows
  document.getElementById('deviceArea').innerHTML = ''
  updateDeviceEmptyState()

  // Load inventory cards + terms from DB (parallel)
  await Promise.all([_loadInventory(), _loadTerms()])

  recalc()
  if (typeof displayHistory === 'function') await displayHistory()
}

// ─── Invoice Number ───────────────────────────────────────────────────────────
function generateInvoiceNumber() {
  const n = new Date()
  const d = n.getFullYear()
    + String(n.getMonth() + 1).padStart(2, '0')
    + String(n.getDate()).padStart(2, '0')
  const t = String(n.getHours()).padStart(2, '0')
    + String(n.getMinutes()).padStart(2, '0')
    + String(n.getSeconds()).padStart(2, '0')
  return `INV-${d}-${t}`
}

// ─── Payment Status Buttons ───────────────────────────────────────────────────
function _syncStatusButtons(value) {
  document.querySelectorAll('.status-opt-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.value === value)
  )
}

window.selectStatus = function (value) {
  document.getElementById('invoiceStatus').value = value
  _syncStatusButtons(value)
  if (value === 'paid') {
    document.getElementById('inPayment').value = _currentTotal
    recalc()
    showToast('Marked as Paid', 'success')
  } else if (value === 'cancelled') {
    document.getElementById('inPayment').value = 0
    recalc()
    showToast('Marked as Cancelled')
  } else {
    recalc()
  }
}

// ─── INVENTORY — load from API into accessories grid ─────────────────────────
async function _loadInventory() {
  const accGrid = document.getElementById('accGrid')
  if (!accGrid) return

  // Remove existing acc cards but KEEP the hint element
  accGrid.querySelectorAll('.pos-acc-card').forEach(el => el.remove())
  const hint = document.getElementById('accEmptyHint')

  try {
    const items = await apiFetch(window.API_BASE + 'inventory.php')
    if (Array.isArray(items) && items.length) {
      if (hint) hint.style.display = 'none'
      items.forEach(item => _createAccCard(item.name, parseFloat(item.price), item.id))
    } else {
      if (hint) hint.style.display = 'flex'
    }
  } catch (err) {
    console.error('Inventory load error:', err)
    showToast('Could not load inventory from server', 'error')
    if (hint) hint.style.display = 'flex'
  }
}

// ─── TERMS — load from API ────────────────────────────────────────────────────
async function _loadTerms() {
  const container = document.getElementById('termsContainer')
  if (!container) return

  try {
    const terms = await apiFetch(window.API_BASE + 'terms.php')

    if (!Array.isArray(terms) || !terms.length) {
      container.innerHTML = `<div class="empty-state" style="padding:16px">
        <i class="fas fa-file-contract"></i><p>No terms configured.</p></div>`
      return
    }

    container.innerHTML = terms.map(t => `
      <div class="term-item" data-term-id="${t.id}">
        <input type="checkbox" ${t.selected ? 'checked' : ''}
          onchange="toggleTerm(${t.id}, this.checked)">
        <input type="text" value="${_esc(t.text)}"
          onchange="updateTermText(${t.id}, this.value)"
          placeholder="Term text...">
        <button class="term-del-btn" onclick="deleteTerm(${t.id})" title="Delete term">
          <i class="fas fa-trash"></i>
        </button>
      </div>`).join('')
  } catch (err) {
    console.error('Terms load error:', err)
    container.innerHTML = `<div class="empty-state" style="padding:16px">
      <i class="fas fa-exclamation-circle"></i><p>Could not load terms.</p></div>`
  }
}

// ─── TERMS — CRUD (now hit API instead of localStorage) ───────────────────────
window.addNewTerm = async function () {
  try {
    const result = await apiFetch(window.API_BASE + 'terms.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: 'New term and condition', selected: true }),
    })
    if (result.success) {
      await _loadTerms()
      showToast('Term added', 'success')
    } else {
      showToast(result.message || 'Failed to add term', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

window.toggleTerm = async function (id, checked) {
  try {
    await apiFetch(window.API_BASE + 'terms.php', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, selected: checked }),
    })
  } catch (err) {
    showToast('Could not update term', 'error')
  }
}

window.updateTermText = async function (id, text) {
  try {
    await apiFetch(window.API_BASE + 'terms.php', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, text }),
    })
  } catch (err) {
    showToast('Could not update term', 'error')
  }
}

window.deleteTerm = async function (id) {
  if (!confirm('Delete this term?')) return
  try {
    const result = await apiFetch(window.API_BASE + 'terms.php', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    if (result.success) {
      await _loadTerms()
      showToast('Term deleted')
    } else {
      showToast(result.message || 'Failed to delete term', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── ACCESSORIES ──────────────────────────────────────────────────────────────
// Called from HTML "Add Item" button
window.addAcc = function () {
  _createAccCard('New Accessory', 0, null, true)
}

function _createAccCard(name, price, dbId = null, focus = false) {
  const accGrid = document.getElementById('accGrid')
  if (!accGrid) return

  const hint = document.getElementById('accEmptyHint')
  if (hint) hint.style.display = 'none'

  const div = document.createElement('div')
  div.className = 'pos-acc-card'
  if (dbId) div.dataset.dbId = dbId

  div.innerHTML = `
    <input type="checkbox" class="pos-check"
      onchange="this.closest('.pos-acc-card').classList.toggle('checked',this.checked);recalc()">
    <div class="pos-acc-info">
      <input type="text" class="pos-acc-name" value="${_esc(name)}"
        placeholder="Item name" oninput="recalc()">
      <div class="pos-acc-meta">
        <span>Qty</span>
        <input type="number" class="pos-qty" value="1" min="1" oninput="recalc()">
        <span>Rs.</span>
        <input type="number" class="pos-price" value="${price}" min="0" step="0.01" oninput="recalc()">
      </div>
    </div>
    <button class="acc-delete-btn" onclick="deleteAccessory(this)" title="Remove item">
      <i class="fas fa-times"></i>
    </button>`

  accGrid.appendChild(div)
  if (focus) div.querySelector('.pos-acc-name').focus()
  recalc()
}

window.deleteAccessory = function (btn) {
  if (confirm('Remove this item from the invoice?')) {
    btn.closest('.pos-acc-card').remove()
    recalc()
    const accGrid = document.getElementById('accGrid')
    const hint    = document.getElementById('accEmptyHint')
    if (hint && !accGrid.querySelector('.pos-acc-card')) hint.style.display = 'flex'
  }
}

// ─── DEVICES ──────────────────────────────────────────────────────────────────
window.addDevice = function () {
  const deviceArea = document.getElementById('deviceArea')
  if (!deviceArea) return

  const div = document.createElement('div')
  div.className = 'pos-device-row'
  div.innerHTML = `
    <input type="text"   class="d-name"    placeholder="iPhone 15 Pro, Samsung S24..." oninput="recalc()">
    <input type="text"   class="d-storage" placeholder="128GB, 256GB..." oninput="recalc()">
    <input type="text"   class="d-imei"    placeholder="IMEI / Serial Number">
    <input type="number" class="d-qty"     value="1" min="1" oninput="recalc()">
    <input type="number" class="d-price"   placeholder="0.00" min="0" step="1" oninput="recalc()">
    <button class="device-del-btn" onclick="removeDevice(this)" title="Remove">
      <i class="fas fa-trash-alt"></i>
    </button>`

  deviceArea.appendChild(div)
  updateDeviceEmptyState()
  recalc()
  div.querySelector('.d-name').focus()
}

window.removeDevice = function (btn) {
  if (confirm('Remove this item?')) {
    btn.closest('.pos-device-row').remove()
    recalc()
    updateDeviceEmptyState()
  }
}

function updateDeviceEmptyState() {
  const deviceArea = document.getElementById('deviceArea')
  const emptyState = document.getElementById('deviceEmptyState')
  if (!deviceArea || !emptyState) return
  emptyState.classList.toggle('visible', !deviceArea.querySelector('.pos-device-row'))
}

// ─── RECALC ───────────────────────────────────────────────────────────────────
window.recalc = function () {
  let sub = 0

  document.querySelectorAll('.pos-acc-card').forEach(card => {
    if (card.querySelector('.pos-check')?.checked) {
      sub += (Number(card.querySelector('.pos-qty')?.value)   || 0) *
             (Number(card.querySelector('.pos-price')?.value) || 0)
    }
  })

  document.querySelectorAll('.pos-device-row').forEach(row => {
    sub += (Number(row.querySelector('.d-qty')?.value)   || 0) *
           (Number(row.querySelector('.d-price')?.value) || 0)
  })

  _currentSubtotal = sub
  _currentDiscount = Math.max(0, Math.min(
    parseFloat(document.getElementById('inDiscount')?.value) || 0, sub
  ))
  _currentTotal   = Math.max(0, sub - _currentDiscount)

  let payment = Math.max(0, Math.min(
    parseFloat(document.getElementById('inPayment')?.value) || 0, _currentTotal
  ))
  _currentPayment = payment

  const balance = _currentTotal - payment
  const fmt = n => 'Rs. ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const el  = id => document.getElementById(id)

  if (el('liveSubtotal')) el('liveSubtotal').innerText = fmt(sub)
  if (el('liveDiscount')) el('liveDiscount').innerText = '- ' + fmt(_currentDiscount)
  if (el('liveTotal'))    el('liveTotal').innerText    = fmt(_currentTotal)
  if (el('livePayment'))  el('livePayment').innerText  = fmt(payment)
  if (el('liveBalance'))  {
    el('liveBalance').innerText   = fmt(balance)
    el('liveBalance').style.color = balance > 0 ? 'var(--danger)' : 'var(--secondary)'
  }

  const payInput = el('inPayment')
  if (payInput && parseFloat(payInput.value) > _currentTotal) payInput.value = payment
}

window.applyDiscount = function () {
  let d = parseFloat(document.getElementById('inDiscount').value) || 0
  if (d < 0) d = 0
  if (d > _currentSubtotal) {
    showToast('Discount cannot exceed subtotal', 'error')
    d = _currentSubtotal
  }
  document.getElementById('inDiscount').value = d
  recalc()
  if (d > 0) showToast(`Discount of Rs. ${d.toLocaleString()} applied`, 'success')
}

window.updatePayment = function () {
  let p = parseFloat(document.getElementById('inPayment').value) || 0
  p = Math.max(0, Math.min(p, _currentTotal))
  document.getElementById('inPayment').value = p
  recalc()
}

window.setFullPayment = function () {
  document.getElementById('inPayment').value = _currentTotal
  recalc()
}

// ─── SAVE INVOICE — posts to api/save_invoice.php ─────────────────────────────
window.saveInvoice = async function () {
  // Validate: must have at least one checked acc OR one device with a name
  const hasCheckedAcc = document.querySelectorAll('.pos-acc-card .pos-check:checked').length > 0
  const hasDevice     = Array.from(document.querySelectorAll('.pos-device-row'))
    .some(row => row.querySelector('.d-name')?.value.trim())

  if (!hasCheckedAcc && !hasDevice) {
    showToast('Please add at least one item to the invoice', 'error')
    return
  }
  if (_currentTotal <= 0) {
    showToast('Invoice total cannot be zero', 'error')
    return
  }

  // Collect items
  const items = []
  document.querySelectorAll('.pos-acc-card').forEach(card => {
    if (!card.querySelector('.pos-check').checked) return
    const qty   = parseInt(card.querySelector('.pos-qty').value)   || 1
    const price = parseFloat(card.querySelector('.pos-price').value) || 0
    items.push({ name: card.querySelector('.pos-acc-name').value.trim() || 'Accessory', qty, price, total: qty * price, type: 'accessory' })
  })
  document.querySelectorAll('.pos-device-row').forEach(row => {
    const name = row.querySelector('.d-name').value.trim()
    if (!name) return
    const storage = row.querySelector('.d-storage').value.trim()
    const qty     = parseInt(row.querySelector('.d-qty').value)     || 1
    const price   = parseFloat(row.querySelector('.d-price').value) || 0
    items.push({ name: name + (storage ? ` (${storage})` : ''), qty, price, total: qty * price, type: 'device' })
  })

  const payload = {
    invoice_no:     document.getElementById('inNo').innerText,
    customer_name:  document.getElementById('inName').value.trim()  || 'Walk-in Customer',
    customer_phone: document.getElementById('inPhone').value.trim() || 'Not Provided',
    invoice_date:   document.getElementById('inDate').value || new Date().toISOString().split('T')[0],
    subtotal:       _currentSubtotal,
    discount:       _currentDiscount,
    total:          _currentTotal,
    paid_amount:    parseFloat(document.getElementById('inPayment').value) || 0,
    status:         document.getElementById('invoiceStatus').value || 'pending',
    items,
  }

  const saveBtn  = document.querySelector('.pos-btn-save')
  const origHtml = saveBtn ? saveBtn.innerHTML : ''
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...' }

  try {
    const result = await apiFetch(window.API_BASE + 'save_invoice.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })

    if (result.success && !result.duplicate) {
      document.getElementById('saveSuccessInvNo').innerText = payload.invoice_no
      document.getElementById('saveSuccessOverlay').style.display = 'flex'
      _resetPOSForm()
      // Reload inventory (quantities may change) and refresh history
      await _loadInventory()
      if (typeof displayHistory === 'function') await displayHistory()
      showToast('Invoice saved!', 'success')
    } else if (result.duplicate) {
      // Generate a new invoice number and warn — do NOT lose the form data
      document.getElementById('inNo').innerText = generateInvoiceNumber()
      showToast('Duplicate number detected — new number generated. Please save again.', 'error')
    } else {
      showToast(result.message || 'Failed to save invoice', 'error')
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error')
    console.error('saveInvoice error:', err)
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origHtml }
  }
}

function _resetPOSForm() {
  const now = new Date()
  document.getElementById('inNo').innerText        = generateInvoiceNumber()
  document.getElementById('inName').value          = ''
  document.getElementById('inPhone').value         = ''
  document.getElementById('inDiscount').value      = 0
  document.getElementById('inPayment').value       = 0
  document.getElementById('invoiceStatus').value   = 'pending'
  document.getElementById('inDate').valueAsDate    = now
  document.getElementById('liveDate').innerText    = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  _syncStatusButtons('pending')
  // Uncheck accessories, reset qty to 1
  document.querySelectorAll('.pos-acc-card').forEach(card => {
    const cb = card.querySelector('.pos-check')
    if (cb) cb.checked = false
    card.classList.remove('checked')
    const qty = card.querySelector('.pos-qty')
    if (qty) qty.value = 1
  })
  // Clear devices
  document.getElementById('deviceArea').innerHTML = ''
  updateDeviceEmptyState()
  recalc()
}

window.closeSaveSuccess = function (destination) {
  document.getElementById('saveSuccessOverlay').style.display = 'none'
  switchTab(destination === 'history' ? 'history' : 'pos')
}

// ─── CLEAR HISTORY (delegates full DELETE to API) ─────────────────────────────
window.clearHistory = async function () {
  if (!confirm('Clear ALL invoice history? This cannot be undone.')) return
  try {
    const result = await apiFetch(window.API_BASE + 'invoices.php', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'clear_all' }),
    })
    if (result.success) {
      if (typeof displayHistory === 'function') await displayHistory()
      showToast('All history cleared')
    } else {
      showToast(result.message || 'Clear failed', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── TAB SWITCHING ────────────────────────────────────────────────────────────
window.switchTab = async function (tab) {
  const tabs   = ['pos', 'history', 'inventory']
  const titles = { pos: 'Point of Sale', history: 'Invoice History', inventory: 'Inventory' }

  tabs.forEach(t => {
    const panel = document.getElementById(t + 'Tab')
    if (panel) panel.style.display = t === tab ? 'block' : 'none'

    // Sidebar nav
    const navEl = document.getElementById('nav' + t.charAt(0).toUpperCase() + t.slice(1))
    if (navEl) navEl.classList.toggle('active', t === tab)

    // Mobile bottom nav (was never updated before — fixed)
    const mobEl = document.getElementById('mobileNav' + t.charAt(0).toUpperCase() + t.slice(1))
    if (mobEl) mobEl.classList.toggle('active', t === tab)
  })

  const mobileTitle = document.getElementById('mobileTabTitle')
  if (mobileTitle) mobileTitle.innerText = titles[tab] || ''

  if (tab === 'history' && typeof displayHistory === 'function') await displayHistory()
  if (tab === 'inventory') await _renderInventoryTab()

  closeMobileSidebar()
}

// ─── MOBILE SIDEBAR ───────────────────────────────────────────────────────────
window.toggleMobileSidebar = function () {
  document.querySelector('.pos-sidebar').classList.toggle('mobile-open')
  document.getElementById('mobileSidebarOverlay').classList.toggle('active')
}
window.closeMobileSidebar = function () {
  document.querySelector('.pos-sidebar')?.classList.remove('mobile-open')
  document.getElementById('mobileSidebarOverlay')?.classList.remove('active')
}

// ─── INVENTORY TAB — read from DB, edit via API ───────────────────────────────
async function _renderInventoryTab() {
  const tbody = document.getElementById('inventoryTableBody')
  if (!tbody) return

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-muted)">
    <i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>`

  try {
    const items = await apiFetch(window.API_BASE + 'inventory.php')

    if (!Array.isArray(items) || !items.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
        No products found. Click "Add Product" to get started.</td></tr>`
      return
    }

    tbody.innerHTML = items.map((item, i) => `
      <tr>
        <td style="color:var(--text-muted);font-size:12px;font-weight:700;width:40px">${i + 1}</td>
        <td>
          <input class="inv-name-input" value="${_esc(item.name)}"
            onchange="updateInventoryItem(${item.id},'name',this.value)"
            placeholder="Product name">
        </td>
        <td style="text-align:right;width:160px">
          <input class="inv-price-input" type="number" value="${item.price}" min="0"
            onchange="updateInventoryItem(${item.id},'price',this.value)">
        </td>
        <td style="text-align:center;width:60px">
          <button class="inv-del-btn" onclick="deleteInventoryItem(${item.id})" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`).join('')
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--danger);padding:16px">
      Error: ${_esc(err.message)}</td></tr>`
  }
}

window.addInventoryItem = async function () {
  try {
    const result = await apiFetch(window.API_BASE + 'inventory.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'New Product', price: 0, quantity: 0, category: 'accessory' }),
    })
    if (result.success) {
      await _renderInventoryTab()
      await _loadInventory()   // refresh acc grid too
      showToast('Product added', 'success')
    } else {
      showToast(result.message || 'Failed to add product', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

window.updateInventoryItem = async function (id, field, value) {
  try {
    await apiFetch(window.API_BASE + 'inventory.php', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, [field]: field === 'price' ? parseFloat(value) : value }),
    })
    await _loadInventory()   // keep acc grid in sync
  } catch (err) {
    showToast('Could not update product', 'error')
  }
}

window.deleteInventoryItem = async function (id) {
  if (!confirm('Delete this product?')) return
  try {
    const result = await apiFetch(window.API_BASE + 'inventory.php', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    if (result.success) {
      await _renderInventoryTab()
      await _loadInventory()
      showToast('Product deleted')
    } else {
      showToast(result.message || 'Failed to delete', 'error')
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ─── PHONE VALIDATION ─────────────────────────────────────────────────────────
window.validatePhone = function (input) {
  input.value = input.value.replace(/[^0-9]/g, '').slice(0, 10)
}

// ─── DARK MODE ────────────────────────────────────────────────────────────────
function _applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('techno_theme', theme)
  const cls    = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'
  const icon   = document.getElementById('darkModeIcon')
  const iconMb = document.getElementById('darkModeIconMobile')
  if (icon)   icon.className   = cls
  if (iconMb) iconMb.className = cls
}

window.toggleDarkMode = function () {
  const cur = document.documentElement.getAttribute('data-theme') || 'light'
  _applyTheme(cur === 'dark' ? 'light' : 'dark')
  if (typeof displayHistory === 'function' &&
      document.getElementById('historyTab')?.style.display !== 'none')
    displayHistory()
}

// ─── SETTINGS / BACKUP ───────────────────────────────────────────────────────
window.openSettingsModal  = () => { document.getElementById('settingsModal').style.display = 'flex' }
window.closeSettingsModal = () => { document.getElementById('settingsModal').style.display = 'none' }

window.backupData = async function () {
  try {
    const [invoices, inventory, terms] = await Promise.all([
      apiFetch(window.API_BASE + 'invoices.php'),
      apiFetch(window.API_BASE + 'inventory.php'),
      apiFetch(window.API_BASE + 'terms.php'),
    ])
    const backup = { version: '4.0', exportedAt: new Date().toISOString(), data: { invoices, inventory, terms } }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    a.download = `TM_Backup_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    showToast('Backup downloaded!', 'success')
  } catch (err) {
    showToast('Backup failed: ' + err.message, 'error')
  }
}

window.restoreData = function () {
  showToast('Database restore is done via phpMyAdmin on the server', 'error')
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (document.getElementById('posTab')?.style.display !== 'none') saveInvoice()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); switchTab('pos') }
  if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); switchTab('history') }
  if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); switchTab('inventory') }
})

// ─── ON LOAD ──────────────────────────────────────────────────────────────────
window.onload = function () {
  _applyTheme(localStorage.getItem('techno_theme') || 'light')
  document.getElementById('loginPage').style.display = 'flex'
  document.getElementById('posSystem').style.display = 'none'
  setTimeout(() => document.getElementById('username')?.focus(), 80)
}
