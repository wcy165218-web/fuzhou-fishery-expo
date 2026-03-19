// ================= js/booth.js =================
window.loadPrices = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    const res = await window.apiFetch(`/api/prices?projectId=${pid}`); const data = await res.json(); 
    globalPrices = { '标摊': data['标摊']||0, '豪标': data['豪标']||0, '光地': data['光地']||0 }; 
    document.getElementById('price-bt').value = globalPrices['标摊']; document.getElementById('price-hb').value = globalPrices['豪标']; document.getElementById('price-gd').value = globalPrices['光地']; 
}

window.savePrices = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    const prices = { '标摊': Number(document.getElementById('price-bt').value)||0, '豪标': Number(document.getElementById('price-hb').value)||0, '光地': Number(document.getElementById('price-gd').value)||0 }; 
    window.toggleBtnLoading('btn-save-prices', true);
    await window.apiFetch('/api/prices', { method: 'POST', body: JSON.stringify({projectId: pid, prices}) }); 
    window.showToast("全局策略保存成功！"); 
    window.loadPrices(); window.loadBooths(); 
    window.toggleBtnLoading('btn-save-prices', false);
}

window.toggleEntrySection = function() { 
    const sec = document.getElementById('entry-section'); const arr = document.getElementById('entry-arrow'); 
    if(sec.classList.contains('hidden')) { sec.classList.remove('hidden'); arr.innerText = '▲'; } 
    else { sec.classList.add('hidden'); arr.innerText = '▼'; } 
}

window.addSingleBooth = async function() { 
    const pid = document.getElementById('global-project-select').value; const idVal = document.getElementById('s-id').value.trim(); const hallNum = document.getElementById('s-hall-num').value.trim(); 
    if(!idVal || !hallNum) return window.showToast("请输入完整展位号和展馆", 'error'); 
    const type = document.getElementById('s-type').value; const area = parseFloat(document.getElementById('s-area').value); 
    if(isNaN(area) || area <= 0) return window.showToast("请输入正确面积", 'error'); 
    window.toggleBtnLoading('btn-add-booth', true);
    const res = await window.apiFetch('/api/add-booth', { method: 'POST', body: JSON.stringify({ project_id: pid, id: idVal, hall: `${hallNum}号馆`, type: type, area: area, price_unit: type==='光地'?'平米':'个', base_price: 0 }) }); 
    if (res.ok) { document.getElementById('s-id').value = ''; document.getElementById('s-area').value = ''; window.showToast("展位添加成功"); window.loadBooths(); }
    else { const err = await res.json(); window.showToast(err.error, 'error'); }
    window.toggleBtnLoading('btn-add-booth', false);
}

window.downloadTemplate = function() { 
    const blob = new Blob(["\uFEFF展位号,展馆数字(如1),类型(标摊/光地/豪标),面积(㎡)\nA01,1,标摊,18\nA02,1,光地,36\n"], { type: "text/csv;charset=utf-8;" }); 
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "展位导入模板.csv"; link.click(); 
}

window.parseAndImportBooths = async function() { 
    const pid = document.getElementById('global-project-select').value; const text = document.getElementById('booth-import-text').value.trim(); 
    if(!text) return window.showToast('请输入数据', 'error'); 
    const rows = text.split('\n'); const booths = []; 
    for(let r of rows) { 
        if(!r.trim()) continue; 
        const cols = r.split(/[\s,]+/).filter(c => c.trim() !== ""); 
        if(cols.length >= 4 && cols[0] !== '展位号') booths.push({ id: cols[0], hall: cols[1].replace(/馆|号/g, '') + '号馆', type: cols[2], area: parseFloat(cols[3]) || 0, price_unit: cols[2]==='光地'?'平米':'个' }); 
    } 
    if(booths.length === 0) return window.showToast('未解析到有效数据', 'error'); 
    
    window.toggleBtnLoading('btn-import-booth', true);
    try {
        await window.apiFetch('/api/import-booths', { method: 'POST', body: JSON.stringify({projectId: pid, booths}) }); 
        document.getElementById('booth-import-text').value = ''; window.loadBooths(); 
        window.showToast(`批量导入成功，共解析 ${booths.length} 条数据`);
    } catch (e) {
        window.showToast("导入失败，请检查数据格式", 'error');
    } finally {
        window.toggleBtnLoading('btn-import-booth', false);
    }
}

window.loadBooths = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    allBooths = await (await window.apiFetch(`/api/booths?projectId=${pid}`)).json(); 
    const halls = [...new Set(allBooths.map(b => b.hall))].sort(); 
    const hallFilter = document.getElementById('filter-hall'); 
    hallFilter.innerHTML = '<option value="">🏢 所有展馆</option>'; 
    halls.forEach(h => hallFilter.innerHTML += `<option value="${h}">${h}</option>`); 
    window.renderBooths(); 
}

