// ================= js/order.js =================
window.currentAllocatedArea = 0; // 全局存储本次分配的展位面积
window.selectedOrderBooths = [];
window.orderFieldSettingsMap = window.orderFieldSettingsMap || {};

window.isOrderFieldEnabled = function(fieldKey) {
    const setting = window.orderFieldSettingsMap?.[fieldKey];
    return setting ? Number(setting.enabled || 0) === 1 : true;
}

window.isOrderFieldRequired = function(fieldKey) {
    const setting = window.orderFieldSettingsMap?.[fieldKey];
    return setting ? Number(setting.required || 0) === 1 : true;
}

window.setOrderFieldVisibility = function(fieldKey, visible) {
    const block = document.getElementById(`order-field-${fieldKey}-block`);
    if (!block) return;
    block.classList.toggle('hidden', !visible);
}

window.setOrderFieldRequiredMarker = function(fieldKey, required) {
    const marker = document.getElementById(`order-required-${fieldKey}`);
    if (!marker) return;
    marker.classList.toggle('hidden', !required);
}

window.applyOrderFieldSettings = function() {
    const fieldKeys = ['is_agent', 'company_name', 'credit_code', 'contact_person', 'phone', 'region', 'category', 'main_business', 'profile', 'booth_selection', 'actual_booth_fee', 'extra_fees', 'contract_upload'];
    fieldKeys.forEach((fieldKey) => {
        window.setOrderFieldVisibility(fieldKey, window.isOrderFieldEnabled(fieldKey));
        window.setOrderFieldRequiredMarker(fieldKey, window.isOrderFieldRequired(fieldKey));
    });

    const agentInput = document.getElementById('order-agent-name');
    if (agentInput) {
        if (!window.isOrderFieldEnabled('is_agent')) {
            const directRadio = document.querySelector('input[name="is_agent"][value="0"]');
            if (directRadio) directRadio.checked = true;
        }
        agentInput.placeholder = window.isOrderFieldRequired('agent_name') ? '请输入具体代理商公司名称 (必填)' : '请输入具体代理商公司名称（选填）';
    }

    if (!window.isOrderFieldEnabled('extra_fees')) {
        dynamicFees = [];
        window.renderDynamicFees();
    }

    if (!window.isOrderFieldEnabled('actual_booth_fee')) {
        const actualFeeInput = document.getElementById('order-actual-fee');
        if (actualFeeInput) actualFeeInput.value = currentStandardFee || 0;
    }

    if (!window.isOrderFieldEnabled('contract_upload')) {
        const contractInput = document.getElementById('order-contract');
        if (contractInput) contractInput.value = '';
    }

    window.toggleAgent();
    window.calculateFinalTotal();
};

window.calculateBoothStandardFee = function(booth, allocatedArea) {
    const priceUnit = booth.base_price > 0 ? booth.base_price : (globalPrices[booth.type] || 0);
    const standardFee = booth.type === '光地'
        ? priceUnit * allocatedArea
        : priceUnit * (allocatedArea / 9);
    return {
        priceUnit,
        standardFee
    };
}

