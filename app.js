(() => {
  'use strict';
  const {engine:E,map:M}=UFSCore,{Game,VERSION}=UFSGame,KEY='ufs-human-playtest-v1';
  const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roomNames={aa:'防空',fighter:'战机',research:'研究',energy:'供能',tunnel:'通道',robot:'机器人'};
  const roomIcons={aa:'⌁',fighter:'✦',research:'△',energy:'ϟ',tunnel:'━',robot:'▣'};
  const phaseNames={dice:'放置骰子',rooms:'结算房间',mothership:'母舰阶段',spawning:'部署敌舰',won:'研究完成',lost:'城市失守',new_round:'准备新回合'};
  const pipPositions={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  let game,view={die:null,cell:null,extent:null,spawn:null},toastTimer;
  function randomSeed(){return crypto.getRandomValues(new Uint32Array(1))[0]||1;}
  let restored=false,storageError=false,loadError=false;
  try{const s=localStorage.getItem(KEY);if(s){game=Game.restore(UFSCore,JSON.parse(s));restored=true;}}catch(e){loadError=true;console.warn('Save unavailable:',e.message);}
  if(!game)game=new Game(UFSCore,{seed:randomSeed()});
  function save(){if(loadError){$('save-status').textContent='旧存档无法恢复 · 新局请先导出';$('save-status').classList.add('save-error');return;}try{localStorage.setItem(KEY,JSON.stringify(game.export()));storageError=false;}catch{storageError=true;}$('save-status').textContent=storageError?'未能自动保存 · 请导出':'已自动保存';$('save-status').classList.toggle('save-error',storageError);}
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
  function room(id){return M.base.rooms.find(r=>r.id===id);}
  function cell(id){return M.base.cells.find(c=>c.id===id);}
  function loc(id){const c=cell(id);return c?`${c.tile}${c.row+1} · 第${c.column+1}列`:id;}
  function dieHTML(d,used=false){return `<button class="die ${d.color} ${used?'used':''} ${view.die===d.id?'selected':''}" data-action="die" data-id="${d.id}" ${used?'disabled':''} aria-pressed="${view.die===d.id}" aria-label="${d.color==='white'?'白':'灰'}骰 ${d.value}点${used?' 已使用':''}"><span class="pips" aria-hidden="true">${Array.from({length:9},(_,i)=>`<i ${pipPositions[d.value].includes(i)?'class="pip"':''}></i>`).join('')}</span></button>`;}
  function shipHTML(s){return `<svg class="ship ${s.color}" viewBox="0 0 30 20" role="img" aria-label="${s.color==='white'?'白':'紫'}色敌舰 ${esc(s.id)}"><path d="M15 1 22 8 28 11 26 16H4L2 11 8 8Z" fill="currentColor"/><path d="M10 9h10l-2 4h-6z" fill="#263249"/><path d="m5 17 2 2m16-2-2 2" stroke="currentColor" stroke-width="2"/></svg>`;}
  function effectText(a){return {spawn_white:`白+${a.amount}`,excavator_back:`掘−${a.amount}`,research_back:`研−${a.amount}`,damage:`伤+${a.amount}`}[a.type]||'';}
  function effectMeaning(a){return {spawn_white:`加入${a.amount}艘白舰`,excavator_back:`挖掘后退${a.amount}格`,research_back:`研究后退${a.amount}格`,damage:`城市受到${a.amount}伤害`}[a.type]||'';}
  function render(){
    const s=game.state,done=!!(s.outcome||game.endedAt);
    $('status').innerHTML=[['round','回合',String(s.round),''],['energy','能量',String(s.energy),`/ ${M.city.maxEnergy}`],['research','研究',String(s.researchIndex),'/ 16'],['damage','城市伤害',String(s.damage),'/ 7'],['phase','当前阶段',game.endedAt&&!s.outcome?'试玩已结束':phaseNames[s.phase],'']].map(([cls,label,val,max])=>`<div class="stat ${cls}"><div class="stat-label">${label}</div><div class="stat-value">${val} <small>${max}</small></div></div>`).join('');
    $('research-number').textContent=`${s.researchIndex} / 16`;
    $('research-track').innerHTML=M.research.costs.map((cost,i)=>`<div title="研究第${i+1}格，需要强度${cost}${i===15?'；需多格研究房':''}" class="research-step ${i<s.researchIndex?'done':''} ${i===s.researchIndex-1?'current':''} ${i===15?'final':''}"><small>${i+1}</small>${i<s.researchIndex?'✓':cost}</div>`).join('');
    const spawn=s.phase==='spawning'?game.spawn():null;
    $('sky').innerHTML=M.sky.rows.map(row=>`<div class="sky-row"><span class="row-number">${row.index+1}</span>${row.cells.map((item,col)=>{
      const drop=row.index===s.mothershipRow,choose=spawn&&drop&&spawn.candidates.includes(col)&&!done;
      let icon=item.explosion!=null?`<span class="sky-icon explosion" title="爆炸门槛${item.explosion}">${item.explosion}</span>`:'';
      if(item.effect)icon+=`<span class="sky-icon" title="${item.effect.type==='arrow'?`转向第${item.effect.targetColumn+1}列`:'母舰下降1行'}">${item.effect.type==='arrow'?(item.effect.targetColumn>col?'→':'←'):'▼'}</span>`;
      return `<div class="sky-cell ${row.index<=s.mothershipRow?'covered':''} ${drop?'drop':''} ${choose?'spawn-choice':''} ${choose&&view.spawn===col?'spawn-selected':''}" ${choose?`role="button" tabindex="0" data-action="spawn-cell" data-column="${col}" aria-label="在第${col+1}列部署"`:''}>${icon}${s.ships.filter(ship=>ship.row===row.index&&ship.column===col).map(shipHTML).join('')}</div>`;
    }).join('')}<div class="mother-cell ${row.index===s.mothershipRow?'current':''} ${row.index===M.sky.skullRow?'skull':''}" title="${row.index===M.sky.skullRow?'骷髅行：母舰抵达立即失败':row.mothershipActions.map(effectMeaning).join('；')||'无轨道效果'}">${row.index===s.mothershipRow?'◆ ':''}${row.index===M.sky.skullRow?'☠ 终点':row.mothershipActions.map(a=>`<span class="effect">${effectText(a)}</span>`).join(' ')||'·'}</div></div>`).join('');
    if(s.mothershipRow<0)$('sky').insertAdjacentHTML('afterbegin',`<div class="sky-row"><div class="row-number">0</div>${Array.from({length:5},(_,col)=>`<div class="sky-cell drop">${s.ships.filter(ship=>ship.row===s.mothershipRow&&ship.column===col).map(shipHTML).join('')}</div>`).join('')}<div class="mother-cell current">◆ 母舰</div></div>`);
    $('dice-label').textContent=done?'本局最后骰面':s.phase==='dice'?'① 选一枚骰子，再点基地格子':'本轮骰子';
    $('dice').innerHTML=s.dice.map(d=>dieHTML(d,d.placed||s.phase!=='dice'||done)).join('')+`<span class="dice-status">${s.dice.filter(d=>!d.placed).length} / 5 未放置</span>`;
    $('excavator-label').textContent=`挖掘 ${s.excavatorIndex} / 19`;
    const legal=view.die&&s.phase==='dice'?game.legalPlacements(view.die):[],usedCols=new Set(s.placements.map(p=>p.column));
    $('base').innerHTML=['A','B'].map(tile=>`<div class="tile-label">BASE ${tile} <span>${tile==='A'?'城市核心':'地下设施'}</span></div>${[0,1,2].map(row=>{
      const cells=M.base.cells.filter(c=>c.tile===tile&&c.row===row).sort((a,b)=>a.column-b.column),groups=[];
      for(const c of cells){if(groups.at(-1)?.id===c.roomId)groups.at(-1).cells.push(c);else groups.push({id:c.roomId,cells:[c]});}
      return `<div class="base-row">${groups.map(group=>{const r=room(group.id),locked=group.cells.every(c=>c.unlockIndex>s.excavatorIndex);return `<div class="room ${r.type==='research'?'lab':r.type} ${locked?'locked':''} ${view.cell&&r.cellIds.includes(view.cell)?'active-room':''}" style="grid-column:span ${group.cells.length};--slots:${group.cells.length}"><div class="room-title"><span>${roomIcons[r.type]} ${roomNames[r.type]}</span><span class="cost">${r.modifier?`${r.modifier>0?'+':''}${r.modifier} `:''}${r.energyCost?`ϟ${r.energyCost}`:''}</span></div><div class="room-slots">${group.cells.map(c=>{
        const p=s.placements.find(p=>p.cellId===c.id),isLegal=legal.some(p=>p.cellId===c.id),isLocked=c.unlockIndex>s.excavatorIndex;
        let text=p?`<span class="placed-die ${p.dieColor}">${p.dieValue}</span>`:isLocked?(isLegal?`掘 ${c.unlockIndex-s.excavatorIndex}`:'未开'):'·';
        return `<button class="base-cell ${isLocked?'locked':''} ${isLegal?'legal':''} ${p?'occupied':''} ${p?.resolved?'resolved':''} ${usedCols.has(c.column)?'used-column':''} ${view.cell===c.id?'selected-cell':''}" data-action="cell" data-id="${c.id}" title="${loc(c.id)} · ${roomNames[r.type]}${r.type==='tunnel'?'（已挖开时无房间效果）':''}${isLocked?` · 距挖掘标记${c.unlockIndex-s.excavatorIndex}格`:''}" aria-label="${loc(c.id)} ${roomNames[r.type]} ${p?`${p.dieValue}点骰${p.resolved?'已结算':'未结算'}`:isLocked?'尚未挖开':'已挖开'}">${c.unlockIndex===s.excavatorIndex&&M.base.excavatorPath.includes(c.id)?'<span class="marker">◈</span>':''}${text}${c.unlockIndex>0?`<span class="path-number">${c.unlockIndex}</span>`:''}</button>`;
      }).join('')}</div></div>`;}).join('')}</div>`;
    }).join('')}`).join('');
    renderAction();renderFeedback();save();
  }
  const line=(a,b)=>`<div class="detail-line"><span>${a}</span><b>${b}</b></div>`;
  function renderAction(){
    const s=game.state,selectedCell=cell(view.cell),r=selectedCell?room(selectedCell.roomId):null;
    $('phase-tag').textContent=`ROUND ${String(s.round).padStart(2,'0')} / ${phaseNames[s.phase]}`;
    let title='',hint='',html='';
    if(s.outcome||game.endedAt){
      const won=s.outcome?.result==='win';title=won?'研究完成，城市获救':s.outcome?'本次任务失败':'本次试玩已结束';hint=s.outcome?(won?'正式研究目标已达成。':'城市伤害达到上限，或母舰抵达骷髅行。'):'游戏没有被判定为胜利或失败。';
      html=`<div class="result-banner ${won?'':'loss'}">研究 ${s.researchIndex}/16 · 挖掘 ${s.excavatorIndex}/19 · 伤害 ${s.damage}/7</div><button class="primary wide" data-action="survey">填写赛后反馈</button><button class="wide" data-action="export">导出本次记录</button><button class="text-button wide" data-action="new">开始新局</button>`;
    }else if(s.phase==='dice'){
      title=view.die?'② 选择放置位置':'选择一枚骰子';hint=view.die?'绿色格子可放置。点击格子查看，再确认操作。':'灰骰保留剩余骰面；放置白骰会重掷其余未放骰子。';
      if(r){const d=s.dice.find(d=>d.id===view.die),option=d?game.legalPlacements(d.id).find(p=>p.cellId===view.cell):null,locked=selectedCell.unlockIndex>s.excavatorIndex;
        html=`<div class="detail-box">${line('选中位置',esc(loc(view.cell)))}${line('房间',`${roomIcons[r.type]} ${roomNames[r.type]}${r.cellIds.length>1?` · ${r.cellIds.length}格`:''}`)}${line('房间费用',r.energyCost+' 能量')}${line('数值修正',r.modifier>0?'+'+r.modifier:r.modifier)}<p class="detail-note">${locked?`这是尚未挖开的格子。挖掘距离${selectedCell.unlockIndex-s.excavatorIndex}格，房间阶段可花1能量挖掘。`:r.type==='tunnel'?'已挖开的通道没有房间效果。':r.type==='aa'?'此列敌舰的下落量减少1；房间阶段没有额外效果。':r.cellIds.length>1?'多格房需所有格子都有骰子才可使用。':'房间阶段选择是否使用，不能重复使用同一枚骰。'}</p>${d?line('此列敌舰下降',`${Math.max(0,d.value-(r.type==='aa'?1:0))} 格`):''}${!option&&d?`<p class="inline-hint">${s.placements.some(p=>p.column===selectedCell.column)?'本轮这一列已有骰子。':'该格距离超出骰值，或本轮已有挖掘骰。'}</p>`:''}<button class="primary wide" data-action="place" ${option?'':'disabled'}>确认放置${d?' · '+d.value+'点':''}</button></div>`;
      }else html='<div class="detail-box"><p class="detail-note">每列每回合最多放一枚骰子。你可以随时取消当前选择。</p></div>';
    }else if(s.phase==='rooms'){
      title='选择房间结算';hint='顺序由你决定。点击基地中未结算的骰子，查看效果和费用。';
      const pending=s.placements.filter(p=>!p.resolved);
      if(r){
        const p=s.placements.find(p=>p.cellId===view.cell&&!p.resolved),actions=game.roomActions(),excavate=actions.find(a=>a.type==='excavate'&&a.placementId===p?.id),resolve=actions.find(a=>a.type==='resolve_room'&&a.roomId===r.id);
        html=`<div class="detail-box">${line('房间',roomIcons[r.type]+' '+roomNames[r.type])}${line('费用',excavate?'1 能量':r.energyCost+' 能量')}`;
        if(excavate)html+=`<p class="detail-note">从挖掘${s.excavatorIndex}推进到${excavate.targetIndex}。这枚骰用于挖掘，不使用所在房间效果。</p><button class="primary wide" data-action="room" data-kind="excavate" data-placement="${p.id}" ${excavate.affordable?'':'disabled'}>支付1能量并挖掘</button>`;
        else if(resolve){
          html+=line('房间强度',Math.max(0,resolve.value));
          if(!resolve.affordable)html+=`<p class="inline-hint">能量不足：当前${s.energy}点，需要${r.energyCost}点。</p>`;
          if(r.type==='research'){
            const max=E.maxResearchAdvance(M,s,r,Math.max(0,resolve.value));
            html+=`<p class="detail-note">选择推进步数。每个研究格的成本相加后须不超过房间强度；费用支付一次。</p><div class="button-row">${Array.from({length:max+1},(_,n)=>`<button class="extent ${view.extent===n?'chosen':''}" data-action="extent" data-value="${n}">${n}格</button>`).join('')}</div>${line('当前研究',s.researchIndex+' / 16')}<button class="primary wide" data-action="room" data-kind="resolve_room" data-room="${r.id}" ${resolve.affordable&&view.extent!==null?'':'disabled'}>${view.extent===null?'先选择推进步数':`支付${r.energyCost}能量 · 推进${view.extent}格`}</button>`;
          }else{
            const effect=r.type==='energy'?`增加${Math.max(0,resolve.value)}点能量，超出${M.city.maxEnergy}的部分不保留。`:r.type==='fighter'?`击落爆炸门槛不高于${Math.max(0,resolve.value)}的敌舰；母舰遮盖的图标不生效。`:r.type==='aa'?'防空的减速已在放骰时发生；结算仅移除骰子。':'已挖开的通道无房间效果，结算仅移除骰子。';
            html+=`<p class="detail-note">${effect}</p><button class="primary wide" data-action="room" data-kind="resolve_room" data-room="${r.id}" ${resolve.affordable?'':'disabled'}>${resolve.affordable?'结算房间':'能量不足'}</button>`;
          }
        }else html+='<p class="detail-note">该房间当前不完整，或所选骰子已经结算。</p>';
        if(p)html+=`<button class="wide" data-action="room" data-kind="skip_worker" data-placement="${p.id}">弃用这枚骰子</button>`;html+='</div>';
      }
      html+=`<div class="detail-box">${line('未结算骰子',pending.length+' 枚')}<button class="${pending.length?'':'primary '}wide" data-action="end-rooms">${pending.length?'弃用剩余骰子并结束房间阶段':'结束房间阶段'}</button></div>`;
    }else if(s.phase==='mothership'){
      title='推进母舰';hint='母舰先下降一行，执行该行轨道效果，然后部署等待中的敌舰。';
      const next=M.sky.rows.find(r=>r.index===s.mothershipRow+1);
      html=`<div class="detail-box">${line('下一行',s.mothershipRow+2)}<p class="detail-note">${s.mothershipRow+1>=M.sky.skullRow?'母舰将抵达骷髅行，任务立即失败。':next?.mothershipActions.map(effectMeaning).join('；')||'该行没有额外轨道效果。'}</p><button class="primary wide" data-action="mothership">执行母舰阶段</button></div>`;
    }else if(s.phase==='spawning'){
      const spawn=game.spawn();
      if(spawn){title=`部署${spawn.waiting.color==='white'?'白':'紫'}色敌舰`;hint='金色位置可部署。先空列；没有空列时，选择与最高敌舰距离最远的列。';
        html=`<div class="button-row">${spawn.candidates.map(col=>`<button class="${view.spawn===col?'primary':''}" data-action="spawn-cell" data-column="${col}">第${col+1}列</button>`).join('')}</div><button class="primary wide" data-action="spawn" ${spawn.candidates.includes(view.spawn)?'':'disabled'}>确认部署${view.spawn!==null?' · 第'+(view.spawn+1)+'列':''}</button>`;
      }else{title='开始下一回合';hint=s.waitingShips.length?'当前没有可用部署位置，剩余敌舰留待之后部署。':'部署完成。下一回合将掷出新的五枚骰子。';html='<button class="primary wide" data-action="next-round">掷骰 · 开始下一回合</button>';}
    }
    $('action-title').textContent=title;$('action-hint').textContent=hint;$('action-content').innerHTML=html;
  }
  function actionLabel(row){const q=row.request;
    if(q.type==='place'){const p=row.after.placements.find(p=>p.id===q.id);return `放置${p?.dieColor==='white'?'白':'灰'}骰${p?.dieValue} → ${loc(p?.cellId)}`;}
    if(q.type==='room'){const a=q.action;return a.type==='excavate'?'执行挖掘':a.type==='skip_worker'?`弃用骰子 · ${loc(a.placementId.split('@')[1])}`:`结算${roomNames[room(a.roomId)?.type]||'房间'}${a.advanceSteps!==undefined?' · 推进'+a.advanceSteps+'格':''}`;}
    return {end_rooms:'结束房间阶段',mothership:'执行母舰阶段',spawn:`部署敌舰 → 第${q.column+1}列`,next_round:'掷骰 · 新回合'}[q.type]||q.type;
  }
  function changes(row){const labels={energy:'能量',damage:'伤害',researchIndex:'研究',excavatorIndex:'挖掘',mothershipRow:'母舰'},out=[];
    for(const k of Object.keys(labels)){const delta=row.after[k]-row.before[k];if(delta)out.push(`<span class="delta ${delta*(k==='damage'||k==='mothershipRow'?-1:1)>0?'good':'bad'}">${labels[k]} ${delta>0?'+':''}${delta}</span>`);}return out.join('');}
  function eventDetails(row){const out=[];
    for(const e of row.events){
      if(e.type==='worker_placed')for(const v of e.shipEvents){const before=row.before.ships.find(s=>s.id===v.shipId),name=before?.color==='white'?'白舰':'紫舰',prefix=`${name} · 第${(before?.column??0)+1}列`;
        if(v.type==='descended')out.push(`${prefix}：第${(before?.row??-1)+1}行 → 第${v.row+1}行`);
        else if(v.type==='arrow')out.push(`${name}转向第${v.to.column+1}列 / 第${v.to.row+1}行`);
        else if(v.type==='arrow_blocked')out.push(`${name}转向位置被占，留在原列`);
        else if(v.type==='city_hit')out.push(`${prefix}抵达城市，造成伤害`);
        else if(v.type==='mothership_down')out.push(`天空图标触发母舰下降${v.amount}行`);
      }
      if(e.type==='white_reroll')out.push('↻ 剩余骰重掷：'+e.after.map(d=>(d.color==='white'?'白':'灰')+d.value).join(' / '));
      if(e.type==='fighter')out.push(`击落${e.destroyed.length}艘敌舰`);
      if(e.type==='mothership_action')out.push('轨道效果：'+effectMeaning(e.action));
    }
    return out.map(x=>`<div class="event-detail">${esc(x)}</div>`).join('');
  }
  function renderFeedback(){const recent=game.actions.slice(-3).reverse();$('feedback').innerHTML=recent.length?recent.map(row=>`<div class="feedback-entry">${esc(actionLabel(row))}<div class="feedback-delta">${changes(row)}</div>${eventDetails(row)}</div>`).join(''):'<p class="muted">选择骰子开始本回合。每次操作后的变化会显示在这里。</p>';}
  function commit(request){try{game.dispatch(request);view={die:null,cell:null,extent:null,spawn:null};render();if(game.state.outcome)toast(game.state.outcome.result==='win'?'研究完成，任务胜利！':'任务结束，可以填写反馈并导出记录。');}catch(e){toast(e.message);}}
  function modal(title,body){$('dialog-body').innerHTML=`<div class="modal-header"><h2>${title}</h2><button class="modal-close" data-action="close" aria-label="关闭">×</button></div><div class="modal-body">${body}</div>`;if(!$('dialog').open)$('dialog').showModal();}
  function help(){game.interaction('rules_opened');save();modal('玩法与规则',`
    <p>在Roswell地下基地分配骰子，完成全部16格研究。每轮分为放骰、房间、母舰与部署阶段。界面显示的行列从1开始。</p>
    <h3>1 / 放置骰子</h3><ul><li>每回合五枚骰子，每列最多一枚。每放一枚，该列敌舰下降与骰值相同的格数。</li><li>防空格让下降量减少1。白骰放下后，所有尚未放置的骰子立刻重掷。</li><li>每轮最多一枚骰子可放到尚未挖开的格子；距离不能超过骰值。这枚骰子在房间阶段用于挖掘。</li><li>敌舰抵达城市造成1点伤害。箭头改变落点；▼让母舰下降。敌舰仅落在图标上时触发，不沿途逐格触发。</li></ul>
    <h3>2 / 结算房间</h3><ul><li>你选择顺序。房间强度＝房内骰值之和＋修正，负值按0处理。多格房须全部有骰子；不同房间不能合并强度。</li><li>供能增加能量，上限7。战机击落爆炸门槛不高于房间强度的敌舰。</li><li>研究需覆盖连续研究格的成本总和，能量费用支付一次；末格必须使用至少两格的研究房。</li><li><b>已经挖开的通道无房间效果。</b>真正挖掘使用前沿骰子，花1能量将标记移动到该格。</li><li>防空的减速已在放骰时发生。每枚骰子只用一次，也可弃用；结束房间阶段会弃用全部剩余骰子。</li></ul>
    <h3>3 / 母舰与部署</h3><ul><li>母舰下降一行，执行右侧轨道效果。放骰触发的额外母舰下降不立即执行该行轨道效果。</li><li>等待敌舰先紫后白部署。优先空列；无空列时选与最高敌舰距离最远的落点，平手由你选。</li><li>母舰覆盖的天空图标不再生效。紫舰被击落后等待部署，白舰被击落则离场。</li></ul>
    <h3>正式胜负</h3><p>研究达到16立即胜利；伤害达到7或母舰到达骷髅行立即失败。未来骰点不提前显示。</p>
    <h3>存档与记录</h3><p>操作后自动存到当前浏览器。菜单可导出或导入JSON；无自动上传。不同浏览器的本地存档不互通。赛后反馈不影响游戏规则。</p><button class="primary wide" data-action="close">返回棋盘</button>`);}
  function menu(){modal('存档与新局',`<p>本次操作已保存在当前浏览器。你也可以下载包含实际操作、实际骰点和赛后反馈的记录文件。</p><button class="primary wide" data-action="export">导出本次记录 / 存档</button><button class="wide" data-action="import">导入记录并继续</button><button class="wide" data-action="new">开始新局</button><button class="text-button wide" data-action="survey">结束当前试玩并填写反馈</button><hr class="divider"><p class="muted">版本 ${VERSION} · 规则地图 Roswell A+B / 威胁0<br>引擎 ${UFSCore.fingerprint.slice(0,12)}</p>`);}
  function newDialog(){modal('开始新局',`<p>${game.actions.length?'新局会替换当前浏览器的自动存档。需要保留本局时，请先导出。':'分配五枚骰子，守住城市，并推进全部研究。'}</p><div class="setup-preview"><span>目标<br><b>研究16格</b></span><span>城市<br><b>伤害上限7</b></span><span>地图<br><b>Roswell A+B</b></span></div><details><summary>指定随机种子（可选）</summary><label class="field">留空使用新的随机种子<input id="seed-input" type="number" min="1" max="4294967295" inputmode="numeric" placeholder="例如 531211"></label></details><div class="button-row">${game.actions.length?'<button data-action="export">先导出本局</button>':''}<button class="primary" data-action="start">开始任务</button></div><button class="text-button wide" data-action="close">取消，返回当前棋盘</button>`);}
  function exportGame(){save();const blob=new Blob([JSON.stringify(game.export(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`UFS-${game.sessionId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出记录；请将JSON文件回传给邀请你试玩的人。');}
  function records(){game.interaction('records_opened');save();modal('操作记录',`<p class="muted">共${game.actions.length}次实际操作。记录保留输入、结果与实际随机事件，可随存档导出。</p>${game.actions.slice().reverse().map(r=>`<div class="record"><time>#${r.index} · 第${r.before.round}轮</time><div>${esc(actionLabel(r))}</div><div class="feedback-delta">${changes(r)}</div>${r.events.some(e=>e.type==='white_reroll')?'<small>剩余骰子已重掷</small>':''}</div>`).join('')||'<p>尚无实际操作。</p>'}`);}
  function survey(){
    if(!game.state.outcome&&!game.endedAt){modal('结束本次试玩？','<p>你可以在任何阶段结束。系统会记录为“主动结束”，不会记成游戏失败；开始填写后，本次操作将停止。</p><button class="primary wide" data-action="confirm-survey">结束试玩并填写</button><button class="wide" data-action="close">继续游戏</button>');return;}
    game.endTrial();save();render();
    const q=game.survey,field=(id,label,type='textarea',options=[])=>`<label class="field">${label}${type==='select'?`<select name="${id}"><option value="">可跳过 / 不确定</option>${options.map(x=>`<option ${q[id]===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`:`<textarea name="${id}" maxlength="2000">${esc(q[id]||'')}</textarea>`}</label>`;
    const last=game.actions.slice().reverse().find(a=>a.request.type==='place');
    modal('赛后反馈',`<p>不需要姓名，问题均可跳过。“不知道”和“不记得”都是有效答案。表单只保存在本机，导出后自行回传。</p>${last?`<div class="result-banner">最近一次放骰：${esc(actionLabel(last))}<div class="feedback-delta">${changes(last)}</div></div>`:''}<form id="survey-form">${field('experience','1. 这次之前，你玩过UFS吗？','select',['从未','看过规则但没玩过','玩过1—3局','玩过更多'])}${field('strategyGames','2. 平时玩资源规划类桌游或策略游戏的频率？','select',['很少','偶尔','经常'])}${field('tunnel','3. 在已经挖开的通道放5点骰，正常结算后，你认为挖掘标记会怎样变化？依据是什么？')}${field('frontier','4. 在尚未挖开的格子放骰，和在已挖开的通道放骰，作用是否相同？')}${field('expectation','5. 回看最近一次放骰：当时主要想得到什么，实际得到了什么？哪些只是现在的推测？')}${field('cause','6. 有没有效果未如预期的操作？你认为有哪些可能解释，依据是什么，还有哪些未知？')}${field('cost','7. 从最初投入到最后结算，用了哪些资源、位置或机会？最后一步不花能量时，你怎样评价整段成本？')}${field('learning','8. 哪种做法让你改变了看法？后来遇到类似情况时，你怎么处理？')}${field('clarity','9. 哪些规则没理解，哪些懂了但当时没想起来？哪些操作只是界面难用？')}${field('comments','10. 其他反馈；是否愿意再玩一小段不同局面？')}<button class="primary wide" type="submit">保存反馈并导出记录</button></form>`);
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action;
    if(a==='die'){view.die=view.die===b.dataset.id?null:b.dataset.id;view.extent=null;render();}
    else if(a==='cell'){view.cell=b.dataset.id;view.extent=null;render();}
    else if(a==='cancel'){view={die:null,cell:null,extent:null,spawn:null};render();}
    else if(a==='place'){const p=game.legalPlacements(view.die).find(p=>p.cellId===view.cell);if(p)commit({type:'place',id:p.id});}
    else if(a==='extent'){view.extent=Number(b.dataset.value);renderAction();}
    else if(a==='room'){const action={type:b.dataset.kind};if(b.dataset.room)action.roomId=b.dataset.room;if(b.dataset.placement)action.placementId=b.dataset.placement;if(room(action.roomId)?.type==='research')action.advanceSteps=view.extent;commit({type:'room',action});}
    else if(a==='end-rooms'){if(game.state.placements.some(p=>!p.resolved))modal('结束房间阶段？','<p>所有未使用骰子将被弃用，然后进入母舰阶段。这个操作不会重新掷骰。</p><button class="primary wide" data-action="confirm-end">确认结束房间阶段</button><button class="wide" data-action="close">取消，继续结算</button>');else commit({type:'end_rooms'});}
    else if(a==='confirm-end'){$('dialog').close();commit({type:'end_rooms'});}
    else if(a==='mothership')commit({type:'mothership'});
    else if(a==='spawn-cell'){view.spawn=Number(b.dataset.column);render();}
    else if(a==='spawn'){const next=game.spawn();if(next)commit({type:'spawn',shipId:next.waiting.id,column:view.spawn});}
    else if(a==='next-round')commit({type:'next_round'});
    else if(a==='help')help();else if(a==='menu')menu();else if(a==='new')newDialog();else if(a==='records')records();
    else if(a==='close')$('dialog').close();else if(a==='export')exportGame();else if(a==='import')$('import-file').click();
    else if(a==='start'){const input=$('seed-input')?.value;const n=input?Number(input):randomSeed();if(!Number.isSafeInteger(n)||n<1||n>4294967295){toast('随机种子需为1至4294967295之间的整数。');return;}game=new Game(UFSCore,{seed:n});loadError=false;view={die:null,cell:null,extent:null,spawn:null};$('dialog').close();render();toast('任务开始：先选择一枚骰子。');}
    else if(a==='survey')survey();else if(a==='confirm-survey'){game.endTrial();survey();}
  });
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.spawn-choice')){e.preventDefault();e.target.click();}});
  document.addEventListener('submit',e=>{if(e.target.id!=='survey-form')return;e.preventDefault();game.survey=Object.fromEntries(new FormData(e.target));game.interaction('survey_saved');save();exportGame();$('dialog').close();toast('反馈已保存并导出，谢谢试玩。');});
  document.addEventListener('input',e=>{if(e.target.closest('#survey-form')){game.survey=Object.fromEntries(new FormData($('survey-form')));save();}});
  $('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('文件大于5MB，请选择本游戏导出的JSON。');const loaded=Game.restore(UFSCore,JSON.parse(await file.text()));game=loaded;loadError=false;view={die:null,cell:null,extent:null,spawn:null};$('dialog').close();render();toast('记录已核验并恢复。');}catch(err){toast('导入失败：'+err.message);}e.target.value='';});
  render();
  if(!restored)modal('欢迎来到Roswell',`<p>在母舰抵达之前，用五枚骰子分配研究、供能、防空和挖掘。完成16格研究即可获胜。</p><div class="setup-preview"><span>一列一骰</span><span>白骰触发重掷</span><span>自选结算顺序</span></div><p>先选择骰子，再选择格子，确认后执行。你可随时查看规则；系统会自动保存。试玩记录只存本机。</p><button class="primary wide" data-action="close">进入指挥所</button><button class="wide" data-action="help">先看玩法与规则</button>`);
  if(loadError)toast('旧存档无法恢复，已保留未覆盖。当前新局请导出保存，或在菜单中明确开始新局。');
})();
