(function () {
  const STORAGE_KEY = "roulette-state-v1";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  // The original fixed spin was 1800 degrees over 4 seconds.
  const BASE_DEG_PER_SEC = 450;

  const SLICE_COLORS = ["#ff8fa3", "#ffc38f", "#ffe58f", "#8fe3b0", "#8fd3f4", "#c9a8f5"];
  const CONFETTI_COLORS = ["#ff8fa3", "#ffc38f", "#ffe58f", "#8fe3b0", "#8fd3f4", "#c9a8f5", "#ffffff"];

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const confettiCanvas = document.getElementById("confetti-canvas");
  const confettiCtx = confettiCanvas.getContext("2d");

  const titleEl = document.getElementById("board-title");
  const subtitleEl = document.getElementById("board-subtitle");
  const categoryBoard = document.getElementById("category-board");
  const wheelItemList = document.getElementById("wheel-item-list");
  const spinBtn = document.getElementById("spin-btn");
  const result = document.getElementById("result");
  const muteBtn = document.getElementById("mute-btn");
  const volumeSlider = document.getElementById("volume-slider");
  const resetWinsBtn = document.getElementById("reset-wins-btn");
  const restoreWinsBtn = document.getElementById("restore-wins-btn");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file-input");

  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmOkBtn = document.getElementById("confirm-ok-btn");
  const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

  let nextId = 1;
  function makeId(prefix) {
    return `${prefix}-${nextId++}`;
  }

  function createSeedCategories() {
    return [
      {
        id: makeId("cat"),
        name: "사업팀",
        items: [
          { id: makeId("item"), name: "김사원", included: true, wins: [] },
          { id: makeId("item"), name: "하대리", included: true, wins: [] },
        ],
      },
      {
        id: makeId("cat"),
        name: "홍보팀",
        items: [
          { id: makeId("item"), name: "박팀장", included: true, wins: [] },
          { id: makeId("item"), name: "이주임", included: true, wins: [] },
        ],
      },
    ];
  }

  let categories = [];
  let boardTitle = "룰렛";
  let boardSubtitle = "카테고리를 넘나들며 항목을 골라 하나의 룰렛으로 돌려보세요.";
  let winsBackup = null;

  let editingHeaderField = null;
  let editingCategoryId = null;
  let addingCategory = false;
  let editingItemId = null;

  let rotation = 0;
  let spinning = false;
  let confettiAnimationId = null;

  // ---------- Persistence ----------
  function serializeState() {
    return {
      version: 1,
      title: boardTitle,
      subtitle: boardSubtitle,
      categories,
      winsBackup,
      nextId,
      volume: masterVolume,
      muted,
    };
  }

  // Shared by loadState() (localStorage) and importState() (a file the
  // user picked), so both go through the same validation/normalization.
  function applyStateData(data) {
    if (!data || !Array.isArray(data.categories)) return false;

    categories = data.categories.map((category) => ({
      id: String(category.id),
      name: String(category.name),
      items: Array.isArray(category.items)
        ? category.items.map((item) => ({
            id: String(item.id),
            name: String(item.name),
            included: item.included !== false,
            wins: Array.isArray(item.wins) ? item.wins.filter((t) => typeof t === "number") : [],
          }))
        : [],
    }));

    if (typeof data.title === "string" && data.title.trim()) boardTitle = data.title;
    if (typeof data.subtitle === "string" && data.subtitle.trim()) boardSubtitle = data.subtitle;
    winsBackup = data.winsBackup && typeof data.winsBackup === "object" ? data.winsBackup : null;
    if (typeof data.volume === "number") masterVolume = Math.min(1, Math.max(0, data.volume));
    muted = data.muted === true;
    if (Number.isFinite(data.nextId)) nextId = data.nextId;

    // Guard against id collisions if the stored/imported counter drifted.
    let highest = nextId - 1;
    categories.forEach((category) => {
      [category, ...category.items].forEach((entity) => {
        const match = /-(\d+)$/.exec(entity.id);
        if (match) highest = Math.max(highest, Number(match[1]));
      });
    });
    nextId = highest + 1;

    return true;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
    } catch (e) {
      // Storage can be unavailable (private mode, quota); the app still
      // works for the current session without it.
    }
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;

    try {
      return applyStateData(JSON.parse(raw));
    } catch (e) {
      return false;
    }
  }

  // ---------- Export / import ----------
  function exportState() {
    playClick();
    const blob = new Blob([JSON.stringify(serializeState(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `roulette-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importStateFromFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      window.alert("파일을 읽을 수 없습니다. 올바른 백업 파일인지 확인해주세요.");
      return;
    }
    if (!data || !Array.isArray(data.categories)) {
      window.alert("올바른 백업 파일 형식이 아닙니다.");
      return;
    }

    const ok = await showConfirm(
      "현재 데이터를 가져온 파일 내용으로 덮어씁니다. 계속하시겠습니까?",
      "가져오기",
      true
    );
    if (!ok) return;

    applyStateData(data);
    editingHeaderField = null;
    editingCategoryId = null;
    addingCategory = false;
    editingItemId = null;
    volumeSlider.value = String(Math.round(masterVolume * 100));
    applyVolume();
    renderAll();
  }

  // ---------- Audio ----------
  let audioCtx = null;
  let masterGain = null;
  let masterVolume = 0.6;
  let muted = false;

  function ensureAudioCtx() {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return null;
    if (!audioCtx) {
      audioCtx = new AudioCtxClass();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : masterVolume;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function applyVolume() {
    if (masterGain) masterGain.gain.value = muted ? 0 : masterVolume;
    muteBtn.textContent = muted || masterVolume === 0 ? "🔇" : "🔊";
  }

  function playClick() {
    const ac = ensureAudioCtx();
    if (!ac) return;
    try {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.value = 700;
      const start = ac.currentTime;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
      osc.connect(gain).connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.07);
    } catch (e) {
      // Ignore playback failures (e.g. autoplay restrictions).
    }
  }

  function scheduleTick(atTime) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = 1000;
      gain.gain.setValueAtTime(0.0001, atTime);
      gain.gain.exponentialRampToValueAtTime(0.14, atTime + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.03);
      osc.connect(gain).connect(masterGain);
      osc.start(atTime);
      osc.stop(atTime + 0.04);
    } catch (e) {
      // Ignore playback failures.
    }
  }

  // Synthesizes a short ascending fanfare with the Web Audio API so no
  // external audio asset is needed; playback failures are non-fatal.
  function playFanfare() {
    if (!audioCtx) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const start = audioCtx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        osc.connect(gain).connect(masterGain);
        osc.start(start);
        osc.stop(start + 0.35);
      });
    } catch (e) {
      // Ignore playback failures (e.g. autoplay restrictions).
    }
  }

  // Evaluates a CSS-style cubic-bezier(p1x,p1y,p2x,p2y) easing at time
  // fraction t, via binary search over the bezier's parametric variable.
  function makeCubicBezierEasing(p1x, p1y, p2x, p2y) {
    function sampleX(u) {
      const mu = 1 - u;
      return 3 * mu * mu * u * p1x + 3 * mu * u * u * p2x + u * u * u;
    }
    function sampleY(u) {
      const mu = 1 - u;
      return 3 * mu * mu * u * p1y + 3 * mu * u * u * p2y + u * u * u;
    }
    return function progressAt(t) {
      let lower = 0;
      let upper = 1;
      let u = t;
      for (let i = 0; i < 20; i++) {
        const x = sampleX(u);
        if (Math.abs(x - t) < 1e-4) break;
        if (x < t) lower = u;
        else upper = u;
        u = (lower + upper) / 2;
      }
      return sampleY(u);
    };
  }

  const wheelEasing = makeCubicBezierEasing(0.17, 0.67, 0.12, 0.99);

  function findTimeFractionForProgress(targetProgress) {
    let lower = 0;
    let upper = 1;
    let t = targetProgress;
    for (let i = 0; i < 20; i++) {
      const p = wheelEasing(t);
      if (Math.abs(p - targetProgress) < 1e-4) break;
      if (p < targetProgress) lower = t;
      else upper = t;
      t = (lower + upper) / 2;
    }
    return t;
  }

  // Schedules a click for every slice boundary that passes the fixed
  // pointer while the wheel rotates from startRotation to endRotation,
  // timed to match the CSS transition's easing so the "roulette ticking"
  // sound speeds up and slows down together with the visual spin.
  function scheduleSpinTicks(startRotation, endRotation, sliceAngle, durationMs) {
    if (!audioCtx) return;
    const pointerAngle = 270;
    const totalDelta = endRotation - startRotation;
    if (totalDelta <= 0) return;

    const phase = ((pointerAngle % sliceAngle) + sliceAngle) % sliceAngle;
    let firstBoundary = startRotation + ((((phase - startRotation) % sliceAngle) + sliceAngle) % sliceAngle);
    if (firstBoundary <= startRotation) firstBoundary += sliceAngle;

    const baseTime = audioCtx.currentTime;
    for (let r = firstBoundary; r <= endRotation; r += sliceAngle) {
      const progress = (r - startRotation) / totalDelta;
      const timeFraction = findTimeFractionForProgress(progress);
      scheduleTick(baseTime + (timeFraction * durationMs) / 1000);
    }
  }

  muteBtn.addEventListener("click", () => {
    ensureAudioCtx();
    muted = !muted;
    applyVolume();
    playClick();
    saveState();
  });

  volumeSlider.addEventListener("input", () => {
    masterVolume = Number(volumeSlider.value) / 100;
    if (masterVolume > 0) muted = false;
    applyVolume();
    saveState();
  });

  // ---------- Confirm dialog ----------
  function showConfirm(message, confirmLabel, danger) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOkBtn.textContent = confirmLabel || "제거";
      confirmOkBtn.className = danger === false ? "primary" : "danger";
      confirmDialog.hidden = false;

      function onKeydown(e) {
        if (e.key === "Escape") cleanup(false);
      }
      function onOverlayClick(e) {
        if (e.target === confirmDialog) cleanup(false);
      }
      function cleanup(value) {
        confirmDialog.hidden = true;
        confirmOkBtn.removeEventListener("click", onOk);
        confirmCancelBtn.removeEventListener("click", onCancel);
        confirmDialog.removeEventListener("click", onOverlayClick);
        document.removeEventListener("keydown", onKeydown);
        resolve(value);
      }
      function onOk() {
        playClick();
        cleanup(true);
      }
      function onCancel() {
        playClick();
        cleanup(false);
      }

      confirmOkBtn.addEventListener("click", onOk);
      confirmCancelBtn.addEventListener("click", onCancel);
      confirmDialog.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeydown);
      requestAnimationFrame(() => confirmCancelBtn.focus());
    });
  }

  // ---------- Derived data ----------
  // The wheel spins over items marked "included", regardless of which
  // category they belong to, so a single roulette can mix e.g. 사업팀's
  // 김사원 with 홍보팀's 박팀장. Each entry keeps a reference to the real
  // item object (not a copy) so callers can mutate it.
  function getWheelEntries() {
    const entries = [];
    categories.forEach((category) => {
      category.items.forEach((item) => {
        if (item.included) entries.push({ item, categoryName: category.name });
      });
    });
    return entries;
  }

  function reorder(array, fromIndex, toIndex) {
    const [moved] = array.splice(fromIndex, 1);
    array.splice(toIndex, 0, moved);
  }

  // Native HTML5 drag-and-drop (used for the ⋮⋮ handles) has no touch
  // equivalent on phones, so these buttons give touch and keyboard users
  // a working way to reorder categories/items too.
  function createReorderButtons(array, index, symbols, ariaLabelPrefix, onReordered) {
    const wrap = document.createElement("span");
    wrap.className = "reorder-buttons";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "icon-btn reorder-btn";
    prevBtn.textContent = symbols[0];
    prevBtn.disabled = spinning || index === 0;
    prevBtn.setAttribute("aria-label", `${ariaLabelPrefix} 앞으로 이동`);
    prevBtn.addEventListener("click", () => {
      playClick();
      reorder(array, index, index - 1);
      onReordered();
    });
    wrap.appendChild(prevBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "icon-btn reorder-btn";
    nextBtn.textContent = symbols[1];
    nextBtn.disabled = spinning || index === array.length - 1;
    nextBtn.setAttribute("aria-label", `${ariaLabelPrefix} 뒤로 이동`);
    nextBtn.addEventListener("click", () => {
      playClick();
      reorder(array, index, index + 1);
      onReordered();
    });
    wrap.appendChild(nextBtn);

    return wrap;
  }

  function formatWinStats(item) {
    const now = Date.now();
    const week = item.wins.filter((t) => now - t <= WEEK_MS).length;
    const month = item.wins.filter((t) => now - t <= MONTH_MS).length;
    return `최근 일주일/한달 내 당첨 횟수 : ${week}회/${month}회`;
  }

  function renderAll() {
    renderHeader();
    renderCategoryBoard();
    renderWheelItems();
    renderTopActions();
    drawWheel();
    saveState();
  }

  // ---------- Editable heading ----------
  function renderEditableHeading(container, value, field, maxLength, apply) {
    container.innerHTML = "";

    if (editingHeaderField === field) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "edit-input";
      input.value = value;
      input.maxLength = maxLength;
      container.appendChild(input);

      // An inline editor commits on both Enter and blur, and committing
      // re-renders (which removes the focused input and fires blur again),
      // so every commit path is guarded against running twice.
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (next) apply(next);
        editingHeaderField = null;
        renderAll();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done = true;
          editingHeaderField = null;
          renderHeader();
        }
      });
      input.addEventListener("blur", commit);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return;
    }

    const span = document.createElement("span");
    span.textContent = value;
    container.appendChild(span);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.textContent = "✎";
    editBtn.disabled = spinning;
    editBtn.setAttribute("aria-label", `${field === "title" ? "제목" : "부제목"} 수정`);
    editBtn.addEventListener("click", () => {
      playClick();
      editingHeaderField = field;
      renderHeader();
    });
    container.appendChild(editBtn);
  }

  function renderHeader() {
    renderEditableHeading(titleEl, boardTitle, "title", 30, (value) => {
      boardTitle = value;
    });
    renderEditableHeading(subtitleEl, boardSubtitle, "subtitle", 80, (value) => {
      boardSubtitle = value;
    });
  }

  function renderTopActions() {
    resetWinsBtn.disabled = spinning;
    restoreWinsBtn.disabled = spinning || !winsBackup;
  }

  // ---------- Wheel drawing ----------
  function drawHub(center, radius) {
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf3";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "#c9a8f5";
    ctx.fill();
  }

  function drawWheel() {
    const entries = getWheelEntries();
    const size = canvas.width;
    const center = size / 2;
    const faceRadius = center - 6;
    const hubRadius = Math.max(24, faceRadius * 0.17);

    ctx.clearRect(0, 0, size, size);

    // White backing ring so pastel slice edges stay crisp against the rim.
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    if (entries.length === 0) {
      ctx.beginPath();
      ctx.arc(center, center, faceRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#eae7f2";
      ctx.fill();
      drawHub(center, hubRadius);
      return;
    }

    const sliceAngle = (Math.PI * 2) / entries.length;
    const fontSize = Math.max(10, Math.min(16, Math.round(140 / entries.length) + 9));

    entries.forEach((entry, i) => {
      const start = i * sliceAngle;
      const end = start + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, faceRadius, start, end);
      ctx.closePath();
      ctx.fillStyle = SLICE_COLORS[i % SLICE_COLORS.length];
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(center + Math.cos(start) * faceRadius, center + Math.sin(start) * faceRadius);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.strokeText(entry.item.name, faceRadius - 18, 0);
      ctx.fillStyle = "#3a2f45";
      ctx.fillText(entry.item.name, faceRadius - 18, 0);
      ctx.restore();
    });

    // Frets between pockets.
    entries.forEach((_, i) => {
      const angle = i * sliceAngle;
      const px = center + Math.cos(angle) * (faceRadius - 3);
      const py = center + Math.sin(angle) * (faceRadius - 3);
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fill();
      ctx.stroke();
    });

    // Inner ring around the hub.
    ctx.beginPath();
    ctx.arc(center, center, hubRadius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 84, 112, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();

    drawHub(center, hubRadius);
  }

  // ---------- Category board ----------
  function renderCategoryBoard() {
    const scrollLeft = categoryBoard.scrollLeft;
    categoryBoard.innerHTML = "";

    categories.forEach((category, categoryIndex) => {
      const column = document.createElement("div");
      column.className = "category-column";
      column.draggable = !spinning && editingCategoryId !== category.id;

      const header = document.createElement("div");
      header.className = "category-column-header";

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.setAttribute("aria-hidden", "true");
      header.appendChild(handle);
      header.appendChild(
        createReorderButtons(categories, categoryIndex, ["◀", "▶"], category.name, renderAll)
      );

      if (editingCategoryId === category.id) {
        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "edit-input";
        editInput.value = category.name;
        editInput.maxLength = 20;
        header.appendChild(editInput);

        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          const value = editInput.value.trim();
          if (value) category.name = value;
          editingCategoryId = null;
          renderAll();
        };
        editInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            done = true;
            editingCategoryId = null;
            renderCategoryBoard();
          }
        });
        editInput.addEventListener("blur", commit);
        requestAnimationFrame(() => {
          editInput.focus();
          editInput.select();
        });
      } else {
        const nameSpan = document.createElement("span");
        nameSpan.className = "category-name";
        nameSpan.textContent = category.name;
        nameSpan.title = category.name;
        header.appendChild(nameSpan);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-btn";
        editBtn.textContent = "✎";
        editBtn.disabled = spinning;
        editBtn.setAttribute("aria-label", `${category.name} 이름 수정`);
        editBtn.addEventListener("click", () => {
          playClick();
          editingCategoryId = category.id;
          renderCategoryBoard();
        });
        header.appendChild(editBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn";
      removeBtn.textContent = "✕";
      removeBtn.disabled = spinning;
      removeBtn.setAttribute("aria-label", `${category.name} 삭제`);
      removeBtn.addEventListener("click", async () => {
        playClick();
        const ok = await showConfirm(
          `"${category.name}" 카테고리와 그 안의 모든 항목을 정말 제거하시겠습니까?`
        );
        if (!ok) return;
        const idx = categories.indexOf(category);
        if (idx !== -1) categories.splice(idx, 1);
        renderAll();
      });
      header.appendChild(removeBtn);

      column.appendChild(header);

      const itemsList = document.createElement("ul");
      itemsList.className = "category-items";

      category.items.forEach((item, itemIndex) => {
        const li = document.createElement("li");
        li.className = "item-row";
        li.draggable = !spinning && editingItemId !== item.id;

        const main = document.createElement("div");
        main.className = "item-main";

        const itemHandle = document.createElement("span");
        itemHandle.className = "drag-handle";
        itemHandle.textContent = "⋮⋮";
        itemHandle.setAttribute("aria-hidden", "true");
        main.appendChild(itemHandle);
        main.appendChild(createReorderButtons(category.items, itemIndex, ["▲", "▼"], item.name, renderAll));

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "item-checkbox";
        checkbox.checked = item.included;
        checkbox.disabled = spinning;
        checkbox.setAttribute("aria-label", `${item.name} 룰렛에 포함`);
        checkbox.addEventListener("change", () => {
          playClick();
          item.included = checkbox.checked;
          renderWheelItems();
          drawWheel();
          saveState();
        });
        main.appendChild(checkbox);

        if (editingItemId === item.id) {
          const editInput = document.createElement("input");
          editInput.type = "text";
          editInput.className = "edit-input";
          editInput.value = item.name;
          editInput.maxLength = 30;
          main.appendChild(editInput);

          let done = false;
          const commit = () => {
            if (done) return;
            done = true;
            const value = editInput.value.trim();
            if (value) item.name = value;
            editingItemId = null;
            renderAll();
          };
          editInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              done = true;
              editingItemId = null;
              renderCategoryBoard();
            }
          });
          editInput.addEventListener("blur", commit);
          requestAnimationFrame(() => {
            editInput.focus();
            editInput.select();
          });
        } else {
          const span = document.createElement("span");
          span.className = "item-name";
          span.textContent = item.name;
          span.title = item.name;
          main.appendChild(span);

          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "icon-btn";
          editBtn.textContent = "✎";
          editBtn.disabled = spinning;
          editBtn.setAttribute("aria-label", `${item.name} 이름 수정`);
          editBtn.addEventListener("click", () => {
            playClick();
            editingItemId = item.id;
            renderCategoryBoard();
          });
          main.appendChild(editBtn);
        }

        const removeItemBtn = document.createElement("button");
        removeItemBtn.type = "button";
        removeItemBtn.className = "icon-btn";
        removeItemBtn.textContent = "✕";
        removeItemBtn.disabled = spinning;
        removeItemBtn.setAttribute("aria-label", `${item.name} 삭제`);
        removeItemBtn.addEventListener("click", async () => {
          playClick();
          const ok = await showConfirm(`"${item.name}" 항목을 정말 제거하시겠습니까?`);
          if (!ok) return;
          const idx = category.items.indexOf(item);
          if (idx !== -1) category.items.splice(idx, 1);
          renderAll();
        });
        main.appendChild(removeItemBtn);

        li.appendChild(main);

        const stats = document.createElement("div");
        stats.className = "item-stats";
        stats.textContent = formatWinStats(item);
        li.appendChild(stats);

        li.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", String(itemIndex));
          e.dataTransfer.effectAllowed = "move";
        });
        li.addEventListener("dragover", (e) => {
          if (spinning) return;
          e.preventDefault();
          e.stopPropagation();
          li.classList.add("drag-over");
        });
        li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
        li.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          li.classList.remove("drag-over");
          if (spinning) return;
          const fromIndex = Number(e.dataTransfer.getData("text/plain"));
          if (Number.isNaN(fromIndex) || fromIndex === itemIndex) return;
          reorder(category.items, fromIndex, itemIndex);
          renderAll();
        });

        itemsList.appendChild(li);
      });

      column.appendChild(itemsList);

      const addItemForm = document.createElement("form");
      addItemForm.className = "add-item-form";

      const addItemInput = document.createElement("input");
      addItemInput.type = "text";
      addItemInput.placeholder = "항목 추가";
      addItemInput.maxLength = 30;
      addItemInput.disabled = spinning;
      addItemForm.appendChild(addItemInput);

      const addItemBtn = document.createElement("button");
      addItemBtn.type = "submit";
      addItemBtn.textContent = "+";
      addItemBtn.disabled = spinning;
      addItemForm.appendChild(addItemBtn);

      addItemForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const value = addItemInput.value.trim();
        if (!value) return;
        playClick();
        category.items.push({ id: makeId("item"), name: value, included: true, wins: [] });
        addItemInput.value = "";
        renderAll();
      });

      column.appendChild(addItemForm);

      column.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-category-index", String(categoryIndex));
        e.dataTransfer.effectAllowed = "move";
      });
      column.addEventListener("dragover", (e) => {
        if (spinning) return;
        if (!e.dataTransfer.types.includes("application/x-category-index")) return;
        e.preventDefault();
        column.classList.add("drag-over");
      });
      column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
      column.addEventListener("drop", (e) => {
        column.classList.remove("drag-over");
        if (spinning) return;
        const raw = e.dataTransfer.getData("application/x-category-index");
        if (raw === "") return;
        e.preventDefault();
        const fromIndex = Number(raw);
        if (Number.isNaN(fromIndex) || fromIndex === categoryIndex) return;
        reorder(categories, fromIndex, categoryIndex);
        renderAll();
      });

      categoryBoard.appendChild(column);
    });

    const addColumn = document.createElement("div");
    addColumn.className = "category-column add-column";

    if (addingCategory) {
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.className = "edit-input";
      addInput.placeholder = "카테고리 이름";
      addInput.maxLength = 20;
      addColumn.appendChild(addInput);

      let done = false;
      const commitAdd = () => {
        if (done) return;
        done = true;
        const value = addInput.value.trim();
        if (value) {
          playClick();
          categories.push({ id: makeId("cat"), name: value, items: [] });
        }
        addingCategory = false;
        renderAll();
      };
      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commitAdd();
        if (e.key === "Escape") {
          done = true;
          addingCategory = false;
          renderCategoryBoard();
        }
      });
      addInput.addEventListener("blur", commitAdd);
      requestAnimationFrame(() => addInput.focus());
    } else {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "add-category-btn";
      addBtn.textContent = "+ 카테고리 추가";
      addBtn.disabled = spinning;
      addBtn.addEventListener("click", () => {
        playClick();
        addingCategory = true;
        renderCategoryBoard();
      });
      addColumn.appendChild(addBtn);
    }

    categoryBoard.appendChild(addColumn);
    categoryBoard.scrollLeft = scrollLeft;
  }

  // ---------- Wheel items panel (cross-category selection) ----------
  function renderWheelItems() {
    wheelItemList.innerHTML = "";
    const entries = getWheelEntries();

    if (entries.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "wheel-item-empty";
      emptyLi.textContent = "포함된 항목이 없습니다. 아래 목록에서 항목의 체크박스를 선택하세요.";
      wheelItemList.appendChild(emptyLi);
    } else {
      entries.forEach((entry) => {
        const li = document.createElement("li");
        li.className = "wheel-item-badge";

        const catSpan = document.createElement("span");
        catSpan.className = "wheel-item-category";
        catSpan.textContent = entry.categoryName;
        li.appendChild(catSpan);

        const nameSpan = document.createElement("span");
        nameSpan.className = "wheel-item-name";
        nameSpan.textContent = entry.item.name;
        li.appendChild(nameSpan);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "icon-btn";
        removeBtn.textContent = "✕";
        removeBtn.disabled = spinning;
        removeBtn.setAttribute("aria-label", `${entry.categoryName} ${entry.item.name} 룰렛에서 제외`);
        removeBtn.addEventListener("click", () => {
          playClick();
          entry.item.included = false;
          renderAll();
        });
        li.appendChild(removeBtn);

        wheelItemList.appendChild(li);
      });
    }

    spinBtn.disabled = entries.length < 2 || spinning;
  }

  // ---------- Export / import wiring ----------
  exportBtn.addEventListener("click", exportState);

  importBtn.addEventListener("click", () => {
    playClick();
    importFileInput.click();
  });

  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files[0];
    importFileInput.value = "";
    if (file) importStateFromFile(file);
  });

  // ---------- Win history ----------
  resetWinsBtn.addEventListener("click", async () => {
    playClick();
    const ok = await showConfirm("정말 초기화 하시겠습니까?", "초기화", true);
    if (!ok) return;
    const backup = {};
    categories.forEach((category) => {
      category.items.forEach((item) => {
        backup[item.id] = item.wins.slice();
      });
    });
    winsBackup = backup;
    categories.forEach((category) => {
      category.items.forEach((item) => {
        item.wins = [];
      });
    });
    renderAll();
  });

  restoreWinsBtn.addEventListener("click", async () => {
    if (!winsBackup) return;
    playClick();
    const ok = await showConfirm("정말 복구하시겠습니까?", "복구", false);
    if (!ok) return;
    categories.forEach((category) => {
      category.items.forEach((item) => {
        if (Array.isArray(winsBackup[item.id])) item.wins = winsBackup[item.id].slice();
      });
    });
    winsBackup = null;
    renderAll();
  });

  // ---------- Confetti ----------
  function resizeConfettiCanvas() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeConfettiCanvas);
  resizeConfettiCanvas();

  function launchConfetti() {
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;
    const particles = Array.from({ length: 140 }, () => ({
      x: originX,
      y: originY,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 1.6) * 14,
      size: 4 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
    }));

    const duration = 2200;
    const startTime = performance.now();

    if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);

    function frame(now) {
      const elapsed = now - startTime;
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

      particles.forEach((p) => {
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rotation);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        confettiCtx.restore();
      });

      if (elapsed < duration) {
        confettiAnimationId = requestAnimationFrame(frame);
      } else {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        confettiAnimationId = null;
      }
    }

    confettiAnimationId = requestAnimationFrame(frame);
  }

  // ---------- Spin ----------
  spinBtn.addEventListener("click", () => {
    const entries = getWheelEntries();
    if (spinning || entries.length < 2) return;
    spinning = true;
    result.textContent = "돌리는 중...";
    result.classList.remove("celebrate");
    result.classList.add("spinning");
    renderAll();

    ensureAudioCtx();
    playClick();

    // Each spin gets its own duration (4-6s) and speed (0.8-1.2x of the
    // original 450°/s), so no two spins feel identical.
    const durationMs = (4 + Math.random() * 2) * 1000;
    const speedFactor = 0.8 + Math.random() * 0.4;
    const targetDegrees = BASE_DEG_PER_SEC * speedFactor * (durationMs / 1000);
    const extraSpins = Math.max(1, Math.round(targetDegrees / 360)) * 360;

    const winnerIndex = Roulette.pickWinnerIndex(entries.length);
    const sliceAngle = 360 / entries.length;
    const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
    // Slices are drawn starting from canvas angle 0 (east) going clockwise,
    // but the pointer is fixed at the top of the wheel, which is canvas
    // angle 270 (north). Rotate so the winning slice's center lands there.
    const pointerAngle = 270;
    const currentOffset = rotation % 360;
    const neededOffset = (((pointerAngle - targetSliceCenter) % 360) + 360) % 360;
    const startRotation = rotation;
    const finalRotation = rotation - currentOffset + extraSpins + neededOffset;

    rotation = finalRotation;
    canvas.style.transitionDuration = `${durationMs / 1000}s`;
    canvas.style.transform = `rotate(${rotation}deg)`;

    scheduleSpinTicks(startRotation, finalRotation, sliceAngle, durationMs);

    canvas.addEventListener(
      "transitionend",
      () => {
        spinning = false;
        const winner = entries[winnerIndex];
        const now = Date.now();
        winner.item.wins = winner.item.wins.filter((t) => now - t <= MONTH_MS);
        winner.item.wins.push(now);

        result.textContent = `결과: ${winner.categoryName} ${winner.item.name}`;
        result.classList.remove("spinning");
        result.classList.add("celebrate");
        renderAll();
        launchConfetti();
        playFanfare();
      },
      { once: true }
    );
  });

  // ---------- Init ----------
  if (!loadState()) categories = createSeedCategories();
  volumeSlider.value = String(Math.round(masterVolume * 100));
  applyVolume();
  renderAll();
})();
