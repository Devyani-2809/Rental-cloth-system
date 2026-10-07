// ============================
// SUPABASE CONFIG
// ============================

const SUPABASE_URL = 'https://yiyubrrqxzuocvmjrapi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8FHJie5q1_2Jb76GO8hOFw_NepiMRA8';

// Keep user/admin sessions separate
const currentStorageKey = window.location.pathname.includes('admin.html')
    ? 'sb-admin-auth-token'
    : 'sb-user-auth-token';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storageKey: currentStorageKey },
});

// ============================
// GLOBALS
// ============================

let clothes = [];
let currentUser = null;
let currentUserProfile = null;
let userOrdersList = []; // स्थानिक पातळीवर ऑर्डर्स मॅनेज करण्यासाठी
let userOrdersRefundMap = {}; // रिफंड मॅप स्टोअर करण्यासाठी

// ============================
// ELEMENTS (may be null on some pages)
// ============================

const cardsGrid = document.getElementById('cardsGrid');
const categoryFilter = document.getElementById('categoryFilter');
const genderFilter = document.getElementById('genderFilter');
const occasionFilter = document.getElementById('occasionFilter');
const festivalFilter = document.getElementById('festivalFilter');
const colorFilter = document.getElementById('colorFilter');
const priceFilter = document.getElementById('priceFilter');
const sizeFilter = document.getElementById('sizeFilter');
const ageFilter = document.getElementById('ageFilter');

const modalOverlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementById('closeModal');

let adminDashboardSection = document.getElementById('adminDashboard');
let adminUsersTableBody = document.getElementById('adminUsersTableBody');
let adminProductsTableBody = document.getElementById('adminProductsTableBody');
let addProductForm = document.getElementById('addProductForm');
let editingProductId = null;
let isSubmittingProduct = false; // एकाच वेळी दोन वेळा सबमिट होऊ नये म्हणून
let adminUsersList = []; // Added to manage user data locally
let adminRefundsList = []; // Added to manage refund data locally
let adminOrdersFullList = []; // For filtering admin orders

// Moved these functions out of initAdminPage so they can be accessed anywhere
function showAdminSection(section) {
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById('section-' + section);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
        if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + section + "'")) n.classList.add('active');
    });
    if (section === 'dashboard') loadAdminDashboard();
    if (section === 'orders') loadAdminOrders();
    if (section === 'users') loadUsersFromSupabase();
    if (section === 'products') loadAdminProductsFromSupabase();
    if (section === 'refunds') loadAdminRefunds();
}

async function loadAdminDashboard() {
    const [usersRes, productsRes, ordersRes] = await Promise.all([
        supabaseClient.from('users').select('id', { count: 'exact', head: true }),
        supabaseClient.from('clothes').select('id', { count: 'exact', head: true }),
        supabaseClient.from('orders').select('order_status')
    ]);
    const orders = ordersRes.data || [];
    const cnt = (s) => orders.filter(o => o.order_status === s).length;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setVal('stat-customers', usersRes.count ?? 0);
    setVal('stat-products', productsRes.count ?? 0);
    setVal('stat-orders', orders.length);
    setVal('stat-pending', cnt('Pending') + cnt('Online Payment - Pending Approval'));
    setVal('stat-shipped', cnt('Shipped'));
    setVal('stat-delivered', cnt('Delivered'));
    setVal('stat-returned', cnt('Returned'));
    setVal('stat-cancelled', cnt('Cancelled'));

    const { data: recent } = await supabaseClient.from('orders')
        .select('id, order_status, total_price, users(full_name), clothes(title)')
        .order('created_at', { ascending: false }).limit(5);
    const tbody = document.getElementById('recentOrdersBody');
    if (!tbody) return;
    if (!recent || !recent.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">No orders yet</td></tr>'; return; }
    tbody.innerHTML = recent.map(o => {
        const sc = o.order_status === 'Confirmed' || o.order_status === 'Booked' || o.order_status === 'Delivered' ? 'badge-confirmed'
            : o.order_status === 'Shipped' ? 'badge-shipped'
                : o.order_status === 'Returned' ? 'badge-returned'
                    : o.order_status === 'Cancelled' ? 'badge-cancelled' : 'badge-pending';
        return '<tr><td>#' + o.id + '</td><td>' + (o.users?.full_name || '-') + '</td><td>' + (o.clothes?.title || '-') + '</td><td>&#8377;' + o.total_price + '</td><td><span class="badge-status ' + sc + '">' + o.order_status + '</span></td></tr>';
    }).join('');
}

function showAdminDashboard() {
    if (adminDashboardSection) adminDashboardSection.classList.remove('hidden');
    if (addProductForm) {
        addProductForm.removeEventListener('submit', addProduct);
        addProductForm.addEventListener('submit', addProduct);
    }
    const emailEl = document.getElementById('adminEmailDisplay');
    if (emailEl && currentUser) emailEl.textContent = currentUser.email;
    loadAdminDashboard();
}

async function loadUsersFromSupabase() {
    const { data, error } = await supabaseClient
        .from('users')
        .select('*');

    if (error) {
        console.error('Error loading users:', error);
        showToast('Failed to load users: ' + error.message);
        return;
    }

    adminUsersList = data || [];
    renderUsersTable(adminUsersList);
}

async function loadAdminProductsFromSupabase() {
    const { data, error } = await supabaseClient
        .from('clothes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading products:', error);
        showToast('Failed to load products');
        return;
    }

    // Fetch active orders count per cloth
    const { data: activeOrders } = await supabaseClient
        .from('orders')
        .select('cloth_id, order_status');

    // Count rented per cloth_id
    const deliveredCount = {};
    (activeOrders || []).forEach(o => {
        if (o.order_status !== 'Cancelled' && o.order_status !== 'Returned') {
            deliveredCount[o.cloth_id] = (deliveredCount[o.cloth_id] || 0) + 1;
        }
    });

    clothes = (data || []).map(item => ({
        ...item,
        _delivered: deliveredCount[item.id] || 0,
        _available: Math.max(0, item.stock - (deliveredCount[item.id] || 0))
    }));

    renderAdminProductsTable(clothes);
}

function renderAdminProductsTable(items) {
    if (!adminProductsTableBody) return;
    adminProductsTableBody.innerHTML = '';
    if (items.length === 0) {
        adminProductsTableBody.innerHTML = '<tr><td colspan="5" style="color: #000; text-align: center;">No products found.</td></tr>';
        return;
    }
    adminProductsTableBody.innerHTML = items.map(item => {
        const total = item.stock || 0;
        const delivered = item._delivered || 0;
        const available = item._available !== undefined ? item._available : total;
        const stockBg = available <= 0 ? '#fee2e2' : available <= 2 ? '#fef9c3' : '#d1fae5';
        const stockClr = available <= 0 ? '#991b1b' : available <= 2 ? '#854d0e' : '#065f46';
        const stockIcon = available <= 0 ? '&#10060;' : available <= 2 ? '&#9888;' : '&#9989;';
        return `
        <tr style="color:#000;">
            <td style="color:#000;">${item.title}</td>
            <td style="color:#000;">${item.category}<br><small style="color:#666;">${item.gender} | ${item.age || '-'}</small></td>
            <td style="color:#000;">&#8377;${item.price}</td>
            <td style="color:#000;">&#8377;${item.deposit || 0}</td>
            <td>
                <div style="font-size:0.82em;line-height:1.8;">
                    <div>Total: <b>${total}</b></div>
                    <div style="color:#dc3545;">Rented: <b>${delivered}</b></div>
                    <div style="margin-top:4px;">
                        <span style="padding:3px 10px;border-radius:12px;font-weight:700;font-size:0.9em;background:${stockBg};color:${stockClr};">
                            ${stockIcon} Available: ${available}
                        </span>
                    </div>
                </div>
            </td>
            <td>
                <button class="btn btn-secondary" style="margin-right:8px;background-color:#ffc107;color:#000;border:1px solid #cc9a06;" onclick="prepareEditProduct('${item.id}')">Edit</button>
                <button class="btn btn-primary" style="background:#dc3545;color:white;" onclick="deleteProduct('${item.id}')">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    const { error } = await supabaseClient.from('clothes').delete().eq('id', id);
    if (error) {
        showToast('Delete failed: ' + error.message);
    } else {
        showToast('Product deleted');
        loadAdminProductsFromSupabase();
    }
}

function prepareEditProduct(id) {
    const item = clothes.find(c => c.id === id);
    if (!item) return;

    editingProductId = id;

    document.getElementById('addTitle').value = item.title;
    document.getElementById('addCategory').value = item.category;
    document.getElementById('addGender').value = item.gender;
    document.getElementById('addAge').value = item.age || '';
    document.getElementById('addSize').value = item.size;
    document.getElementById('addOccasion').value = item.occasion;
    document.getElementById('addPrice').value = item.price;
    document.getElementById('addDeposit').value = item.deposit;
    document.getElementById('addColor').value = item.color;
    document.getElementById('addImageUrl').value = item.image_url;
    document.getElementById('addDescription').value = item.description;
    document.getElementById('addStock').value = item.stock;
    document.getElementById('addFestival').value = item.festival || 'None';

    const availCheck = document.getElementById('addAvailable');
    if (availCheck) availCheck.checked = item.available !== false;

    const submitBtn = addProductForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.innerText = 'Update Product';

    const formTitle = document.getElementById('formSectionTitle');
    if (formTitle) formTitle.innerText = 'Edit Product';

    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    // Open add-product section and scroll.
    // showAdminSection('addproduct') will also trigger loadAdminProductsFromSupabase() only for products section.
    showAdminSection('addproduct');

    setTimeout(() => scrollToId('addProductForm'), 50);
}


function resetProductForm() {
    if (addProductForm) addProductForm.reset();
    editingProductId = null;
    const submitBtn = addProductForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.innerText = 'Add Product';
    const formTitle = document.getElementById('formSectionTitle');
    if (formTitle) formTitle.innerText = 'Add New Product';
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
}

function renderUsersTable(users) {
    const userTable = document.getElementById('adminUsersTableBody');
    if (!userTable) return;

    userTable.innerHTML = '';

    if (users.length === 0) {
        userTable.innerHTML = '<tr><td colspan="7" style="text-align:center; color: #000;">No users found.</td></tr>';
        return;
    }

    userTable.innerHTML = users.map(user => `
        <tr style="color: #000;">
            <td style="color: #000;font-size:0.75em;max-width:80px;overflow:hidden;text-overflow:ellipsis;">${user.id}</td>
            <td style="color: #000;">${user.full_name || ''}</td>
            <td style="color: #000;">${user.email}</td>
            <td style="color: #000;">${user.phone || ''}</td>
            <td style="color: #000;">${user.role || ''}</td>
            <td style="color: #000;">${user.created_at ? new Date(user.created_at).toLocaleDateString() : ''}</td>
            <td>
                <button class="act-btn act-purple" onclick="showUserFullReport('${user.id}')">View Report</button>
            </td>
        </tr>
    `).join('');
}

function filterAdminUsers() {
    const query = document.getElementById('adminUserSearchInput')?.value?.toLowerCase() || '';
    const filtered = adminUsersList.filter(u =>
        (u.full_name || '').toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        (u.phone || '').includes(query)
    );
    renderUsersTable(filtered);
}

async function showUserFullReport(userId) {
    showToast('Generating user report...');
    const user = adminUsersList.find(u => u.id === userId);
    if (!user) return;

    const [{ data: orders }, { data: refunds }] = await Promise.all([
        supabaseClient.from('orders').select('*, clothes(title, price, size, category, image_url)').eq('user_id', userId).order('created_at', { ascending: false }),
        supabaseClient.from('cancel_refunds').select('*, orders(id, clothes(title))').eq('user_id', userId).order('cancelled_at', { ascending: false })
    ]);

    const refundMap = {};
    (refunds || []).forEach(r => { refundMap[r.order_id] = r; });

    const statusColors = { 'Delivered': '#16a34a', 'Returned': '#7c3aed', 'Cancelled': '#dc3545', 'Shipped': '#0369a1', 'Confirmed': '#0f5132', 'Booked': '#0f5132', 'Pending': '#856404' };

    const orderRows = (orders || []).map(o => {
        const sc = statusColors[o.order_status] || '#856404';
        const refund = refundMap[o.id];
        const refundCell = refund
            ? '<span style="padding:2px 8px;border-radius:8px;font-size:0.82em;font-weight:700;background:' + (refund.refund_status === 'Paid' ? '#d1fae5' : refund.refund_status === 'Rejected' ? '#fee2e2' : '#fef9c3') + ';color:' + (refund.refund_status === 'Paid' ? '#065f46' : refund.refund_status === 'Rejected' ? '#991b1b' : '#854d0e') + ';">' + refund.refund_status + ' &#8377;' + refund.refund_amount + '</span>'
            : '-';
        return '<tr>'
            + '<td>#' + o.id + '<br><small style="color:#888;">' + new Date(o.created_at).toLocaleDateString('en-IN') + '</small></td>'
            + '<td>' + (o.clothes?.title || '-') + '<br><small>' + (o.clothes?.category || '') + ' | ' + (o.clothes?.size || '') + '</small></td>'
            + '<td>&#8377;' + o.total_price + '</td>'
            + '<td>' + (o.payment_status || '-') + '</td>'
            + '<td><span style="font-weight:700;color:' + sc + ';">' + o.order_status + '</span></td>'
            + '<td>' + refundCell + '</td>'
            + '</tr>';
    }).join('');

    const totalPaid = (orders || []).reduce((s, o) => s + (parseFloat(o.total_price) || 0), 0).toFixed(2);
    const totalRefunded = (refunds || []).filter(r => r.refund_status === 'Paid').reduce((s, r) => s + (parseFloat(r.refund_amount) || 0), 0).toFixed(2);

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>User Report - ' + (user.full_name || user.email) + '</title>'
        + '<style>body{font-family:Arial,sans-serif;padding:30px;color:#111;}'
        + 'h1{color:#6366f1;margin-bottom:4px;} .meta{color:#888;font-size:0.88em;margin-bottom:20px;}'
        + '.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px 24px;background:#f8f7ff;border-radius:10px;padding:16px 20px;margin-bottom:24px;}'
        + '.info-row label{font-size:0.75em;color:#888;text-transform:uppercase;font-weight:700;display:block;}'
        + '.info-row span{font-weight:600;font-size:0.95em;}'
        + 'table{width:100%;border-collapse:collapse;font-size:0.88em;}'
        + 'th{background:#6366f1;color:#fff;padding:10px 12px;text-align:left;}'
        + 'td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top;}'
        + 'tr:nth-child(even) td{background:#f8f7ff;}'
        + '.summary{margin-top:24px;background:#f8f7ff;border-radius:10px;padding:16px 20px;display:flex;gap:32px;}'
        + '.summary div{font-size:0.9em;color:#555;} .summary b{font-size:1.2em;color:#6366f1;}'
        + '@media print{.no-print{display:none;}}'
        + '</style></head><body>'
        + '<h1>&#128084; RentStyle — User Report</h1>'
        + '<div class="meta">Generated on ' + new Date().toLocaleString('en-IN') + '</div>'
        + '<div class="info-grid">'
        + '<div class="info-row"><label>Full Name</label><span>' + (user.full_name || '-') + '</span></div>'
        + '<div class="info-row"><label>Email</label><span>' + user.email + '</span></div>'
        + '<div class="info-row"><label>Phone</label><span>' + (user.phone || '-') + '</span></div>'
        + '<div class="info-row"><label>Role</label><span>' + (user.role?.toUpperCase() || 'USER') + '</span></div>'
        + '<div class="info-row"><label>Registered On</label><span>' + (user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN') : '-') + '</span></div>'
        + '<div class="info-row"><label>Address</label><span>' + [user.address_line, user.city, user.state, user.pincode].filter(Boolean).join(', ') + '</span></div>'
        + '</div>'
        + '<div class="no-print" style="margin-bottom:20px;">'
        + '<button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>'
        + '</div>'
        + '<table><thead><tr><th>Order ID</th><th>Product</th><th>Total Paid</th><th>Payment</th><th>Status</th><th>Refund</th></tr></thead>'
        + '<tbody>' + (orderRows || '<tr><td colspan="6" style="text-align:center;color:#888;">No orders found.</td></tr>') + '</tbody></table>'
        + '<div class="summary">'
        + '<div>Total Orders<br><b>' + (orders?.length || 0) + '</b></div>'
        + '<div>Total Amount Paid<br><b>&#8377;' + totalPaid + '</b></div>'
        + '<div>Total Refunded<br><b>&#8377;' + totalRefunded + '</b></div>'
        + '</div>'
        + '</body></html>';

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

async function addProduct(event) {
    event.preventDefault();
    await processAddProduct();
}

// ============================
// UTIL
// ============================

function showToast(message) {
    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#111';
    toast.style.color = '#fff';
    toast.style.padding = '14px 20px';
    toast.style.borderRadius = '12px';
    toast.style.zIndex = '9999';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

const scrollToId = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ============================
// INIT BINDINGS (INDEX BUTTONS)
// ============================

function bindIndexButtons() {
    const browseNow = document.getElementById('browseNow');
    const viewDemo = document.getElementById('viewDemo');
    const openLoginBtn = document.getElementById('openLogin');
    const openRegisterBtn = document.getElementById('openRegister');
    const openContactBtn = document.getElementById('openContact');

    if (browseNow) browseNow.addEventListener('click', () => scrollToId('collections'));
    if (viewDemo) viewDemo.addEventListener('click', () => scrollToId('features'));

    if (openLoginBtn) openLoginBtn.addEventListener('click', openLoginModal);
    if (openRegisterBtn) openRegisterBtn.addEventListener('click', openRegisterModal);

    if (openContactBtn) {
        openContactBtn.addEventListener('click', () => {
            // If contact.html exists, it is better UX to navigate.
            // If your design expects modal, you can change this.
            window.location.href = 'contact.html';
        });
    }
}

// ============================
// SESSION
// ============================

async function checkSession() {
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();

    currentUser = session?.user || null;

    if (!currentUser) {
        currentUserProfile = null;
        return;
    }

    let { data: profile, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', currentUser.email)
        .maybeSingle();

    const ADMIN_EMAIL = 'pawardevyani560@gmail.com';
    if (currentUser.email === ADMIN_EMAIL && (!profile || profile.role !== 'admin')) {
        await ensureAdminProfile(currentUser.email, currentUser.id);
        // ensureAdminProfile updates global currentUserProfile
        return;
    }

    if (error) {
        console.error('Error fetching user profile:', error);
        currentUserProfile = null;
        return;
    }

    currentUserProfile = profile;
}

// ============================
// USER AUTH UI
// ============================

function renderAuthButtons() {
    const actions = document.querySelector('.actions');
    if (!actions) return;

    actions.innerHTML = '';

    if (currentUser) {
        const isAdmin = window.location.pathname.includes('admin.html') && currentUserProfile?.role === 'admin';
        if (isAdmin) {
            actions.innerHTML = `
                <span class="user-status">Admin: ${currentUser.email}</span>
                <button class="btn btn-secondary" onclick="logoutUser()">Logout Admin</button>
            `;
        } else {
            actions.innerHTML = `
                <span class="user-status">👋 ${currentUserProfile?.full_name || currentUser.email}</span>
                <button class="btn btn-secondary" onclick="loadCart()" style="margin-right:8px;">🛒 Cart</button>
                <button class="btn btn-secondary" onclick="logoutUser()">Logout</button>
            `;
        }
    } else {
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="openLoginModal()">Login</button>
            <button class="btn btn-primary" onclick="openRegisterModal()">Register</button>
        `;
    }
}

async function logoutUser() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    currentUserProfile = null;
    renderAuthButtons();
    showToast('Logged out');
}

