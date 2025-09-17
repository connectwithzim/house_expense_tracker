// Firebase (ESM via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy,
  onSnapshot, serverTimestamp, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

// --- Config ---
const firebaseConfig = {
  apiKey: "AIzaSyDwP_AusU7Rar2aguy0DVGGlravF9q2D1g",
  authDomain: "house-expenditure-calculator.firebaseapp.com",
  projectId: "house-expenditure-calculator",
  storageBucket: "house-expenditure-calculator.firebasestorage.app",
  messagingSenderId: "209030650549",
  appId: "1:209030650549:web:de2eae21574b9023f1bcfc",
  measurementId: "G-0HV7FPY7ME"
};

const PEOPLE = ['Tayyab','Islam','Mahmur','Guest'];
const CURRENCY = '₺';

// --- Init ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
signInAnonymously(auth).catch(e => console.error('Anon sign-in error', e));

// --- Collections ---
const txCol = collection(db, 'transactions');

// --- Helpers ---
const $ = s => document.querySelector(s);
const el = (t, cls, html) => { const e = document.createElement(t); if (cls) e.className = cls; if (html!==undefined) e.innerHTML = html; return e; };

// --- Tabs: remember last opened ---
function activateTab(key){
  document.querySelectorAll('.tab').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === key);
  });
  document.querySelectorAll('.tabview').forEach(v => v.style.display='none');
  const view = document.querySelector('#tab-'+key);
  if (view) view.style.display='block';
  localStorage.setItem('lastTab', key);
}
document.querySelectorAll('.tab').forEach(btn =>
  btn.addEventListener('click', () => activateTab(btn.dataset.tab))
);
const savedTab = localStorage.getItem('lastTab');
activateTab(savedTab && document.querySelector('#tab-'+savedTab) ? savedTab : 'add');

// --- People controls ---
function renderPeopleControls() {
  const paidSel = $('#paidBy');
  const fromSel = $('#from');
  const toSel   = $('#to');
  paidSel.innerHTML = PEOPLE.map(p=>`<option value="${p}">Who Paid: ${p}</option>`).join('');
  fromSel.innerHTML = PEOPLE.map(p=>`<option value="${p}">From: ${p}</option>`).join('');
  toSel.innerHTML   = PEOPLE.map(p=>`<option value="${p}">To: ${p}</option>`).join('');

  const wrap = $('#splitBetween');
  wrap.innerHTML = '';
  PEOPLE.forEach(name => {
    const b = el('button','pill');
    b.textContent = name;
    b.addEventListener('click', ()=>{b.classList.toggle('active')});
    wrap.appendChild(b);
  });
}
renderPeopleControls();

// --- Add Expense ---
$('#addBtn').addEventListener('click', async () => {
  const amount = parseFloat($('#amount').value);
  const paidBy = $('#paidBy').value;
  const desc = $('#desc').value.trim();
  const splitBetween = Array.from(document.querySelectorAll('#splitBetween .pill.active')).map(b=>b.textContent);

  if (!amount || !paidBy || splitBetween.length === 0) {
    alert('Fill amount, who paid, and at least one split name.');
    return;
  }

  await addDoc(txCol, {
    type: 'Expense',
    amount,
    paidBy,
    splitBetween,      // payer is optional, only selected names are included
    description: desc,
    date: new Date().toISOString(),
    createdAt: serverTimestamp()
  });

  $('#amount').value = '';
  $('#desc').value = '';
  document.querySelectorAll('#splitBetween .pill.active').forEach(b=>b.classList.remove('active'));
});

// --- Record Payment ---
$('#payBtn').addEventListener('click', async () => {
  const amount = parseFloat($('#payAmount').value);
  const from = $('#from').value;
  const to   = $('#to').value;
  const desc = $('#payDesc').value.trim();
  if (!amount || !from || !to || from===to) { alert('Enter amount and valid From → To.'); return; }
  await addDoc(txCol, { type:'Payment', amount, from, to, description:desc, date: new Date().toISOString(), createdAt: serverTimestamp() });
  $('#payAmount').value=''; $('#payDesc').value='';
});

// --- Clear all (owner only) ---
$('#clearAll').addEventListener('click', async () => {
  if (!confirm('Really delete ALL transactions?')) return;
  const snap = await getDocs(query(txCol));
  const promises = [];
  snap.forEach(d=> promises.push(deleteDoc(doc(db,'transactions',d.id))));
  await Promise.all(promises);
});

