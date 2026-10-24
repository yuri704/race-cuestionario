const SVG_MIC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SVG_PAUSA='<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
const SVG_OK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const API='https://qouknsooeokwphjgpsru.supabase.co/functions/v1/cuestionario';
const codigo=new URLSearchParams(location.search).get('c')||'';
const T=document.getElementById('tarjeta');
let C=null, actual=0, vistaPrevia=null;
let rec=null, trozos=[], flujo=null, ctxAudio=null, analizador=null, rafId=null;
let segundos=0, reloj=null, blob=null, modoTexto=false, alParar=null;

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $=id=>document.getElementById(id);
const q=i=>C.preguntas[i];
const est=i=>C.estado[String(i+1)]||{fragmentos:[],saltada:false};
const contestada=i=>est(i).fragmentos.length>0;
const resuelta=i=>contestada(i)||est(i).saltada;

async function cargar(){
  try{
    const r=await fetch(`${API}?accion=cuestionario&c=`+encodeURIComponent(codigo),{cache:'no-store'});
    if(!r.ok) throw 0;
    C=await r.json();
  }catch(e){
    T.innerHTML='<h2>Enlace no válido</h2><p class="sub">Revisa que has abierto el enlace completo del correo. Si el problema sigue, escríbenos.</p>';
    return;
  }
  const empezado=C.preguntas.some((_,i)=>resuelta(i));
  if(!empezado) return bienvenida();
  const p=primeraPendiente();
  p===-1?deVuelta():pregunta(p,true);
}

function deVuelta(){
  limpiarGrabacion();
  const ultima=C.preguntas.length-1;
  T.innerHTML=`
    <h1>Hola de nuevo, ${esc(C.nombre)}</h1>
    <p style="margin-top:14px">Ya contestaste todas las preguntas. Si te has acordado de algo, cuéntalo: se sumará a lo que ya nos dijiste, sin borrar nada.</p>
    <div class="acciones">
      <button class="btn btn-primario" id="nuevo">Contar algo nuevo</button>
      <button class="btn btn-sec" id="concreta">Añadir a una pregunta concreta</button>
    </div>`;
  $('nuevo').onclick=()=>pregunta(ultima);
  $('concreta').onclick=indice;
}
function primeraPendiente(){return C.preguntas.findIndex((_,i)=>!resuelta(i))}

function bienvenida(){
  T.innerHTML=`
    <h1>Hola, ${esc(C.nombre)}</h1>
    <p class="sub">${esc(C.titulo)} · ${C.preguntas.length} preguntas</p>
    <p style="margin-top:20px">${esc(C.intro)}</p>
    <p style="margin-top:12px">📱 Puedes hacerlo desde el móvil o desde el ordenador, como te resulte más cómodo. Incluso empezar en uno y terminar en otro: abre este mismo enlace y seguirás donde lo dejaste.</p>
    <p class="nota">${esc(C.privacidad)}</p>
    <p class="firma">${esc(C.firma)}</p>
    <div class="acciones"><button class="btn btn-primario" id="seguir">Continuar</button></div>`;
  $('seguir').onclick=()=>instrucciones(()=>pruebaMic(()=>pregunta(0)));
}