window.renderSelectedBooths = function() {
    const list = document.getElementById('selected-booth-list');
    const countBadge = document.getElementById('selected-booth-count');
    const selectedIdsInput = document.getElementById('selected-booth-id');
    if (!list || !countBadge || !selectedIdsInput) return;

    if (!Array.isArray(window.selectedOrderBooths)) window.selectedOrderBooths = [];
    selectedIdsInput.value = window.selectedOrderBooths.map((item) => item.id).join(',');
    countBadge.innerText = `${window.selectedOrderBooths.length} 个`;

    if (window.selectedOrderBooths.length === 0) {
        list.innerHTML = '<span class="text-xs text-slate-400 italic">暂未选择展位</span>';
        document.getElementById('calc-booth').innerText = '-';
        document.getElementById('calc-type').innerText = '-';
        document.getElementById('calc-area').innerText = '-';
        document.getElementById('calc-unit').innerText = '-';
        currentStandardFee = 0;
        document.getElementById('calc-standard-fee').innerText = '¥ 0';
        window.calculateFinalTotal();
        return;
    }

    list.innerHTML = window.selectedOrderBooths.map((item) => `
        <div class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
            <span>${window.escapeHtml ? window.escapeHtml(item.hall) : item.hall} - ${window.escapeHtml ? window.escapeHtml(item.id) : item.id}</span>
            <span class="tabular-data text-slate-400">${Number(item.area || 0).toLocaleString()}㎡</span>
            <button type="button" onclick="window.removeSelectedBooth('${String(item.id).replace(/'/g, "\\'")}')" class="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="移除展位">
                ${window.renderIcon('close', 'h-3.5 w-3.5', 2.2)}
            </button>
        </div>
    `).join('');

    const totalArea = window.selectedOrderBooths.reduce((sum, item) => sum + Number(item.area || 0), 0);
    const types = Array.from(new Set(window.selectedOrderBooths.map((item) => item.type).filter(Boolean)));
    currentStandardFee = window.selectedOrderBooths.reduce((sum, item) => sum + Number(item.standard_fee || 0), 0);

    document.getElementById('calc-booth').innerText = window.selectedOrderBooths.length === 1
        ? `${window.selectedOrderBooths[0].hall} - ${window.selectedOrderBooths[0].id}`
        : `${window.selectedOrderBooths.length} 个展位`;
    document.getElementById('calc-type').innerText = types.length === 1 ? types[0] : '混合';
    document.getElementById('calc-area').innerText = totalArea.toLocaleString();
    document.getElementById('calc-unit').innerText = window.selectedOrderBooths.length === 1
        ? `${window.selectedOrderBooths[0].unit_label}`
        : '按已选展位分别计价';
    document.getElementById('calc-standard-fee').innerText = `¥ ${currentStandardFee.toLocaleString()}`;
    document.getElementById('order-actual-fee').value = currentStandardFee;
    window.calculateFinalTotal();
}

window.removeSelectedBooth = function(boothId) {
    window.selectedOrderBooths = (window.selectedOrderBooths || []).filter((item) => String(item.id) !== String(boothId));
    window.renderSelectedBooths();
}

window.initOrderForm = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const pRes = await window.apiFetch(`/api/prices?projectId=${pid}`); 
    const data = await pRes.json();
    globalPrices = { '标摊': data['标摊']||0, '豪标': data['豪标']||0, '光地': data['光地']||0 };
    
    const bRes = await window.apiFetch(`/api/booths?projectId=${pid}`); 
    allBooths = await bRes.json(); 
    
    await window.loadOrderFieldSettings?.();
    window.resetOrderForm();
    window.loadIndustries(); 
}

window.resetOrderForm = function() {
    const inputs = ['order-company', 'order-credit-code', 'order-category', 'order-business', 'order-contact', 'order-phone', 'order-agent-name', 'order-actual-fee', 'booth-search-inp', 'order-discount-reason', 'order-contract', 'reg-intl', 'reg-city-inp', 'selected-booth-id', 'order-profile'];
    inputs.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    
    document.getElementById('reg-prov').value = ''; 
    document.getElementById('reg-city-sel').value = ''; 
    document.getElementById('reg-dist').value = ''; 
    window.onProvinceChange(); 
    
    document.querySelector('input[name="is_agent"][value="0"]').checked = true; 
    window.toggleAgent();
    
    document.getElementById('order-no-code').checked = false; 
    window.toggleCreditCode();
    
    isJointExhibition = false; 
    window.currentAllocatedArea = 0;
    window.selectedOrderBooths = [];

    document.getElementById('calc-booth').innerText = '-'; 
    document.getElementById('calc-type').innerText = '-'; 
    document.getElementById('calc-area').innerText = '-'; 
    document.getElementById('calc-unit').innerText = '-'; 
    document.getElementById('calc-standard-fee').innerText = '¥ 0'; 
    document.getElementById('calc-final-total').innerText = '¥ 0'; 
    document.getElementById('dynamic-strategy-display').classList.add('hidden'); 
    currentStandardFee = 0; 
    document.getElementById('discount-reason-container').classList.add('hidden');
    
    dynamicFees = []; 
    window.renderDynamicFees();
    window.renderSelectedBooths();
    window.applyOrderFieldSettings?.();
}

