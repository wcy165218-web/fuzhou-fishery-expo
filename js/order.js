// ================= js/order.js =================
window.currentAllocatedArea = 0; // 全局存储本次分配的展位面积

window.initOrderForm = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const pRes = await window.apiFetch(`/api/prices?projectId=${pid}`); 
    const data = await pRes.json();
    globalPrices = { '标摊': data['标摊']||0, '豪标': data['豪标']||0, '光地': data['光地']||0 };
    
    const bRes = await window.apiFetch(`/api/booths?projectId=${pid}`); 
    allBooths = await bRes.json(); 
    
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
    
    document.getElementById('selected-booth-id').value = booth.id; 
    document.getElementById('calc-booth').innerText = `${booth.hall} - ${booth.id}`; 
    
    window.currentAllocatedArea = allocatedArea; // 记录本次分配的面积
    window.autoFillBoothData(booth);
    
    if(!isJointExhibition) window.showToast(`已成功锁定展位：${booth.id}`);
}

window.addFeeRow = function() { dynamicFees.push({ name: '', amount: '' }); window.renderDynamicFees(); }
window.removeFeeRow = function(idx) { dynamicFees.splice(idx, 1); window.renderDynamicFees(); }
window.updateFeeData = function(idx, field, val) { dynamicFees[idx][field] = val; window.calculateFinalTotal(); }

window.renderDynamicFees = function() {
    const container = document.getElementById('dynamic-fees-container'); 
    const noFeesText = document.getElementById('no-fees-text'); 
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
    const isAgent = document.querySelector('input[name="is_agent"]:checked').value === '1';
    const box = document.getElementById('order-agent-name'); 
    if(isAgent) { box.classList.remove('hidden'); } else { box.classList.add('hidden'); } 
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
    const actualBoothFee = parseFloat(document.getElementById('order-actual-fee').value); 
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
    const boothId = document.getElementById('selected-booth-id').value; 
    
    const isAgent = document.querySelector('input[name="is_agent"]:checked').value === '1';
    const agentName = document.getElementById('order-agent-name').value.trim();
    if(isAgent && !agentName) return window.showToast("请填写代理商公司名称！", 'error');

    let finalRegion = ''; const prov = document.getElementById('reg-prov').value;
    if(!prov) return window.showToast("请选择所在地区！", 'error');
    if(prov === '国际') { 
        const intl = document.getElementById('reg-intl').value.trim(); 
        if(!intl) return window.showToast("【国际】地区必须输入具体的国家/地区名称！", 'error'); 
        finalRegion = `国际 - ${intl}`; 
    } 
    else if (prov === '福建') { 
        const city = document.getElementById('reg-city-sel').value; 
        if(!city) return window.showToast("请选择福建城市！", 'error'); 
        finalRegion = `${prov}省 - ${city}市`; 
        if(city === '福州') { 
            const dist = document.getElementById('reg-dist').value; 
            if(!dist) return window.showToast("请选择区县！", 'error'); 
            finalRegion += ` - ${dist}`; 
        } 
    } else { 
        const cityInp = document.getElementById('reg-city-inp').value.trim(); 
        finalRegion = `${prov} - ${cityInp || '未知市'}`; 
    }

    if(!company) return window.showToast("请填写企业名称", 'error'); 
    if(!code) return window.showToast("请填写信用代码", 'error'); 
    if(!contact || !phone) return window.showToast("请填写电话", 'error'); 
    if(!boothId) return window.showToast("请锁定展位", 'error'); 
    
    const actualBoothFee = parseFloat(document.getElementById('order-actual-fee').value); 
    if(isNaN(actualBoothFee)) return window.showToast("金额填写错误", 'error');
    
    const reason = document.getElementById('order-discount-reason').value.trim(); 
    if(actualBoothFee < currentStandardFee && !reason) return window.showToast("低于系统原价，请填写优惠理由！", 'error');

    let otherFeeTotal = 0; let validFees = [];
    dynamicFees.forEach(f => { if(f.name && parseFloat(f.amount)) { otherFeeTotal += parseFloat(f.amount); validFees.push(f); } });
    const feesJsonStr = JSON.stringify(validFees); 
    
    const category = document.getElementById('order-category').value.trim();
    const business = document.getElementById('order-business').value.trim();
    const profile = document.getElementById('order-profile').value.trim(); 
    const booth = allBooths.find(b => b.id === boothId);
    
    window.toggleBtnLoading('submit-btn', true, '✅ 确认无误，生成订单并锁定展位');

    let uploadedFileKey = '';
    try {
        const fileInput = document.getElementById('order-contract');
        if (fileInput.files.length > 0) {
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
            contact_person: contact, phone: phone, region: finalRegion, booth_id: boothId, 
            area: window.currentAllocatedArea || booth.area, // 提交分配后面积
            price_unit: booth.type === '光地' ? '平米' : '个', unit_price: booth.base_price > 0 ? booth.base_price : globalPrices[booth.type],
            total_booth_fee: actualBoothFee, discount_reason: reason, other_income: otherFeeTotal, fees_json: feesJsonStr, profile: profile, total_amount: actualBoothFee + otherFeeTotal, contract_url: uploadedFileKey, sales_name: currentUser.name
        };
        const res = await window.apiFetch('/api/submit-order', { method: 'POST', body: JSON.stringify(orderData) });
        if(res.ok) { 
            window.showToast("🎉 订单录入成功，展位已锁定！"); 
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
