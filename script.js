(function () {
  const COLORS = ["#ff5470", "#ff9f5a", "#ffd166", "#06d6a0", "#118ab2", "#8338ec"];
  const CONFETTI_COLORS = ["#ff5470", "#ff9f5a", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#ffffff"];
  const SPIN_DURATION_MS = 4000;

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const confettiCanvas = document.getElementById("confetti-canvas");
  const confettiCtx = confettiCanvas.getContext("2d");

  const categoryBoard = document.getElementById("category-board");
  const wheelItemList = document.getElementById("wheel-item-list");
  const spinBtn = document.getElementById("spin-btn");
  const result = document.getElementById("result");
  const muteBtn = document.getElementById("mute-btn");
  const volumeSlider = document.getElementById("volume-slider");

  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmOkBtn = document.getElementById("confirm-ok-btn");
  const confirmCancelBtn = document.getElementById("confirm-cancel-btn");

  let nextId = 1;
  function makeId(prefix) {
    return `${prefix}-${nextId++}`;
  }

  let categories = [
    {
      id: makeId("cat"),
      name: "사업팀",
      items: [
        { id: makeId("item"), name: "김사원", included: true },
        { id: makeId("item"), name: "하대리", included: true },
      ],
    },
    {
      id: makeId("cat"),
      name: "홍보팀",
      items: [
        { id: makeId("item"), name: "박팀장", included: true },
        { id: makeId("item"), name: "이주임", included: true },
      ],
    },
  ];

  let editingCategoryId = null;
  let addingCategory = false;
  let editingItemId = null;

  let rotation = 0;
  let spinning = false;
  let confettiAnimationId = null;

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
  // fraction t, via binary search over the bezier's parametric variable
  // (fast/simple enough for scheduling a few dozen ticks, no need for
  // Newton-Raphson precision).
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
  function scheduleSpinTicks(startRotation, endRotation, sliceAngle) {
    if (!audioCtx) return;
    const pointerAngle = 270;
    const totalDelta = endRotation - startRotation;
    if (totalDelta <= 0) return;

    const phase = ((pointerAngle % sliceAngle) + sliceAngle) % sliceAngle;
    let firstBoundary = startRotation + (((phase - startRotation) % sliceAngle) + sliceAngle) % sliceAngle;
    if (firstBoundary <= startRotation) firstBoundary += sliceAngle;

    const baseTime = audioCtx.currentTime;
    for (let r = firstBoundary; r <= endRotation; r += sliceAngle) {
      const progress = (r - startRotation) / totalDelta;
      const timeFraction = findTimeFractionForProgress(progress);
      scheduleTick(baseTime + (timeFraction * SPIN_DURATION_MS) / 1000);
    }
  }

  muteBtn.addEventListener("click", () => {
    ensureAudioCtx();
    muted = !muted;
    applyVolume();
    playClick();
  });

  volumeSlider.addEventListener("input", () => {
    masterVolume = Number(volumeSlider.value) / 100;
    if (masterVolume > 0) muted = false;
    applyVolume();
  });

  // ---------- Confirm dialog ----------
  function showConfirm(message) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
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

  // The wheel spins over items marked "included", regardless of which
  // category they belong to, so a single roulette can mix e.g. 사업팀's
  // 김사원 with 홍보팀's 박팀장. Each entry keeps a reference to the real
  // item object (not a copy) so callers can mutate `included` back.
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

  function renderAll() {
    renderCategoryBoard();
    renderWheelItems();
    drawWheel();
  }

  // ---------- Wheel ----------
  function drawWheel() {
    const entries = getWheelEntries();
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 4;
    ctx.clearRect(0, 0, size, size);

    if (entries.length === 0) {
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ddd";
      ctx.fill();
      return;
    }

    const sliceAngle = (Math.PI * 2) / entries.length;
    entries.forEach((entry, i) => {
      const start = i * sliceAngle;
      const end = start + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(start + sliceAngle / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillText(entry.item.name, radius - 12, 6);
      ctx.restore();
    });
  }

  // ---------- Category board ----------
  function renderCategoryBoard() {
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

      if (editingCategoryId === category.id) {
        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "edit-input";
        editInput.value = category.name;
        editInput.maxLength = 20;
        header.appendChild(editInput);

        const commit = () => {
          const value = editInput.value.trim();
          if (value) category.name = value;
          editingCategoryId = null;
          renderAll();
        };
        editInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
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
        const ok = await showConfirm(`"${category.name}" 카테고리와 그 안의 모든 항목을 정말 제거하시겠습니까?`);
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

        const itemHandle = document.createElement("span");
        itemHandle.className = "drag-handle";
        itemHandle.textContent = "⋮⋮";
        itemHandle.setAttribute("aria-hidden", "true");
        li.appendChild(itemHandle);

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
        });
        li.appendChild(checkbox);

        if (editingItemId === item.id) {
          const editInput = document.createElement("input");
          editInput.type = "text";
          editInput.className = "edit-input";
          editInput.value = item.name;
          editInput.maxLength = 30;
          li.appendChild(editInput);

          const commit = () => {
            const value = editInput.value.trim();
            if (value) item.name = value;
            editingItemId = null;
            renderCategoryBoard();
            renderWheelItems();
            drawWheel();
          };
          editInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
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
          li.appendChild(span);

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
          li.appendChild(editBtn);
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
          renderCategoryBoard();
          renderWheelItems();
          drawWheel();
        });
        li.appendChild(removeItemBtn);

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
          renderCategoryBoard();
          renderWheelItems();
          drawWheel();
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
        category.items.push({ id: makeId("item"), name: value, included: true });
        addItemInput.value = "";
        renderCategoryBoard();
        renderWheelItems();
        drawWheel();
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
        renderCategoryBoard();
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

      const commitAdd = () => {
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
    result.textContent = "";
    result.classList.remove("celebrate");
    renderCategoryBoard();
    renderWheelItems();

    ensureAudioCtx();
    playClick();

    const winnerIndex = Roulette.pickWinnerIndex(entries.length);
    const sliceAngle = 360 / entries.length;
    const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
    const extraSpins = 5 * 360;
    // Slices are drawn starting from canvas angle 0 (east) going clockwise,
    // but the pointer is fixed at the top of the wheel, which is canvas
    // angle 270 (north). Rotate so the winning slice's center lands there.
    const pointerAngle = 270;
    const currentOffset = rotation % 360;
    const neededOffset = ((pointerAngle - targetSliceCenter) % 360 + 360) % 360;
    const startRotation = rotation;
    const finalRotation = rotation - currentOffset + extraSpins + neededOffset;

    scheduleSpinTicks(startRotation, finalRotation, sliceAngle);

    rotation = finalRotation;
    canvas.style.transform = `rotate(${rotation}deg)`;

    canvas.addEventListener(
      "transitionend",
      () => {
        spinning = false;
        renderCategoryBoard();
        renderWheelItems();
        const winner = entries[winnerIndex];
        result.textContent = `결과: ${winner.categoryName} ${winner.item.name}`;
        result.classList.add("celebrate");
        launchConfetti();
        playFanfare();
      },
      { once: true }
    );
  });

  applyVolume();
  renderAll();
})();