window.onProvinceChange = function() { 
    const prov = document.getElementById('reg-prov').value; 
    const intlInput = document.getElementById('reg-intl'); 
    const citySel = document.getElementById('reg-city-sel'); 
    const cityInp = document.getElementById('reg-city-inp'); 
    const distSel = document.getElementById('reg-dist'); 
    
    intlInput.classList.add('hidden'); 
    citySel.classList.add('hidden'); 
    cityInp.classList.add('hidden'); 
    distSel.classList.add('hidden'); 
    
    if (prov === '国际') { 
        intlInput.classList.remove('hidden'); 
    } else if (prov === '福建') { 
        citySel.classList.remove('hidden'); citySel.value = ''; window.onCityChange(); 
    } else if (prov !== '') { 
        cityInp.classList.remove('hidden'); 
    } 
}

window.onCityChange = function() { 
    const prov = document.getElementById('reg-prov').value; 
    const city = document.getElementById('reg-city-sel').value; 
    const distSel = document.getElementById('reg-dist'); 
    if (prov === '福建' && city === '福州') { 
        distSel.classList.remove('hidden'); distSel.value = ''; 
    } else { 
        distSel.classList.add('hidden'); 
    } 
}

window.searchAndSelectBooth = function() {
    const inp = document.getElementById('booth-search-inp').value.trim().toUpperCase(); 
    if(!inp) return window.showToast("请先输入展位号！", 'error');
    
    const booth = allBooths.find(b => b.id.toUpperCase() === inp); 
    if(!booth) return window.showToast(`未找到展位：${inp}`, 'error');
    if ((window.selectedOrderBooths || []).some((item) => String(item.id) === String(booth.id))) {
        document.getElementById('booth-search-inp').value = '';
        return window.showToast(`展位 [${inp}] 已经在当前订单选择列表中`, 'info');
    }
    
    if(booth.status === '已锁定') { 
        document.getElementById('booth-search-inp').value = ''; 
        return window.showToast(`展位 [${inp}] 已被他人临时锁定，暂不可操作！`, 'error'); 
    }
    
    let allocatedArea = booth.area;

    // 【核心修复】：联合参展面积分配逻辑
    if(booth.status === '已预订' || booth.status === '已成交') {
        const areaInput = prompt(`【联合参展提醒】\n\n展位 [${booth.id}] 已有企业入驻。\n\n请输入分配给【新企业】的展位面积（㎡）：\n(原总面积 ${booth.area}㎡，提交后系统将自动从原企业订单中扣除该面积)`, "9");
        
        if(areaInput === null) { 
            document.getElementById('booth-search-inp').value = ''; 
            return; 
        }
        
        allocatedArea = parseFloat(areaInput);
        if(isNaN(allocatedArea) || allocatedArea <= 0 || allocatedArea >= booth.area) {
            window.showToast("输入的面积无效或大于等于总面积，已取消录入", "error");
            document.getElementById('booth-search-inp').value = ''; 
            return;
        }

        isJointExhibition = true;
        window.showToast(`已开启联合参展，分配面积：${allocatedArea}㎡`, 'info');
    } else { 
        isJointExhibition = false; 
    }
    
    window.currentAllocatedArea = allocatedArea;
    const boothPricing = window.calculateBoothStandardFee(booth, allocatedArea);
    window.selectedOrderBooths.push({
        id: booth.id,
        hall: booth.hall,
        type: booth.type,
        area: allocatedArea,
        unit_price: boothPricing.priceUnit,
        unit_label: booth.type === '光地' ? `¥${boothPricing.priceUnit} /平米` : `¥${boothPricing.priceUnit} /个(9㎡)`,
        standard_fee: boothPricing.standardFee,
        price_unit: booth.type === '光地' ? '平米' : '个',
        is_joint: isJointExhibition ? 1 : 0
    });
    window.renderSelectedBooths();
    document.getElementById('booth-search-inp').value = '';
    
    if(!isJointExhibition) window.showToast(`已加入展位：${booth.id}`);
}

