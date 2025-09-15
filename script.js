(function () {
  // Helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeCSV = (s) => {
    const str = String(s ?? "");
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  // Storage keys
  const K_TX = "gx.transactions.v1";
  const K_PEOPLE = "gx.people.v1";

  // State
  let TX = load(K_TX) || [];     // unified transactions: type: 'expense' or 'payment'
  let PEOPLE = load(K_PEOPLE) || [];

  // Elements
  const tabs = $$('.tab');
  const panels = $$('.panel');

  // People manager
  const peopleForm = $("#people-form");
  const peopleInput = $("#people-input");
  const peopleList = $("#people-list");

  // Add expense
  const amountInput = $("#amount");
  const payerSelect = $("#payer");
  const descInput = $("#desc");
  const dateInput = $("#date");
  const splitWithBox = $("#split-with");
  const btnSelectAll = $("#btn-select-all");
  const btnClearAll = $("#btn-clear-all");
  const addForm = $("#add-form");
  const btnClearEntries = $("#btn-clear-entries");

  // Pay back
  const payForm = $("#pay-form");
  const payAmount = $("#pay-amount");
  const payFrom = $("#pay-from");
  const payTo = $("#pay-to");
  const payDesc = $("#pay-desc");
  const payDate = $("#pay-date");

  // History
  const filterText = $("#filter-text");
  const filterMonth = $("#filter-month");
  const sortBy = $("#sort-by");
  const tbodyHistory = $("#tbody-history");
  const btnCSV = $("#btn-export-csv");
  const btnBackup = $("#btn-backup-json");
  const inputRestore = $("#input-restore-json");

  // Balances views
  const balancesAdd = $("#balances-add-view");
  const balancesPay = $("#balances-pay-view");
  const balancesHist = $("#balances-history-view");

  // Footer clear
  const btnHardClear = $("#btn-hard-clear");

  // Init
  dateInput.value = todayISO();
  payDate.value = todayISO();
  filterMonth.value = todayISO().slice(0, 7);

  renderPeopleUI();
  renderEverywhere();

  // Tab logic
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      $("#panel-" + id).classList.add('active');
      renderEverywhere();
    });
  });

  // People
  peopleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (peopleInput.value || "").trim();
    if (!name) return;
    if (PEOPLE.includes(name)) return alert("That name already exists.");
    PEOPLE.push(name);
    save(K_PEOPLE, PEOPLE);
    peopleInput.value = "";
    renderPeopleUI();
    renderEverywhere();
  });

  // Quick select/clear for split
  btnSelectAll.addEventListener("click", () => {
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);
  });
  btnClearAll.addEventListener("click", () => {
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = false);
  });

  // Add expense
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = Number(amountInput.value);
    const payer = payerSelect.value;
    const desc = (descInput.value || "").trim();
    const date = dateInput.value || todayISO();
    const splitWith = $$("#split-with input[type=checkbox]").filter(cb => cb.checked).map(cb => cb.value);

    if (!Number.isFinite(amount) || amount <= 0) return alert("Enter a valid amount.");
    if (!payer) return alert("Choose who paid.");
    if (splitWith.length === 0) return alert("Pick at least one person to split with.");
    const t = { id: rid(), type: "expense", amount, desc, date, payer, splitWith };
    TX = [t, ...TX];
    save(K_TX, TX);

    amountInput.value = "";
    descInput.value = "";
    dateInput.value = todayISO();
    // default: check all
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);

    renderEverywhere();
  });

  // Record payment
  payForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = Number(payAmount.value);
    const from = payFrom.value;
    const to = payTo.value;
    const desc = (payDesc.value || "").trim();
    const date = payDate.value || todayISO();
    if (!Number.isFinite(amount) || amount <= 0) return alert("Enter a valid amount.");
    if (!from || !to) return alert("Pick the people involved.");
    if (from === to) return alert("From and To must be different.");
    const t = { id: rid(), type: "payment", amount, desc, date, from, to };
    TX = [t, ...TX];
    save(K_TX, TX);

    payAmount.value = "";
    payDesc.value = "";
    payDate.value = todayISO();
    renderEverywhere();
  });

  // History controls
  filterText.addEventListener("input", renderHistory);
  filterMonth.addEventListener("input", renderAllBalancesAndHistory);
  sortBy.addEventListener("change", renderHistory);

  btnCSV.addEventListener("click", () => {
    const list = filteredTX();
    const header = ["Date","Type","Description","Amount","From","To/Split"];
    const rows = list.map(t => {
      if (t.type === "expense") {
        return [t.date, "Expense", t.desc || "", t.amount, t.payer, (t.splitWith || []).join("|")];
      } else {
        return [t.date, "Payment", t.desc || "", t.amount, t.from, t.to];
      }
    });
    const csv = [header, ...rows].map(r => r.map(escapeCSV).join(",")).join("\n");
    download("transactions.csv", new Blob([csv], { type: "text/csv" }));
  });

  btnBackup.addEventListener("click", () => {
    download("transactions_backup.json", new Blob([JSON.stringify(TX, null, 2)], { type: "application/json" }));
  });

  inputRestore.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("Invalid");
        // Basic sanitize
        const cleaned = arr.map((t) => ({
          id: t.id || rid(),
          type: t.type === "payment" ? "payment" : "expense",
          amount: Number(t.amount) || 0,
          desc: String(t.desc || ""),
          date: String(t.date || todayISO()).slice(0, 10),
          payer: t.payer || undefined,
          splitWith: Array.isArray(t.splitWith) ? t.splitWith.map(String) : undefined,
          from: t.from || undefined,
          to: t.to || undefined,
        }));
        TX = [...cleaned, ...TX];
        save(K_TX, TX);
        renderEverywhere();
      } catch {
        alert("Couldn't import that file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // Hard clear
  btnClearEntries.addEventListener("click", () => {
    if (!confirm("Delete ALL transactions?")) return;
    TX = [];
    save(K_TX, TX);
    renderEverywhere();
  });
  btnHardClear.addEventListener("click", () => {
    if (!confirm("Delete ALL people and transactions?")) return;
    TX = [];
    PEOPLE = [];
    save(K_TX, TX);
    save(K_PEOPLE, PEOPLE);
    renderPeopleUI();
    renderEverywhere();
  });

  // Rendering
  function renderPeopleUI() {
    // chips
    if (!PEOPLE.length) {
      peopleList.className = "people-list muted small";
      peopleList.textContent = "No people yet — add at least one.";
    } else {
      peopleList.className = "people-list";
      peopleList.innerHTML = "";
      PEOPLE.forEach(name => {
        const chip = document.createElement("div");
        chip.className = "person-chip";
        chip.innerHTML = `<span>${esc(name)}</span>`;
        const btn = document.createElement("button"); btn.title = "Remove"; btn.textContent = "✕";
        btn.addEventListener("click", () => {
          if (!confirm(`Remove ${name}?`)) return;
          PEOPLE = PEOPLE.filter(p => p !== name);
          save(K_PEOPLE, PEOPLE);
          renderPeopleUI();
          renderEverywhere();
        });
        chip.appendChild(btn);
        peopleList.appendChild(chip);
      });
    }
    // selects
    [payerSelect, payFrom, payTo].forEach(sel => { sel.innerHTML = ""; });
    PEOPLE.forEach(name => {
      [payerSelect, payFrom, payTo].forEach(sel => {
        const opt = document.createElement("option");
        opt.value = name; opt.textContent = name; sel.appendChild(opt);
      });
    });
    // split checkboxes
    splitWithBox.innerHTML = "";
    if (!PEOPLE.length) {
      splitWithBox.innerHTML = `<p class="muted small">Add people first.</p>`;
    } else {
      PEOPLE.forEach(name => {
        const id = "p_" + name.replace(/\s+/g, "_");
        const label = document.createElement("label");
        label.className = "split-item";
        label.innerHTML = `<input id="${id}" type="checkbox" value="${esc(name)}"> <span>${esc(name)}</span>`;
        splitWithBox.appendChild(label);
      });
      $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);
    }
  }

  function renderEverywhere() {
    renderAllBalancesAndHistory();
  }

  function renderAllBalancesAndHistory() {
    // History and balances depend on filters
    renderHistory();
    renderBalances(balancesAdd);
    renderBalances(balancesPay);
    renderBalances(balancesHist);
  }

  function renderHistory() {
    const list = filteredTX();
    tbodyHistory.innerHTML = "";
    if (!list.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="empty">No transactions yet.</td>`;
      tbodyHistory.appendChild(tr);
      return;
    }
    list.forEach(t => {
      const tr = document.createElement("tr");
      if (t.type === "expense") {
        tr.innerHTML = `
          <td>${t.date}</td>
          <td><span class="stat-neg">Expense</span></td>
          <td>${esc(t.desc || "")}</td>
          <td class="right">${fmt(t.amount)}</td>
          <td>${esc(t.payer)}</td>
          <td>${(t.splitWith || []).map(esc).join(", ")}</td>
          <td class="right"><button class="btn danger btn-sm">Delete</button></td>
        `;
      } else {
        tr.innerHTML = `
          <td>${t.date}</td>
          <td><span class="stat-pos">Payment</span></td>
          <td>${esc(t.desc || "")}</td>
          <td class="right">${fmt(t.amount)}</td>
          <td>${esc(t.from)}</td>
          <td>${esc(t.to)}</td>
          <td class="right"><button class="btn danger btn-sm">Delete</button></td>
        `;
      }
      tr.querySelector(".btn-sm").addEventListener("click", () => {
        if (!confirm("Delete this transaction?")) return;
        TX = TX.filter(x => x.id !== t.id);
        save(K_TX, TX);
        renderEverywhere();
      });
      tbodyHistory.appendChild(tr);
    });
  }

  // Balances
  function renderBalances(container) {
    const list = filteredTX();
    const pairwise = computePairwiseDebts(list); // owes[a][b]
    const names = [...new Set(PEOPLE)];
    container.innerHTML = "";
    if (!names.length) {
      container.innerHTML = `<p class="muted">Add people to see balances.</p>`;
      return;
    }
    names.forEach(name => {
      const card = document.createElement("div");
      card.className = "person-card";
      const owesMe = names.filter(other => other !== name && (pairwise[other]?.[name] || 0) > 0);
      const iOwe = names.filter(other => other !== name && (pairwise[name]?.[other] || 0) > 0);
      const listOwesMe = owesMe.map(other => `<li><a>${esc(other)}</a> owes me: <strong class="stat-pos">${fmt(pairwise[other][name])}</strong></li>`).join("") || `<li class="muted">No one owes ${esc(name)}.</li>`;
      const listIOwe = iOwe.map(other => `<li>I owe <a>${esc(other)}</a>: <strong class="stat-neg">${fmt(pairwise[name][other])}</strong></li>`).join("") || `<li class="muted">${esc(name)} owes no one.</li>`;
      card.innerHTML = `<h3>${esc(name)}</h3><ul>${listOwesMe}${listIOwe}</ul>`;
      container.appendChild(card);
    });
  }

  function filteredTX() {
    const txt = (filterText.value || "").toLowerCase();
    const yymm = filterMonth.value;
    let start, end;
    if (yymm && /^\d{4}-\d{2}$/.test(yymm)) {
      const [y, m] = yymm.split("-").map(Number);
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0, 23, 59, 59);
    }
    let list = TX.filter(t => {
      let inText = (t.desc || "") + " " + (t.type === "expense" ? (t.payer + " " + (t.splitWith || []).join(" ")) : (t.from + " " + t.to));
      inText = inText.toLowerCase().includes(txt);
      let inMonth = true;
      if (start && end) {
        const d = new Date(t.date);
        inMonth = d >= start && d <= end;
      }
      return inText && inMonth;
    });
    // sort
    list.sort((a, b) => {
      switch (sortBy.value) {
        case "amount-asc": return a.amount - b.amount;
        case "amount-desc": return b.amount - a.amount;
        case "date-asc": return new Date(a.date) - new Date(b.date);
        case "date-desc":
        default: return new Date(b.date) - new Date(a.date);
      }
    });
    return list;
  }

  // Compute pairwise debts matrix: owes[a][b] = amount a owes b
  function computePairwiseDebts(list) {
    const owes = {};
    const add = (a, b, v) => {
      if (!owes[a]) owes[a] = {};
      owes[a][b] = (owes[a][b] || 0) + v;
    };
    list.forEach(t => {
      if (t.type === "expense") {
        const participants = t.splitWith || [];
        const share = t.amount / (participants.length || 1);
        participants.forEach(p => {
          if (p === t.payer) return; // skip self-owing
          add(p, t.payer, share);
        });
      } else if (t.type === "payment") {
        add(t.from, t.to, -t.amount); // payment reduces what 'from' owes to 'to'
      }
    });
    // Net out A<->B
    const names = new Set();
    Object.keys(owes).forEach(a => { names.add(a); Object.keys(owes[a]).forEach(b => names.add(b)); });
    const na = [...names];
    na.forEach(a => na.forEach(b => {
      if (a === b) return;
      const ab = (owes[a]?.[b] || 0);
      const ba = (owes[b]?.[a] || 0);
      const net = ab - ba;
      if (net > 0) {
        if (!owes[a]) owes[a] = {};
        if (!owes[b]) owes[b] = {};
        owes[a][b] = net;
        owes[b][a] = 0;
      } else {
        if (!owes[a]) owes[a] = {};
        owes[a][b] = 0;
      }
    }));
    return owes;
  }

  // Utils
  function rid() {
    if (crypto?.getRandomValues) {
      const a = new Uint32Array(2); crypto.getRandomValues(a);
      return a[0].toString(36) + a[1].toString(36);
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
})();