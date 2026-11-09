const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const KEY = "vocab.decks";
let decks = load(), cur = null, queue = [], total = 0;

function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(decks)); return true; } catch { alert("Stockage plein : exporte tes listes puis supprime-en."); return false; } }
function show(id){ document.querySelectorAll("main>section").forEach(s => s.hidden = s.id !== id); window.scrollTo(0,0); }

function renderHome(){
  const el = $("#decks");
  el.innerHTML = decks.length ? decks.map(d => `<div class="deck"><b>${esc(d.title)}<small>${d.cards.length} cartes</small></b>
    <button data-a="study" data-id="${d.id}">Réviser</button><button class="ghost" data-a="edit" data-id="${d.id}">Modifier</button><button class="ghost" data-a="del" data-id="${d.id}" aria-label="Supprimer">✕</button></div>`).join("")
    : `<p class="empty">Aucune liste pour l’instant. Prends une page en photo pour commencer.</p>`;
  show("home");
}
$("#decks").onclick = e => {
  const b = e.target.closest("button"); if(!b) return;
  const d = decks.find(x => x.id === b.dataset.id); if(!d) return;
  if(b.dataset.a === "study") startStudy(d);
  if(b.dataset.a === "edit"){ cur = JSON.parse(JSON.stringify(d)); renderEdit(); }
  if(b.dataset.a === "del" && confirm(`Supprimer « ${d.title} » ?`)){ decks = decks.filter(x => x !== d); save(); renderHome(); }
};

// Photo → réduction → API
function resize(file, max = 1600){
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = img.width * r; c.height = img.height * r;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .85).split(",")[1]);
    };
    img.onerror = () => ko(new Error("Image illisible."));
    img.src = url;
  });
}
$("#file").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  $("#homeErr").hidden = true; show("loading");
  try{
    const image = await resize(f);
    const r = await fetch("api.php", { method:"POST", headers:{"Content-Type":"application/json","X-Requested-With":"vocab"}, body: JSON.stringify({ image, consent: CONSENT_V }) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || "Erreur du serveur.");
    cur = { id: null, title: j.title || "Nouvelle liste", cards: j.cards.map(c => ({ front: c.front, back: c.back })) };
    renderEdit();
  }catch(err){ renderHome(); $("#homeErr").textContent = err.message; $("#homeErr").hidden = false; }
};

// Vérification
function renderEdit(){
  $("#etitle").value = cur.title;
  $("#ecards").innerHTML = cur.cards.map((c,i) => `<div class="edit"><textarea rows="1" data-i="${i}" data-k="front" aria-label="Recto">${esc(c.front)}</textarea><textarea rows="1" data-i="${i}" data-k="back" aria-label="Verso">${esc(c.back)}</textarea><button data-del="${i}" aria-label="Supprimer la carte">✕</button></div>`).join("");
  show("edit");
  requestAnimationFrame(() => document.querySelectorAll("#ecards textarea").forEach(autosize));
}
function autosize(t){ t.style.height = "auto"; t.style.height = t.scrollHeight + 4 + "px"; }
window.addEventListener("resize", () => document.querySelectorAll("#ecards textarea").forEach(autosize));
$("#etitle").oninput = e => cur.title = e.target.value;
$("#ecards").oninput = e => { const t = e.target; if(t.dataset.k){ cur.cards[t.dataset.i][t.dataset.k] = t.value; autosize(t); } };
$("#ecards").onclick = e => { const b = e.target.closest("[data-del]"); if(b){ cur.cards.splice(+b.dataset.del, 1); renderEdit(); } };
$("#add").onclick = () => { cur.cards.push({front:"",back:""}); renderEdit(); $("#ecards").lastElementChild.querySelector("textarea").focus(); };
$("#cancel").onclick = renderHome;
$("#saveStudy").onclick = () => {
  cur.cards = cur.cards.filter(c => c.front.trim() || c.back.trim());
  if(!cur.cards.length) return alert("Ajoute au moins une carte.");
  cur.title = cur.title.trim() || "Ma liste";
  if(cur.id){ decks = decks.map(d => d.id === cur.id ? cur : d); } else { cur.id = Date.now().toString(36); decks.unshift(cur); }
  if(save()) startStudy(cur);
};

