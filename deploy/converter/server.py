import json
import os
import shutil
import subprocess
import tempfile
import threading
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_SLIDES = int(os.environ.get("CONVERTER_MAX_SLIDES", "300"))
BASE_DPI = int(os.environ.get("CONVERTER_BASE_DPI", "150"))
LARGE_DECK_THRESHOLD = int(os.environ.get("CONVERTER_LARGE_DECK_THRESHOLD", "120"))
LARGE_FILE_BYTES = int(os.environ.get("CONVERTER_LARGE_FILE_BYTES", str(80 * 1024 * 1024)))
LARGE_DECK_DPI = int(os.environ.get("CONVERTER_LARGE_DECK_DPI", "110"))
MAX_LONG_EDGE = int(os.environ.get("CONVERTER_MAX_LONG_EDGE", "1600"))
OFFICE_TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_OFFICE_TIMEOUT_SECONDS", "240"))
OFFICE_QUEUE_TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_OFFICE_QUEUE_TIMEOUT_SECONDS", "600"))
PAGE_TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_PAGE_TIMEOUT_SECONDS", "60"))
SOFFICE_CONCURRENCY = int(os.environ.get("CONVERTER_SOFFICE_CONCURRENCY", "1"))
ZIP_BOMB_RATIO = int(os.environ.get("CONVERTER_ZIP_BOMB_RATIO", "120"))
ZIP_BOMB_UNCOMPRESSED_BYTES = int(os.environ.get("CONVERTER_ZIP_BOMB_UNCOMPRESSED_BYTES", str(350 * 1024 * 1024)))
SUPPORTED_EXTENSIONS = {".pdf", ".ppt", ".pptx", ".odp"}
SOFFICE_SEMAPHORE = threading.BoundedSemaphore(max(1, SOFFICE_CONCURRENCY))


class ConvertHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/convert":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.end_headers()
        try:
            body = self.read_request_body()
            if not body:
                raise ValueError("Пустой запрос к converter: core не передал JSON payload")
            payload = json.loads(body.decode("utf-8"))
            stream_convert(
                job_id=payload["jobId"],
                source=Path(payload["sourcePath"]).resolve(),
                output_dir=Path(payload["outputDir"]).resolve(),
                output_prefix=payload["outputPrefix"].strip("/"),
                emit=self.emit,
            )
        except Exception as exc:
            self.emit({"type": "error", "errorMessage": human_error(exc)})

    def log_message(self, fmt, *args):
        return

    def emit(self, payload):
        self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        self.wfile.flush()

    def read_request_body(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            chunks = []
            while True:
                size_line = self.rfile.readline().strip().split(b";", 1)[0]
                if not size_line:
                    raise ValueError("Некорректный chunked-запрос к converter")
                size = int(size_line, 16)
                if size == 0:
                    while self.rfile.readline().strip():
                        pass
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)
            return b"".join(chunks)
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)


