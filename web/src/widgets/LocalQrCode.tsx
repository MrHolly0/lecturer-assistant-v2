interface LocalQrCodeProps {
  value: string;
  label: string;
}

const SIZE = 25;

export function LocalQrCode({ value, label }: LocalQrCodeProps) {
  const cells = qrCells(value);
  return (
    <div className="qr-card" aria-label={label} title={value}>
      <div className="qr-grid">
        {cells.map((filled, index) => (
          <span key={index} className={filled ? "qr-cell qr-cell--filled" : "qr-cell"} />
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}

function qrCells(value: string): boolean[] {
  const cells = Array.from({ length: SIZE * SIZE }, () => false);
  drawFinder(cells, 1, 1);
  drawFinder(cells, SIZE - 8, 1);
  drawFinder(cells, 1, SIZE - 8);
  let seed = hash(value);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (isFinderArea(x, y)) continue;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      cells[y * SIZE + x] = ((seed >>> ((x + y) % 16)) & 1) === 1;
    }
  }
  return cells;
}

function drawFinder(cells: boolean[], startX: number, startY: number) {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const border = x === 0 || y === 0 || x === 6 || y === 6;
      const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      cells[(startY + y) * SIZE + startX + x] = border || center;
    }
  }
}

function isFinderArea(x: number, y: number) {
  return (x < 9 && y < 9) || (x > SIZE - 10 && y < 9) || (x < 9 && y > SIZE - 10);
}

function hash(value: string) {
  let seed = 2166136261;
  for (const char of value) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}
