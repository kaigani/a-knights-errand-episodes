/* Series two-video shell: untimed choices, complete departures, dream resets. */
'use strict';
const $=id=>document.getElementById(id);
const DEBUG=new URLSearchParams(location.search).get('debug')==='1';
const titlePanel=$('title'),endPanel=$('end'),choiceBar=$('choicebar');
const buttons=[$('c0'),$('c1')],blobs={};
let manifest,active=$('vidA'),hidden=$('vidB'),currentId=null,mode='title';
let choice=null,armed=null,swapping=false,path=[],generation=0;
const state=()=>({currentId,mode,path:[...path],armed,swapping,
  choice:choice?{phase:choice.phase,options:choice.info.options}:null,
  time:active.currentTime,duration:active.duration,paused:active.paused});
function hideChoices(){choiceBar.classList.remove('visible');buttons.forEach(b=>b.classList.remove('selected','dimmed'));}
function arm(id){armed=id;hidden.src=blobs[id];hidden.load();}
function enter(id){
  currentId=id;path.push(id);armed=null;swapping=false;hideChoices();
  const info=manifest.clips[id];choice=info.choice?{info:info.choice,phase:'pending'}:null;
  if(info.next)arm(info.next);
}
function start(id){
  generation++;active.pause();hidden.pause();
  active.src=blobs[id];active.currentTime=0;active.style.zIndex=2;hidden.style.zIndex=1;
  enter(id);active.play().catch(showError);
}
function begin(){
  $('splashvid').pause();titlePanel.classList.remove('visible');endPanel.classList.remove('visible');
  mode='playing';path=[];start(manifest.start);
}
function showChoices(){
  if(!choice||choice.phase!=='pending')return;
  buttons.forEach((b,i)=>{b.querySelector('.glyph').textContent=i?'▶':'◀';b.querySelector('.label').textContent=choice.info.options[i].label;});
  choice.phase='open';choiceBar.classList.add('visible');
}
function pick(i){
  if(mode!=='playing'||!choice||choice.phase!=='open'||![0,1].includes(i))return;
  choice.phase='locked';buttons[i].classList.add('selected');buttons[1-i].classList.add('dimmed');
  arm(choice.info.options[i].next);
  if(active.ended||active.currentTime>=active.duration-.025)swap();
}
function swap(){
  if(swapping||!armed)return;
  swapping=true;const next=armed,incoming=hidden,outgoing=active,token=generation;
  let revealed=false;
  const reveal=()=>{
    if(revealed||token!==generation)return;revealed=true;
    incoming.style.zIndex=2;outgoing.style.zIndex=1;outgoing.pause();
    active=incoming;hidden=outgoing;enter(next);
  };
  if(incoming.requestVideoFrameCallback)incoming.requestVideoFrameCallback(reveal);
  else incoming.addEventListener('playing',reveal,{once:true});
  incoming.currentTime=0;incoming.play().catch(showError);
  setTimeout(()=>{if(!revealed&&token===generation&&incoming.readyState>=2)reveal();},1000);
}
function returnToStart(){
  generation++;mode='title';choice=null;armed=null;hideChoices();active.pause();hidden.pause();
  titlePanel.classList.add('visible');$('begin').textContent='Begin Again';
  $('splashvid').currentTime=0;$('splashvid').play().catch(()=>{});
}
function showWin(){
  mode='ended';hideChoices();endPanel.className='panel visible win';
  $('endPath').textContent='Morning reaches the court. The sandman gets his first proper rest. You can finally yawn.';
  $('restart').focus();
}
function ended(v){
  if(mode!=='playing'||v!==active||swapping)return;
  if(armed){swap();return;}
  if(choice){showChoices();return;}
  const info=manifest.clips[currentId];
  if(info.restart==='Start')returnToStart();else if(info.outcome==='win')showWin();
}
function update(){
  if(mode==='playing'&&choice?.phase==='pending'&&active.currentTime>=choice.info.at)showChoices();
  if(DEBUG)$('hud').textContent=JSON.stringify(state(),null,2);
  requestAnimationFrame(update);
}
function showError(e){if(e?.name==='AbortError')return;console.error(e);$('status').textContent='Playback could not continue. Reload to try again.';}
buttons.forEach((b,i)=>b.addEventListener('click',()=>pick(i)));
$('begin').addEventListener('click',begin);$('restart').addEventListener('click',begin);
for(const v of [active,hidden]){v.muted=false;v.addEventListener('ended',()=>ended(v));v.addEventListener('error',()=>showError(v.error));}
document.addEventListener('keydown',e=>{
  if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();pick(e.key==='ArrowRight'?1:0);}
  else if(e.key==='Enter'&&!$('begin').disabled){if(mode==='title'||mode==='ended')begin();}
});
async function boot(){
  try{
    const r=await fetch('manifest.json');if(!r.ok)throw Error('Missing manifest');manifest=await r.json();
    const entries=Object.entries(manifest.clips);let done=0;
    await Promise.all(entries.map(async([id,info])=>{const r=await fetch(info.src);if(!r.ok)throw Error(info.src);blobs[id]=URL.createObjectURL(await r.blob());$('loadfill').style.width=(++done/entries.length*100)+'%';}));
    $('begin').disabled=false;$('begin').textContent='Enter the Sleeping Court';
  }catch(e){$('begin').textContent='Clips not ready';showError(e);}
}
window.__player={state};
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&mode==='playing'&&!active.ended)active.play().catch(showError);
});
if(DEBUG){$('hud').classList.add('visible');window.__player.jump=id=>{mode='playing';titlePanel.classList.remove('visible');endPanel.classList.remove('visible');start(id);};}
$('splashvid').muted=true;$('splashvid').play().catch(()=>{});
boot();requestAnimationFrame(update);

let soundMuted=false; $("mutebtn").addEventListener("click",()=>{soundMuted=!soundMuted; active.muted=hidden.muted=soundMuted; $("muteicon").alt=soundMuted?"sound is off":"sound is on"; $("muteicon").src=soundMuted?"assets/icon-muted.webp":"assets/icon-unmuted.webp"; $("mutebtn").style.opacity=soundMuted?"0.5":"1";});