// ============================
// MODAL
// ============================

function openModal(content) {
    if (!modalOverlay || !modal || !modalContent) return;
    modalContent.innerHTML = content;
    modalOverlay.classList.remove('hidden');
    modal.classList.remove('hidden');
}

function closeModalWindow() {
    if (modalOverlay) modalOverlay.classList.add('hidden');
    if (modal) modal.classList.add('hidden');
    if (modalContent) modalContent.innerHTML = '';
}

if (closeModal) closeModal.addEventListener('click', closeModalWindow);
if (modalOverlay) modalOverlay.addEventListener('click', closeModalWindow);

function openLoginModal() {
    openModal(`
        <div style="display:flex; flex-wrap:wrap; background:#fff; border-radius:20px; overflow:hidden; max-width:800px; width:100%; margin:auto;">
            <div style="flex:1; min-width:300px; background: url('https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&q=80&w=800') center/cover no-repeat; min-height:400px;"></div>
            <div style="flex:1; min-width:300px; padding:40px; display:flex; flex-direction:column; justify-content:center;">
                <h2 style="margin-bottom:8px; font-size:28px; color:#111;">Welcome Back</h2>
                <p style="margin-bottom:24px; color:#666;">Login to manage your rentals.</p>
                <form onsubmit="loginUser(event)">
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Email Address</label>
                        <input id="loginEmail" type="email" placeholder="name@example.com" required class="input" style="width:100%;" />
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Password</label>
                        <input id="loginPassword" type="password" placeholder="••••••••" required class="input" style="width:100%;" />
                    </div>
                    <button type="submit" class="btn btn-primary" style="margin-top:10px; width:100%; padding:14px; font-size:16px;">Login</button>
                </form>
                <p style="margin-top:24px; font-size:14px; color:#666; text-align:center;">
                    Don't have an account?
                    <a href="javascript:void(0)" onclick="openRegisterModal()" style="color:var(--primary); text-decoration:none; font-weight:600;">Register Now</a>
                </p>
            </div>
        </div>
    `);
}

function openRegisterModal() {
    openModal(`
        <div style="display:flex; flex-wrap:wrap; background:#fff; border-radius:20px; overflow:hidden; max-width:900px; width:100%; margin:auto;">
            <div style="flex:1; min-width:300px; background: url('https://images.unsplash.com/photo-1445205170230-053b830c6050?auto=format&fit=crop&q=80&w=800') center/cover no-repeat; min-height:500px;">
                <div style="padding:40px; background:rgba(0,0,0,0.3); height:100%; display:flex; align-items:flex-end;">
                    <h3 style="color:#fff; font-size:24px;">Join the elite rental community.</h3>
                </div>
            </div>
            <div style="flex:1.5; min-width:350px; padding:40px; max-height:85vh; overflow-y:auto;">
                <h2 style="margin-bottom:8px; font-size:28px; color:#111;">Create Account</h2>
                <p style="margin-bottom:24px; color:#666;">Experience designer fashion without the heavy price tag.</p>
                <form onsubmit="registerUser(event)">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Full Name</label>
                            <input id="registerName" type="text" placeholder="John Doe" required class="input" style="width:100%;" />
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Email</label>
                            <input id="registerEmail" type="email" placeholder="john@example.com" required class="input" style="width:100%;" />
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Password</label>
                            <input id="registerPassword" type="password" placeholder="Min 6 chars" required class="input" style="width:100%;" />
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Phone (10 digits)</label>
                            <input id="registerPhone" type="text" placeholder="9876543210" required class="input" style="width:100%;" />
                        </div>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Address Line</label>
                        <input id="registerAddress" type="text" placeholder="Flat No, Building, Street" class="input" style="width:100%;" />
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:24px;">
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">City</label>
                            <input id="registerCity" type="text" placeholder="Mumbai" class="input" style="width:100%;" />
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">State</label>
                            <input id="registerState" type="text" placeholder="MH" class="input" style="width:100%;" />
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:12px; text-transform:uppercase;">Pincode</label>
                            <input id="registerPincode" type="text" placeholder="400001" class="input" style="width:100%;" />
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width:100%; padding:14px; font-size:16px;">Sign Up Now</button>
                </form>
                <p style="margin-top:20px; font-size:14px; color:#666; text-align:center;">
                    Already have an account?
                    <a href="javascript:void(0)" onclick="openLoginModal()" style="color:var(--primary); text-decoration:none; font-weight:600;">Login</a>
                </p>
            </div>
        </div>
    `);
}

async function loginUser(event) {
    event.preventDefault();

    const email = document.getElementById('loginEmail')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;

    if (!email || !password) return;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        console.error(error);
        showToast(error.message);
        return;
    }

    currentUser = data.user;

    const { data: profile, error: profileError } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (!profileError && profile) currentUserProfile = profile;

    const ADMIN_EMAIL = 'pawardevyani560@gmail.com';

    if (email === ADMIN_EMAIL) {
        await checkSession();
    }

    renderAuthButtons();
    showToast('Login successful');
    closeModalWindow();
}

async function ensureAdminProfile(email, authId) {
    const { data: newProfile, error } = await supabaseClient
        .from('users')
        .upsert([{
            id: authId,
            email: email,
            role: 'admin',
            full_name: 'Admin User',
            country: 'India'
        }], { onConflict: 'email' })
        .select()
        .single();

    if (!error) {
        currentUserProfile = newProfile;
    }
}

async function registerUser(event) {
    event.preventDefault();

    const fullName = document.getElementById('registerName')?.value?.trim();
    const email = document.getElementById('registerEmail')?.value?.trim();
    const password = document.getElementById('registerPassword')?.value;
    const phoneRaw = document.getElementById('registerPhone')?.value || '';
    const address = document.getElementById('registerAddress')?.value || '';
    const city = document.getElementById('registerCity')?.value || '';
    const state = document.getElementById('registerState')?.value || '';
    const pincodeRaw = document.getElementById('registerPincode')?.value || '';

    const cleanPhone = phoneRaw.replace(/\D/g, '');
    const cleanPincode = pincodeRaw.replace(/\D/g, '');

    if (cleanPhone.length !== 10) {
        showToast('Phone number must be exactly 10 digits');
        return;
    }

    if (cleanPincode.length !== 6) {
        showToast('Pincode must be exactly 6 digits');
        return;
    }

    let { data, error } = await supabaseClient.auth.signUp({ email, password });

    if (error) {
        // if already registered, try signing in
        if (error.message?.toLowerCase().includes('already') || error.message?.includes('registered')) {
            const signInRes = await supabaseClient.auth.signInWithPassword({ email, password });
            if (signInRes.error) {
                showToast('Account already exists. Please use correct password.');
                return;
            }
            data = signInRes.data;
        } else {
            showToast(error.message);
            return;
        }
    }

    const authUser = data.user;
    if (!authUser) {
        showToast('Registration failed');
        return;
    }

    const { data: existingUser } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

    if (!existingUser) {
        const { error: insertError } = await supabaseClient
            .from('users')
            .insert([
                {
                    id: authUser.id, // Save the actual Supabase Auth ID
                    full_name: fullName,
                    email,
                    phone: cleanPhone,
                    address_line: address,
                    city,
                    state,
                    pincode: cleanPincode,
                    country: 'India',
                    role: 'user',
                },
            ]);

        if (insertError) {
            console.error(insertError);
            showToast('Profile save failed: ' + insertError.message);
            return;
        }
    }

    const { data: profile } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    currentUserProfile = profile;
    currentUser = authUser;

    await checkSession();

    renderAuthButtons();
    showToast('Registration successful');
    closeModalWindow();
}

// ============================
// CLOTHS + FILTERS
// ============================

async function loadClothesFromSupabase() {
    const { data, error } = await supabaseClient
        .from('clothes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('loadClothes error:', error);
        showToast('Failed to load clothes: ' + error.message);
        return;
    }

    clothes = data || [];
    if (!clothes.length) console.warn('clothes array is empty after fetch');
}

function updateDynamicFilters() {
    // Dynamic Colors
    if (colorFilter) {
        const uniqueColors = [...new Set(clothes.map(item => item.color).filter(c => c && c.trim() !== ''))];
        const currentValues = Array.from(colorFilter.options).map(opt => opt.value.toLowerCase().trim());

        uniqueColors.forEach(color => {
            const val = color.toLowerCase().trim();
            if (!currentValues.includes(val)) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = color.charAt(0).toUpperCase() + color.slice(1);
                colorFilter.appendChild(opt);
                currentValues.push(val);
            }
        });
    }

    // Dynamic Festivals
    if (festivalFilter) {
        const uniqueFestivals = [...new Set(clothes.map(item => item.festival).filter(f => f && f.trim() !== '' && f.toLowerCase() !== 'none'))];
        const currentValues = Array.from(festivalFilter.options).map(opt => opt.value.toLowerCase().trim());

        uniqueFestivals.forEach(festival => {
            const val = festival.toLowerCase().trim();
            if (!currentValues.includes(val)) {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = festival.charAt(0).toUpperCase() + festival.slice(1);
                festivalFilter.appendChild(opt);
                currentValues.push(val);
            }
        });
    }
}

function renderCards(items) {
    if (!cardsGrid) return;

    if (!items || items.length === 0) {
        cardsGrid.innerHTML = `
            <div class="empty">No clothes found</div>
        `;
        return;
    }

    cardsGrid.innerHTML = items
        .map(
            (item) => `
        <article class="card">
            <div class="card-image" style="aspect-ratio: 3/4; overflow: hidden; background: #f5f5f5;">
                <img src="${item.image_url}" alt="${item.title}" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
            </div>
            <div class="card-body">
                <h3 class="card-title" style="color: #000;">${item.title}</h3>
                <div class="card-meta" style="color: #000;">
                    <span style="color: #000;">${item.category}</span>
                    <span style="color: #000;">₹${item.price}/day</span>
                </div>
                <p class="card-description" style="color: #000;">${item.description || ''}</p>
                <div class="card-footer">
                    <span class="badge">${item.available ? 'Available' : 'Not Available'}</span>
                    <button class="btn btn-secondary" onclick="openDetails('${item.id}')">View</button>
                </div>
            </div>
        </article>
    `
        )
        .join('');
}


// ============================
// QUICK SEARCH
// ============================

function quickSearch(query) {
    const resultsEl = document.getElementById('quickSearchResults');
    if (!resultsEl) return;
    const q = query.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ''; resultsEl.classList.add('hidden'); return; }

    const isWomen = q === 'women' || q === 'woman' || q === 'girls' || q === 'girl';
    const isMen = q === 'men' || q === 'man' || q === 'boys' || q === 'boy';

    const matches = clothes.filter(item =>
        (item.title || '').toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q) ||
        (item.color || '').toLowerCase().includes(q) ||
        (item.occasion || '').toLowerCase().includes(q) ||
        (item.gender || '').toLowerCase().includes(q) ||
        (item.festival || '').toLowerCase().includes(q) ||
        (item.size || '').toLowerCase().includes(q) ||
        (item.age || '').toLowerCase().includes(q) ||
        (isWomen && (item.gender || '').toLowerCase() === 'female') ||
        (isMen && (item.gender || '').toLowerCase() === 'male')
    ).slice(0, 6);
    if (!matches.length) {
        resultsEl.innerHTML = '<div class="qs-empty">No results for "' + query + '"</div>';
        resultsEl.classList.remove('hidden');
        return;
    }
    // Ensure results are visible above other content
    resultsEl.style.zIndex = '2000';
    resultsEl.innerHTML = matches.map(item =>
        '<div class="qs-item" onclick="openDetails(\'' + item.id + '\'); hideQuickResults();">'
        + '<img src="' + (item.image_url || '') + '" alt="' + item.title + '" />'
        + '<div class="qs-item-info">'
        + '<div class="qs-item-title">' + item.title + '</div>'
        + '<div class="qs-item-meta">' + item.category + ' &bull; &#8377;' + item.price + '/day &bull; ' + item.size + '</div>'
        + '</div></div>'
    ).join('');
    // append a footer link to view full results on a dedicated page
    resultsEl.innerHTML += '<div class="qs-item" style="justify-content:center;padding:10px;">'
        + '<a href="search.html?q=' + encodeURIComponent(query) + '" style="color:var(--accent);font-weight:700;text-decoration:none;">View all results</a>'
        + '</div>';
    resultsEl.classList.remove('hidden');
}

// When user wants to view full search results on a separate page
function openSearchPage(query) {
    if (!query || !query.trim()) return;
    window.location.href = 'search.html?q=' + encodeURIComponent(query.trim());
}

function showQuickResults() {
    const input = document.getElementById('quickSearchInput');
    if (input && input.value.trim()) quickSearch(input.value);
}

function hideQuickResults() {
    const el = document.getElementById('quickSearchResults');
    if (el) el.classList.add('hidden');
}

function setupFilters() {
    const bind = (el) => {
        if (!el) return;
        el.addEventListener('change', filterClothes);
    };

    bind(categoryFilter);
    bind(genderFilter);
    bind(occasionFilter);
    bind(festivalFilter);
    bind(colorFilter);
    bind(priceFilter);
    bind(sizeFilter);
    bind(ageFilter);

    const searchInp = document.getElementById('clothesSearchInput');
    if (searchInp) searchInp.addEventListener('input', filterClothes);

    // Date filters
    const sd = document.getElementById('filterStartDate');
    const ed = document.getElementById('filterEndDate');
    if (sd) sd.addEventListener('change', filterClothes);
    if (ed) ed.addEventListener('change', filterClothes);

    // Quick search — wait for clothes to load
    const qs = document.getElementById('quickSearchInput');
    if (qs) {
        qs.addEventListener('input', (e) => quickSearch(e.target.value));
        qs.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const v = qs.value && qs.value.trim();
                if (v) openSearchPage(v);
            }
        });
    }
}