def stream_convert(job_id: str, source: Path, output_dir: Path, output_prefix: str, emit):
    ensure_under(source, output_dir)
    if not source.exists() or source.stat().st_size == 0:
        raise ValueError("Файл пустой или не найден")
    validate_source(source)
    with tempfile.TemporaryDirectory() as tmp_raw:
        tmp = Path(tmp_raw)
        pdf = source if source.suffix.lower() == ".pdf" else office_to_pdf(source, tmp, job_id)
        page_count = pdf_page_count(pdf)
        if page_count <= 0:
            raise RuntimeError("PDF не содержит страниц")

        render_count = min(page_count, MAX_SLIDES)
        dpi = choose_dpi(page_count, source.stat().st_size)
        warning = warning_message(page_count, render_count, dpi)
        target_dir = output_dir / output_prefix
        ensure_under(target_dir, output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        emit({
            "type": "metadata",
            "phase": f"RENDERING 0/{page_count}",
            "totalSlides": page_count,
            "renderedSlides": render_count,
            "warningMessage": warning,
        })

        processed = 0
        for index in range(1, render_count + 1):
            target = target_dir / f"slide-{index}.png"
            placeholder = False
            render_error = None
            image = render_page(pdf, index, tmp, dpi)
            if image is None:
                placeholder = True
                render_error = f"Слайд {index}: ошибка рендера"
                write_placeholder_png(target, render_error)
            else:
                shutil.copyfile(image, target)
            text = page_text(pdf, index, tmp)
            if render_error:
                text = (text + "\n\n" if text else "") + render_error
            processed = index
            emit({
                "type": "slide",
                "index": index,
                "imageRef": f"{output_prefix}/slide-{index}.png",
                "textExtract": text,
                "placeholder": placeholder,
                "processedSlides": processed,
                "totalSlides": page_count,
            })

        emit({
            "type": "done",
            "totalSlides": page_count,
            "renderedSlides": processed,
            "partial": processed < page_count,
            "warningMessage": warning,
        })


def validate_source(source: Path):
    suffix = source.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError("Поддерживаются только PDF, PPT, PPTX и ODP")
    with source.open("rb") as file:
        header = file.read(8)
    if suffix == ".pdf" and not header.startswith(b"%PDF"):
        raise ValueError("Файл не похож на PDF или повреждён")
    if suffix in {".pptx", ".odp"}:
        if not header.startswith(b"PK"):
            raise ValueError("Файл не похож на ZIP-based Office документ")
        validate_zip_safety(source)
    if suffix == ".ppt" and header != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ValueError("Файл не похож на старый PowerPoint PPT")


def validate_zip_safety(source: Path):
    try:
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            compressed = sum(max(info.compress_size, 1) for info in infos)
            uncompressed = sum(info.file_size for info in infos)
    except zipfile.BadZipFile as exc:
        raise ValueError("ZIP-структура PPTX/ODP повреждена") from exc
    if uncompressed > ZIP_BOMB_UNCOMPRESSED_BYTES or uncompressed / max(compressed, 1) > ZIP_BOMB_RATIO:
        raise ValueError("PPTX похож на zip-bomb или содержит слишком сильно сжатые вложения")


def choose_dpi(page_count: int, source_size: int):
    if page_count > LARGE_DECK_THRESHOLD or source_size > LARGE_FILE_BYTES:
        return LARGE_DECK_DPI
    return BASE_DPI


def warning_message(page_count: int, render_count: int, dpi: int):
    warnings = []
    if render_count < page_count:
        warnings.append(f"Импортировано {render_count} из {page_count}; остальное загрузите отдельным файлом")
    if dpi < BASE_DPI:
        warnings.append(f"Для большой презентации качество снижено до {dpi} DPI")
    return ". ".join(warnings) if warnings else None


def office_to_pdf(source: Path, tmp: Path, job_id: str):
    profile = Path(tempfile.gettempdir()) / f"lo-{job_id}"
    profile.mkdir(parents=True, exist_ok=True)
    if not SOFFICE_SEMAPHORE.acquire(timeout=OFFICE_QUEUE_TIMEOUT_SECONDS):
        raise TimeoutError("Очередь LibreOffice переполнена. Попробуйте импорт позже.")
    try:
        run([
            "soffice",
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--nolockcheck",
            "--nodefault",
            "--convert-to",
            "pdf",
            "--outdir",
            str(tmp),
            str(source),
        ], timeout=OFFICE_TIMEOUT_SECONDS)
    finally:
        SOFFICE_SEMAPHORE.release()
        shutil.rmtree(profile, ignore_errors=True)
    pdfs = list(tmp.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError("LibreOffice вернул 0 PDF-файлов")
    return pdfs[0]


def pdf_page_count(pdf: Path):
    result = run(["pdfinfo", str(pdf)], timeout=30)
    pages = None
    encrypted = False
    for line in result.stdout.splitlines():
        if line.startswith("Pages:"):
            pages = int(line.split(":", 1)[1].strip())
        if "Encrypted:" in line and "yes" in line.lower():
            encrypted = True
    if encrypted:
        raise RuntimeError("PDF защищён паролем или зашифрован")
    if pages is not None:
        return pages
    raise RuntimeError("pdfinfo не вернул число страниц")


def render_page(pdf: Path, page: int, tmp: Path, dpi: int):
    prefix = tmp / f"slide-{page}"
    try:
        run([
            "pdftoppm",
            "-png",
            "-r",
            str(dpi),
            "-scale-to",
            str(MAX_LONG_EDGE),
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            str(pdf),
            str(prefix),
        ], timeout=PAGE_TIMEOUT_SECONDS)
    except Exception:
        return None
    image = prefix.with_suffix(".png")
    return image if image.exists() and image.stat().st_size > 0 else None


def page_text(pdf: Path, page: int, tmp: Path):
    text_file = tmp / f"slide-{page}.txt"
    try:
        run([
            "pdftotext",
            "-layout",
            "-f",
            str(page),
            "-l",
            str(page),
            str(pdf),
            str(text_file),
        ], timeout=PAGE_TIMEOUT_SECONDS)
        return text_file.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        return ""


def run(args, timeout):
    return subprocess.run(
        args,
        check=True,
        timeout=timeout,
        text=True,
        capture_output=True,
    )


def human_error(exc: Exception):
    if isinstance(exc, subprocess.TimeoutExpired):
        return "Конвертация заняла слишком много времени. Сохраните презентацию как PDF и загрузите PDF."
    if isinstance(exc, TimeoutError):
        return str(exc)
    if isinstance(exc, subprocess.CalledProcessError):
        output = " ".join(part for part in [exc.stdout, exc.stderr] if part).strip()
        lowered = output.lower()
        if "source file could not be loaded" in lowered:
            return "LibreOffice не смог открыть файл. Проверьте, что файл не повреждён."
        if "incorrect password" in lowered or "encrypted" in lowered or "password" in lowered:
            return "Файл защищён паролем или зашифрован. Снимите защиту и загрузите заново."
        if "out of memory" in lowered or "cannot allocate memory" in lowered:
            return "Конвертеру не хватило памяти. Сохраните презентацию как PDF или разделите файл."
        return f"Ошибка конвертации: {output[:500] or exc}"
    message = str(exc)
    if "zip-bomb" in message.lower():
        return "PPTX похож на zip-bomb или содержит слишком сильно сжатые вложения. Сохраните презентацию как PDF."
    return message


def write_placeholder_png(path: Path, text: str):
    width, height = 1280, 720
    png = make_placeholder_png(width, height, text)
    path.write_bytes(png)


def make_placeholder_png(width: int, height: int, text: str):
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            banner = height // 2 - 90 <= y <= height // 2 + 90
            border = x < 24 or x > width - 24 or y < 24 or y > height - 24
            diagonal = (x + y) % 80 < 20
            if border or (banner and diagonal):
                pixels.extend([185, 28, 28])
            elif banner:
                pixels.extend([254, 226, 226])
            else:
                pixels.extend([255, 247, 237])
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00")
        + png_chunk(b"tEXt", ("Description\x00" + text).encode("utf-8", errors="ignore"))
        + png_chunk(b"IDAT", zlib.compress(bytes(pixels), level=6))
        + png_chunk(b"IEND", b"")
    )


def png_chunk(kind: bytes, data: bytes):
    return (
        len(data).to_bytes(4, "big")
        + kind
        + data
        + zlib.crc32(kind + data).to_bytes(4, "big")
    )


def ensure_under(path: Path, root: Path):
    if root not in path.parents and path != root:
        raise ValueError("path escapes blob root")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), ConvertHandler).serve_forever()
