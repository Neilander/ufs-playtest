(function(g,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else g.UFSGame=factory();})(globalThis,function(){
  'use strict';
  const VERSION='0.1.0',SCHEMA='ufs_human_playtest_v1';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const digestState=s=>{const {history,rngState,...publicState}=s;return clone(publicState);};
  class Game {
    constructor(core,{seed=1,sessionId,startedAt}={}){
      this.core=core;this.seed=Number(seed)>>>0||1;this.sessionId=sessionId||`ufs-${Date.now()}-${this.seed}`;
      this.startedAt=startedAt||new Date().toISOString();this.state=core.engine.createGame(core.map,this.seed);
      this.actions=[];this.interactions=[];this.survey={};this.endedAt=null;this.endKind=null;
    }
    legalPlacements(dieId){return this.core.engine.legalWorkerPlacements(this.core.map,this.state,dieId);}
    roomActions(){return this.core.engine.legalRoomActions(this.core.map,this.state);}
    spawn(){return this.state.phase==='spawning'?this.core.engine.nextSpawnChoice(this.core.map,this.state):null;}
    dispatch(request,{at=new Date().toISOString(),replay=false}={}){
      if(this.state.outcome||this.endedAt&&!replay)throw Error('本次试玩已经结束，请开始新局。');
      const E=this.core.engine,M=this.core.map,before=this.state;let next;
      if(request.type==='place'){
        const p=E.allLegalWorkerPlacements(M,before).find(p=>p.id===request.id);if(!p)throw Error('这个放置当前不合法。');
        next=E.applyWorkerPlacement(M,before,p);
      }else if(request.type==='room'){
        const a=this.roomActions().find(a=>a.type===request.action.type&&
          (a.type==='resolve_room'?a.roomId===request.action.roomId:a.type==='skip_worker'||a.type==='excavate'?a.placementId===request.action.placementId:a.type==='remove_robot'?a.robotId===request.action.robotId:false));
        if(!a)throw Error('这个房间操作当前不可用。');if(a.affordable===false)throw Error('能量不足。');
        const action={...a};
        if(a.type==='resolve_room'&&a.roomType==='research'){
          const room=M.base.rooms.find(r=>r.id===a.roomId),max=E.maxResearchAdvance(M,before,room,Math.max(0,a.value));
          if(!Number.isInteger(request.action.advanceSteps)||request.action.advanceSteps<0||request.action.advanceSteps>max)throw Error('请明确选择可推进的研究步数。');
          action.advanceSteps=request.action.advanceSteps;
        }
        if(a.type==='resolve_room'&&a.roomType==='robot')Object.assign(action,{targetCellId:request.action.targetCellId,removeRobotId:request.action.removeRobotId});
        next=E.applyRoomAction(M,before,action);
      }else if(request.type==='end_rooms'){
        if(before.phase!=='rooms')throw Error('现在不是房间阶段。');next=E.applyRoomAction(M,before,{type:'end_rooms'});
      }else if(request.type==='mothership'){
        next=E.resolveMothership(M,before,{deferSpawns:true});
      }else if(request.type==='spawn'){
        if(before.phase!=='spawning')throw Error('现在不是部署阶段。');next=E.applySpawnChoice(M,before,{shipId:request.shipId,column:request.column});
      }else if(request.type==='next_round'){
        if(before.phase!=='spawning'||this.spawn())throw Error('请先完成当前部署。');next=E.startRound(M,E.finishDeferredMothership(before));
      }else throw Error('未知操作。');
      this.state=next;
      const record={index:this.actions.length+1,at,request:clone(request),before:digestState(before),after:digestState(next),events:clone(next.history.slice(before.history.length))};
      this.actions.push(record);return record;
    }
    interaction(type,data={}){this.interactions.push({at:new Date().toISOString(),afterAction:this.actions.length,type,data:clone(data)});}
    endTrial(){if(!this.endedAt){this.endedAt=new Date().toISOString();this.endKind=this.state.outcome?'terminal':'participant_stopped';this.interaction('trial_ended',{kind:this.endKind});}}
    export(){return {schema:SCHEMA,version:VERSION,engineFingerprint:this.core.fingerprint,mapId:this.core.map.id,sessionId:this.sessionId,seed:this.seed,startedAt:this.startedAt,endedAt:this.endedAt,endKind:this.endKind,state:clone(this.state),actions:clone(this.actions),interactions:clone(this.interactions),survey:clone(this.survey)};}
    static restore(core,saved){
      if(saved?.schema!==SCHEMA||saved.version!==VERSION||saved.engineFingerprint!==core.fingerprint||saved.mapId!==core.map.id)throw Error('存档版本或规则引擎不匹配。');
      if(!Array.isArray(saved.actions)||saved.actions.length>2000||!Array.isArray(saved.interactions)||saved.interactions.length>20000)throw Error('存档记录格式不正确。');
      const game=new Game(core,saved);
      for(const row of saved.actions){const actual=game.dispatch(row.request,{at:row.at,replay:true});if(JSON.stringify(actual.after)!==JSON.stringify(row.after))throw Error(`存档第${row.index}步与规则结果不一致。`);}
      if(JSON.stringify(game.state)!==JSON.stringify(saved.state))throw Error('存档末状态与操作回放不一致。');
      game.interactions=clone(saved.interactions);game.survey=clone(saved.survey||{});game.endedAt=saved.endedAt||null;game.endKind=saved.endKind||null;
      return game;
    }
  }
  return {Game,VERSION,SCHEMA,digestState};
});