window.renderStats = function(boothData) { 
    const panel = document.getElementById('stats-panel'); 
    if(boothData.length === 0) { panel.innerHTML = '<div class="col-span-4 text-gray-500 text-center py-4">无符合条件的数据</div>'; return; } 
    let totalArea = 0, totalRev = 0, gdArea = 0, btArea = 0; 
    let statusMap = { '可售':0, '已锁定':0, '已预订':0, '已成交':0 }; 
    boothData.forEach(b => { 
        totalArea += b.area; statusMap[b.status] = (statusMap[b.status] || 0) + b.area; 
        if(b.type === '光地') gdArea += b.area; else btArea += b.area; 
        if (b.status === '已预订' || b.status === '已成交') { 
            totalRev += (b.total_booth_fee || 0); 
        } else { 
            let price = b.base_price > 0 ? b.base_price : (globalPrices[b.type] || 0); 
            let currentRev = (b.type === '光地') ? (price * b.area) : (price * (b.area/9)); 
            totalRev += currentRev; 
        }
    }); 
    const fC = (a) => Number((a/9).toFixed(2)).toString(); const cR = (v, t) => t > 0 ? ((v/t)*100).toFixed(1) : 0; const soldArea = (statusMap['已成交'] || 0) + (statusMap['已预订'] || 0);
    panel.innerHTML = `<div class="bg-gray-50 p-3 border rounded shadow-sm"><div class="text-xs text-gray-500">💰 (筛选范围) 预期总收入</div><div class="text-lg font-bold text-red-600">¥${totalRev.toLocaleString()}</div><div class="text-xs text-gray-400 mt-1">折 ${fC(totalArea)} 个</div></div><div class="bg-blue-50 p-3 border rounded shadow-sm"><div class="text-xs text-blue-500">🟦 光地总面积</div><div class="text-lg font-bold text-blue-700">${gdArea}㎡</div></div><div class="bg-indigo-50 p-3 border rounded shadow-sm"><div class="text-xs text-indigo-500">🟪 标摊总面积</div><div class="text-lg font-bold text-indigo-700">${btArea}㎡</div></div><div class="bg-gray-50 p-3 border rounded shadow-sm text-xs flex flex-col justify-center space-y-1"><div class="flex justify-between"><span>✅ 可售:</span><span class="font-bold">${cR(statusMap['可售'], totalArea)}%</span></div><div class="flex justify-between text-yellow-600"><span>🔒 已锁定:</span><span class="font-bold">${cR(statusMap['已锁定'], totalArea)}%</span></div><div class="flex justify-between text-green-600"><span>🤝 已成交/预订:</span><span class="font-bold">${cR(soldArea, totalArea)}%</span></div></div>`; 
}

window.renderBooths = function() { 
    const searchTxt = document.getElementById('filter-search').value.toLowerCase(); 
    const hallTxt = document.getElementById('filter-hall').value; 
    const typeTxt = document.getElementById('filter-type').value; 
    const statusTxt = document.getElementById('filter-status').value; 
    const filtered = allBooths.filter(b => { 
        if(searchTxt && !b.id.toLowerCase().includes(searchTxt)) return false; 
        if(hallTxt && b.hall !== hallTxt) return false; 
        if(typeTxt && b.type !== typeTxt) return false; 
        if(statusTxt && b.status !== statusTxt) return false; 
        return true; 
    }); 
    window.renderStats(filtered);
    const tbody = document.getElementById('booth-list-tbody'); tbody.innerHTML = ''; document.getElementById('check-all').checked = false; 
    filtered.forEach(b => { 
        const unit = b.type === '光地' ? '㎡' : '个'; const bCount = Number((b.area / 9).toFixed(2)).toString(); const isLockedByOrder = b.status === '已预订' || b.status === '已成交';
        
        let pStr = '';
        if (isLockedByOrder && b.total_booth_fee != null) {
            let actualUnit = b.type === '光地' ? (b.total_booth_fee / b.area) : (b.total_booth_fee / (b.area / 9)); actualUnit = Number(actualUnit.toFixed(2));
            pStr = `<span class="bg-green-100 text-green-700 px-1 rounded text-xs font-bold">实际单价</span> ¥${actualUnit}/${unit}`;
        } else {
            const standardPrice = b.base_price > 0 ? b.base_price : (globalPrices[b.type] || 0); 
            pStr = `<span class="bg-gray-100 text-gray-500 px-1 rounded text-xs font-bold">原价</span> ¥${standardPrice}/${unit}`;
        }
        
        let selectHtml = '';
        if (isLockedByOrder) { 
            selectHtml = `<span class="bg-gray-100 text-gray-500 px-2 py-1 rounded text-xs font-bold flex items-center justify-center gap-1" title="受订单关联控制，不可手动更改">🔒 ${b.status}</span>`; 
        } else { 
            selectHtml = `<select onchange="window.updateSingleBoothStatus('${b.id}', this.value)" class="border p-1 text-xs rounded w-20 bg-white">`; 
            ['可售', '已锁定'].forEach(opt => selectHtml += `<option value="${opt}" ${b.status===opt?'selected':''}>${opt}</option>`); 
            selectHtml += `</select>`; 
        }
        const actionHtml = isLockedByOrder ? `<span class="text-xs text-gray-400 font-bold">订单锁定</span>` : `<button onclick="window.openEditBooth('${b.id}', '${b.type}', ${b.area}, ${b.base_price})" class="text-indigo-600 hover:underline mr-2 text-xs">修改</button><button onclick="window.deleteSingleBooth('${b.id}')" class="text-red-500 hover:underline text-xs">删除</button>`; 
        const checkHtml = isLockedByOrder ? `<input type="checkbox" disabled title="不可批量操作">` : `<input type="checkbox" class="booth-check" value="${b.id}">`; 
        tbody.innerHTML += `<tr class="border-b"><td class="p-3">${checkHtml}</td><td class="p-3 font-bold">${b.id}</td><td class="p-3">${b.hall}</td><td class="p-3">${b.type}</td><td class="p-3">${b.area}㎡</td><td class="p-3">${bCount}个</td><td class="p-3">${pStr}</td><td class="p-3 text-center">${selectHtml}</td><td class="p-3 text-center">${actionHtml}</td></tr>`; 
    }); 
}