window.addFeeRow = function() { dynamicFees.push({ name: '', amount: '' }); window.renderDynamicFees(); }
window.removeFeeRow = function(idx) { dynamicFees.splice(idx, 1); window.renderDynamicFees(); }
window.updateFeeData = function(idx, field, val) { dynamicFees[idx][field] = val; window.calculateFinalTotal(); }

window.renderDynamicFees = function() {
    const container = document.getElementById('dynamic-fees-container'); 
    const noFeesText = document.getElementById('no-fees-text'); 
    const wrapper = document.getElementById('order-field-extra_fees-block');
    if (wrapper && wrapper.classList.contains('hidden')) {
        container.innerHTML = '';
        noFeesText.classList.add('hidden');
        window.calculateFinalTotal();
        return;
    }
    container.innerHTML = '';
    
    if (dynamicFees.length === 0) { 
        noFeesText.classList.remove('hidden'); 
    } else { 
        noFeesText.classList.add('hidden'); 
        dynamicFees.forEach((fee, idx) => { 
            container.innerHTML += `<div class="flex gap-2 items-center bg-gray-50 p-2 rounded border"><input type="text" placeholder="费用类目 (如：搭建费)" value="${fee.name}" oninput="window.updateFeeData(${idx}, 'name', this.value)" class="border p-2 rounded flex-1 text-sm bg-white"><span class="text-gray-500 font-bold">¥</span><input type="number" placeholder="金额" value="${fee.amount}" oninput="window.updateFeeData(${idx}, 'amount', this.value)" class="border p-2 rounded w-32 text-sm bg-white font-bold text-gray-700"><button onclick="window.removeFeeRow(${idx})" class="text-red-500 hover:bg-red-100 font-bold px-3 py-1 rounded">删除</button></div>`; 
        }); 
    }
    window.calculateFinalTotal();
}

window.toggleAgent = function() { 
    if (!window.isOrderFieldEnabled('is_agent')) {
        document.getElementById('order-agent-name')?.classList.add('hidden');
        return;
    }
    const checkedAgent = document.querySelector('input[name="is_agent"]:checked');
    const isAgent = checkedAgent && checkedAgent.value === '1';
    const box = document.getElementById('order-agent-name'); 
    const showAgentName = isAgent && window.isOrderFieldEnabled('agent_name');
    if(showAgentName) { box.classList.remove('hidden'); } else { box.classList.add('hidden'); } 
}

window.toggleCreditCode = function() { 
    const input = document.getElementById('order-credit-code'); 
    if(document.getElementById('order-no-code').checked) { 
        input.placeholder = "无代码请输入护照号等"; 
        input.classList.replace('bg-yellow-50', 'bg-gray-100'); 
    } else { 
        input.placeholder = "防止重复，请准确填写"; 
        input.classList.replace('bg-gray-100', 'bg-yellow-50'); 
    } 
}

window.autoFillBoothData = function(booth) {
    document.getElementById('calc-type').innerText = booth.type; 
    document.getElementById('calc-area').innerText = window.currentAllocatedArea; // 使用分配面积展示
    const priceUnit = booth.base_price > 0 ? booth.base_price : (globalPrices[booth.type] || 0);
    
    // 原价计算根据分配的面积走
    if(booth.type === '光地') { 
        document.getElementById('calc-unit').innerText = `¥${priceUnit} /平米`; 
        currentStandardFee = priceUnit * window.currentAllocatedArea; 
    } else { 
        document.getElementById('calc-unit').innerText = `¥${priceUnit} /个(9㎡)`; 
        currentStandardFee = priceUnit * (window.currentAllocatedArea / 9); 
    }
    document.getElementById('calc-standard-fee').innerText = `¥ ${currentStandardFee.toLocaleString()}`; 
    document.getElementById('order-actual-fee').value = currentStandardFee; 
    window.calculateFinalTotal();
}