// Révision
let flipped = false;
let reversed = localStorage.getItem("vocab.reversed") === "1";
function renderDir(){ const b = $("#rev"); b.textContent = reversed ? "Droite → gauche ⇄" : "Gauche → droite ⇄"; b.setAttribute("aria-pressed", reversed); }
$("#rev").onclick = () => { reversed = !reversed; try { localStorage.setItem("vocab.reversed", reversed ? "1" : "0"); } catch {} renderDir(); if(queue.length) next(); };
renderDir();
function startStudy(d){ cur = d; queue = d.cards.map(c => c).sort(() => Math.random() - .5); total = queue.length; missed = 0; next(); show("study"); }
let missed = 0;
function next(){
  if(!queue.length){ $("#doneTxt").textContent = missed ? `${total} cartes sues, dont ${missed} revues après une erreur.` : `Les ${total} cartes étaient sues du premier coup.`; return show("done"); }
  flipped = false; $("#card").classList.remove("flip"); $("#judge").classList.add("invisible"); $("#hint").classList.remove("invisible");
  $("#fr").textContent = queue[0][reversed ? "back" : "front"]; $("#bk").textContent = queue[0][reversed ? "front" : "back"];
  $("#count").textContent = `${total - queue.length + 1} / ${total}`;
  $("#prog").style.width = ((total - queue.length) / total * 100) + "%";
}
function flip(){ flipped = !flipped; $("#card").classList.toggle("flip", flipped); if(flipped){ $("#judge").classList.remove("invisible"); $("#hint").classList.add("invisible"); } }
$("#card").onclick = flip;
$("#got").onclick = () => { queue.shift(); next(); };
$("#miss").onclick = () => { missed++; queue.push(queue.shift()); next(); };
$("#quit").onclick = renderHome; $("#home2").onclick = renderHome;
$("#again").onclick = () => startStudy(cur);

// Export / import
$("#exp").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(decks, null, 2)], {type:"application/json"}));
  a.download = "vocab-listes.json"; a.click();
};
$("#imp").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  try{
    const arr = JSON.parse(await f.text());
    if(!Array.isArray(arr)) throw 0;
    arr.forEach(d => { if(d && d.title && Array.isArray(d.cards) && !decks.some(x => x.id === d.id)) decks.push({ id: d.id || Date.now().toString(36) + Math.random().toString(36).slice(2,5), title: d.title, cards: d.cards.map(c => ({front:String(c.front), back:String(c.back)})) }); });
    save(); renderHome();
  }catch{ alert("Ce fichier n’est pas une sauvegarde Vocab valide."); }
};

// Consentement : l'utilisateur doit confirmer ses engagements avant tout envoi à Google
const CONSENT_V = 1; // à incrémenter si le texte de l'écran de consentement change (même valeur dans api.php)
let sessionConsent = false, afterConsent = false;
function hasConsent(){ try { const c = JSON.parse(localStorage.getItem("vocab.consent")); if(c && c.v === CONSENT_V) return true; } catch {} return sessionConsent; }
function updateConsentBtn(){ $("#consentYes").disabled = ![...document.querySelectorAll(".ck")].every(c => c.checked); }
function showConsent(fromUpload){
  afterConsent = fromUpload; const ok = hasConsent();
  document.querySelectorAll(".ck").forEach(c => c.checked = ok);
  $("#consentRevoke").hidden = !ok; updateConsentBtn(); show("consent");
}
document.querySelectorAll(".ck").forEach(c => c.onchange = updateConsentBtn);
$("#file").addEventListener("click", e => { if(!hasConsent()){ e.preventDefault(); showConsent(true); } });
$("#privacy").onclick = () => showConsent(false);
$("#consentNo").onclick = renderHome;
$("#consentYes").onclick = () => {
  sessionConsent = true;
  try { localStorage.setItem("vocab.consent", JSON.stringify({ v: CONSENT_V, t: new Date().toISOString() })); } catch {}
  renderHome(); if(afterConsent) $("#file").click();
};
$("#consentRevoke").onclick = () => { sessionConsent = false; try { localStorage.removeItem("vocab.consent"); } catch {} renderHome(); };

renderHome();