window.toggleAllChecks = function(source) { document.querySelectorAll('.booth-check:not(:disabled)').forEach(cb => cb.checked = source.checked); } 
window.getCheckedIds = function() { return Array.from(document.querySelectorAll('.booth-check:checked')).map(cb => cb.value); }
window.updateSingleBoothStatus = async function(bid, st) { if(!confirm(`确定将展位 [${bid}] 修改为【${st}】吗？`)) { window.loadBooths(); return; } const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/update-booth-status', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: [bid], status: st}) }); window.loadBooths(); window.showToast(`已更新为 ${st}`);}
window.batchUpdateStatus = async function() { const ids = window.getCheckedIds(); if(ids.length === 0) return window.showToast("请勾选要操作的展位", 'error'); const st = document.getElementById('batch-status-select').value; if(!confirm(`确定批量修改选中的 ${ids.length} 个展位状态为【${st}】吗？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/update-booth-status', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: ids, status: st}) }); window.showToast(`成功更新了 ${ids.length} 个展位状态！`); window.loadBooths(); }
window.deleteSingleBooth = async function(id) { if(!confirm(`🚨 危险操作：永久删除展位 [${id}]？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/delete-booths', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: [id]}) }); window.showToast("展位删除成功"); window.loadBooths(); }
window.batchDelete = async function() { const ids = window.getCheckedIds(); if(ids.length === 0) return window.showToast("请勾选展位", 'error'); if(!confirm(`🚨 危险操作：确定永久删除选中的 ${ids.length} 个展位吗？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/delete-booths', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: ids}) }); window.showToast(`成功删除了 ${ids.length} 个展位！`); window.loadBooths(); }

window.openEditBooth = function(id, type, area, bp) { document.getElementById('eb-id').innerText = id; document.getElementById('eb-type').value = type; document.getElementById('eb-area').value = area; document.getElementById('eb-custom-price').value = bp > 0 ? bp : ''; document.getElementById('edit-booth-modal').classList.remove('hidden'); }
window.submitEditBooth = async function() { 
    const pid = document.getElementById('global-project-select').value; 
    const id = document.getElementById('eb-id').innerText; 
    const type = document.getElementById('eb-type').value; 
    const area = parseFloat(document.getElementById('eb-area').value); 
    const cp = parseFloat(document.getElementById('eb-custom-price').value);
    const finalCustomPrice = isNaN(cp) ? 0 : cp;

    if (isNaN(area) || area <= 0) return window.showToast("面积必须大于0", 'error');

    window.toggleBtnLoading('btn-save-booth', true);
    try {
        const res = await window.apiFetch('/api/edit-booth', { method: 'POST', body: JSON.stringify({project_id: pid, id: id, type: type, area: area, base_price: finalCustomPrice}) }); 
        if(res.ok) {
            window.closeModal('edit-booth-modal'); 
            window.showToast("展位信息修改成功"); 
            await window.loadBooths();
        } else {
            window.showToast("修改失败", 'error');
        }
    } finally {
        window.toggleBtnLoading('btn-save-booth', false);
    }
}