$l = Get-Content 'script.js' -Encoding UTF8

$insertIdx = -1
for ($i = 0; $i -lt $l.Length; $i++) {
    if ($l[$i] -like 'function filterAdminUsers() {' -and $insertIdx -eq -1) { $insertIdx = $i; break }
}
Write-Host "Insert at: $insertIdx"

$func = @'

async function showUserFullReport(userId) {
    // Fetch user info
    const { data: user } = await supabaseClient.from('users').select('*').eq('id', userId).single();
    if (!user) { showToast('User not found'); return; }

    // Fetch all orders for this user
    const { data: orders } = await supabaseClient
        .from('orders')
        .select('*, clothes(title, price, size, category)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    // Fetch returned orders
    const { data: returns } = await supabaseClient
        .from('returned_orders')
        .select('*')
        .eq('user_id', userId);

    const returnMap = {};
    (returns || []).forEach(r => { returnMap[r.order_id] = r; });

    const allOrders = orders || [];
    const total = allOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);

    const statusBadge = (s) => {
        const colors = {
            'Pending': '#856404', 'Confirmed': '#0f5132', 'Shipped': '#0a58ca',
            'Delivered': '#16a34a', 'Returned': '#6d28d9', 'Cancelled': '#842029',
            'Online Payment - Pending Approval': '#856404'
        };
        return '<span style="padding:2px 8px;border-radius:10px;font-size:0.78em;font-weight:700;background:#f0f0f0;color:' + (colors[s] || '#333') + ';">' + s + '</span>';
    };

    const orderRows = allOrders.map(o => {
        const ret = returnMap[o.id];
        const retInfo = ret ? '<br><small style="color:#6d28d9;">Returned: ' + new Date(ret.return_date || ret.created_at).toLocaleDateString('en-IN') + ' | ' + (ret.status || '') + '</small>' : '';
        return '<tr>'
            + '<td style="padding:8px;border:1px solid #ddd;">#' + o.id + '<br><small style="color:#888;">' + new Date(o.created_at).toLocaleDateString('en-IN') + '</small></td>'
            + '<td style="padding:8px;border:1px solid #ddd;">' + (o.clothes?.title || '-') + '<br><small style="color:#888;">' + (o.clothes?.category || '') + ' | ' + (o.clothes?.size || '') + '</small></td>'
            + '<td style="padding:8px;border:1px solid #ddd;">&#8377;' + o.total_price + '</td>'
            + '<td style="padding:8px;border:1px solid #ddd;">' + o.payment_status + '</td>'
            + '<td style="padding:8px;border:1px solid #ddd;">' + statusBadge(o.order_status) + retInfo + '</td>'
            + '</tr>';
    }).join('');

    const printContent = `
        <!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>User Report - ${user.full_name}</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 30px; color: #000; }
            h1 { font-size: 1.4em; margin-bottom: 4px; }
            .subtitle { color: #666; font-size: 0.9em; margin-bottom: 20px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f9f9f9; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
            .info-item label { font-size: 0.75em; color: #888; text-transform: uppercase; display: block; }
            .info-item span { font-weight: 600; font-size: 0.95em; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th { background: #111; color: #fff; padding: 10px 8px; text-align: left; font-size: 0.82em; }
            tr:nth-child(even) td { background: #f9f9f9; }
            .summary { margin-top: 20px; padding: 14px; background: #f0f0f0; border-radius: 8px; display: flex; gap: 24px; }
            .sum-item { text-align: center; }
            .sum-item .val { font-size: 1.4em; font-weight: 800; }
            .sum-item .lbl { font-size: 0.75em; color: #666; }
            @media print { body { padding: 10px; } }
        </style>
        </head><body>
        <h1>&#128101; Customer Report — ${user.full_name}</h1>
        <div class="subtitle">Generated on ${new Date().toLocaleString('en-IN')} | RentStyle Admin</div>

        <div class="info-grid">
            <div class="info-item"><label>Full Name</label><span>${user.full_name || '-'}</span></div>
            <div class="info-item"><label>Email</label><span>${user.email || '-'}</span></div>
            <div class="info-item"><label>Phone</label><span>${user.phone || '-'}</span></div>
            <div class="info-item"><label>City</label><span>${user.city || '-'}</span></div>
            <div class="info-item"><label>Address</label><span>${user.address_line || '-'}</span></div>
            <div class="info-item"><label>Registered On</label><span>${user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN') : '-'}</span></div>
        </div>

        <div class="summary">
            <div class="sum-item"><div class="val">${allOrders.length}</div><div class="lbl">Total Orders</div></div>
            <div class="sum-item"><div class="val">${allOrders.filter(o => o.order_status === 'Delivered').length}</div><div class="lbl">Delivered</div></div>
            <div class="sum-item"><div class="val">${allOrders.filter(o => o.order_status === 'Returned').length}</div><div class="lbl">Returned</div></div>
            <div class="sum-item"><div class="val">${allOrders.filter(o => o.order_status === 'Cancelled').length}</div><div class="lbl">Cancelled</div></div>
            <div class="sum-item"><div class="val">&#8377;${total.toFixed(2)}</div><div class="lbl">Total Spent</div></div>
        </div>

        <h3 style="margin-top:24px;margin-bottom:8px;">Order History</h3>
        ${allOrders.length === 0 ? '<p style="color:#888;">No orders found.</p>' : `
        <table>
            <thead><tr><th>Order ID</th><th>Product</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead>
            <tbody>${orderRows}</tbody>
        </table>`}
        </body></html>
    `;

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(printContent);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 600);
}

'@

$before   = $l[0..($insertIdx - 1)]
$after    = $l[$insertIdx..($l.Length - 1)]
$combined = $before + ($func -split "`n") + $after
$combined | Set-Content 'script.js' -Encoding UTF8
Write-Host "Done. Lines: $($combined.Length)"
