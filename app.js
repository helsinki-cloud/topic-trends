/* 진료과별 연구 주제 트렌드 대시보드 — 정적 페이지, 외부 API 호출 없음 */
(async function () {
  const MAX_SERIES = 8;
  const DEFAULT_SELECTED = 5;
  const css = (v) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(v).trim();

  // ---------- 데이터 읽기 ----------
  let meta, counts, totals;
  try {
    [meta, counts, totals] = await Promise.all(
      ["meta", "counts", "totals"].map((n) =>
        fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => {
          if (!r.ok) throw new Error(n);
          return r.json();
        })
      )
    );
  } catch (e) {
    document.getElementById("empty").hidden = false;
    return;
  }
  document.getElementById("app").hidden = false;

  const curYear = meta.current_year;
  const lastFull = curYear - 1;
  const allYears = Object.keys(totals).map(Number).sort((a, b) => a - b);

  // ---------- 상태 ----------
  const state = { dept: meta.departments[0].id, mode: "count", from: Math.max(allYears[0], curYear - 15), showCur: false };
  // 색은 주제(엔티티)에 붙고, 선택 해제 전까지 바뀌지 않음
  const colorsByDept = new Map(); // deptId -> Map(topicId -> slot 1..8)
  const selected = new Map(); // deptId -> Set(topicId)
  let colorOf = new Map();

  const deptObj = () => meta.departments.find((d) => d.id === state.dept);
  const value = (tid, y) => {
    const n = counts[tid]?.[y] ?? null;
    if (n === null) return null;
    if (state.mode === "count") return n;
    const t = totals[y];
    return t ? (n / t) * 10000 : null;
  };
  const fmt = (v) =>
    v === null || v === undefined ? "–" :
    state.mode === "count" ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(2);
  const tname = (t) => t.name || t.name_ko || t.id;
  const pubmedUrl = (q) => "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(q);

  function freeSlot() {
    const used = new Set(colorOf.values());
    for (let s = 1; s <= MAX_SERIES; s++) if (!used.has(s)) return s;
    return null;
  }
  function selectTopic(tid) {
    const s = freeSlot();
    if (s === null) return false;
    colorOf.set(tid, s);
    selected.get(state.dept).add(tid);
    return true;
  }
  function unselectTopic(tid) {
    colorOf.delete(tid);
    selected.get(state.dept).delete(tid);
  }
  function ensureDeptSelection() {
    if (selected.has(state.dept)) {
      colorOf = colorsByDept.get(state.dept); // 다른 과에서 돌아와도 색 그대로
      return;
    }
    colorOf = new Map();
    colorsByDept.set(state.dept, colorOf);
    selected.set(state.dept, new Set());
    // 기본 선택: 지난해 1만 편당 비율 기준 상위 5개 (색은 선택 순서대로 고정)
    const ranked = deptObj().topics
      .map((t) => ({ id: t.id, r: (counts[t.id]?.[lastFull] ?? 0) / (totals[lastFull] || 1) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, DEFAULT_SELECTED);
    ranked.forEach((t) => selectTopic(t.id));
  }

  // ---------- 필터 ----------
  const deptSel = document.getElementById("dept");
  meta.departments.forEach((d) => deptSel.add(new Option(d.name_ko, d.id)));
  deptSel.onchange = () => { state.dept = deptSel.value; ensureDeptSelection(); renderAll(); };

  const fromSel = document.getElementById("from");
  allYears.slice(0, -2).forEach((y) => fromSel.add(new Option(y, y)));
  fromSel.value = state.from;
  fromSel.onchange = () => { state.from = Number(fromSel.value); renderChart(); };

  const curBox = document.getElementById("showcur");
  curBox.onchange = () => { state.showCur = curBox.checked; renderChart(); };

  document.querySelectorAll(".seg button").forEach((b) => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll(".seg button").forEach((x) => {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-checked", x === b);
      });
      renderChart();
    };
  });

  document.getElementById("csv").onclick = () => {
    const d = deptObj();
    const rows = [["진료과", "주제", "연도", "논문 수", "PubMed 전체", "1만 편당", "검색식"]];
    d.topics.forEach((t) =>
      allYears.forEach((y) => {
        const n = counts[t.id]?.[y];
        rows.push([d.name_ko, tname(t), y, n ?? "", totals[y] ?? "",
          n != null && totals[y] ? ((n / totals[y]) * 10000).toFixed(4) : "", t.query]);
      })
    );
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `topic-trends_${d.id}_${meta.collected_at_utc.slice(0, 10)}.csv`;
    a.click();
  };

  // ---------- 주제 선택 칩 ----------
  function renderPicks() {
    const box = document.getElementById("topic-picks");
    box.innerHTML = "";
    const sel = selected.get(state.dept);
    const full = sel.size >= MAX_SERIES;
    deptObj().topics.forEach((t) => {
      const on = sel.has(t.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick" + (on ? " on" : "");
      b.disabled = !on && full;
      b.setAttribute("aria-pressed", on);
      b.innerHTML = `<span class="dot"></span>${tname(t)}`;
      if (on) b.querySelector(".dot").style.background = css(`--s${colorOf.get(t.id)}`);
      b.onclick = () => { on ? unselectTopic(t.id) : selectTopic(t.id); renderPicks(); renderChart(); };
      box.appendChild(b);
    });
  }

  // ---------- 차트 ----------
  let chart;
  // 선이 4개 이하일 때 오른쪽 끝에 이름표 (색이 아닌 글자로도 구분)
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(c) {
      if (c.data.datasets.length > 4) return;
      const { ctx } = c;
      ctx.save();
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = css("--text-secondary");
      ctx.textBaseline = "middle";
      // 이름표끼리 겹치지 않게 세로 간격 확보
      const items = c.data.datasets.map((ds, i) => {
        const pts = c.getDatasetMeta(i).data.filter((p, j) => ds.data[j] !== null);
        const p = pts[pts.length - 1];
        return p ? { label: ds.label, x: p.x, y: p.y } : null;
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      const gap = 15;
      for (let k = 1; k < items.length; k++)
        if (items[k].y - items[k - 1].y < gap) items[k].y = items[k - 1].y + gap;
      items.forEach((it) => ctx.fillText(it.label, it.x + 8, it.y));
      ctx.restore();
    },
  };

  function renderChart() {
    const d = deptObj();
    const years = allYears.filter((y) => y >= state.from && (state.showCur || y !== curYear));
    const sel = selected.get(state.dept);
    const datasets = d.topics
      .filter((t) => sel.has(t.id))
      .map((t) => {
        const color = css(`--s${colorOf.get(t.id)}`);
        return {
          label: tname(t),
          data: years.map((y) => value(t.id, y)),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: css("--surface-1"),
          tension: 0,
          segment: { borderDash: (ctx) => (years[ctx.p1DataIndex] === curYear ? [5, 4] : undefined) },
        };
      });

    document.getElementById("chart-title").textContent =
      `${d.name_ko} · 연도별 ${state.mode === "count" ? "논문 수" : "PubMed 전체 1만 편당 논문 수"}`;

    const grid = css("--grid"), muted = css("--text-muted"), sec = css("--text-secondary");
    const cfg = {
      type: "line",
      data: { labels: years.map((y) => (y === curYear ? `${y}*` : String(y))), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: datasets.length <= 4 ? 140 : 8 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { color: sec, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" } },
          tooltip: {
            itemSort: (a, b) => (b.parsed.y ?? -1) - (a.parsed.y ?? -1),
            callbacks: {
              title: (items) => {
                const y = years[items[0].dataIndex];
                return y === curYear ? `${y}년 (집계 중)` : `${y}년`;
              },
              label: (it) => ` ${it.dataset.label}: ${fmt(it.parsed.y)}${state.mode === "count" ? "편" : ""}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 }, border: { color: grid } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, callback: (v) => fmt(v) }, border: { display: false } },
        },
      },
      plugins: [endLabels],
    };
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById("chart"), cfg);
  }

  // ---------- 최근 5년 급상승 순위 ----------
  function renderTable() {
    const base = lastFull - 5;
    document.getElementById("growth-title").textContent = `최근 5년 급상승 순위 (${base} → ${lastFull})`;
    const rate = (tid, y) => (counts[tid]?.[y] != null && totals[y] ? (counts[tid][y] / totals[y]) * 10000 : null);
    const rows = deptObj().topics.map((t) => {
      const r1 = rate(t.id, lastFull), r0 = rate(t.id, base);
      return { t, g: r0 && r1 != null ? (r1 / r0 - 1) * 100 : null };
    }).sort((a, b) => (b.g ?? -Infinity) - (a.g ?? -Infinity));

    const tb = document.querySelector("#growth tbody");
    tb.innerHTML = "";
    rows.forEach(({ t, g }, i) => {
      const gTxt = g === null ? "–" : Math.abs(g) < 0.5 ? "변화 없음" : `${g > 0 ? "▲" : "▼"} ${Math.abs(g).toFixed(0)}%`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="num rank">${i + 1}</td>
        <td>${escapeHtml(tname(t))}</td>
        <td class="num ${g > 0 ? "up" : ""}">${gTxt}</td>
        <td class="query"><a href="${pubmedUrl(t.query)}" target="_blank" rel="noopener">${escapeHtml(t.query)}</a></td>`;
      tb.appendChild(tr);
    });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 하단 메타 ----------
  const kst = new Date(meta.collected_at_utc).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  document.getElementById("meta-line").textContent =
    `데이터 기준: ${kst} (한국 시간) · 출처: ${meta.source} · 연도 기준: ${meta.date_field} · * = 올해(집계 중)`;

  function renderAll() { renderPicks(); renderChart(); renderTable(); }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);

  ensureDeptSelection();
  renderAll();
})();