window.calculateFinalTotal = function() {
    const actualFeeInput = document.getElementById('order-actual-fee');
    if (!window.isOrderFieldEnabled('actual_booth_fee') && actualFeeInput) {
        actualFeeInput.value = currentStandardFee || 0;
    }
    const actualBoothFee = parseFloat(actualFeeInput?.value); 
    const dynamicStrategyDiv = document.getElementById('dynamic-strategy-display'); 
    const boothId = document.getElementById('selected-booth-id').value;
    
    if(boothId && !isNaN(actualBoothFee)) {
        const booth = allBooths.find(b => b.id === boothId);
        if(booth && window.currentAllocatedArea > 0) { 
            // 按照分配的面积反推单价
            let actualUnit = booth.type === '光地' ? actualBoothFee / window.currentAllocatedArea : actualBoothFee / (window.currentAllocatedArea / 9); 
            dynamicStrategyDiv.innerText = `(反推实际单价：¥ ${actualUnit.toFixed(2)} /${booth.type === '光地'?'㎡':'个'})`; 
            dynamicStrategyDiv.classList.remove('hidden'); 
        }
    } else { 
        dynamicStrategyDiv.classList.add('hidden'); 
    }
    
    let otherFeeTotal = 0; 
    dynamicFees.forEach(f => { otherFeeTotal += parseFloat(f.amount) || 0; });
    
    const reasonBox = document.getElementById('discount-reason-container');
    if(actualBoothFee < currentStandardFee) { reasonBox.classList.remove('hidden'); } else { reasonBox.classList.add('hidden'); }
    
    const total = (actualBoothFee || 0) + otherFeeTotal; 
    document.getElementById('calc-formula-text').innerText = `应收合计 = 展位费 (¥${actualBoothFee || 0}) + 杂费 (¥${otherFeeTotal})`; 
    document.getElementById('calc-final-total').innerText = `¥ ${total.toLocaleString()}`;
}