// सर्च करण्यासाठी हेल्पपर फंक्शन (नाव, ऑकेजन, कलर, प्राईस इ. चेक करते)
function matchesSearch(item, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const isWomen = q === 'women' || q === 'woman' || q === 'girls' || q === 'girl';
    const isMen = q === 'men' || q === 'man' || q === 'boys' || q === 'boy';

    const fields = [
        item.title, item.occasion, item.color, item.price,
        item.festival, item.category, item.gender, item.size, item.age
    ];
    let match = fields.some(field => String(field || '').toLowerCase().includes(q));
    if (isWomen && (item.gender || '').toLowerCase() === 'female') match = true;
    if (isMen && (item.gender || '').toLowerCase() === 'male') match = true;
    return match;
}

function filterClothes() {
    const category = categoryFilter?.value || 'all';
    const gender = genderFilter?.value || 'all';
    const age = ageFilter?.value || 'all';
    const occasion = occasionFilter?.value || 'all';
    const festival = festivalFilter?.value || 'all';
    const color = colorFilter?.value || 'all';
    const size = sizeFilter?.value || 'all';
    const priceRange = priceFilter?.value || 'all';
    const searchQuery = document.getElementById('clothesSearchInput')?.value || '';
    const startDate = document.getElementById('filterStartDate')?.value || '';
    const endDate = document.getElementById('filterEndDate')?.value || '';

    const parsePrice = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

    const filtered = clothes.filter((item) => {
        const matchCategory = category === 'all' || (item.category || '').toLowerCase() === category.toLowerCase();
        const matchGender = gender === 'all' || (item.gender || '').toLowerCase() === gender.toLowerCase();
        const matchAge = age === 'all' || (item.age || '').toLowerCase() === age.toLowerCase();
        const matchOccasion = occasion === 'all' || (item.occasion || '').toLowerCase() === occasion.toLowerCase();
        const matchFestival = festival === 'all' || (item.festival || '').toLowerCase() === festival.toLowerCase();
        const matchColor = color === 'all' || (item.color || '').toLowerCase() === color.toLowerCase();
        const matchSize = size === 'all' || (item.size || '').toLowerCase() === size.toLowerCase();
        let matchPrice = true;
        if (priceRange !== 'all') {
            const p = parsePrice(item.price);
            if (p === null) matchPrice = false;
            else if (priceRange === '0-500') matchPrice = p >= 0 && p < 500;
            else if (priceRange === '500-1500') matchPrice = p >= 500 && p < 1500;
            else if (priceRange === '1500+') matchPrice = p >= 1500;
        }
        const matchSearch = matchesSearch(item, searchQuery);
        return matchCategory && matchGender && matchAge && matchOccasion && matchFestival && matchColor && matchSize && matchPrice && matchSearch;
    });

    if (startDate && endDate) {
        checkDateAvailability(filtered, startDate, endDate);
    } else {
        renderCards(filtered);
    }
}

// Render full search results on a dedicated page
function performSearchPage(query) {
    const q = (query || '').trim();
    const headerEl = document.getElementById('searchQueryDisplay');
    if (headerEl) headerEl.textContent = q ? '"' + q + '"' : '';
    const cards = document.getElementById('cardsGrid');
    if (!cards) return;
    const results = (clothes || []).filter(item => matchesSearch(item, q));
    if (!results.length) {
        cards.innerHTML = '<div style="color:var(--muted);padding:28px;font-size:1rem;">No results found for "' + q + '"</div>';
        return;
    }
    renderCards(results);
}

async function checkDateAvailability(filteredItems, startDate, endDate) {
    if (!filteredItems.length) { renderCards([]); return; }
    const clothIds = filteredItems.map(i => i.id);

    let bookedOrders = [];
    try {
        const { data } = await supabaseClient
            .from('orders')
            .select('cloth_id, start_date, end_date, order_status')
            .in('cloth_id', clothIds);

        bookedOrders = (data || []).filter(o => o.order_status !== 'Cancelled' && o.order_status !== 'Returned');
    } catch (e) {
        console.warn('Date availability check failed:', e);
        renderCards(filteredItems);
        return;
    }

    // Count how many units of each cloth are rented during selected period
    const rentedCountMap = {};
    const bookedDatesMap = {};
    bookedOrders.forEach(o => {
        const oStart = new Date(o.start_date);
        const oEnd = new Date(o.end_date);
        const fStart = new Date(startDate);
        const fEnd = new Date(endDate);

        oStart.setHours(0, 0, 0, 0);
        oEnd.setHours(0, 0, 0, 0);
        fStart.setHours(0, 0, 0, 0);
        fEnd.setHours(0, 0, 0, 0);

        if (fStart <= oEnd && fEnd >= oStart) {
            rentedCountMap[o.cloth_id] = (rentedCountMap[o.cloth_id] || 0) + 1;
            if (!bookedDatesMap[o.cloth_id]) bookedDatesMap[o.cloth_id] = { start: o.start_date, end: o.end_date };
        }
    });

    if (!cardsGrid) return;
    cardsGrid.innerHTML = filteredItems.map(item => {
        const totalStock = item.stock || 0;
        const rentedCount = rentedCountMap[item.id] || 0;
        const available = Math.max(0, totalStock - rentedCount);
        const isFullyBooked = available === 0 && totalStock > 0;

        // Always show stock info when dates selected
        const stockBadge = '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;font-size:0.8em;font-weight:600;background:' +
            (isFullyBooked ? '#fee2e2' : rentedCount > 0 ? '#fef9c3' : '#f0fdf4') + ';color:' +
            (isFullyBooked ? '#991b1b' : rentedCount > 0 ? '#854d0e' : '#065f46') + ';">'
            + 'Total: <b>' + totalStock + '</b> &nbsp;|&nbsp; '
            + 'Rented: <b style="color:#dc3545;">' + rentedCount + '</b> &nbsp;|&nbsp; '
            + 'Available: <b style="color:' + (available > 0 ? '#16a34a' : '#dc3545') + ';">' + available + '</b>'
            + (isFullyBooked
                ? '<br><span style="color:#991b1b;">&#128683; Out of Stock for this period. Please select another date.</span>'
                : '<br><span>&#9989; Available for selected dates</span>')
            + '</div>';

        return '<article class="card" style="' + (isFullyBooked ? 'opacity:0.7;' : '') + '">'
            + '<div class="card-image" style="aspect-ratio:3/4;overflow:hidden;background:#f5f5f5;">'
            + '<img src="' + item.image_url + '" alt="' + item.title + '" style="width:100%;height:100%;object-fit:cover;display:block;' + (isFullyBooked ? 'filter:grayscale(60%);' : '') + '" />'
            + '</div>'
            + '<div class="card-body">'
            + '<h3 class="card-title" style="color:#000;">' + item.title + '</h3>'
            + '<div class="card-meta" style="color:#000;"><span>' + item.category + '</span><span>&#8377;' + item.price + '/day</span></div>'
            + '<p class="card-description" style="color:#000;">' + (item.description || '') + '</p>'
            + stockBadge
            + '<div class="card-footer" style="margin-top:8px;">'
            + '<span class="badge">' + (item.available ? 'Available' : 'Not Available') + '</span>'
            + (isFullyBooked
                ? '<button class="btn btn-secondary" style="opacity:0.5;cursor:not-allowed;" disabled>Fully Booked</button>'
                : '<button class="btn btn-secondary" onclick="openDetails(\'' + item.id + '\')" >View</button>')
            + '</div></div></article>';
    }).join('');
}

// ============================
// DETAILS MODAL
// ============================

function openDetails(id) {
    const item = clothes.find((c) => c.id == id);
    if (!item) return;

    // Load reviews for this product
    supabaseClient.from('reviews')
        .select('rating, comment, created_at, users(full_name)')
        .eq('cloth_id', id)
        .order('created_at', { ascending: false })
        .then(({ data: reviews }) => {
            const avgRating = reviews && reviews.length
                ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
                : null;
            const stars = (n) => '&#9733;'.repeat(Math.round(n)) + '&#9734;'.repeat(5 - Math.round(n));
            const reviewsHTML = reviews && reviews.length
                ? reviews.map(r =>
                    '<div style="border-top:1px solid rgba(255,255,255,0.08);padding:10px 0;">'
                    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                    + '<span style="color:#f59e0b;font-size:0.95em;">' + stars(r.rating) + '</span>'
                    + '<span style="font-size:0.82em;color:var(--muted);">' + (r.users?.full_name || 'User') + '</span>'
                    + '<span style="font-size:0.78em;color:var(--muted);margin-left:auto;">' + new Date(r.created_at).toLocaleDateString('en-IN') + '</span>'
                    + '</div>'
                    + (r.comment ? '<p style="margin:0;font-size:0.88em;color:var(--muted);">' + r.comment + '</p>' : '')
                    + '</div>'
                ).join('')
                : '<p style="color:var(--muted);font-size:0.88em;">No reviews yet. Be the first to review!</p>';

            openModal(
                '<div class="product-modal">'
                + '<div class="product-modal-img">'
                + '<img src="' + item.image_url + '" alt="' + item.title + '" />'
                + '<span class="product-modal-badge">' + (item.available ? '\u2713 Available' : '\u2717 Not Available') + '</span>'
                + '</div>'
                + '<div class="product-modal-info">'
                + '<span class="product-modal-cat">' + item.category + ' \u00b7 ' + item.gender + '</span>'
                + '<h2 class="product-modal-title">' + item.title + '</h2>'
                + (avgRating ? '<div style="color:#f59e0b;font-size:1em;margin-bottom:4px;">' + stars(avgRating) + ' <span style="color:var(--muted);font-size:0.85em;">(' + avgRating + ' / 5 &bull; ' + reviews.length + ' review' + (reviews.length > 1 ? 's' : '') + ')</span></div>' : '')
                + '<p class="product-modal-desc">' + (item.description || '') + '</p>'
                + '<div class="product-modal-tags">'
                + '<span class="pm-tag">\ud83d\udcd0 ' + item.size + '</span>'
                + (item.age ? '<span class="pm-tag">&#128102; ' + item.age + '</span>' : '')
                + '<span class="pm-tag">\ud83c\udf89 ' + item.occasion + '</span>'
                + (item.color ? '<span class="pm-tag">\ud83c\udfa8 ' + item.color + '</span>' : '')
                + (item.festival && item.festival !== 'None' ? '<span class="pm-tag">\ud83e\ude94 ' + item.festival + '</span>' : '')
                + '</div>'
                + '<div class="product-modal-price">'
                + '<div class="pm-price-main">\u20b9' + item.price + '<span>/day</span></div>'
                + '<div class="pm-price-deposit">Deposit: \u20b9' + (item.deposit || 0) + '</div>'
                + '</div>'
                + '<div class="product-modal-stock">Stock: ' + (item.stock || 0) + ' units</div>'
                + '<div style="margin-top:12px;max-height:160px;overflow-y:auto;">'
                + '<div style="font-size:0.78em;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--accent);margin-bottom:8px;">Customer Reviews</div>'
                + reviewsHTML
                + '</div>'
                + '<div class="product-modal-actions">'
                + ((item.stock || 0) > 0
                    ? [
                        '<button class="btn btn-primary pm-cart-btn" onclick="addToCart(\'' + item.id + '\')">\ud83d\uded2 Add to Cart</button>',
                        '<button class="btn btn-success pm-book-btn" style="margin-left:8px;" onclick="bookNowProduct(\'' + item.id + '\')">\ud83d\udccd Book Now</button>',
                        '<button class="btn btn-info pm-order-btn" style="margin-left:8px;" onclick="orderProduct(\'' + item.id + '\')">\ud83d\udce6 Order</button>'
                    ].join('')
                    : '<button class="btn btn-primary pm-cart-btn" disabled style="opacity:0.6;cursor:not-allowed;">\ud83d\uded2 Out of stock</button>'
                )
                + '<button class="btn btn-secondary pm-close-btn" onclick="closeModalWindow()">Close</button>'
                + '</div>'
                + '</div>'
                + '</div>'
            );
        });
}

function bookNowProduct(productId) {
    // Store productId and userId (if available)
    localStorage.setItem('selectedProductId', productId);
    if (currentUser && currentUser.id) {
        localStorage.setItem('userId', currentUser.id);
    }
    window.location.href = 'book_now.html';
}

function orderProduct(productId) {
    if (!currentUser) {
        showToast('Please login first');
        openLoginModal();
        return;
    }
    const cloth = clothes.find(c => c.id == productId);
    if (!cloth) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const nextD = new Date();
    nextD.setDate(nextD.getDate() + 1);
    const tomorrowStr = nextD.toISOString().split('T')[0];

    const mockCartItem = {
        id: 'direct_' + productId,
        quantity: 1,
        rental_days: 1,
        start_date: todayStr,
        end_date: tomorrowStr,
        clothes: { id: cloth.id, title: cloth.title, price: cloth.price, image_url: cloth.image_url }
    };

    localStorage.setItem('pendingOrderItems', JSON.stringify([mockCartItem]));
    localStorage.setItem('pendingCartIds', JSON.stringify([]));
    window.location.href = 'confirm_order.html';
}


async function requestReturn(orderId) {
    // Save orderId and redirect to return payment page
    localStorage.setItem('returnOrderId', orderId);
    window.location.href = 'return_payment.html';
}

// ============================
// RETURN PAYMENT PAGE
// ============================

async function loadReturnPaymentPage() {
    const orderId = localStorage.getItem('returnOrderId');
    if (!orderId) { window.location.href = 'orders.html'; return; }

    const { data: order, error } = await supabaseClient
        .from('orders')
        .select('*, clothes(id, title, image_url, price, size)')
        .eq('id', orderId)
        .single();

    if (error || !order) { showToast('Order not found'); window.location.href = 'orders.html'; return; }

    renderReturnBill(order);
}

function renderReturnBill(order) {
    const container = document.getElementById('returnBillContainer');
    if (!container) return;

    const cloth = order.clothes;
    const start = new Date(order.start_date);
    const now = new Date();

    // Actual rental days are counted from start date up to the true return date (today)
    const actualDays = Math.max(1, Math.ceil((now - start) / 86400000));
    const pricePerDay = cloth?.price || 0;
    const rentalAmount = parseFloat((pricePerDay * actualDays).toFixed(2));
    const gst = parseFloat((rentalAmount * 0.18).toFixed(2));
    const totalRentalWithGst = parseFloat((rentalAmount + gst).toFixed(2));

    // Use the deposit amount that was paid at checkout
    const depositPaid = parseFloat((order.deposit_amount || 0).toFixed(2));
    const balanceDue = parseFloat(Math.max(0, totalRentalWithGst - depositPaid).toFixed(2));
    const refund = parseFloat(Math.max(0, depositPaid - totalRentalWithGst).toFixed(2));

    // Store bill data for submission
    localStorage.setItem('returnBillData', JSON.stringify({
        orderId: order.id,
        clothId: order.cloth_id,
        totalBill: totalRentalWithGst,
        depositPaid,
        balanceDue,
        refund,
        actualDays
    }));

    container.innerHTML = `
        <div class="bill-card">
            <div class="bill-card-header">
                <h2>&#128257; Return Bill — Order #${order.id}</h2>
                <p>${cloth?.title || ''} | ${cloth?.size || ''}</p>
            </div>
            <div class="bill-body">
                <div class="bill-row"><span>Rental Start</span><span>${start.toLocaleDateString('en-IN')}</span></div>
                <div class="bill-row"><span>Return Date (Today)</span><span>${now.toLocaleDateString('en-IN')}</span></div>
                <div class="bill-row"><span>Actual Rental Days</span><span>${actualDays} day(s)</span></div>
                <div class="bill-row"><span>Price/Day</span><span>&#8377;${pricePerDay}</span></div>
                <div class="bill-row"><span>Rental Amount</span><span>&#8377;${rentalAmount}</span></div>
                <div class="bill-row"><span>GST (18%)</span><span>&#8377;${gst}</span></div>
                <div class="bill-row"><span>Total Rental + GST</span><span>&#8377;${totalRentalWithGst}</span></div>
                <div class="bill-row credit"><span>Deposit Already Paid</span><span>- &#8377;${depositPaid}</span></div>
                ${balanceDue > 0
            ? `<div class="bill-row due"><span>Balance Due (Pay Now)</span><span>&#8377;${balanceDue}</span></div>`
            : `<div class="bill-row credit"><span>Refund Amount</span><span>&#8377;${refund}</span></div>`
        }
            </div>
        </div>
        ${balanceDue > 0 ? `
        <div class="bill-card">
            <div class="bill-body">
                <p style="color:#000;font-weight:600;margin-bottom:16px;">Select Payment Method for Balance &#8377;${balanceDue}</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                    <div class="pay-method-box" onclick="showReturnCOD(${balanceDue})">
                        <div style="font-size:2em;">&#128666;</div>
                        <h3>Cash on Delivery</h3>
                        <p>Pay at the time of return pickup</p>
                    </div>
                    <div class="pay-method-box" onclick="showReturnOnline(${balanceDue})">
                        <div style="font-size:2em;">&#128241;</div>
                        <h3>Pay Online</h3>
                        <p>UPI / PhonePe / GPay</p>
                    </div>
                </div>
            </div>
        </div>` : `
        <div class="bill-card">
            <div class="bill-body" style="text-align:center;">
                <p style="color:#16a34a;font-weight:600;font-size:1.1em;">&#9989; No balance due! Deposit covers full rental.</p>
                ${refund > 0 ? `<p style="color:#0369a1;">Refund of &#8377;${refund} will be processed by admin.</p>` : ''}
                <button class="btn btn-primary" style="margin-top:16px;width:100%;padding:14px;" onclick="submitReturnRequest('Cash on Delivery','N/A',0)">Submit Return Request</button>
            </div>
        </div>`}
    `;
}

