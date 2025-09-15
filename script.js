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
  const toISODate = (d) => {
    const t = new Date(d);
    t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
    return t.toISOString().slice(0, 10);
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

  // --- Categories ---
  const categoriesPreset = [
    "Food", "Transport", "Housing", "Utilities", "Health",
    "Entertainment", "Education", "Shopping", "Travel", "Other"
  ];

  // --- State ---
  const STORAGE_KEY = "expense.entries.v1";
  let entries = loadEntries();

  // --- DOM refs ---
  const descInput = $("#desc");
  const amountInput = $("#amount");
  const categorySelect = $("#category");
  const dateInput = $("#date");
  const addForm = $("#add-form");
  const clearAllBtn = $("#btn-clear-all");

  const filterTextInput = $("#filter-text");
  const filterMonthInput = $("#filter-month");
  const sortBySelect = $("#sort-by");

  const sumTotal = $("#sum-total");
  const sumMonth = $("#sum-month");
  const sumCount = $("#sum-count");
  const sumTopCat = $("#sum-topcat");

  const tbody = $("#tbody-entries");
  const catGrid = $("#cat-grid");

  const btnExportCSV = $("#btn-export-csv");
  const btnBackupJSON = $("#btn-backup-json");
  const inputRestoreJSON = $("#input-restore-json");

  // --- Init ---
  fillCategories();
  dateInput.value = todayISO();
  filterMonthInput.value = todayISO().slice(0, 7);

  // Render initially
  render();

  // --- Event listeners ---
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const desc = (descInput.value || "").trim();
    const amount = Number(amountInput.value);
    const category = categorySelect.value;
    const date = dateInput.value;

    if (!desc) return alert("Please add a description.");
    if (!Number.isFinite(amount) || amount <= 0) return alert("Amount must be a positive number.");
    if (!date) return alert("Please select a date.");

    const newEntry = { id: uid(), desc, amount, category, date };
    entries = [newEntry, ...entries];
    saveEntries();

    // reset
    descInput.value = "";
    amountInput.value = "";
    categorySelect.value = categoriesPreset[0];
    dateInput.value = todayISO();

    render();
  });

  clearAllBtn.addEventListener("click", () => {
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
    const header = ["Date", "Description", "Category", "Amount"];
    const rows = filtered.map(e => [e.date, escapeCSV(e.desc), escapeCSV(e.category), e.amount]);
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
            id: e.id || uid(),
            desc: String(e.desc),
            amount: Number(e.amount),
            category: String(e.category),
            date: String(e.date).slice(0, 10),
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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
      const inText = (e.desc + " " + e.category).toLowerCase().includes(text);
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

  function topCategoryLabel(byCat) {
    const entries = Object.entries(byCat);
    if (!entries.length) return "—";
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
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
      tr.innerHTML = `<td colspan="5" class="empty">No items for this filter.</td>`;
      tbody.appendChild(tr);
    } else {
      filtered.forEach(e => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${e.date}</td>
          <td>${escapeHTML(e.desc)}</td>
          <td>${escapeHTML(e.category)}</td>
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

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();