window.submitOrderForm = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const company = document.getElementById('order-company').value.trim(); 
    const code = document.getElementById('order-credit-code').value.trim();
    const contact = document.getElementById('order-contact').value.trim(); 
    const phone = document.getElementById('order-phone').value.trim();
    const selectedBooths = Array.isArray(window.selectedOrderBooths) ? window.selectedOrderBooths : [];
    
    const selectedAgentRadio = document.querySelector('input[name="is_agent"]:checked');
    const isAgent = window.isOrderFieldEnabled('is_agent') ? (selectedAgentRadio?.value === '1') : false;
    const agentName = document.getElementById('order-agent-name').value.trim();
    if(isAgent && window.isOrderFieldEnabled('agent_name') && window.isOrderFieldRequired('agent_name') && !agentName) return window.showToast("请填写代理商公司名称！", 'error');

    let finalRegion = ''; const prov = document.getElementById('reg-prov').value;
    if(window.isOrderFieldEnabled('region') && window.isOrderFieldRequired('region') && !prov) return window.showToast("请选择所在地区！", 'error');
    if(prov === '国际') { 
        const intl = document.getElementById('reg-intl').value.trim(); 
        if(window.isOrderFieldRequired('region') && !intl) return window.showToast("【国际】地区必须输入具体的国家/地区名称！", 'error'); 
        finalRegion = `国际 - ${intl}`; 
    } 
    else if (prov === '福建') { 
        const city = document.getElementById('reg-city-sel').value; 
        if(window.isOrderFieldRequired('region') && !city) return window.showToast("请选择福建城市！", 'error'); 
        finalRegion = `${prov}省 - ${city}市`; 
        if(city === '福州') { 
            const dist = document.getElementById('reg-dist').value; 
            if(window.isOrderFieldRequired('region') && !dist) return window.showToast("请选择区县！", 'error'); 
            finalRegion += ` - ${dist}`; 
        } 
    } else { 
        const cityInp = document.getElementById('reg-city-inp').value.trim(); 
        finalRegion = `${prov} - ${cityInp || '未知市'}`; 
    }

    if(window.isOrderFieldEnabled('company_name') && window.isOrderFieldRequired('company_name') && !company) return window.showToast("请填写企业名称", 'error'); 
    if(window.isOrderFieldEnabled('credit_code') && window.isOrderFieldRequired('credit_code') && !code) return window.showToast("请填写信用代码", 'error'); 
    if(window.isOrderFieldEnabled('contact_person') && window.isOrderFieldRequired('contact_person') && !contact) return window.showToast("请填写联系人", 'error'); 
    if(window.isOrderFieldEnabled('phone') && window.isOrderFieldRequired('phone') && !phone) return window.showToast("请填写联系电话", 'error'); 
    if(window.isOrderFieldRequired('booth_selection') && selectedBooths.length === 0) return window.showToast("请至少选择一个展位", 'error'); 
    
    const actualBoothFee = window.isOrderFieldEnabled('actual_booth_fee')
        ? parseFloat(document.getElementById('order-actual-fee').value)
        : Number(currentStandardFee || 0);
    if(isNaN(actualBoothFee)) return window.showToast("金额填写错误", 'error');
    
    const reason = document.getElementById('order-discount-reason').value.trim(); 
    if(actualBoothFee < currentStandardFee && !reason) return window.showToast("低于系统原价，请填写优惠理由！", 'error');

    let otherFeeTotal = 0; let validFees = [];
    if (window.isOrderFieldEnabled('extra_fees')) {
        dynamicFees.forEach(f => { if(f.name && parseFloat(f.amount)) { otherFeeTotal += parseFloat(f.amount); validFees.push(f); } });
    }
    const feesJsonStr = JSON.stringify(validFees); 
    
    const category = document.getElementById('order-category').value.trim();
    const business = document.getElementById('order-business').value.trim();
    const profile = document.getElementById('order-profile').value.trim(); 
    if (window.isOrderFieldEnabled('category') && window.isOrderFieldRequired('category') && !category) return window.showToast("请选择产品分类", 'error');
    if (window.isOrderFieldEnabled('main_business') && window.isOrderFieldRequired('main_business') && !business) return window.showToast("请填写主营业务/详细展品", 'error');
    if (window.isOrderFieldEnabled('profile') && window.isOrderFieldRequired('profile') && !profile) return window.showToast("请填写企业简介", 'error');

    window.toggleBtnLoading('submit-btn', true, '确认无误，生成订单并锁定展位');

    let uploadedFileKey = '';
    try {
        const fileInput = document.getElementById('order-contract');
        if (window.isOrderFieldEnabled('contract_upload') && fileInput.files.length > 0) {
            const file = fileInput.files[0]; 
            const formData = new FormData(); formData.append('file', file);
            const uploadRes = await window.apiFetch('/api/upload', { method: 'POST', body: formData }); 
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok || !uploadData.success) throw new Error(uploadData.error || "上传失败"); 
            uploadedFileKey = uploadData.fileKey;
        }
        const orderData = {
            project_id: pid, company_name: company, credit_code: code, no_code_checked: document.getElementById('order-no-code').checked,
            category: category, main_business: business, is_agent: isAgent, agent_name: agentName,
            contact_person: contact, phone: phone, region: finalRegion, booth_id: selectedBooths.map((item) => item.id).join(', '), 
            area: selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0),
            price_unit: selectedBooths.length === 1 ? selectedBooths[0].price_unit : '组合',
            unit_price: selectedBooths.length === 1 ? selectedBooths[0].unit_price : 0,
            total_booth_fee: actualBoothFee, discount_reason: reason, other_income: otherFeeTotal, fees_json: feesJsonStr, profile: profile, total_amount: actualBoothFee + otherFeeTotal, contract_url: uploadedFileKey, sales_name: currentUser.name
        };
        orderData.selected_booths = selectedBooths.map((item) => ({
            booth_id: item.id,
            hall: item.hall,
            type: item.type,
            area: item.area,
            price_unit: item.price_unit,
            unit_price: item.unit_price,
            standard_fee: item.standard_fee,
            is_joint: item.is_joint
        }));
        const res = await window.apiFetch('/api/submit-order', { method: 'POST', body: JSON.stringify(orderData) });
        if(res.ok) { 
            const result = await res.json().catch(() => ({ success: true }));
            const createdCount = Number(result.created_count || selectedBooths.length || 1);
            window.showToast(`🎉 订单录入成功，已生成 ${createdCount} 笔订单并锁定对应展位！`); 
            window.initOrderForm(); 
        } else { 
            const err = await res.json(); 
            throw new Error(err.error); 
        }
    } catch (error) { 
        window.showToast(error.message, 'error'); 
    } finally { 
        window.toggleBtnLoading('submit-btn', false);
    }
}