function showReturnCOD(amount) {
    openModal(`
        <div style="padding:20px;color:#000;max-width:380px;text-align:center;">
            <div style="font-size:3em;">&#128666;</div>
            <h2 style="margin:12px 0;">Cash on Delivery</h2>
            <p style="color:#555;">Pay &#8377;${amount} at the time of return pickup.</p>
            <div style="margin-top:16px;text-align:left;">
                <label style="font-weight:600;font-size:0.9em;">Your Phone Number</label>
                <input id="returnPayerPhone" type="tel" placeholder="Enter your 10-digit phone number" class="input-field" maxlength="10" />
            </div>
            <button class="btn btn-primary" style="width:100%;margin-top:16px;padding:14px;" onclick="submitReturnRequest('Cash on Delivery', document.getElementById('returnPayerPhone').value, ${amount})">Submit Return Request</button>
        </div>
    `);
}

function showReturnOnline(amount) {
    openModal(`
        <div style="padding:10px;color:#000;max-width:380px;text-align:center;">
            <h2 style="margin-bottom:16px;">Pay Online via UPI</h2>
            <div class="upi-box">
                <p style="color:#666;margin:0 0 8px;">Send &#8377;${amount} to</p>
                <div class="upi-number">8459643821</div>
                <div class="upi-name">Devyani Pawar</div>
                <p style="color:#666;font-size:0.85em;margin-top:8px;">PhonePe / GPay / Paytm</p>
            </div>
            <div style="margin-top:16px;text-align:left;">
                <label style="font-weight:600;font-size:0.9em;">Your Phone Number (from which you paid)</label>
                <input id="returnPayerPhone" type="tel" placeholder="Enter payer phone number" class="input-field" maxlength="10" />
            </div>
            <p style="margin-top:12px;color:#555;font-size:0.85em;">After payment, click below. Admin will verify.</p>
            <button class="btn btn-primary" style="width:100%;margin-top:12px;padding:14px;" onclick="submitReturnRequest('Online Payment', document.getElementById('returnPayerPhone').value, ${amount})">Payment Done — Submit Return</button>
        </div>
    `);
}

async function submitReturnRequest(paymentMethod, payerPhone, amountPaid) {
    if (paymentMethod !== 'Cash on Delivery' && (!payerPhone || payerPhone.replace(/\D/g, '').length < 10)) {
        showToast('Please enter a valid 10-digit phone number'); return;
    }

    const billData = JSON.parse(localStorage.getItem('returnBillData') || '{}');
    if (!billData.orderId) { showToast('Return data missing'); return; }

    const now = new Date().toISOString();

    const { error: orderErr } = await supabaseClient.from('orders')
        .update({ order_status: 'Returned', returned_at: now })
        .eq('id', billData.orderId);
    if (orderErr) { showToast('Failed: ' + orderErr.message); return; }

    const { error: retErr } = await supabaseClient.from('returned_orders').insert([{
        user_id: currentUser.id,
        order_id: billData.orderId,
        cloth_id: billData.clothId,
        return_date: now,
        return_status: 'Pending',
        status: 'Pending Approval',
        refund_amount: billData.refund || 0,
        notes: 'Payment: ' + paymentMethod + ' | Phone: ' + (payerPhone || 'N/A') + ' | Paid: Rs.' + amountPaid + ' | Total Bill: Rs.' + billData.totalBill + ' | Balance Due: Rs.' + billData.balanceDue,
        damage_notes: ''
    }]);

    if (retErr) { showToast('Return save failed: ' + retErr.message); return; }

    localStorage.removeItem('returnOrderId');
    localStorage.removeItem('returnBillData');

    // Show feedback modal after return is submitted
    openFeedbackModal(billData.clothId);
}

function openFeedbackModal(clothId) {
    openModal(
        '<div style="padding:28px;color:#000;max-width:420px;text-align:center;">'
        + '<div style="font-size:2.5em;margin-bottom:8px;">&#11088;</div>'
        + '<h2 style="margin-bottom:6px;">Rate Your Experience</h2>'
        + '<p style="color:#666;font-size:0.92em;margin-bottom:20px;">How was this outfit? Your feedback helps others!</p>'
        + '<div id="starRow" style="display:flex;justify-content:center;gap:10px;margin-bottom:20px;">'
        + [1, 2, 3, 4, 5].map(n =>
            '<span data-star="' + n + '" onclick="selectStar(' + n + ')" style="font-size:2.2em;cursor:pointer;color:#ddd;transition:color 0.15s;">&#9733;</span>'
        ).join('')
        + '</div>'
        + '<textarea id="feedbackComment" placeholder="Write your review (optional)..." style="width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:0.95em;resize:vertical;min-height:80px;font-family:inherit;"></textarea>'
        + '<div style="display:flex;gap:10px;margin-top:16px;">'
        + '<button class="btn btn-secondary" style="flex:1;" onclick="skipFeedback()">Skip</button>'
        + '<button class="btn btn-primary" style="flex:2;" onclick="submitFeedback(\'' + clothId + '\')" id="submitFeedbackBtn">Submit Feedback</button>'
        + '</div>'
        + '</div>'
    );
}

let _selectedStar = 0;
function selectStar(n) {
    _selectedStar = n;
    document.querySelectorAll('#starRow span').forEach((el, i) => {
        el.style.color = i < n ? '#f59e0b' : '#ddd';
    });
}

async function submitFeedback(clothId) {
    if (!_selectedStar) { showToast('Please select a star rating'); return; }
    const comment = document.getElementById('feedbackComment')?.value?.trim() || '';

    const { error } = await supabaseClient.from('reviews').insert([{
        user_id: currentUser.id,
        cloth_id: clothId,
        rating: _selectedStar,
        comment: comment || null
    }]);

    if (error) { showToast('Failed to save feedback: ' + error.message); return; }

    _selectedStar = 0;
    closeModalWindow();
    showToast('Thank you for your feedback!');
    setTimeout(() => { window.location.href = 'orders.html'; }, 1200);
}

function skipFeedback() {
    _selectedStar = 0;
    closeModalWindow();
    showToast('Return request submitted! Admin will verify.');
    setTimeout(() => { window.location.href = 'orders.html'; }, 1200);
}


async function rentNow(clothId) {
    if (!currentUser) { showToast('Please login first'); openLoginModal(); return; }
    const startVal = document.getElementById('rentStartDate')?.value;
    const endVal = document.getElementById('rentEndDate')?.value;

    if (!startVal || !endVal) { showToast('Please select delivery and return dates'); return; }

    const startDate = new Date(startVal);
    const endDate = new Date(endVal);
    const diff = endDate - startDate;
    if (diff <= 0) { showToast('Return date must be after delivery date'); return; }

    const cloth = clothes.find(c => c.id == clothId);
    const rentalDays = Math.max(1, Math.ceil(diff / 86400000));
    const rental = parseFloat((cloth.price * rentalDays).toFixed(2));
    const deposit = parseFloat((rental * 0.30).toFixed(2));
    const gst = parseFloat((deposit * 0.18).toFixed(2));
    const depositPaid = parseFloat((deposit + gst).toFixed(2));

    const { data: newOrder, error } = await supabaseClient.from('orders').insert([{
        user_id: currentUser.id,
        cloth_id: clothId,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        total_price: depositPaid,
        deposit_amount: depositPaid,
        payment_status: 'Pending',
        order_status: 'Pending',
        address: currentUserProfile?.address_line || ''
    }]).select('id').single();

    if (error) { showToast('Error: ' + error.message); return; }
    showToast('Order placed! Redirecting...');
    setTimeout(() => { window.location.href = 'orders.html'; }, 1200);
}

async function addToCart(clothId) {
    if (!currentUser) {
        showToast('Please login first');
        return;
    }
    if (!currentUserProfile?.id) {
        showToast('User profile not loaded. Please try logging in again.');
        return;
    }

    // Use auth UUID directly
    const userId = currentUser.id;

    // Check cart limit
    const { count } = await supabaseClient
        .from('cart')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    if (count >= 25) {
        showToast('Cart limit reached (max 25 items)');
        return;
    }

    // Ensure product has stock > 0 before adding
    const { data: clothData, error: clothErr } = await supabaseClient
        .from('clothes')
        .select('id, stock')
        .eq('id', clothId)
        .maybeSingle();
    if (clothErr) {
        console.error('Failed to fetch product stock:', clothErr);
    }
    const availableStock = (clothData && Number.isFinite(Number(clothData.stock))) ? Number(clothData.stock) : 0;
    if (availableStock <= 0) {
        showToast('Cannot add — product is out of stock');
        return;
    }

    // Check if already in cart
    const { data: existing } = await supabaseClient
        .from('cart')
        .select('id, quantity')
        .eq('user_id', userId)
        .eq('cloth_id', clothId)
        .maybeSingle();

    if (existing) {
        // ensure we don't increase beyond available stock
        if (existing.quantity + 1 > availableStock) {
            showToast('Cannot add more — only ' + availableStock + ' in stock');
            return;
        }
        const { error } = await supabaseClient
            .from('cart')
            .update({ quantity: existing.quantity + 1 })
            .eq('id', existing.id);
        if (error) { showToast('Failed to update cart: ' + error.message); return; }
        showToast('Cart quantity updated');
        return;
    }

    const { error } = await supabaseClient.from('cart').insert([
        { user_id: userId, cloth_id: clothId, quantity: 1, rental_days: 1 },
    ]);

    if (error) {
        console.error('Add to cart error:', error);
        showToast('Failed to add to cart: ' + error.message);
        return;
    }

    showToast('Added to cart');
}

async function loadCart() {
    if (!currentUser || !currentUserProfile?.id) {
        showToast('Please login first');
        return;
    }

    const { data, error } = await supabaseClient
        .from('cart')
        .select('id, quantity, rental_days, clothes(id, title, image_url, price)')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        showToast('Failed to load cart: ' + error.message);
        return;
    }

    window._fullCartData = data || []; // कार्ट डेटा ग्लोबल स्टोअर करा
    renderCartModal(window._fullCartData);
}

function filterCartItems() {
    const query = document.getElementById('cartSearchInput')?.value || '';
    const filtered = (window._fullCartData || []).filter(item => matchesSearch(item.clothes, query));
    renderCartTableRows(filtered);
}

function renderCartModal(items, isFiltering = false) {
    if (!isFiltering && items.length === 0) {
        openModal(`<div style="padding:20px; text-align:center;"><h2>Your Cart</h2><p style="margin-top:20px;">Your cart is empty.</p></div>`);
        return;
    }

    const searchBar = `
        <div style="margin-bottom:15px;">
            <input type="text" id="cartSearchInput" placeholder="Search cart items..." 
                style="width:100%; padding:10px; border:1px solid var(--border); border-radius:10px; font-family:inherit; background:var(--surface2); color:var(--text);"
                oninput="filterCartItems()" />
        </div>
    `;

    openModal(`
        <div style="min-width:320px;">
            <h2 style="margin-bottom:20px;">Your Cart</h2>
            ${searchBar}
            <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr style="background:var(--surface); color:var(--muted);">
                            <th style="padding:10px;">
                                <input type="checkbox" id="selectAllCart" style="width:18px; height:18px; cursor:pointer;" onchange="document.querySelectorAll('.cart-select').forEach(c => c.checked = this.checked)" />
                            </th>
                            <th style="padding:10px; text-align:left;">Item</th>
                            <th style="padding:10px;">Price</th>
                            <th style="padding:10px;">Qty</th>
                            <th style="padding:10px;">Days</th>
                            <th style="padding:10px;">Subtotal</th>
                            <th style="padding:10px;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="cartTableBody"></tbody>
                </table>
            </div>
            <div id="cartSummaryDisplay" style="margin-top:20px; text-align:right; font-size:1.1em; font-weight:600;"></div>
            <div style="margin-top:16px; display:flex; gap:12px; justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="orderSelectedFromCart()">Order Selected</button>
                <button class="btn btn-primary" onclick="orderAllFromCart()">Order All</button>
            </div>
        </div>
    `);

    renderCartTableRows(items);
}

function renderCartTableRows(items) {
    const tbody = document.getElementById('cartTableBody');
    const summary = document.getElementById('cartSummaryDisplay');
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">No items match search.</td></tr>';
        if (summary) summary.innerText = '';
        return;
    }

    tbody.innerHTML = items.map(item => {
        const cloth = item.clothes;
        const todayStr = new Date().toISOString().split('T')[0];
        if (!item.start_date) item.start_date = todayStr;
        if (!item.end_date) {
            const nextD = new Date();
            nextD.setDate(nextD.getDate() + (item.rental_days || 1));
            item.end_date = nextD.toISOString().split('T')[0];
        }
        const subtotal = (cloth?.price || 0) * item.quantity * item.rental_days;
        return `
        <tr>
            <td style="padding:10px; text-align:center;">
                <input type="checkbox" class="cart-select" data-id="${item.id}" style="width:18px; height:18px; cursor:pointer;" />
            </td>
            <td style="padding:10px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${cloth?.image_url || ''}" style="width:60px; height:80px; object-fit:cover; border-radius:8px;" />
                    <span>${cloth?.title || ''}</span>
                </div>
            </td>
            <td style="padding:10px; text-align:center;">₹${cloth?.price || 0}/day</td>
            <td style="padding:10px; text-align:center;">
                <input type="number" min="1" value="${item.quantity}" style="width:55px; padding:4px; border:1px solid var(--border); border-radius:6px; text-align:center; background:var(--surface2); color:var(--text);"
                    onchange="updateCartQuantity(${item.id}, this.value)" />
            </td>
            <td style="padding:10px; text-align:center; min-width:140px;">
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <div>
                        <label style="font-size:0.75em; color:var(--muted); display:block; text-align:left;">Start Date</label>
                        <input type="date" id="cart-start-${item.id}" value="${item.start_date}" min="${todayStr}" onchange="calculateCartDays(${item.id}, ${cloth?.price || 0})" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:6px; background:var(--surface2); color:var(--text); font-family:inherit;" />
                    </div>
                    <div>
                        <label style="font-size:0.75em; color:var(--muted); display:block; text-align:left;">Return Date</label>
                        <input type="date" id="cart-end-${item.id}" value="${item.end_date}" min="${todayStr}" onchange="calculateCartDays(${item.id}, ${cloth?.price || 0})" style="width:100%; padding:6px; border:1px solid var(--border); border-radius:6px; background:var(--surface2); color:var(--text); font-family:inherit;" />
                    </div>
                </div>
                <div style="font-size:0.85em; margin-top:6px; font-weight:600;"><span id="cart-days-${item.id}">${item.rental_days}</span> day(s)</div>
            </td>
            <td style="padding:10px; text-align:center; font-weight:600;" id="cart-subtotal-${item.id}">₹${subtotal}</td>
            <td style="padding:10px; text-align:center;">
                <button class="btn btn-primary" style="background:#dc3545; color:#fff; padding:6px 12px;" onclick="removeFromCart(${item.id})">Remove</button>
            </td>
        </tr>`;
    }).join('');

    updateCartSummaryDisplay();
}

