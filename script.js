(function () {
  // --- Helpers ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const escapeCSV = (s) => {
    const str = String(s);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  function formatNumber(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- Categories ---
  const categoriesPreset = [
    "Food", "Transport", "Housing", "Utilities", "Health",
    "Entertainment", "Education", "Shopping", "Travel", "Other"
  ];

  // --- Storage Keys ---
  const STORAGE_ENTRIES = "expense.entries.v2"; // bump to v2 to include payer/split
  const STORAGE_PEOPLE = "expense.people.v1";

  // --- State ---
  let entries = loadEntries();
  let people = loadPeople();

  // --- DOM refs ---
  const descInput = $("#desc");
  const amountInput = $("#amount");
  const categorySelect = $("#category");
  const dateInput = $("#date");
  const payerSelect = $("#payer");
  const splitWithBox = $("#split-with");

  const addForm = $("#add-form");
  const clearEntriesBtn = $("#btn-clear-entries");

  const filterTextInput = $("#filter-text");
  const filterMonthInput = $("#filter-month");
  const sortBySelect = $("#sort-by");

  const sumTotal = $("#sum-total");
  const sumMonth = $("#sum-month");
  const sumCount = $("#sum-count");
  const sumTopCat = $("#sum-topcat");

  const tbody = $("#tbody-entries");
  const catGrid = $("#cat-grid");
  const balancesGrid = $("#balances");

  const btnExportCSV = $("#btn-export-csv");
  const btnBackupJSON = $("#btn-backup-json");
  const inputRestoreJSON = $("#input-restore-json");

  const peopleForm = $("#people-form");
  const peopleInput = $("#people-input");
  const peopleList = $("#people-list");
  const btnSelectAll = $("#btn-select-all");
  const btnClearAll = $("#btn-clear-all");

  // --- Init ---
  fillCategories();
  dateInput.value = todayISO();
  filterMonthInput.value = todayISO().slice(0, 7);
  renderPeopleUI();
  render();

  // --- Event listeners ---
  peopleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (peopleInput.value || "").trim();
    if (!name) return;
    if (people.includes(name)) {
      alert("That name already exists.");
      return;
    }
    people.push(name);
    savePeople();
    peopleInput.value = "";
    renderPeopleUI();
    render(); // refresh tables if needed
  });

  btnSelectAll?.addEventListener("click", () => {
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);
  });
  btnClearAll?.addEventListener("click", () => {
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = false);
  });

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const desc = (descInput.value || "").trim();
    const amount = Number(amountInput.value);
    const category = categorySelect.value;
    const date = dateInput.value;
    const payer = payerSelect.value;
    const splitWith = $$("#split-with input[type=checkbox]")
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (!desc) return alert("Please add a description.");
    if (!Number.isFinite(amount) || amount <= 0) return alert("Amount must be a positive number.");
    if (!date) return alert("Please select a date.");
    if (!people.length) return alert("Add at least one person in People.");
    if (!payer) return alert("Select who paid.");
    if (splitWith.length === 0) return alert("Select at least one person to split with.");

    const newEntry = { id: cryptoRandomId(), desc, amount, category, date, payer, splitWith };
    entries = [newEntry, ...entries];
    saveEntries();

    // reset
    descInput.value = "";
    amountInput.value = "";
    categorySelect.value = categoriesPreset[0];
    dateInput.value = todayISO();
    payerSelect.value = people[0] || "";
    // default: check all again
    $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);

    render();
  });

  clearEntriesBtn.addEventListener("click", () => {
    if (confirm("Delete all entries?")) {
      entries = [];
      saveEntries();
      render();
    }
  });

  filterTextInput.addEventListener("input", render);
  filterMonthInput.addEventListener("input", render);
  sortBySelect.addEventListener("change", render);

  btnExportCSV.addEventListener("click", () => {
    const filtered = getFiltered();
    const header = ["Date", "Description", "Category", "Amount", "Payer", "SplitWith"];
    const rows = filtered.map(e => [
      e.date,
      escapeCSV(e.desc),
      escapeCSV(e.category),
      e.amount,
      escapeCSV(e.payer || ""),
      escapeCSV((e.splitWith || []).join("|")),
    ]);
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `expenses_${filterMonthInput.value || "all"}.csv`);
  });

  btnBackupJSON.addEventListener("click", () => {
    const payload = JSON.stringify(entries, null, 2);
    downloadBlob(new Blob([payload], { type: "application/json" }), "expenses_backup.json");
  });

  inputRestoreJSON.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Invalid file");
        const cleaned = parsed
          .filter((e) => e && e.desc && e.amount && e.date && e.category)
          .map((e) => ({
            id: e.id || cryptoRandomId(),
            desc: String(e.desc),
            amount: Number(e.amount),
            category: String(e.category),
            date: String(e.date).slice(0, 10),
            payer: e.payer ? String(e.payer) : "", // optional for old backups
            splitWith: Array.isArray(e.splitWith) ? e.splitWith.map(String) : [],
          }));
        entries = [...cleaned, ...entries];
        saveEntries();
        render();
      } catch (err) {
        alert("Couldn't import that file.");
      }
    };
    reader.readAsText(file);
    // Reset input so selecting the same file again triggers change
    e.target.value = "";
  });

  // --- Functions ---
  function renderPeopleUI() {
    // chips
    if (!people.length) {
      peopleList.className = "people-list muted small";
      peopleList.textContent = "No people yet — add at least one.";
    } else {
      peopleList.className = "people-list";
      peopleList.innerHTML = "";
      people.forEach(name => {
        const chip = document.createElement("div");
        chip.className = "person-chip";
        chip.innerHTML = `<span>${escapeHTML(name)}</span>`;
        const btn = document.createElement("button");
        btn.title = "Remove";
        btn.innerHTML = "✕";
        btn.addEventListener("click", () => {
          if (!confirm(`Remove ${name}?`)) return;
          people = people.filter(p => p !== name);
          savePeople();
          renderPeopleUI();
          render();
        });
        chip.appendChild(btn);
        peopleList.appendChild(chip);
      });
    }

    // payer select
    payerSelect.innerHTML = "";
    people.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      payerSelect.appendChild(opt);
    });
    payerSelect.value = people[0] || "";

    // split checkboxes
    splitWithBox.innerHTML = "";
    if (!people.length) {
      splitWithBox.innerHTML = `<p class="muted small">Add people first.</p>`;
    } else {
      people.forEach(name => {
        const id = "split_" + name.replace(/\s+/g, "_");
        const label = document.createElement("label");
        label.className = "split-item";
        label.innerHTML = `<input id="${id}" type="checkbox" value="${escapeHTML(name)}"> <span>${escapeHTML(name)}</span>`;
        splitWithBox.appendChild(label);
      });
      // default: check all
      $$("#split-with input[type=checkbox]").forEach(cb => cb.checked = true);
    }
  }

  function fillCategories() {
    categorySelect.innerHTML = "";
    categoriesPreset.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySelect.appendChild(opt);
    });
  }

  function loadEntries() {
    // Try v2; if empty, migrate from v1
    try {
      const raw2 = localStorage.getItem(STORAGE_ENTRIES);
      if (raw2) return JSON.parse(raw2);
    } catch {}
    try {
      const raw1 = localStorage.getItem("expense.entries.v1");
      if (raw1) return JSON.parse(raw1).map(e => ({ ...e, payer: "", splitWith: [] }));
    } catch {}
    return [];
  }

  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
    } catch {}
  }

  function loadPeople() {
    try {
      const raw = localStorage.getItem(STORAGE_PEOPLE);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
      return [];
    } catch { return []; }
  }
  function savePeople() {
    try {
      localStorage.setItem(STORAGE_PEOPLE, JSON.stringify(people));
    } catch {}
  }

  function getFiltered() {
    const text = (filterTextInput.value || "").toLowerCase();
    const yymm = filterMonthInput.value;
    let monthStart, monthEnd;
    if (yymm && /^\d{4}-\d{2}$/.test(yymm)) {
      const [y, m] = yymm.split("-").map(Number);
      monthStart = new Date(y, m - 1, 1);
      monthEnd = new Date(y, m, 0);
    }

    const filtered = entries.filter(e => {
      const inText = (e.desc + " " + e.category + " " + (e.payer || "") + " " + (e.splitWith || []).join(" "))
        .toLowerCase().includes(text);
      let inMonth = true;
      if (monthStart && monthEnd) {
        const d = new Date(e.date);
        inMonth = (d >= monthStart && d <= monthEnd);
      }
      return inText && inMonth;
    });

    const sort = sortBySelect.value;
    filtered.sort((a, b) => {
      switch (sort) {
        case "amount-asc": return a.amount - b.amount;
        case "amount-desc": return b.amount - a.amount;
        case "date-asc": return new Date(a.date) - new Date(b.date);
        case "date-desc":
        default: return new Date(b.date) - new Date(a.date);
      }
    });

    return filtered;
  }

  function computeTotals(list) {
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCategory = {};
    list.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount || 0);
    });
    return { total, byCategory };
  }

  // Balances: positive = person is owed, negative = person owes.
  function computeBalances(list) {
    const ledger = {};
    list.forEach(e => {
      const A = Number(e.amount || 0);
      const participants = Array.isArray(e.splitWith) ? e.splitWith : [];
      const payer = e.payer || "";
      const n = participants.length || 0;
      if (!A || !n || !payer) return;
      const share = A / n;
      // Everyone in participants owes their share
      participants.forEach(p => {
        ledger[p] = (ledger[p] || 0) - share;
      });
      // Payer paid the whole amount
      ledger[payer] = (ledger[payer] || 0) + A;
    });
    return ledger;
  }

  function render() {
    const filtered = getFiltered();
    const totals = computeTotals(filtered);

    // Summary
    sumTotal.textContent = formatNumber(totals.total);
    sumMonth.textContent = "for " + (filterMonthInput.value || "—");
    sumCount.textContent = String(filtered.length);
    sumTopCat.textContent = topCategoryLabel(totals.byCategory);

    // Table
    tbody.innerHTML = "";
    if (!filtered.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="empty">No items for this filter.</td>`;
      tbody.appendChild(tr);
    } else {
      filtered.forEach(e => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${e.date}</td>
          <td>${escapeHTML(e.desc)}</td>
          <td>${escapeHTML(e.category)}</td>
          <td>${escapeHTML(e.payer || "—")}</td>
          <td>${(e.splitWith || []).map(escapeHTML).join(", ") || "—"}</td>
          <td class="right"><strong>${formatNumber(e.amount)}</strong></td>
          <td class="right"><button class="btn btn-sm btn-delete">Delete</button></td>
        `;
        // Row click -> edit (load into form and remove original)
        tr.addEventListener("click", () => {
          // load
          descInput.value = e.desc;
          amountInput.value = e.amount;
          categorySelect.value = e.category;
          dateInput.value = e.date;
          payerSelect.value = e.payer || (people[0] || "");
          // set split checkboxes
          $$("#split-with input[type=checkbox]").forEach(cb => {
            cb.checked = e.splitWith?.includes(cb.value) || false;
          });
          // remove original
          entries = entries.filter(x => x.id !== e.id);
          saveEntries();
          render();
          descInput.focus();
        });
        // Delete button (stop row click)
        tr.querySelector(".btn-delete").addEventListener("click", (ev) => {
          ev.stopPropagation();
          entries = entries.filter(x => x.id !== e.id);
          saveEntries();
          render();
        });
        tbody.appendChild(tr);
      });
    }

    // Categories grid
    catGrid.innerHTML = "";
    const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
    if (!cats.length) {
      catGrid.innerHTML = `<p class="muted">Nothing here yet.</p>`;
    } else {
      cats.forEach(([cat, val]) => {
        const row = document.createElement("div");
        row.className = "cat-row";
        row.innerHTML = `<span>${escapeHTML(cat)}</span><strong>${formatNumber(val)}</strong>`;
        catGrid.appendChild(row);
      });
    }

    // Balances grid
    const ledger = computeBalances(filtered);
    balancesGrid.innerHTML = "";
    const names = Object.keys(ledger).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      balancesGrid.innerHTML = `<p class="muted">Add people and expenses to see balances.</p>`;
    } else {
      names.forEach(name => {
        const val = ledger[name];
        const row = document.createElement("div");
        row.className = "balance-row";
        const cls = val > 0 ? "balance-pos" : (val < 0 ? "balance-neg" : "");
        row.innerHTML = `<span>${escapeHTML(name)}</span><strong class="${cls}">${formatNumber(val)}</strong>`;
        balancesGrid.appendChild(row);
      });
    }
  }

  function topCategoryLabel(map) {
    const entries = Object.entries(map);
    if (!entries.length) return "—";
    const [name] = entries.sort((a, b) => b[1] - a[1])[0];
    return name;
  }

  function cryptoRandomId() {
    if (window.crypto?.getRandomValues) {
      const arr = new Uint32Array(2);
      window.crypto.getRandomValues(arr);
      return arr[0].toString(36) + arr[1].toString(36);
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }
})();