// --- History delete: delegated (set once) ---
const tbody = $('#historyTable tbody');
tbody.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-del]');
  if (!btn) return;
  const id = btn.getAttribute('data-del');
  if (!confirm('Delete this transaction?')) return;
  await deleteDoc(doc(db, 'transactions', id));
});

// --- Live updates ---
onSnapshot(query(txCol, orderBy('createdAt','desc')), (snap)=>{
  const txs = [];
  snap.forEach(d=> txs.push({id:d.id, ...d.data()}));

  // History table
  tbody.innerHTML = '';
  const right = (n)=>`${CURRENCY}${Number(n).toFixed(2)}`;
  txs.forEach(t=>{
    const tr = el('tr');
    const when = new Date(t.date||Date.now()).toISOString().slice(0,10);
    const badge = t.type==='Expense' ? '<span class="badge expense">Expense</span>' : '<span class="badge payment">Payment</span>';
    const toSplit = t.type==='Expense' ? (t.splitBetween||[]).join(', ') : (t.to||'');
    tr.innerHTML = `
      <td>${when}</td>
      <td>${badge}</td>
      <td>${t.description||''}</td>
      <td class="right">${right(t.amount)}</td>
      <td>${t.paidBy||t.from||''}</td>
      <td>${toSplit}</td>
      <td class="right"><button class="pill danger" data-del="${t.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Balances matrix owes[i][j] meaning i owes j
  const idx = Object.fromEntries(PEOPLE.map((p,i)=>[p,i]));
  const n = PEOPLE.length; const owes = Array.from({length:n},()=>Array(n).fill(0));

  txs.slice().reverse().forEach(t => {
    if (t.type === 'Expense') {
      const inc = Array.isArray(t.splitBetween)
        ? t.splitBetween.filter(n => PEOPLE.includes(n))
        : [];
      if (inc.length === 0) return;              // prevent divide-by-zero
      const j = idx[t.paidBy]; if (j == null) return;

      const share = Number(t.amount) / inc.length;
      inc.forEach(name => {
        const i = idx[name];
        if (i == null || i === j) return;        // don't owe self
        owes[i][j] += share;
      });

    } else if (t.type === 'Payment') {
      const i = idx[t.from], j = idx[t.to];
      if (i != null && j != null) owes[i][j] -= (Number(t.amount) || 0);
    }
  });

  // Render mini-balance cards
  const box = $('#balances');
  box.innerHTML = '';
  PEOPLE.forEach((p, i) => {
    const card = el('div','mini');
    card.innerHTML = `<h4>${p}</h4>`;
    PEOPLE.forEach((q, j) => {
      if (i === j) return;
      const net = owes[i][j] - owes[j][i];  // +ve: p owes q
      if (Math.abs(net) < 0.01) return;
      const row = el('div','line');
      if (net > 0) row.innerHTML = `Owes ${q}: <span class="amt-neg">${CURRENCY}${Math.abs(net).toFixed(2)}</span>`;
      else         row.innerHTML = `${q} owes me: <span class="amt-pos">${CURRENCY}${Math.abs(net).toFixed(2)}</span>`;
      card.appendChild(row);
    });
    box.appendChild(card);
  });

  // ---- Settle Up Suggestions ----
  const net = PEOPLE.map(()=>0); // +ve: owes overall, -ve: should receive
  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      net[i] += owes[i][j] - owes[j][i];
    }
  }
  const debtors = [], creditors = [];
  net.forEach((v, i) => {
    const c = Math.round(v * 100) / 100;
    if (c > 0.01)  debtors.push({ i, amt: c });
    else if (c < -0.01) creditors.push({ i, amt: -c });
  });
  // sort biggest first (optional, helps greedy)
  debtors.sort((a,b)=>b.amt-a.amt);
  creditors.sort((a,b)=>b.amt-a.amt);

  const transfers = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length){
    const pay = Math.min(debtors[di].amt, creditors[ci].amt);
    transfers.push({ from: PEOPLE[debtors[di].i], to: PEOPLE[creditors[ci].i], amount: pay });
    debtors[di].amt   = Math.round((debtors[di].amt - pay) * 100) / 100;
    creditors[ci].amt = Math.round((creditors[ci].amt - pay) * 100) / 100;
    if (debtors[di].amt   <= 0.01) di++;
    if (creditors[ci].amt <= 0.01) ci++;
  }

  const settleBox = $('#settle');
  if (settleBox){
    settleBox.innerHTML = '';
    if (transfers.length === 0){
      settleBox.innerHTML = `<p style="margin:0;color:var(--sub)">All settled up 🎉</p>`;
    } else {
      transfers.forEach(t => {
        const row = el('div','settle-row');
        row.innerHTML = `
          <span>${t.from} → ${t.to}</span>
          <span class="right"><b>${CURRENCY}${t.amount.toFixed(2)}</b></span>
          <button class="pill primary" data-settle="${t.from}|${t.to}|${t.amount.toFixed(2)}">Record</button>
        `;
        settleBox.appendChild(row);
      });
      settleBox.onclick = async (ev) => {
        const btn = ev.target.closest('[data-settle]');
        if (!btn) return;
        const [from, to, amount] = btn.dataset.settle.split('|');
        await addDoc(txCol, {
          type: 'Payment',
          amount: Number(amount),
          from, to,
          description: 'Settle up',
          date: new Date().toISOString(),
          createdAt: serverTimestamp()
        });
      };
    }
  }

  // ---- Totals by Person (split share only; payer optional) ----
  const byPerson = Object.fromEntries(
    PEOPLE.map(p => [p, { w1:0, w2:0, w3:0, w4:0, month:0, lastMonth:0, prev2Month:0 }])
  );
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const startThisMonth  = new Date(y, m, 1);
  const startNextMonth  = new Date(y, m + 1, 1);
  const startLastMonth  = new Date(y, m - 1, 1);
  const startPrev2Month = new Date(y, m - 2, 1);
  const weekOfMonth = (d) => (d.getDate()<=7?1:d.getDate()<=14?2:d.getDate()<=21?3:4);

  const arrify = (x) => Array.isArray(x) ? x.slice() : (typeof x==='string' ? x.split(',').map(s=>s.trim()).filter(Boolean) : []);
  const getIncluded = (t) => arrify(t.splitBetween).filter(n => PEOPLE.includes(n));
  const addShare = (inc, amt, fn) => {
    if (!inc.length) return;
    const share = amt / inc.length;
    inc.forEach(n => fn(n, share));
  };

  txs.forEach(t => {
    if (t.type !== 'Expense') return;
    const when = new Date(t.date || Date.now());
    const amt  = Number(t.amount) || 0;
    const inc  = getIncluded(t);
    if (inc.length === 0 || !isFinite(amt) || amt <= 0) return;

    if (when >= startThisMonth && when < startNextMonth) {
      const w = weekOfMonth(when);
      addShare(inc, amt, (name, share) => { byPerson[name][`w${w}`] += share; byPerson[name].month += share; });
    }
    if (when >= startLastMonth && when < startThisMonth) {
      addShare(inc, amt, (name, share) => { byPerson[name].lastMonth += share; });
    }
    if (when >= startPrev2Month && when < startLastMonth) {
      addShare(inc, amt, (name, share) => { byPerson[name].prev2Month += share; });
    }
  });

  const totals = $('#totals');
  totals.innerHTML = '';
  PEOPLE.forEach(p => {
    const d = byPerson[p];
    const card = el('div','mini');
    card.innerHTML = `
      <h4>${p}</h4>
      <div class="rowline"><span>1st week:</span><b>${CURRENCY}${d.w1.toFixed(2)}</b></div>
      <div class="rowline"><span>2nd week:</span><b>${CURRENCY}${d.w2.toFixed(2)}</b></div>
      <div class="rowline"><span>3rd week:</span><b>${CURRENCY}${d.w3.toFixed(2)}</b></div>
      <div class="rowline"><span>4th week:</span><b>${CURRENCY}${d.w4.toFixed(2)}</b></div>
      <div class="rowline"><span>This month:</span><b>${CURRENCY}${d.month.toFixed(2)}</b></div>
      <div class="rowline"><span>Last Month:</span><b>${CURRENCY}${d.lastMonth.toFixed(2)}</b></div>
      <div class="rowline"><span>2nd Last Month:</span><b>${CURRENCY}${d.prev2Month.toFixed(2)}</b></div>
    `;
    totals.appendChild(card);
  });
});