function pruebaMic(despues,mensaje){
  limpiarGrabacion();
  T.innerHTML=`
    <h2>Primero, probemos el micrófono</h2>
    <p style="margin-top:12px">Pulsa el micrófono, di tu nombre y la ciudad desde la que contestas, y vuelve a pulsarlo. Después escúchate.</p>
    <div class="grabador">
      <button class="mic" id="pmic" aria-label="Probar micrófono">${SVG_MIC}</button>
      <div class="ondas" id="ondas">${'<i></i>'.repeat(24)}</div>
      <div class="estado-txt" id="pest">Pulsa el micrófono para empezar la prueba.</div>
      <audio id="preprod" class="oculto" controls></audio>
    </div>
    <div id="aviso"></div>
    <div class="acciones oculto" id="pacc">
      <button class="btn btn-primario" id="psi">Me oigo bien, empezamos</button>
      <button class="btn btn-sec" id="pno">No me oigo</button>
    </div>
    <div class="acciones"><span style="flex:1"></span><button class="btn-link" id="pescribir">Prefiero contestar por escrito</button></div>`;
  let maximo=0;
  if(mensaje) aviso(mensaje);
  $('pescribir').onclick=despues;
  $('psi').onclick=()=>{ try{localStorage.setItem('race-mic-ok','1')}catch(e){} limpiarGrabacion(); despues(); };
  $('pno').onclick=()=>{ pruebaMic(despues,'Comprueba que el navegador tiene permiso para usar el micrófono (el icono del candado o del micrófono junto a la dirección), que no está silenciado y, si usas auriculares, que están conectados. Luego vuelve a probar. Si sigue sin funcionar, prueba desde el móvil o contesta por escrito.'); };
  $('pmic').onclick=async()=>{
    const mic=$('pmic');
    if(rec && rec.state==='recording'){ rec.stop(); return; }
    try{ flujo=await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch(e){ return aviso('El navegador no nos deja usar el micrófono. Pulsa el icono del candado o del micrófono junto a la dirección, permite el micrófono y recarga la página. También puedes contestar por escrito.'); }
    const tipo=tipoSoportado();
    rec=new MediaRecorder(flujo, tipo?{mimeType:tipo}:undefined); trozos=[];
    rec.ondataavailable=e=>{ if(e.data.size) trozos.push(e.data); };
    rec.onstop=()=>{
      const b=new Blob(trozos,{type:(rec.mimeType||'audio/webm').split(';')[0]});
      pararMedidor();
      mic.classList.remove('grabando'); mic.innerHTML=SVG_MIC;
      if(maximo<25){
        aviso('No hemos captado tu voz: parece que el micrófono no recoge sonido. Revisa que no esté silenciado o que el navegador use el micrófono correcto, y vuelve a probar.');
        rec=null; $('pest').textContent='Pulsa el micrófono para repetir la prueba.'; return;
      }
      const a=$('preprod'); a.src=URL.createObjectURL(b); a.classList.remove('oculto');
      $('pest').textContent='Escúchate. ¿Se te oye bien?';
      $('pacc').classList.remove('oculto'); rec=null;
    };
    rec.start(500); maximo=0; aviso('');
    medidor((v)=>{ if(v>maximo) maximo=v; });
    mic.classList.add('grabando'); mic.innerHTML=SVG_PAUSA;
    $('pest').textContent='Grabando… Di tu nombre y pulsa de nuevo para terminar.';
  };
}

function instrucciones(volver){
  limpiarGrabacion();
  T.innerHTML=`
    <h2>Cómo funciona</h2>
    <ul class="instr">
      <li><span class="ic">🎙</span><div><b>Pulsa el micrófono, habla y pulsa «Enviar y seguir».</b><p>Así de sencillo. Si necesitas pensar, pulsa otra vez el micrófono para hacer una pausa. Si quieres escucharte antes de enviarlo, usa «Parar y escucharlo». Si lo prefieres, también puedes escribir.</p></div></li>
      <li><span class="ic">↩</span><div><b>Si te olvidas de algo, vuelve atrás.</b><p>Con «Anterior» o desde el índice puedes ir a cualquier pregunta y añadir lo que quieras. Lo que ya grabaste no se pierde: se suma.</p></div></li>
      <li><span class="ic">💬</span><div><b>Habla con naturalidad.</b><p>No te preocupes por la precisión ni por el orden: te vamos a entender perfectamente. No hace falta ceñirse a la pregunta; si en cualquier momento te acuerdas de algo, aunque sea de otro tema, cuéntalo ahí mismo, como harías hablando con una persona.</p></div></li>
    </ul>
    <p class="nota">Puedes dejarlo a medias y seguir otro día con el mismo enlace, desde el móvil o desde el ordenador. Estas instrucciones están siempre en el botón «?».</p>
    <div class="acciones"><button class="btn btn-primario" id="ok">Entendido</button></div>`;
  $('ok').onclick=volver;
}

function cabecera(i){
  const total=C.preguntas.length, hechas=C.preguntas.filter((_,k)=>resuelta(k)).length;
  return `<div class="barra-sup">
      <div class="progreso"><div class="barra"><div class="relleno" style="width:${hechas/total*100}%"></div></div>
        <span>${i===null?'Índice':`Pregunta ${i+1} de ${total}`}</span></div>
      <button class="btn-indice" id="verIndice">Índice</button>
      <button class="icono" id="ayuda" aria-label="Instrucciones">?</button>
    </div>`;
}
function enlazarCabecera(i){
  $('verIndice').onclick=()=>indice();
  $('ayuda').onclick=()=>instrucciones(()=>i===null?indice():pregunta(i));
}

function indice(){
  limpiarGrabacion();
  const filas=C.preguntas.map((p,i)=>{
    const e=est(i);
    const chip=e.fragmentos.length?`<span class="chip ok">Contestada${e.fragmentos.length>1?' · '+e.fragmentos.length:''}</span>`
      :e.saltada?'<span class="chip salt">Saltada</span>':'<span class="chip pend">Pendiente</span>';
    return `<li data-i="${i}"><span class="num">${i+1}</span><span class="txt">${esc(p.texto)}</span>${chip}</li>`;
  }).join('');
  T.innerHTML=cabecera(null)+`<h2>Todas las preguntas</h2>
    <p class="sub">Toca cualquiera para contestarla o para añadir algo.</p>
    <ul class="indice">${filas}</ul>
    <div class="acciones"><button class="btn btn-sec" id="volver">Volver</button></div>`;
  enlazarCabecera(null);
  $('verIndice').classList.add('oculto');
  document.querySelectorAll('.indice li').forEach(li=>li.onclick=()=>pregunta(+li.dataset.i));
  $('volver').onclick=()=>{ const p=primeraPendiente(); p===-1?fin():pregunta(p); };
}

function fragmentosHTML(i){
  const fr=est(i).fragmentos; if(!fr.length) return '';
  return `<div class="previas"><h3>Lo que ya has contado</h3>${fr.map((f,k)=>`
    <div class="frag"><div class="meta">${k+1}.º · ${f.tipo==='audio'?'audio':'texto'} · ${new Date(f.fecha).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    ${f.tipo==='audio'?`<audio controls preload="none" src="${API}?accion=audio&c=${encodeURIComponent(codigo)}&f=${encodeURIComponent(f.fichero)}"></audio>`:`<div class="tx">${esc(f.texto||'')}</div>`}</div>`).join('')}</div>`;
}

function pregunta(i,retoma=false){
  actual=i; blob=null; segundos=0; modoTexto=false; limpiarGrabacion();
  const P=q(i), ya=contestada(i);
  T.innerHTML=cabecera(i)+`
    ${retoma?'<p class="sub" style="margin-bottom:12px">Bienvenido de nuevo. Seguimos por donde lo dejaste.</p>':''}
    ${P.bloque?`<div class="bloque">${esc(P.bloque)}</div>`:''}
    <h2>${esc(P.texto)}</h2>
    ${P.abierta&&!ya?'<p class="pista">Pregunta abierta: si no tienes nada que añadir, pulsa «Saltar».</p>':''}
    ${fragmentosHTML(i)}
    <div id="zonaVoz">
      <div class="grabador">
        <button class="mic" id="mic" aria-label="Grabar">${SVG_MIC}</button>
        <div class="ondas" id="ondas">${'<i></i>'.repeat(24)}</div>
        <div class="tiempo" id="tiempo">0:00</div>
        <div class="estado-txt" id="estadoTxt">${ya?'Pulsa el micrófono para añadir algo más.':'Pulsa el micrófono y habla.'}</div>
        <div class="controles"><button class="btn-link oculto" id="terminar">Parar y escucharlo antes de enviar</button></div>
        <audio id="reprod" class="oculto" controls></audio>
      </div>
    </div>
    <div id="zonaTexto" class="oculto"><textarea id="texto" placeholder="Escribe aquí…"></textarea></div>
    <div id="aviso"></div>
    <div class="acciones">
      ${i>0?'<button class="btn btn-sec" id="anterior">← Anterior</button>':''}
      <button class="btn btn-primario" id="enviar" disabled>${ya?'Añadir y seguir':'Enviar y seguir'}</button>
      ${ya?'<button class="btn btn-sec" id="siguiente">Siguiente →</button>':''}
      <button class="btn btn-sec oculto" id="regrabar">Volver a grabar</button>
      <span style="flex:1"></span>
      <button class="btn-link" id="alternar">Prefiero escribir</button>
      ${ya?'':'<button class="btn-link" id="saltar">Saltar</button>'}
    </div>`;
  enlazarCabecera(i);
  $('mic').onclick=pulsarMic;
  $('terminar').onclick=terminar;
  $('regrabar').onclick=()=>pregunta(i);
  $('enviar').onclick=enviar;
  if($('anterior')) $('anterior').onclick=()=>pregunta(i-1);
  if($('siguiente')) $('siguiente').onclick=()=>irDespues(i);
  if($('saltar')) $('saltar').onclick=saltar;
  $('alternar').onclick=()=>{
    modoTexto=!modoTexto;
    if(modoTexto && rec && rec.state!=='inactive') terminar();
    $('zonaVoz').classList.toggle('oculto',modoTexto);
    $('zonaTexto').classList.toggle('oculto',!modoTexto);
    $('regrabar').classList.add('oculto');
    $('alternar').textContent=modoTexto?'Prefiero hablar':'Prefiero escribir';
    $('enviar').disabled=modoTexto?!$('texto').value.trim():!blob;
    if(modoTexto) $('texto').focus();
  };
  $('texto').oninput=e=>{ if(modoTexto) $('enviar').disabled=!e.target.value.trim(); };
}

function tipoSoportado(){
  for(const t of ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'])
    if(window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

async function pulsarMic(){
  const mic=$('mic'), txt=$('estadoTxt');
  if(!rec){
    try{ flujo=await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch(e){ return aviso('No hemos podido usar el micrófono. Revisa el permiso del navegador o pulsa «Prefiero escribir».'); }
    const tipo=tipoSoportado();
    rec=new MediaRecorder(flujo, Object.assign({audioBitsPerSecond:48000}, tipo?{mimeType:tipo}:{}));
    trozos=[];
    rec.ondataavailable=e=>{ if(e.data.size) trozos.push(e.data); };
    rec.onstop=()=>{
      blob=new Blob(trozos,{type:(rec.mimeType||'audio/webm').split(';')[0]});
      if(alParar){ const f=alParar; alParar=null; pararMedidor(); return f(); }
      const a=$('reprod'); a.src=URL.createObjectURL(blob); a.classList.remove('oculto');
      $('enviar').disabled=false;
      $('regrabar').classList.remove('oculto');
      $('terminar').classList.add('oculto');
      mic.classList.remove('grabando','pausado'); mic.disabled=true; mic.style.opacity=.35;
      txt.textContent='Escúchalo si quieres. Si te vale, pulsa «Enviar y seguir»; si no, «Volver a grabar».';
      pararMedidor();
    };
    rec.start(1000);
    medidor(); arrancarReloj();
    mic.classList.add('grabando'); mic.innerHTML=SVG_PAUSA; mic.setAttribute('aria-label','Pausar');
    $('terminar').classList.remove('oculto');
    $('enviar').disabled=false;
    txt.textContent='Grabando. Cuando acabes, pulsa «Enviar y seguir».';
  } else if(rec.state==='recording'){
    rec.pause(); pararReloj();
    mic.classList.replace('grabando','pausado'); mic.innerHTML=SVG_MIC; mic.setAttribute('aria-label','Continuar');
    txt.textContent='En pausa. Pulsa el micrófono para seguir hablando, o «Enviar y seguir» si ya has terminado.';
  } else if(rec.state==='paused'){
    rec.resume(); arrancarReloj();
    mic.classList.replace('pausado','grabando'); mic.innerHTML=SVG_PAUSA; mic.setAttribute('aria-label','Pausar');
    txt.textContent='Grabando. Cuando acabes, pulsa «Enviar y seguir».';
  }
}
function terminar(){ if(rec && rec.state!=='inactive'){ rec.stop(); pararReloj(); } }

const MAX_SEG=30*60;
function arrancarReloj(){ pararReloj(); reloj=setInterval(()=>{ segundos++;
  if(segundos>=MAX_SEG && rec && rec.state==='recording'){ terminar(); aviso('Llevas media hora grabando en esta pregunta. Envíala y, si quieres seguir, vuelve a ella con «Añadir algo más».'); } const el=$('tiempo'); if(el) el.textContent=Math.floor(segundos/60)+':'+String(segundos%60).padStart(2,'0'); },1000); }
function pararReloj(){ clearInterval(reloj); reloj=null; }

function medidor(alNivel){
  try{
    ctxAudio=new (window.AudioContext||window.webkitAudioContext)();
    analizador=ctxAudio.createAnalyser(); analizador.fftSize=64;
    ctxAudio.createMediaStreamSource(flujo).connect(analizador);
    const datos=new Uint8Array(analizador.frequencyBinCount);
    const barras=[...document.querySelectorAll('#ondas i')];
    const pinta=()=>{
      analizador.getByteFrequencyData(datos);
      const activo=rec && rec.state==='recording';
      if(activo && alNivel) alNivel(Math.max(...datos));
      barras.forEach((b,k)=>{ const v=activo?datos[(k+2)%datos.length]/255:0; b.style.height=(4+v*30)+'px'; });
      rafId=requestAnimationFrame(pinta);
    };
    pinta();
  }catch(e){}
}
function pararMedidor(){
  cancelAnimationFrame(rafId);
  document.querySelectorAll('#ondas i').forEach(b=>b.style.height='4px');
  if(flujo) flujo.getTracks().forEach(t=>t.stop());
  if(ctxAudio) ctxAudio.close().catch(()=>{});
}
function limpiarGrabacion(){
  if(rec && rec.state!=='inactive'){ rec.onstop=null; rec.stop(); }
  pararReloj(); cancelAnimationFrame(rafId);
  if(flujo) flujo.getTracks().forEach(t=>t.stop());
  if(ctxAudio) ctxAudio.close().catch(()=>{});
  rec=null; flujo=null; ctxAudio=null;
}

function aviso(m){ $('aviso').innerHTML=m?`<div class="aviso">${esc(m)}</div>`:''; }

async function enviar(){
  const b=$('enviar'); b.disabled=true; b.textContent='Enviando…'; aviso('');
  if(!modoTexto && rec && rec.state!=='inactive'){ await new Promise(r=>{ alParar=r; rec.stop(); pararReloj(); }); }
  const cuerpo=modoTexto?$('texto').value.trim():blob;
  const tipo=modoTexto?'text/plain; charset=utf-8':(blob.type||'audio/webm');
  try{
    const r=await fetch(`${API}?accion=respuesta&c=${encodeURIComponent(codigo)}&n=${actual}`,{method:'POST',headers:{'Content-Type':tipo},body:cuerpo});
    if(!r.ok) throw 0;
    C.estado=(await r.json()).estado;
    irDespues(actual);
  }catch(e){
    b.disabled=false; b.textContent='Enviar y seguir';
    aviso('No se ha podido enviar. Comprueba la conexión y vuelve a intentarlo: tu grabación sigue aquí.');
  }
}
async function saltar(){
  limpiarGrabacion();
  try{
    const r=await fetch(`${API}?accion=saltar&c=${encodeURIComponent(codigo)}&n=${actual}`,{method:'POST'});
    C.estado=(await r.json()).estado;
  }catch(e){}
  irDespues(actual);
}
function irDespues(i){
  const sig=C.preguntas.findIndex((_,k)=>k>i&&!resuelta(k));
  if(sig!==-1) return pregunta(sig);
  const p=primeraPendiente();
  p===-1?fin():pregunta(p);
}

function fin(){
  limpiarGrabacion();
  T.innerHTML=`
    <div class="check">${SVG_OK}</div>
    <h1>Gracias, ${esc(C.nombre)}</h1>
    <p style="margin-top:14px">Tus respuestas ya están con nosotros. Las vamos a estudiar una a una, con todo el rigor y la atención que merecen, para construir contigo algo que de verdad te haga el trabajo más fácil.</p>
    <p style="margin-top:12px">Te enviaremos un resumen para que confirmes que te hemos entendido bien. Esto no ha hecho más que empezar.</p>
    <p class="nota">Si te acuerdas de algo más, vuelve cuando quieras con el mismo enlace y añádelo a cualquier pregunta.</p>
    <p class="firma">${esc(C.firma)}</p>
    <div class="acciones"><button class="btn btn-sec" id="revisar">Revisar o añadir algo</button></div>`;
  $('revisar').onclick=indice;
}

cargar();