async function updateCartQuantity(cartId, value) {
    const qty = parseInt(value);
    if (!qty || qty < 1) return;

    const item = window._fullCartData?.find(i => i.id === cartId);
    if (!item) return;

    const { data: cloth } = await supabaseClient.from('clothes').select('id, stock').eq('id', item.cloth_id || item.clothes?.id).maybeSingle();
    const stock = cloth && Number.isFinite(Number(cloth.stock)) ? Number(cloth.stock) : 0;
    if (qty > stock) { showToast('Only ' + stock + ' units available'); return; }

    await supabaseClient.from('cart').update({ quantity: qty }).eq('id', cartId);

    item.quantity = qty;
    const subtotal = (item.clothes?.price || 0) * item.quantity * item.rental_days;
    const subtotalEl = document.getElementById(`cart-subtotal-${cartId}`);
    if (subtotalEl) subtotalEl.innerText = '₹' + subtotal;

    updateCartSummaryDisplay();
}

function calculateCartDays(cartId, pricePerDay) {
    const startInput = document.getElementById(`cart-start-${cartId}`);
    const endInput = document.getElementById(`cart-end-${cartId}`);
    if (!startInput || !endInput || !startInput.value || !endInput.value) return;

    const start = new Date(startInput.value);
    const end = new Date(endInput.value);
    const diff = end - start;

    if (diff <= 0) {
        showToast('Return date must be after start date');
        endInput.value = '';
        return;
    }

    const days = Math.ceil(diff / 86400000);
    const daysEl = document.getElementById(`cart-days-${cartId}`);
    if (daysEl) daysEl.innerText = days;

    const item = window._fullCartData.find(i => i.id === cartId);
    if (item) {
        item.rental_days = days;
        item.start_date = startInput.value;
        item.end_date = endInput.value;
    }

    const subtotal = pricePerDay * (item?.quantity || 1) * days;
    const subtotalEl = document.getElementById(`cart-subtotal-${cartId}`);
    if (subtotalEl) subtotalEl.innerText = '₹' + subtotal;

    updateCartSummaryDisplay();
}

function updateCartSummaryDisplay() {
    const summary = document.getElementById('cartSummaryDisplay');
    if (!summary) return;
    const total = (window._fullCartData || []).reduce((sum, item) => {
        return sum + (item.clothes?.price || 0) * item.quantity * item.rental_days;
    }, 0);
    summary.innerText = 'Total: ₹' + total;
}

async function removeFromCart(cartId) {
    const { error } = await supabaseClient.from('cart').delete().eq('id', cartId);
    if (error) { showToast('Failed to remove: ' + error.message); return; }
    showToast('Removed from cart');
    await loadCart();
}

async function placeOrdersFromCart(cartIds) {
    if (!currentUser || !currentUserProfile) return;

    const cartItems = (window._fullCartData || []).filter(i => cartIds.includes(i.id));

    if (!cartItems.length) { showToast('Failed to fetch selected items'); return; }

    // Ensure start and end dates are selected
    for (let item of cartItems) {
        if (!item.start_date || !item.end_date) {
            showToast('Please select Start and Return dates for all items in the cart.');
            return;
        }
    }

    // Only save to localStorage — actual DB insert happens in confirm_order.html after payment
    localStorage.setItem('pendingOrderItems', JSON.stringify(cartItems));
    localStorage.setItem('pendingCartIds', JSON.stringify(cartIds));
    window.location.href = 'confirm_order.html';
}

async function orderSelectedFromCart() {
    const checked = [...document.querySelectorAll('.cart-select:checked')].map(c => parseInt(c.dataset.id));
    if (!checked.length) { showToast('Please select at least one item'); return; }
    await placeOrdersFromCart(checked);
}

async function orderAllFromCart() {
    const all = [...document.querySelectorAll('.cart-select')].map(c => parseInt(c.dataset.id));
    if (!all.length) { showToast('Cart is empty'); return; }
    await placeOrdersFromCart(all);
}

// ============================
// ORDERS PAGE
// ============================

async function loadOrders() {
    if (!currentUser) return;

    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, clothes!inner(id, title, image_url, price, size, category)')
        .select('*, clothes!inner(*)')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        document.getElementById('ordersContainer').innerHTML =
            `<div class="empty-orders"><p>Failed to load orders: ${error.message}</p></div>`;
        return;
    }

    // Load cancel_refunds for this user
    const { data: refunds } = await supabaseClient
        .from('cancel_refunds')
        .select('order_id, refund_status, refund_amount')
        .eq('user_id', currentUser.id);

    const refundMap = {};
    (refunds || []).forEach(r => { refundMap[r.order_id] = r; });

    userOrdersList = data || [];
    userOrdersRefundMap = refundMap;
    renderOrdersPage(userOrdersList, userOrdersRefundMap);
}

function filterUserOrders() {
    const query = document.getElementById('orderSearchInput')?.value || '';
    const filtered = userOrdersList.filter(o => matchesSearch(o.clothes, query));
    // फक्त लिस्ट अपडेट करा, इनपुट बार पुन्हा रेंडर करू नका जेणेकरून फोकस जाणार नाही
    renderOrdersPage(filtered, userOrdersRefundMap, true);
}

