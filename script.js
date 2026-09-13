(function () {
  const COLORS = ["#ff5470", "#ff9f5a", "#ffd166", "#06d6a0", "#118ab2", "#8338ec"];
  const CONFETTI_COLORS = ["#ff5470", "#ff9f5a", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#ffffff"];

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const confettiCanvas = document.getElementById("confetti-canvas");
  const confettiCtx = confettiCanvas.getContext("2d");

  const categoryList = document.getElementById("category-list");
  const wheelItemList = document.getElementById("wheel-item-list");
  const itemForm = document.getElementById("add-form");
  const itemInput = document.getElementById("item-input");
  const itemList = document.getElementById("item-list");
  const spinBtn = document.getElementById("spin-btn");
  const result = document.getElementById("result");

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

  let activeCategoryId = categories[0].id;
  let editingCategoryId = null;
  let addingCategory = false;
  let editingItemId = null;

  let rotation = 0;
  let spinning = false;
  let audioCtx = null;
  let confettiAnimationId = null;

  function getActiveCategory() {
    return categories.find((c) => c.id === activeCategoryId) || null;
  }

  function getActiveItems() {
    const category = getActiveCategory();
    return category ? category.items : [];
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
    renderCategories();
    renderItems();
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

  // ---------- Category bar ----------
  function renderCategories() {
    categoryList.innerHTML = "";

    categories.forEach((category, index) => {
      const li = document.createElement("li");
      li.className = "category-chip";
      if (category.id === activeCategoryId) li.classList.add("active");
      li.draggable = !spinning && editingCategoryId !== category.id;

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.setAttribute("aria-hidden", "true");
      li.appendChild(handle);

      if (editingCategoryId === category.id) {
        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "edit-input";
        editInput.value = category.name;
        editInput.maxLength = 20;
        li.appendChild(editInput);

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
            renderCategories();
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
        nameSpan.addEventListener("click", () => {
          if (spinning) return;
          activeCategoryId = category.id;
          renderAll();
        });
        li.appendChild(nameSpan);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-btn";
        editBtn.textContent = "✎";
        editBtn.disabled = spinning;
        editBtn.setAttribute("aria-label", `${category.name} 이름 수정`);
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          editingCategoryId = category.id;
          renderCategories();
        });
        li.appendChild(editBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn";
      removeBtn.textContent = "✕";
      removeBtn.disabled = spinning;
      removeBtn.setAttribute("aria-label", `${category.name} 삭제`);
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        categories.splice(index, 1);
        if (activeCategoryId === category.id) {
          activeCategoryId = categories.length ? categories[0].id : null;
        }
        renderAll();
      });
      li.appendChild(removeBtn);

      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragover", (e) => {
        if (spinning) return;
        e.preventDefault();
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (spinning) return;
        const fromIndex = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isNaN(fromIndex) || fromIndex === index) return;
        reorder(categories, fromIndex, index);
        renderCategories();
      });

      categoryList.appendChild(li);
    });

    const addLi = document.createElement("li");
    addLi.className = "category-chip add-chip";

    if (addingCategory) {
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.className = "edit-input";
      addInput.placeholder = "카테고리 이름";
      addInput.maxLength = 20;
      addLi.appendChild(addInput);

      const commitAdd = () => {
        const value = addInput.value.trim();
        if (value) {
          const newCategory = { id: makeId("cat"), name: value, items: [] };
          categories.push(newCategory);
          activeCategoryId = newCategory.id;
        }
        addingCategory = false;
        renderAll();
      };
      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commitAdd();
        if (e.key === "Escape") {
          addingCategory = false;
          renderCategories();
        }
      });
      addInput.addEventListener("blur", commitAdd);
      requestAnimationFrame(() => addInput.focus());
    } else {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ 카테고리";
      addBtn.disabled = spinning;
      addBtn.addEventListener("click", () => {
        addingCategory = true;
        renderCategories();
      });
      addLi.appendChild(addBtn);
    }

    categoryList.appendChild(addLi);
  }

  // ---------- Item list (per category) ----------
  function renderItems() {
    itemList.innerHTML = "";
    const items = getActiveItems();
    const activeCategory = getActiveCategory();

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.draggable = !spinning && editingItemId !== item.id;

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.setAttribute("aria-hidden", "true");
      li.appendChild(handle);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "item-checkbox";
      checkbox.checked = item.included;
      checkbox.disabled = spinning;
      checkbox.setAttribute("aria-label", `${item.name} 룰렛에 포함`);
      checkbox.addEventListener("change", () => {
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
          renderItems();
          renderWheelItems();
          drawWheel();
        };
        editInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            editingItemId = null;
            renderItems();
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
        li.appendChild(span);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-btn";
        editBtn.textContent = "✎";
        editBtn.disabled = spinning;
        editBtn.setAttribute("aria-label", `${item.name} 이름 수정`);
        editBtn.addEventListener("click", () => {
          editingItemId = item.id;
          renderItems();
        });
        li.appendChild(editBtn);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn";
      removeBtn.textContent = "✕";
      removeBtn.disabled = spinning;
      removeBtn.setAttribute("aria-label", `${item.name} 삭제`);
      removeBtn.addEventListener("click", () => {
        items.splice(index, 1);
        renderItems();
        renderWheelItems();
        drawWheel();
      });
      li.appendChild(removeBtn);

      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragover", (e) => {
        if (spinning) return;
        e.preventDefault();
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (spinning) return;
        const fromIndex = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isNaN(fromIndex) || fromIndex === index) return;
        reorder(items, fromIndex, index);
        renderItems();
        renderWheelItems();
        drawWheel();
      });

      itemList.appendChild(li);
    });

    itemForm.hidden = !activeCategory;
    itemInput.disabled = spinning;
  }

  itemForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = itemInput.value.trim();
    const activeCategory = getActiveCategory();
    if (!value || !activeCategory) return;
    activeCategory.items.push({ id: makeId("item"), name: value, included: true });
    itemInput.value = "";
    renderItems();
    renderWheelItems();
    drawWheel();
  });

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
          entry.item.included = false;
          renderAll();
        });
        li.appendChild(removeBtn);

        wheelItemList.appendChild(li);
      });
    }

    spinBtn.disabled = entries.length < 2 || spinning;
  }

  // ---------- Winner effects ----------
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
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.35);
      });
    } catch (e) {
      // Ignore playback failures (e.g. autoplay restrictions).
    }
  }

  // ---------- Spin ----------
  spinBtn.addEventListener("click", () => {
    const entries = getWheelEntries();
    if (spinning || entries.length < 2) return;
    spinning = true;
    result.textContent = "";
    result.classList.remove("celebrate");
    renderCategories();
    renderItems();
    renderWheelItems();

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx && AudioCtxClass) audioCtx = new AudioCtxClass();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

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
    const finalRotation = rotation - currentOffset + extraSpins + neededOffset;

    rotation = finalRotation;
    canvas.style.transform = `rotate(${rotation}deg)`;

    canvas.addEventListener(
      "transitionend",
      () => {
        spinning = false;
        renderCategories();
        renderItems();
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

  renderAll();
})();
