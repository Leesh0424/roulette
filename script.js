(function () {
  const COLORS = ["#ff5470", "#ff9f5a", "#ffd166", "#06d6a0", "#118ab2", "#8338ec"];

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const form = document.getElementById("add-form");
  const input = document.getElementById("item-input");
  const list = document.getElementById("item-list");
  const spinBtn = document.getElementById("spin-btn");
  const result = document.getElementById("result");

  let items = ["피자", "치킨", "초밥", "떡볶이"];
  let rotation = 0;
  let spinning = false;

  function drawWheel() {
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 4;
    ctx.clearRect(0, 0, size, size);

    if (items.length === 0) {
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ddd";
      ctx.fill();
      return;
    }

    const sliceAngle = (Math.PI * 2) / items.length;
    items.forEach((label, i) => {
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
      ctx.fillText(label, radius - 12, 6);
      ctx.restore();
    });
  }

  function renderList() {
    list.innerHTML = "";
    items.forEach((label, i) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = label;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", `${label} 삭제`);
      removeBtn.addEventListener("click", () => {
        items.splice(i, 1);
        renderList();
        drawWheel();
      });
      li.append(span, removeBtn);
      list.appendChild(li);
    });
    spinBtn.disabled = items.length < 2 || spinning;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    items.push(value);
    input.value = "";
    renderList();
    drawWheel();
  });

  spinBtn.addEventListener("click", () => {
    if (spinning || items.length < 2) return;
    spinning = true;
    result.textContent = "";
    spinBtn.disabled = true;

    const winnerIndex = Roulette.pickWinnerIndex(items.length);
    const sliceAngle = 360 / items.length;
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
        renderList();
        result.textContent = `결과: ${items[winnerIndex]}`;
      },
      { once: true }
    );
  });

  renderList();
  drawWheel();
})();