function renderOrdersPage(orders, refundMap = {}, onlyUpdateList = false) {
    const container = document.getElementById('ordersContainer');
    if (!container) return;

    if (!orders.length) {
        container.innerHTML = '<div class="empty-orders"><h2>No Orders Yet</h2><p>Browse our collection and rent something amazing!</p><a href="index.html" class="btn btn-primary" style="display:inline-block;margin-top:20px;">Browse Collection</a></div>';
        return;
    }

    const statusConfig = {
        'Pending': { color: '#856404', bg: '#fff3cd', label: 'Pending' },
        'Confirmed': { color: '#0f5132', bg: '#d1e7dd', label: 'Confirmed' },
        'Booked': { color: '#0f5132', bg: '#d1e7dd', label: 'Booked' },
        'Online Payment - Pending Approval': { color: '#856404', bg: '#fff3cd', label: 'Payment Pending Approval' },
        'Shipped': { color: '#0369a1', bg: '#e0f2fe', label: 'Shipped' },
        'Delivered': { color: '#16a34a', bg: '#dcfce7', label: 'Delivered' },
        'Returned': { color: '#7c3aed', bg: '#ede9fe', label: 'Returned' },
        'Cancelled': { color: '#842029', bg: '#f8d7da', label: 'Cancelled' },
    };

    const ordersHtml = orders.map(order => {
        const cloth = order.clothes;
        const start = new Date(order.start_date);
        const end = new Date(order.end_date);
        const rentalDays = Math.max(1, Math.round((end - start) / 86400000));

        const cfg = statusConfig[order.order_status] || { color: '#333', bg: '#eee', label: order.order_status };

        const deliveredAt = order.delivered_at ? new Date(order.delivered_at).toLocaleString('en-IN') : null;
        const returnedAt = order.returned_at ? new Date(order.returned_at).toLocaleString('en-IN') : null;
        let expectedReturn = null;
        if (order.delivered_at) {
            const d = new Date(order.delivered_at);
            d.setDate(d.getDate() + rentalDays);
            expectedReturn = d.toLocaleString('en-IN');
        }

        const isPending = order.order_status === 'Pending';
        const isDelivered = order.order_status === 'Delivered';
        const isOnlinePend = order.order_status === 'Online Payment - Pending Approval';
        const isCancelled = order.order_status === 'Cancelled';
        const refund = refundMap[order.id];

        // Refund status badge for cancelled orders
        let refundBadge = '';
        if (isCancelled) {
            if (!refund) {
                refundBadge = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.82em;font-weight:700;background:#f3f4f6;color:#6b7280;">&#9711; No Refund Request</span>';
            } else if (refund.refund_status === 'Paid') {
                refundBadge = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.82em;font-weight:700;background:#d1fae5;color:#065f46;">&#9989; Refund Paid &mdash; &#8377;' + refund.refund_amount + '</span>';
            } else if (refund.refund_status === 'Rejected') {
                refundBadge = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.82em;font-weight:700;background:#fee2e2;color:#991b1b;">&#10060; Refund Rejected</span>';
            } else {
                refundBadge = '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.82em;font-weight:700;background:#fef9c3;color:#854d0e;">&#9203; Refund Pending &mdash; &#8377;' + refund.refund_amount + '</span>';
            }
        }

        return `
        <div class="order-card">
            <div class="order-card-header">
                <h3>Order #${order.id} &nbsp;|&nbsp; ${new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</h3>
                <div style="display:flex; gap:10px; align-items:center;">
                    <span class="payment-badge">&#128181; ${order.payment_status}</span>
                    <span style="padding:4px 12px; border-radius:20px; font-size:0.85em; font-weight:700; background:${cfg.bg}; color:${cfg.color};">${cfg.label}</span>
                </div>
            </div>
            <table class="order-items-table">
                <thead><tr><th>Product</th><th>Size</th><th>Rental Period</th><th>Price/Day</th></tr></thead>
                <tbody>
                    <tr>
                        <td>
                            <div style="display:flex; align-items:center; gap:12px;">
                                <img src="${cloth?.image_url || ''}" style="width:50px; height:65px; object-fit:cover; border-radius:8px;" />
                                <span style="font-weight:600;">${cloth?.title || 'N/A'}</span>
                            </div>
                        </td>
                        <td>${cloth?.size || '-'}</td>
                        <td>${order.start_date} to ${order.end_date}<br><small style="color:var(--muted);">${rentalDays} day(s)</small></td>
                        <td>&#8377;${cloth?.price || 0}</td>
                    </tr>
                </tbody>
            </table>
            <div class="bill-section">
                <div style="font-weight:600; margin-bottom:8px;">Bill & Delivery Info</div>
                <div class="bill-row"><span>Amount Paid (Deposit + GST)</span><span>&#8377;${order.total_price}</span></div>
                <div class="bill-row"><span>Payment</span><span>${order.payment_status}</span></div>
                ${deliveredAt ? `<div class="bill-row" style="color:#4ade80;"><span>&#9989; Delivered On</span><span>${deliveredAt}</span></div>` : ''}
                ${expectedReturn && !returnedAt ? `<div class="bill-row" style="color:#fbbf24;"><span>&#128197; Expected Return By</span><span>${expectedReturn}</span></div>` : ''}
                ${returnedAt ? `<div class="bill-row" style="color:#c084fc;"><span>&#128257; Returned On</span><span>${returnedAt}</span></div>` : ''}
                <div style="margin-top:8px; color:var(--muted); font-size:0.9em;">&#128205; Address: ${order.address || 'Not provided'}</div>
                ${isOnlinePend ? '<div style="margin-top:8px;color:#fbbf24;font-size:0.9em;font-weight:600;">&#9203; Waiting for admin to verify your online payment.</div>' : ''}
                ${isCancelled && refundBadge ? '<div style="margin-top:10px;">' + refundBadge + '</div>' : ''}
            </div>
            <div class="order-actions">
                ${isPending ? '<button class="btn btn-secondary" style="background:#dc3545;color:#fff;" onclick="cancelOrder(' + "'" + order.id + "'" + ')">Cancel Order</button>' : ''}
                ${isPending ? '<button class="btn btn-primary" onclick="confirmOrder(' + "'" + order.id + "'" + ')">Complete Order</button>' : ''}
                ${isOnlinePend ? '<button class="btn btn-secondary" style="background:#dc3545;color:#fff;" onclick="cancelOrder(' + "'" + order.id + "'" + ')">Cancel Order</button>' : ''}
                ${isDelivered ? '<button class="btn btn-primary" style="background:#7c3aed;" onclick="requestReturn(' + "'" + order.id + "'" + ')">&#128257; Return Product</button>' : ''}
                ${isDelivered ? '<button class="btn btn-secondary" style="background:#0891b2;color:#fff;" onclick="editReturnDate(' + "'" + order.id + "'" + ',\'' + order.end_date + '\')" >&#128197; Edit Return Date</button>' : ''}
                <button class="btn btn-secondary" style="background:#0369a1;color:#fff;" onclick="printUserBill('${order.id}')">&#128438; Print / Download Bill</button>
            </div>
        </div>`;
    }).join('');

    if (onlyUpdateList) {
        const listDiv = document.getElementById('ordersListWrapper');
        if (listDiv) listDiv.innerHTML = ordersHtml;
    } else {
        container.innerHTML = '<div id="ordersListWrapper">' + ordersHtml + '</div>';
    }
}

async function orderSelectedFromOrders() {
    const ids = [...document.querySelectorAll('.order-select:checked')].map(cb => cb.dataset.id);
    if (!ids.length) return showToast('Please select orders first');
    window.location.href = 'orders.html';
}

async function orderAllFromOrders() {
    const ids = [...document.querySelectorAll('.order-select')].map(cb => cb.dataset.id);
    if (!ids.length) return showToast('No orders found');
    window.location.href = 'orders.html';
}

async function confirmOrder(orderId) {
    openModal(`
        <div style="padding:30px; text-align:center; color:#000; max-width:400px;">
            <div style="font-size:3em; margin-bottom:16px;">✅</div>
            <h2 style="margin-bottom:12px;">Confirm Order?</h2>
            <p style="color:#555; margin-bottom:24px;">You will need to pay the <b>Deposit Amount</b> now to confirm. The remaining rental balance is paid upon return.</p>
            <div style="display:flex; gap:12px; justify-content:center;">
                <button class="btn btn-secondary" onclick="closeModalWindow()">Cancel</button>
                <button class="btn btn-primary" onclick="finalConfirmOrder('${orderId}')">Yes, Confirm Order</button>
            </div>
        </div>
    `);
}

async function finalConfirmOrder(orderId) {
    const { error } = await supabaseClient
        .from('orders')
        .update({ order_status: 'Booked', payment_status: 'Cash on Delivery' })
        .eq('id', orderId);

    if (error) { showToast('Failed to confirm: ' + error.message); return; }
    closeModalWindow();
    showToast('Order confirmed successfully!');
    await loadOrders();
}

function editReturnDate(orderId, currentEndDate) {
    const minDate = new Date().toISOString().split('T')[0];
    openModal(
        '<div style="padding:28px;color:#000;max-width:400px;text-align:center;">'
        + '<div style="font-size:2.5em;margin-bottom:8px;">&#128197;</div>'
        + '<h2 style="margin-bottom:6px;">Edit Return Date</h2>'
        + '<p style="color:#666;font-size:0.9em;margin-bottom:20px;">Order #' + orderId + ' &mdash; Current return date: <b>' + new Date(currentEndDate).toLocaleDateString('en-IN') + '</b></p>'
        + '<div style="text-align:left;margin-bottom:20px;">'
        + '<label style="font-weight:600;font-size:0.9em;display:block;margin-bottom:8px;">New Return Date</label>'
        + '<input type="date" id="newReturnDate" min="' + minDate + '" value="' + currentEndDate + '" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:1em;" />'
        + '</div>'
        + '<div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:12px;margin-bottom:20px;font-size:0.82em;color:#854d0e;">'
        + '&#9888; Extending return date may increase your final bill. Admin will recalculate at return time.'
        + '</div>'
        + '<div style="display:flex;gap:10px;">'
        + '<button class="btn btn-secondary" style="flex:1;" onclick="closeModalWindow()">Cancel</button>'
        + '<button class="btn btn-primary" style="flex:2;" onclick="saveReturnDate(\'' + orderId + '\')" >Save New Date</button>'
        + '</div>'
        + '</div>'
    );
}

async function saveReturnDate(orderId) {
    const newDate = document.getElementById('newReturnDate')?.value;
    if (!newDate) { showToast('Please select a date'); return; }

    const today = new Date().toISOString().split('T')[0];
    if (newDate < today) { showToast('Return date cannot be in the past'); return; }

    const { error } = await supabaseClient
        .from('orders')
        .update({ end_date: newDate })
        .eq('id', orderId)
        .eq('user_id', currentUser.id);

    if (error) { showToast('Failed to update: ' + error.message); return; }

    closeModalWindow();
    showToast('Return date updated successfully!');
    await loadOrders();
}

async function cancelOrder(orderId) {
    // Fetch order details first to calculate refund
    const { data: order, error: fetchErr } = await supabaseClient
        .from('orders')
        .select('*, clothes(id, title, price, deposit)')
        .eq('id', orderId)
        .single();
    if (fetchErr || !order) { showToast('Could not load order details'); return; }

    const depositPaid = parseFloat(order.total_price || 0);
    const paymentMethod = order.payment_status || 'Cash on Delivery';

    // Show cancel + refund confirmation modal
    openModal(
        '<div style="padding:28px;color:#000;max-width:420px;text-align:center;">'
        + '<div style="font-size:2.5em;margin-bottom:8px;">&#10060;</div>'
        + '<h2 style="margin-bottom:8px;">Cancel Order?</h2>'
        + '<p style="color:#555;margin-bottom:20px;">Order #' + orderId + ' &mdash; <b>' + (order.clothes?.title || '') + '</b></p>'
        + '<div style="background:#fef9c3;border:1px solid #fde047;border-radius:12px;padding:16px;margin-bottom:20px;text-align:left;">'
        + '<div style="font-weight:700;color:#854d0e;margin-bottom:8px;">&#128181; Refund Details</div>'
        + '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.92em;"><span>Deposit Paid</span><span>&#8377;' + depositPaid + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.92em;"><span>Payment Method</span><span>' + paymentMethod + '</span></div>'
        + '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:1em;font-weight:700;border-top:1px solid #fde047;margin-top:6px;"><span>Refund Amount</span><span style="color:#16a34a;">&#8377;' + depositPaid + '</span></div>'
        + '<p style="font-size:0.8em;color:#92400e;margin-top:8px;">* Refund will be processed by admin after verification.</p>'
        + '</div>'
        + '<textarea id="cancelReason" placeholder="Reason for cancellation (optional)..." style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:0.9em;resize:vertical;min-height:60px;font-family:inherit;margin-bottom:16px;"></textarea>'
        + '<div style="display:flex;gap:10px;">'
        + '<button class="btn btn-secondary" style="flex:1;" onclick="closeModalWindow()">Keep Order</button>'
        + '<button class="btn btn-primary" style="flex:2;background:#dc3545;" onclick="confirmCancelOrder(' + "'" + orderId + "'" + ',' + depositPaid + ',\'' + paymentMethod + '\',\'' + (order.cloth_id || order.clothes?.id || '') + '\')" >Yes, Cancel & Request Refund</button>'
        + '</div>'
        + '</div>'
    );
}

async function confirmCancelOrder(orderId, depositPaid, paymentMethod, clothId) {
    const reason = document.getElementById('cancelReason')?.value?.trim() || 'No reason provided';

    // 1. Update order status to Cancelled
    const { error: cancelErr } = await supabaseClient
        .from('orders')
        .update({ order_status: 'Cancelled' })
        .eq('id', orderId);
    if (cancelErr) { showToast('Failed to cancel: ' + cancelErr.message); return; }

    // 2. Insert into cancel_refunds table
    const { error: refundErr } = await supabaseClient
        .from('cancel_refunds')
        .insert([{
            order_id: parseInt(orderId),
            user_id: currentUser.id,
            cloth_id: clothId,
            deposit_paid: depositPaid,
            refund_amount: depositPaid,
            refund_status: 'Pending',
            payment_method: paymentMethod,
            notes: 'Reason: ' + reason
        }]);
    if (refundErr) { showToast('Order cancelled but refund record failed: ' + refundErr.message); }

    closeModalWindow();
    showToast('Order cancelled! Refund request sent to admin.');
    await loadOrders();
}


// ============================
// ADMIN PAGE (only initialize on admin.html)
// ============================

async function initAdminPage() {
    adminDashboardSection = document.getElementById('adminDashboard');
    adminUsersTableBody = document.getElementById('adminUsersTableBody');
    adminProductsTableBody = document.getElementById('adminProductsTableBody');
    addProductForm = document.getElementById('addProductForm');

    await checkSession();
    showAdminDashboard();
}

async function processAddProduct() {
    // जर आधीच एक रिक्वेस्ट चालू असेल, तर दुसरी सुरू करू नका
    if (isSubmittingProduct) return;

    const title = document.getElementById('addTitle')?.value || '';
    const category = document.getElementById('addCategory')?.value || '';
    const gender = document.getElementById('addGender')?.value || '';
    const age = document.getElementById('addAge')?.value || '';
    const size = document.getElementById('addSize')?.value || '';
    const occasion = document.getElementById('addOccasion')?.value || '';
    const price = parseFloat(document.getElementById('addPrice')?.value || '0');
    const deposit = parseFloat(document.getElementById('addDeposit')?.value || '0');
    const color = document.getElementById('addColor')?.value || '';
    const imageUrl = document.getElementById('addImageUrl')?.value || '';
    const description = document.getElementById('addDescription')?.value || '';
    const stock = parseInt(document.getElementById('addStock')?.value || '0', 10);
    const festivalValue = document.getElementById('addFestival')?.value || 'None';
    const available = document.getElementById('addAvailable')?.checked ?? true;

    if (!title || !category || !gender || !age || !size || !occasion || !color || Number.isNaN(price) || Number.isNaN(deposit) || Number.isNaN(stock) || stock <= 0) {
        showToast('Please fill all required product fields correctly. Stock must be greater than 0.');
        return;
    }

    isSubmittingProduct = true;

    const submitBtn = addProductForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerText;

    submitBtn.disabled = true;
    submitBtn.innerText = 'Processing...';

    const productData = {
        title, category, gender, age, size, occasion,
        price, deposit, color, image_url: imageUrl,
        description, stock, festival: festivalValue,
        available
    };

    if (editingProductId) {
        const { error } = await supabaseClient.from('clothes').update(productData).eq('id', editingProductId);
        if (error) {
            showToast('Update failed: ' + error.message);
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
            isSubmittingProduct = false;
            return;
        }
        showToast('Product updated successfully!');
        resetProductForm();
    } else {
        const { error } = await supabaseClient.from('clothes').insert([productData]);
        if (error) {
            showToast('Failed to add product: ' + error.message);
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
            isSubmittingProduct = false;
            return;
        }
        showToast('Product added successfully!');
        resetProductForm(); // प्रॉडक्ट ॲड झाल्यावर फॉर्म रिकामा करा
    }

    await loadAdminProductsFromSupabase();
    submitBtn.disabled = false;
    submitBtn.innerText = originalBtnText;
    isSubmittingProduct = false;
}

// ============================
// START
// ============================


// ============================
// CONFIRM ORDER PAGE
// ============================

function loadConfirmOrderPage() {
    const raw = localStorage.getItem('pendingOrderItems');
    if (!raw) { window.location.href = 'index.html'; return; }
    renderConfirmBill(JSON.parse(raw));
}

function renderConfirmBill(items) {
    const container = document.getElementById('confirmBillContainer');
    if (!container) return;
    const DEPOSIT_RATE = 0.30, GST_RATE = 0.18;
    const itemRowsHtml = items.map(item => {
        const cloth = item.clothes;
        const rental = parseFloat((cloth.price * item.quantity * item.rental_days).toFixed(2));
        const deposit = parseFloat((rental * DEPOSIT_RATE).toFixed(2));
        return '<div class="bill-item-row"><img src="' + (cloth.image_url || '') + '" style="width:55px;height:72px;object-fit:cover;border-radius:8px;" />'
            + '<div class="bill-item-info"><h4>' + cloth.title + '</h4>'
            + '<p>&#8377;' + cloth.price + '/day x ' + item.quantity + ' qty x ' + item.rental_days + ' days</p>'
            + (item.start_date && item.end_date ? '<p style="color:#666;font-size:0.85em;">Dates: ' + item.start_date + ' to ' + item.end_date + '</p>' : '')
            + '<p style="color:#0369a1;">Deposit (30%): &#8377;' + deposit + '</p></div>'
            + '<div class="bill-item-price">&#8377;' + rental + '</div></div>';
    }).join('');
    const totalRental = items.reduce((s, i) => s + i.clothes.price * i.quantity * i.rental_days, 0);
    const totalDeposit = parseFloat((totalRental * DEPOSIT_RATE).toFixed(2));
    const gst = parseFloat((totalDeposit * GST_RATE).toFixed(2));
    const grandTotal = parseFloat((totalDeposit + gst).toFixed(2));
    container.innerHTML = '<div class="bill-card">'
        + '<div class="bill-card-header"><h2>Order Bill</h2><p>' + items.length + ' item(s) for rental</p></div>'
        + '<div class="bill-items">' + itemRowsHtml + '</div>'
        + '<div class="bill-summary">'
        + '<div class="bill-summary-row"><span>Total Rental</span><span>&#8377;' + totalRental.toFixed(2) + '</span></div>'
        + '<div class="bill-summary-row deposit"><span>Deposit (30%)</span><span>&#8377;' + totalDeposit + '</span></div>'
        + '<div class="bill-summary-row gst"><span>GST on Deposit (18%)</span><span>&#8377;' + gst + '</span></div>'
        + '<div class="bill-summary-row grand"><span>Total Payable Now</span><span>&#8377;' + grandTotal + '</span></div>'
        + '<p style="color:#666;font-size:0.85em;margin-top:12px;">* Remaining balance collected on delivery.</p>'
        + '</div></div>'
        + '<button class="btn btn-primary pay-btn" style="width:100%;padding:16px;font-size:1.1em;margin-top:16px;border-radius:12px;" onclick="openPaymentMethodModal(' + grandTotal + ')">Pay Bill &mdash; &#8377;' + grandTotal + '</button>';
}

function openPaymentMethodModal(amount) {
    openModal('<div style="padding:10px;color:#000;max-width:420px;">'
        + '<h2 style="margin-bottom:6px;">Select Payment Method</h2>'
        + '<p style="color:#666;margin-bottom:24px;">Pay &#8377;' + amount + '</p>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
        + '<div style="border:2px solid #e5e7eb;border-radius:14px;padding:20px;cursor:pointer;text-align:center;" onclick="handleCashOnDelivery()">'
        + '<div style="font-size:2.5em;">&#128666;</div><h3 style="margin:10px 0 6px;color:#000;">Cash on Delivery</h3><p style="color:#666;font-size:0.85em;">Pay when order arrives</p></div>'
        + '<div style="border:2px solid #e5e7eb;border-radius:14px;padding:20px;cursor:pointer;text-align:center;" onclick="handlePayOnline(' + amount + ')">'
        + '<div style="font-size:2.5em;">&#128241;</div><h3 style="margin:10px 0 6px;color:#000;">Pay Online</h3><p style="color:#666;font-size:0.85em;">UPI / PhonePe / GPay</p></div>'
        + '</div></div>');
}

async function handleCashOnDelivery() {
    closeModalWindow();
    await submitOrders('Pending', 'Cash on Delivery');
}

function handlePayOnline(amount) {
    openModal('<div style="padding:10px;color:#000;max-width:380px;text-align:center;">'
        + '<h2 style="margin-bottom:16px;">Pay Online via UPI</h2>'
        + '<div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:14px;padding:24px;">'
        + '<p style="color:#666;margin:0 0 8px;">Send &#8377;' + amount + ' to</p>'
        + '<div style="font-size:1.8em;font-weight:800;color:#111;letter-spacing:2px;margin:12px 0 4px;">8459643821</div>'
        + '<div style="font-size:1em;color:#16a34a;font-weight:600;">Devyani Pawar</div>'
        + '<p style="color:#666;font-size:0.85em;margin-top:12px;">Use PhonePe / GPay / Paytm</p></div>'
        + '<p style="margin-top:20px;color:#555;font-size:0.9em;">After payment click below. Admin will verify.</p>'
        + '<button class="btn btn-primary" style="width:100%;margin-top:16px;" onclick="submitOnlinePaymentOrder()">I have paid &mdash; Submit Order</button>'
        + '</div>');
}

async function submitOnlinePaymentOrder() {
    closeModalWindow();
    await submitOrders('Online Payment - Pending Approval', 'Online Payment');
}

async function submitOrders(orderStatus, paymentStatus) {
    if (!currentUser || !currentUserProfile) { showToast('Please login first'); return; }
    const raw = localStorage.getItem('pendingOrderItems');
    const cartIds = JSON.parse(localStorage.getItem('pendingCartIds') || '[]');
    if (!raw) { showToast('No order data found'); return; }
    const items = JSON.parse(raw);
    const today = new Date();
    const orders = items.map(item => {
        const startDateStr = item.start_date || today.toISOString().split('T')[0];
        let endDateStr = item.end_date;
        if (!endDateStr) {
            const startObj = new Date(startDateStr);
            startObj.setDate(startObj.getDate() + (item.rental_days || 1));
            endDateStr = startObj.toISOString().split('T')[0];
        }
        const rental = item.clothes.price * item.quantity * (item.rental_days || 1);
        const deposit = parseFloat((rental * 0.30).toFixed(2));
        const gst = parseFloat((deposit * 0.18).toFixed(2));
        const depositPaid = parseFloat((deposit + gst).toFixed(2));
        return {
            user_id: currentUser.id,
            cloth_id: item.clothes.id,
            start_date: startDateStr,
            end_date: endDateStr,
            total_price: depositPaid,
            deposit_amount: depositPaid,
            payment_status: paymentStatus,
            order_status: orderStatus,
            address: currentUserProfile.address_line || '',
        };
    });
    const { error } = await supabaseClient.from('orders').insert(orders);
    if (error) { showToast('Order failed: ' + error.message); return; }
    if (cartIds.length) await supabaseClient.from('cart').delete().in('id', cartIds);
    localStorage.removeItem('pendingOrderItems');
    localStorage.removeItem('pendingCartIds');
    showToast('Order placed! Redirecting...');
    setTimeout(() => { window.location.href = 'orders.html'; }, 1200);
}

// ============================
// ADMIN ORDERS
// ============================

async function adminDeleteSelectedOrders() {
    const ids = [...document.querySelectorAll('.order-row-check:checked')].map(c => parseInt(c.dataset.id));
    if (!ids.length) { showToast('Please select at least one order'); return; }
    if (!confirm('Delete ' + ids.length + ' selected order(s)? This cannot be undone.')) return;
    let failed = 0;
    for (const id of ids) {
        const { error } = await supabaseClient.from('orders').delete().eq('id', id);
        if (error) { console.error('Delete order ' + id + ':', error); failed++; }
    }
    if (failed) showToast(failed + ' order(s) failed to delete. Check console.');
    else showToast(ids.length + ' order(s) deleted!');
    await loadAdminOrders();
}

async function adminDeleteAllOrders() {
    if (!confirm('Delete ALL orders permanently? This cannot be undone!')) return;
    if (!confirm('Are you absolutely sure? All order history will be lost!')) return;
    const { data: allOrders, error: fetchErr } = await supabaseClient.from('orders').select('id');
    if (fetchErr) { showToast('Failed to fetch orders: ' + fetchErr.message); return; }
    if (!allOrders || !allOrders.length) { showToast('No orders to delete'); return; }
    let failed = 0;
    for (const o of allOrders) {
        const { error } = await supabaseClient.from('orders').delete().eq('id', o.id);
        if (error) { console.error('Delete order ' + o.id + ':', error); failed++; }
    }
    if (failed) showToast(failed + ' order(s) failed. Check console.');
    else showToast('All orders deleted!');
    await loadAdminOrders();
}

function filterAdminOrders() {
    const query = document.getElementById('adminOrderSearchInput')?.value?.toLowerCase() || '';
    const filtered = adminOrdersFullList.filter(o =>
        String(o.id).includes(query) ||
        String(o.user_id).toLowerCase().includes(query) ||
        String(o.order_status).toLowerCase().includes(query)
    );
    renderAdminOrdersTable(filtered); // Note: renderAdminOrdersTable doesn't currently handle returnMap/refundMap in basic view
}

function filterAdminProducts() {
    const query = document.getElementById('adminProductSearchInput')?.value || '';
    const filtered = clothes.filter(p => matchesSearch(p, query));
    renderAdminProductsTable(filtered);
}

async function loadAdminOrders() {
    const tbody = document.getElementById('adminOrdersTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#888;">Loading...</td></tr>';

    // Fetch orders along with user and cloth details
    const [{ data: orders, error: ordersErr }, { data: returns, error: returnsErr }, { data: cancels, error: cancelsErr }] = await Promise.all([
        supabaseClient.from('orders').select('*, users(full_name,email,phone), clothes(id,title,image_url,price,size,category)').order('created_at', { ascending: false }),
        supabaseClient.from('returned_orders').select('*').order('return_date', { ascending: false }),
        supabaseClient.from('cancel_refunds').select('*').order('cancelled_at', { ascending: false })
    ]);

    if (ordersErr) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="color:red;padding:20px;text-align:center;">Error: ' + ordersErr.message + '</td></tr>';
        return;
    }

    adminOrdersFullList = orders || [];

    // Auto-extend return date if user hasn't returned past end_date
    if (orders) {
        const todayStr = new Date().toISOString().split('T')[0];
        for (let o of orders) {
            if (o.order_status === 'Delivered' && o.end_date < todayStr) {
                o.end_date = todayStr;
                // Update in background to ensure database reflects real-time extension
                supabaseClient.from('orders').update({ end_date: todayStr }).eq('id', o.id).then();
            }
        }
    }

    if (!orders || !orders.length) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="color:orange;padding:20px;text-align:center;">0 orders returned from DB</td></tr>';
        return;
    }

    // Build maps for returns and cancel refunds keyed by order_id
    const returnMap = {};
    (returns || []).forEach(r => { if (r && r.order_id) returnMap[r.order_id] = r; });
    const cancelMap = {};
    (cancels || []).forEach(c => { if (c && c.order_id) cancelMap[c.order_id] = c; });

    // Use the richer renderer which includes return and refund info
    renderAdminOrdersTable(orders, returnMap, cancelMap);
}

function renderAdminOrdersTable(orders, returnMap, cancelRefundMap) {
    returnMap = returnMap || {};
    cancelRefundMap = cancelRefundMap || {};
    const tbody = document.getElementById('adminOrdersTableBody');
    if (!tbody) return;
    if (!orders.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#000;padding:20px;">No orders found.</td></tr>';
        return;
    }
    tbody.innerHTML = orders.map(order => {
        const s = order.order_status;
        const isOnlinePending = s === 'Online Payment - Pending Approval';
        const isPending = s === 'Pending';
        const isBooked = s === 'Confirmed' || s === 'Booked';
        const isShipped = s === 'Shipped';
        const isDone = s === 'Delivered' || s === 'Returned' || s === 'Cancelled';

        const statusColor = (isBooked) ? '#0f5132'
            : s === 'Shipped' ? '#0369a1'
                : s === 'Delivered' ? '#16a34a'
                    : s === 'Returned' ? '#7c3aed'
                        : s === 'Cancelled' ? '#842029' : '#856404';

        const payBadge = (order.payment_status || '').includes('Online') ? '#0369a1' : '#856404';

        // Calculate bill amount: (rental days * price/day + GST) - deposit_amount
        const start = new Date(order.start_date);
        const end = new Date(order.end_date);
        const rentalDays = Math.max(1, Math.ceil((end - start) / 86400000));
        const pricePerDay = order.clothes?.price || 0;
        const rentalAmount = rentalDays * pricePerDay;
        const gst = rentalAmount * 0.18;
        const totalRental = rentalAmount + gst;
        const depositPaid = order.deposit_amount || 0;
        const billAmount = Math.max(0, totalRental - depositPaid);

        const deliveredAt = order.delivered_at ? new Date(order.delivered_at).toLocaleString('en-IN') : '';
        const returnedAt = order.returned_at ? new Date(order.returned_at).toLocaleString('en-IN') : '';

        // Return info from returned_orders table
        const returnRecord = returnMap[order.id];
        const returnInfo = returnRecord
            ? '<div style="margin-top:6px;padding:6px 8px;background:#ede9fe;border-radius:6px;font-size:0.82em;">'
            + '<b style="color:#7c3aed;">&#128257; Return Record</b><br>'
            + 'Returned: ' + (returnRecord.return_date ? new Date(returnRecord.return_date).toLocaleDateString('en-IN') : 'N/A') + '<br>'
            + 'Status: ' + (returnRecord.return_status || returnRecord.status || 'N/A') + '<br>'
            + (returnRecord.notes ? 'Note: ' + returnRecord.notes : '')
            + '</div>'
            : '';

        // Cancel refund info
        const cancelRefund = cancelRefundMap[order.id];
        let cancelRefundInfo = '';
        if (s === 'Cancelled' && cancelRefund) {
            const rColor = cancelRefund.refund_status === 'Paid' ? '#065f46' : cancelRefund.refund_status === 'Rejected' ? '#991b1b' : '#854d0e';
            const rBg = cancelRefund.refund_status === 'Paid' ? '#d1fae5' : cancelRefund.refund_status === 'Rejected' ? '#fee2e2' : '#fef9c3';
            const rIcon = cancelRefund.refund_status === 'Paid' ? '&#9989;' : cancelRefund.refund_status === 'Rejected' ? '&#10060;' : '&#9203;';
            cancelRefundInfo = '<div style="margin-top:6px;padding:6px 10px;background:' + rBg + ';border-radius:6px;font-size:0.82em;">'
                + '<b style="color:' + rColor + ';">' + rIcon + ' Refund: ' + cancelRefund.refund_status + '</b><br>'
                + 'Amount: &#8377;' + cancelRefund.refund_amount + ' | ' + (cancelRefund.payment_method || '') + '</div>';
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const canAct = todayStr >= order.start_date;

        let actionsHtml = '';
        if (!isDone) {
            if (canAct) {
                const approveBtn = isOnlinePending
                    ? '<button style="background:#16a34a;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminAction(\'' + order.id + '\',\'Booked\',\'Online Payment - Approved\')">&#10003; Approve</button>'
                    : '';
                const shipBtn = (isPending || isBooked)
                    ? '<button style="background:#0369a1;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminAction(\'' + order.id + '\',\'Shipped\',null)">&#128666; Ship</button>'
                    : '';
                const deliverBtn = isShipped
                    ? '<button style="background:#16a34a;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminAction(\'' + order.id + '\',\'Delivered\',null,true)">&#9989; Delivered</button>'
                    : '';
                const cancelBtn = '<button style="background:#dc3545;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminAction(\'' + order.id + '\',\'Cancelled\',null)">&#10005; Reject</button>';
                actionsHtml = approveBtn + shipBtn + deliverBtn + cancelBtn;
            } else {
                actionsHtml = '<div style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;padding:8px 6px;border-radius:6px;font-size:0.82em;text-align:center;line-height:1.4;">Actions unlock on<br><b>' + new Date(order.start_date).toLocaleDateString('en-IN') + '</b></div>';
            }
        }

        return '<tr style="color:#000;">'
            + '<td><input type="checkbox" class="order-row-check" data-id="' + order.id + '" style="width:16px;height:16px;cursor:pointer;"></td>'
            + '<td style="color:#000;">#' + order.id + '<br><small style="color:#888;">' + new Date(order.created_at).toLocaleDateString('en-IN') + '</small></td>'
            + '<td style="color:#000;"><b>' + (order.users?.full_name || 'N/A') + '</b><br><small>' + (order.users?.email || '') + '</small></td>'
            + '<td style="color:#000;">' + (order.clothes?.title || '-') + '</td>'
            + '<td style="color:#000;"><small>' + rentalDays + ' day(s)<br>&#8377;' + pricePerDay.toFixed(0) + '/day</small></td>'
            + '<td style="color:#000;">&#8377;' + (order.total_price || 0).toFixed(2) + '<br><small style="color:#888;">Paid</small></td>'
            + '<td style="color:#0f766e;font-weight:700;">&#8377;' + billAmount.toFixed(2) + '<br><small style="color:#666;">(Total - Deposit)</small></td>'
            + '<td><span style="background:#e8f4fd;color:' + payBadge + ';padding:3px 8px;border-radius:12px;font-size:0.82em;font-weight:600;">' + (order.payment_status || 'N/A') + '</span></td>'
            + '<td><span style="font-weight:700;color:' + statusColor + ';">' + s + '</span>'
            + (deliveredAt ? '<br><small style="color:#16a34a;">Del: ' + deliveredAt + '</small>' : '')
            + (returnedAt ? '<br><small style="color:#7c3aed;">Ret: ' + returnedAt + '</small>' : '')
            + returnInfo
            + cancelRefundInfo
            + '</td>'
            + '<td>' + actionsHtml + '</td>'
            + '</tr>';
    }).join('');
}


async function loadAdminRefunds() {
    const { data, error } = await supabaseClient
        .from('cancel_refunds')
        .select('*, orders(id, clothes(title)), users(full_name, email)')
        .order('cancelled_at', { ascending: false });
    if (error) { showToast('Failed to load refunds: ' + error.message); return; }
    adminRefundsList = data || [];
    const tbody = document.getElementById('adminRefundsTableBody');
    if (!tbody) return;
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#888;">No refund requests found.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(r => {
        const sc = r.refund_status === 'Paid' ? '#16a34a' : r.refund_status === 'Rejected' ? '#dc3545' : '#856404';
        const bg = r.refund_status === 'Paid' ? '#d1e7dd' : r.refund_status === 'Rejected' ? '#f8d7da' : '#fff3cd';
        const isPending = r.refund_status === 'Pending';
        return '<tr style="color:#000;">'
            + '<td><input type="checkbox" class="refund-row-check" data-id="' + r.id + '" style="width:16px;height:16px;cursor:pointer;"></td>'
            + '<td>#' + r.id + '</td>'
            + '<td>#' + r.order_id + '</td>'
            + '<td><b>' + (r.users?.full_name || '-') + '</b><br><small>' + (r.users?.email || '') + '</small></td>'
            + '<td>' + (r.orders?.clothes?.title || '-') + '</td>'
            + '<td>&#8377;' + r.deposit_paid + '</td>'
            + '<td style="color:#16a34a;font-weight:700;">&#8377;' + r.refund_amount + '</td>'
            + '<td>' + (r.payment_method || '-') + '</td>'
            + '<td style="font-size:0.82em;max-width:160px;">' + (r.notes || '-') + '<br><small style="color:#888;">' + new Date(r.cancelled_at).toLocaleDateString('en-IN') + '</small></td>'
            + '<td><span style="padding:3px 10px;border-radius:12px;font-size:0.82em;font-weight:700;background:' + bg + ';color:' + sc + ';">' + r.refund_status + '</span></td>'
            + '<td>'
            + (isPending ? '<button style="background:#16a34a;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminUpdateRefund(' + r.id + ',\'Paid\')">&#10003; Mark Paid</button>' : '')
            + (isPending ? '<button style="background:#dc3545;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;margin:2px;font-size:0.82em;" onclick="adminUpdateRefund(' + r.id + ',\'Rejected\')">&#10005; Reject</button>' : '')
            + '</td>'
            + '</tr>';
    }).join('');
}

async function adminUpdateRefund(refundId, status) {
    const msg = status === 'Paid' ? 'Mark this refund as Paid?' : 'Reject this refund request?';
    if (!confirm(msg)) return;
    const { error } = await supabaseClient
        .from('cancel_refunds')
        .update({ refund_status: status })
        .eq('id', refundId);
    if (error) { showToast('Failed: ' + error.message); return; }
    showToast('Refund marked as ' + status);
    loadAdminRefunds();
}

async function adminApproveReturn(returnId, orderId) {
    if (!confirm('Approve this return?')) return;
    const { error } = await supabaseClient.from('returned_orders')
        .update({ status: 'Approved' }).eq('id', returnId);
    if (error) { showToast('Failed: ' + error.message); return; }
    showToast('Return approved!');
    loadAdminOrders();
}

async function adminCancelReturn(returnId, orderId) {
    if (!confirm('Cancel/Reject this return?')) return;
    const [r1, r2] = await Promise.all([
        supabaseClient.from('returned_orders').update({ status: 'Rejected' }).eq('id', returnId),
        supabaseClient.from('orders').update({ order_status: 'Delivered' }).eq('id', orderId)
    ]);
    if (r1.error) { showToast('Failed: ' + r1.error.message); return; }
    showToast('Return rejected. Order restored to Delivered.');
    loadAdminOrders();
}

async function adminAction(orderId, newStatus, newPayment, markDelivered) {
    const update = { order_status: newStatus };
    if (newPayment) update.payment_status = newPayment;
    if (markDelivered) update.delivered_at = new Date().toISOString();
    const { error } = await supabaseClient.from('orders').update(update).eq('id', orderId);
    if (error) { showToast('Failed: ' + error.message); return; }
    showToast('Order updated to: ' + newStatus);
    loadAdminOrders();
}

// ============================
// PRINT / PDF FUNCTIONS
// ============================

function buildBillHTML(order, userName, userEmail, userPhone, userAddress, isAdmin) {
    const cloth = order.clothes;
    const start = new Date(order.start_date);
    const end = new Date(order.end_date);
    const days = Math.max(1, Math.round((end - start) / 86400000));
    const rental = parseFloat(((cloth.price || 0) * days).toFixed(2));
    const deposit = parseFloat((rental * 0.30).toFixed(2));
    const gst = parseFloat((deposit * 0.18).toFixed(2));
    const total = parseFloat((deposit + gst).toFixed(2));

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>RentStyle Bill - Order #${order.id}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 30px; color: #111; background: #fff; }
        .bill-wrap { max-width: 700px; margin: 0 auto; border: 2px solid #6366f1; border-radius: 16px; overflow: hidden; }
        .bill-header { background: linear-gradient(135deg,#6366f1,#a855f7); color: #fff; padding: 28px 32px; display: flex; justify-content: space-between; align-items: center; }
        .bill-header h1 { margin: 0; font-size: 2em; letter-spacing: 2px; }
        .bill-header p { margin: 4px 0 0; opacity: 0.85; font-size: 0.9em; }
        .bill-header .order-no { font-size: 1.1em; font-weight: 700; background: rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 8px; }
        .bill-body { padding: 28px 32px; }
        .section-title { font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #6366f1; margin: 20px 0 8px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; }
        .info-row { display: flex; flex-direction: column; }
        .info-row span:first-child { font-size: 0.78em; color: #888; }
        .info-row span:last-child { font-weight: 600; font-size: 0.95em; }
        .product-box { display: flex; gap: 16px; background: #f8f7ff; border-radius: 10px; padding: 16px; margin: 12px 0; align-items: center; }
        .product-box img { width: 70px; height: 90px; object-fit: cover; border-radius: 8px; }
        .product-box h3 { margin: 0 0 6px; font-size: 1.05em; }
        .product-box p { margin: 2px 0; font-size: 0.85em; color: #555; }
        .bill-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        .bill-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 0.92em; }
        .bill-table td:last-child { text-align: right; font-weight: 600; }
        .bill-table .total-row td { border-top: 2px solid #6366f1; border-bottom: none; font-size: 1.05em; font-weight: 700; color: #6366f1; padding-top: 14px; }
        .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 0.82em; font-weight: 700; background: #ede9fe; color: #6d28d9; }
        .bill-footer { background: #f8f7ff; padding: 18px 32px; text-align: center; font-size: 0.82em; color: #888; border-top: 1px solid #e5e7eb; }
        .bill-footer strong { color: #6366f1; }
        @media print { body { padding: 0; } .no-print { display: none; } }
    </style></head><body>
    <div class="bill-wrap">
        <div class="bill-header">
            <div><h1>RentStyle</h1><p>Premium Cloth Rental</p></div>
            <div class="order-no">Order #${order.id}</div>
        </div>
        <div class="bill-body">
            <div class="section-title">Customer Details</div>
            <div class="info-grid">
                <div class="info-row"><span>Name</span><span>${userName || 'N/A'}</span></div>
                <div class="info-row"><span>Email</span><span>${userEmail || 'N/A'}</span></div>
                <div class="info-row"><span>Phone</span><span>${userPhone || 'N/A'}</span></div>
                <div class="info-row"><span>Address</span><span>${userAddress || 'N/A'}</span></div>
            </div>
            <div class="section-title">Order Details</div>
            <div class="info-grid">
                <div class="info-row"><span>Order Date</span><span>${new Date(order.created_at).toLocaleDateString('en-IN')}</span></div>
                <div class="info-row"><span>Status</span><span><span class="status-badge">${order.order_status}</span></span></div>
                <div class="info-row"><span>Rental Start</span><span>${start.toLocaleDateString('en-IN')}</span></div>
                <div class="info-row"><span>Rental End</span><span>${end.toLocaleDateString('en-IN')}</span></div>
            </div>
            <div class="section-title">Product</div>
            <div class="product-box">
                <img src="${cloth.image_url || ''}" alt="${cloth.title}" />
                <div>
                    <h3>${cloth.title}</h3>
                    <p>Category: ${cloth.category || '-'} &nbsp;|&nbsp; Size: ${cloth.size || '-'}</p>
                    <p>Price: &#8377;${cloth.price}/day &nbsp;|&nbsp; Rental Days: ${days}</p>
                </div>
            </div>
            <div class="section-title">Bill Summary</div>
            <table class="bill-table">
                <tr><td>Rental Amount (&#8377;${cloth.price} x ${days} days)</td><td>&#8377;${rental}</td></tr>
                <tr><td>Deposit (30% of Rental)</td><td>&#8377;${deposit}</td></tr>
                <tr><td>GST on Deposit (18%)</td><td>&#8377;${gst}</td></tr>
                <tr class="total-row"><td>Total Amount Paid</td><td>&#8377;${order.total_price || total}</td></tr>
            </table>
            <div style="margin-top:16px;font-size:0.82em;color:#888;">* Remaining rental balance is collected at the time of return.</div>
        </div>
        <div class="bill-footer">
            <strong>RentStyle</strong> &mdash; Thank you for renting with us! &nbsp;|&nbsp; Generated on ${new Date().toLocaleString('en-IN')}
        </div>
    </div>
    <div class="no-print" style="text-align:center;margin-top:24px;">
        <button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:14px 36px;border-radius:10px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>
    </div>
    </body></html>`;
}

async function printUserBill(orderId) {
    const { data: order, error } = await supabaseClient
        .from('orders')
        .select('*, clothes(id, title, image_url, price, size, category)')
        .eq('id', orderId)
        .single();
    if (error || !order) { showToast('Could not load order'); return; }

    const name = currentUserProfile?.full_name || currentUser?.email || '';
    const email = currentUser?.email || '';
    const phone = currentUserProfile?.phone || '';
    const address = currentUserProfile?.address_line || order.address || '';

    const html = buildBillHTML(order, name, email, phone, address, false);
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

let _adminAllOrders = [];

async function adminPrintAllReport() {
    const { data: orders, error } = await supabaseClient
        .from('orders')
        .select('*, users(full_name, email, phone, address_line), clothes(id, title, image_url, price, size, category)')
        .order('created_at', { ascending: false });
    if (error) { showToast('Failed to load orders'); return; }
    _adminAllOrders = orders || [];
    openAdminReportWindow(_adminAllOrders, 'All Customers — Full Rental Report');
}

async function adminPrintByCustomer() {
    const { data: users, error } = await supabaseClient.from('users').select('id, full_name, email').order('full_name');
    if (error) { showToast('Failed to load users'); return; }

    const opts = users.map(u => '<option value="' + u.id + '">' + (u.full_name || u.email) + ' (' + u.email + ')</option>').join('');
    openModal('<div style="padding:24px;color:#000;min-width:320px;">'
        + '<h2 style="margin-bottom:16px;">Select Customer</h2>'
        + '<select id="reportUserSelect" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:1em;">'
        + '<option value="">-- Select Customer --</option>' + opts
        + '</select>'
        + '<button class="btn btn-primary" style="width:100%;margin-top:16px;padding:14px;" onclick="generateCustomerReport()">Generate Report</button>'
        + '</div>');
}

async function generateCustomerReport() {
    const userId = document.getElementById('reportUserSelect')?.value;
    if (!userId) { showToast('Please select a customer'); return; }

    const { data: orders, error } = await supabaseClient
        .from('orders')
        .select('*, users(full_name, email, phone, address_line), clothes(id, title, image_url, price, size, category)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) { showToast('Failed to load orders'); return; }

    closeModalWindow();
    const userName = orders[0]?.users?.full_name || 'Customer';
    openAdminReportWindow(orders, 'Rental Report — ' + userName);
}

function openAdminReportWindow(orders, title) {
    const rows = orders.map(o => {
        const cloth = o.clothes;
        const u = o.users;
        const start = new Date(o.start_date);
        const end = new Date(o.end_date);
        const days = Math.max(1, Math.round((end - start) / 86400000));
        const statusColors = { 'Delivered': '#16a34a', 'Returned': '#7c3aed', 'Cancelled': '#dc3545', 'Shipped': '#0369a1', 'Confirmed': '#0f5132', 'Booked': '#0f5132' };
        const sc = statusColors[o.order_status] || '#856404';
        return '<tr>'
            + '<td>#' + o.id + '<br><small style="color:#888;">' + new Date(o.created_at).toLocaleDateString('en-IN') + '</small></td>'
            + '<td><b>' + (u?.full_name || '-') + '</b><br><small>' + (u?.email || '') + '</small><br><small>' + (u?.phone || '') + '</small></td>'
            + '<td>' + (cloth?.title || '-') + '<br><small>' + (cloth?.category || '') + ' | ' + (cloth?.size || '') + '</small></td>'
            + '<td>' + start.toLocaleDateString('en-IN') + ' to ' + end.toLocaleDateString('en-IN') + '<br><small>' + days + ' day(s)</small></td>'
            + '<td>&#8377;' + (cloth?.price || 0) + '/day</td>'
            + '<td>&#8377;' + o.total_price + '</td>'
            + '<td>' + o.payment_status + '</td>'
            + '<td><span style="font-weight:700;color:' + sc + ';">' + o.order_status + '</span></td>'
            + '</tr>';
    }).join('');

    const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.total_price) || 0), 0).toFixed(2);

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + title + '</title>'
        + '<style>body{font-family:Arial,sans-serif;padding:30px;color:#111;}'
        + 'h1{color:#6366f1;margin-bottom:4px;}'
        + '.meta{color:#888;font-size:0.88em;margin-bottom:24px;}'
        + 'table{width:100%;border-collapse:collapse;font-size:0.88em;}'
        + 'th{background:#6366f1;color:#fff;padding:10px 12px;text-align:left;}'
        + 'td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top;}'
        + 'tr:nth-child(even) td{background:#f8f7ff;}'
        + '.summary{margin-top:24px;background:#f8f7ff;border-radius:10px;padding:16px 20px;display:flex;gap:32px;}'
        + '.summary div{font-size:0.9em;color:#555;} .summary b{font-size:1.2em;color:#6366f1;}'
        + '@media print{.no-print{display:none;}}'
        + '</style></head><body>'
        + '<h1>&#128084; RentStyle — ' + title + '</h1>'
        + '<div class="meta">Generated on ' + new Date().toLocaleString('en-IN') + ' &nbsp;|&nbsp; Total Orders: ' + orders.length + '</div>'
        + '<div class="no-print" style="margin-bottom:20px;">'
        + '<button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>'
        + '</div>'
        + '<table><thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Rental Period</th><th>Price/Day</th><th>Total Paid</th><th>Payment</th><th>Status</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>'
        + '<div class="summary"><div>Total Orders<br><b>' + orders.length + '</b></div><div>Total Revenue Collected<br><b>&#8377;' + totalRevenue + '</b></div></div>'
        + '</body></html>';

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

async function adminPrintSelectedRefunds() {
    const checked = document.querySelectorAll('.refund-row-check:checked');
    const ids = [...checked].map(c => parseInt(c.dataset.id));
    if (!ids.length) { showToast('Please select at least one refund request'); return; }
    const selected = adminRefundsList.filter(r => ids.includes(r.id));
    openRefundReportWindow(selected, 'Selected Refund Requests Report');
}

async function adminPrintAllUsersReport() {
    const { data, error } = await supabaseClient.from('users').select('*').order('created_at', { ascending: false });
    if (error) { showToast('Failed to load user data'); return; }
    openUserReportWindow(data || [], 'All Registered Users Report');
}

function openRefundReportWindow(refunds, title) {
    const rows = refunds.map(r => {
        const bg = r.refund_status === 'Paid' ? '#d1fae5' : r.refund_status === 'Rejected' ? '#f8d7da' : '#fff3cd';
        const clr = r.refund_status === 'Paid' ? '#16a34a' : r.refund_status === 'Rejected' ? '#dc3545' : '#856404';
        return '<tr>'
            + '<td>#' + r.id + '</td>'
            + '<td>#' + r.order_id + '</td>'
            + '<td><b>' + (r.users?.full_name || '-') + '</b><br><small>' + (r.users?.email || '') + '</small></td>'
            + '<td>' + (r.orders?.clothes?.title || '-') + '</td>'
            + '<td>&#8377;' + r.deposit_paid + '</td>'
            + '<td style="font-weight:700;color:#16a34a;">&#8377;' + r.refund_amount + '</td>'
            + '<td>' + (r.payment_method || '-') + '</td>'
            + '<td><span style="padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + clr + ';font-weight:700;">' + r.refund_status + '</span></td>'
            + '<td>' + new Date(r.cancelled_at).toLocaleDateString('en-IN') + '</td>'
            + '</tr>';
    }).join('');
    const totalRefunded = refunds.filter(r => r.refund_status === 'Paid').reduce((s, r) => s + (parseFloat(r.refund_amount) || 0), 0).toFixed(2);
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + title + '</title>'
        + '<style>body{font-family:Arial,sans-serif;padding:30px;color:#111;}'
        + 'h1{color:#6366f1;margin-bottom:4px;}'
        + '.meta{color:#888;font-size:0.88em;margin-bottom:24px;}'
        + 'table{width:100%;border-collapse:collapse;font-size:0.88em;}'
        + 'th{background:#6366f1;color:#fff;padding:10px 12px;text-align:left;}'
        + 'td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top;}'
        + 'tr:nth-child(even) td{background:#f8f7ff;}'
        + '.summary{margin-top:24px;background:#f8f7ff;border-radius:10px;padding:16px 20px;display:flex;gap:32px;}'
        + '.summary div{font-size:0.9em;color:#555;} .summary b{font-size:1.2em;color:#6366f1;}'
        + '@media print{.no-print{display:none;}}'
        + '</style></head><body>'
        + '<h1>&#128181; RentStyle — ' + title + '</h1>'
        + '<div class="meta">Generated on ' + new Date().toLocaleString('en-IN') + ' &nbsp;|&nbsp; Total Records: ' + refunds.length + '</div>'
        + '<div class="no-print" style="margin-bottom:20px;">'
        + '<button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>'
        + '</div>'
        + '<table><thead><tr><th>Refund ID</th><th>Order ID</th><th>Customer</th><th>Product</th><th>Deposit</th><th>Refund Amt</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>'
        + '<div class="summary"><div>Total Requests<br><b>' + refunds.length + '</b></div><div>Total Successfully Refunded<br><b>&#8377;' + totalRefunded + '</b></div></div>'
        + '</body></html>';
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

async function adminPrintAllProductsReport() {
    const { data: products, error } = await supabaseClient
        .from('clothes')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { showToast('Failed to load products'); return; }

    const { data: activeOrders } = await supabaseClient
        .from('orders')
        .select('cloth_id, order_status');
    const deliveredCount = {};
    (activeOrders || []).forEach(o => {
        if (o.order_status !== 'Cancelled' && o.order_status !== 'Returned') {
            deliveredCount[o.cloth_id] = (deliveredCount[o.cloth_id] || 0) + 1;
        }
    });

    const rows = (products || []).map(p => {
        const delivered = deliveredCount[p.id] || 0;
        const available = Math.max(0, (p.stock || 0) - delivered);
        const availColor = available <= 0 ? '#dc3545' : available <= 2 ? '#d97706' : '#16a34a';
        const availBg = available <= 0 ? '#fee2e2' : available <= 2 ? '#fef9c3' : '#d1fae5';
        return '<tr>'
            + '<td><b>' + p.title + '</b></td>'
            + '<td>' + (p.category || '-') + '</td>'
            + '<td>' + (p.gender || '-') + '</td>'
            + '<td>' + (p.size || '-') + '</td>'
            + '<td>' + (p.occasion || '-') + '</td>'
            + '<td>' + (p.festival && p.festival !== 'None' ? p.festival : '-') + '</td>'
            + '<td>' + (p.color || '-') + '</td>'
            + '<td>&#8377;' + p.price + '/day</td>'
            + '<td>&#8377;' + (p.deposit || 0) + '</td>'
            + '<td>' + (p.stock || 0) + '</td>'
            + '<td>' + delivered + '</td>'
            + '<td><span style="padding:2px 10px;border-radius:10px;font-weight:700;font-size:0.88em;background:' + availBg + ';color:' + availColor + ';">' + available + '</span></td>'
            + '<td><span style="padding:2px 8px;border-radius:8px;font-size:0.82em;font-weight:700;background:' + (p.available ? '#d1fae5' : '#fee2e2') + ';color:' + (p.available ? '#065f46' : '#991b1b') + ';">' + (p.available ? 'Yes' : 'No') + '</span></td>'
            + '<td style="font-size:0.82em;max-width:180px;">' + (p.description || '-') + '</td>'
            + '</tr>';
    }).join('');

    const totalStock = (products || []).reduce((s, p) => s + (p.stock || 0), 0);
    const totalAvailable = (products || []).reduce((s, p) => s + Math.max(0, (p.stock || 0) - (deliveredCount[p.id] || 0)), 0);

    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>All Products Report</title>'
        + '<style>body{font-family:Arial,sans-serif;padding:30px;color:#111;}'
        + 'h1{color:#6366f1;margin-bottom:4px;} .meta{color:#888;font-size:0.88em;margin-bottom:24px;}'
        + 'table{width:100%;border-collapse:collapse;font-size:0.82em;}'
        + 'th{background:#6366f1;color:#fff;padding:9px 10px;text-align:left;white-space:nowrap;}'
        + 'td{padding:9px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;}'
        + 'tr:nth-child(even) td{background:#f8f7ff;}'
        + '.summary{margin-top:24px;background:#f8f7ff;border-radius:10px;padding:16px 20px;display:flex;gap:32px;flex-wrap:wrap;}'
        + '.summary div{font-size:0.9em;color:#555;} .summary b{font-size:1.2em;color:#6366f1;}'
        + '@media print{.no-print{display:none;}}'
        + '</style></head><body>'
        + '<h1>&#128084; RentStyle — All Products Report</h1>'
        + '<div class="meta">Generated on ' + new Date().toLocaleString('en-IN') + ' &nbsp;|&nbsp; Total Products: ' + (products?.length || 0) + '</div>'
        + '<div class="no-print" style="margin-bottom:20px;">'
        + '<button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>'
        + '</div>'
        + '<table><thead><tr>'
        + '<th>Title</th><th>Category</th><th>Gender</th><th>Size</th><th>Occasion</th><th>Festival</th><th>Color</th><th>Price</th><th>Deposit</th><th>Total Stock</th><th>Delivered</th><th>Available</th><th>For Rent</th><th>Description</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>'
        + '<div class="summary">'
        + '<div>Total Products<br><b>' + (products?.length || 0) + '</b></div>'
        + '<div>Total Stock Units<br><b>' + totalStock + '</b></div>'
        + '<div>Total Available<br><b>' + totalAvailable + '</b></div>'
        + '<div>Total Delivered (Active)<br><b>' + (totalStock - totalAvailable) + '</b></div>'
        + '</div>'
        + '</body></html>';

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

function openUserReportWindow(users, title) {
    const rows = users.map(u => {
        return '<tr>'
            + '<td>' + u.id + '</td>'
            + '<td><b>' + (u.full_name || '-') + '</b></td>'
            + '<td>' + u.email + '</td>'
            + '<td>' + (u.phone || '-') + '</td>'
            + '<td>' + (u.role || '-') + '</td>'
            + '<td>' + (u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '-') + '</td>'
            + '</tr>';
    }).join('');
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + title + '</title>'
        + '<style>body{font-family:Arial,sans-serif;padding:30px;color:#111;}'
        + 'h1{color:#6366f1;margin-bottom:4px;}'
        + '.meta{color:#888;font-size:0.88em;margin-bottom:24px;}'
        + 'table{width:100%;border-collapse:collapse;font-size:0.88em;}'
        + 'th{background:#6366f1;color:#fff;padding:10px 12px;text-align:left;}'
        + 'td{padding:10px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top;}'
        + 'tr:nth-child(even) td{background:#f8f7ff;}'
        + '@media print{.no-print{display:none;}}'
        + '</style></head><body>'
        + '<h1>&#128101; RentStyle — ' + title + '</h1>'
        + '<div class="meta">Generated on ' + new Date().toLocaleString('en-IN') + ' &nbsp;|&nbsp; Total Users: ' + users.length + '</div>'
        + '<div class="no-print" style="margin-bottom:20px;">'
        + '<button onclick="window.print()" style="background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:1em;font-weight:700;cursor:pointer;">&#128438; Print / Save as PDF</button>'
        + '</div>'
        + '<table><thead><tr><th>User ID</th><th>Full Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Registered On</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>'
        + '</body></html>';
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}

(async function main() {
    bindIndexButtons();

    await checkSession();
    renderAuthButtons();

    if (window.location.pathname.includes('admin.html')) {
        await initAdminPage();
        return;
    }

    if (window.location.pathname.includes('confirm_order.html')) {
        await checkSession();
        renderAuthButtons();
        loadConfirmOrderPage();
        return;
    }

    if (window.location.pathname.includes('return_payment.html')) {
        await checkSession();
        renderAuthButtons();
        if (!currentUser) { window.location.href = 'index.html'; return; }
        loadReturnPaymentPage();
        return;
    }

    if (window.location.pathname.includes('orders.html')) {
        if (!currentUser) {
            showToast('Please login to view orders');
            setTimeout(() => { window.location.href = 'index.html'; }, 1500);
            return;
        }
        await loadOrders();
        const osi = document.getElementById('orderSearchInput');
        if (osi) osi.addEventListener('input', filterUserOrders);
        return;
    }

    await loadClothesFromSupabase();
    updateDynamicFilters();
    filterClothes(); // Run filter initially to respect any pre-selected options or URL parameters
    setupFilters();
    // If this is the dedicated search page, run the search from the URL
    if (window.location.pathname.includes('search.html')) {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q') || '';
        const qs = document.getElementById('quickSearchInput');
        if (qs) qs.value = q;
        performSearchPage(q);
    }
})();
