import json
import os
import shutil
import subprocess
import tempfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_SLIDES = int(os.environ.get("CONVERTER_MAX_SLIDES", "300"))
RENDER_DPI = int(os.environ.get("CONVERTER_RENDER_DPI", "144"))
OFFICE_TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_OFFICE_TIMEOUT_SECONDS", "240"))
PAGE_TIMEOUT_SECONDS = int(os.environ.get("CONVERTER_PAGE_TIMEOUT_SECONDS", "60"))
SUPPORTED_EXTENSIONS = {".pdf", ".ppt", ".pptx", ".odp"}


class ConvertHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/convert":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            slides = convert(
                Path(payload["sourcePath"]).resolve(),
                Path(payload["outputDir"]).resolve(),
                payload["outputPrefix"].strip("/"),
            )
            self.respond(200, {"slides": slides})
        except Exception as exc:
            self.respond(500, {"error": human_error(exc)})

    def log_message(self, fmt, *args):
        return

    def respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def convert(source: Path, output_dir: Path, output_prefix: str):
    ensure_under(source, output_dir)
    if not source.exists():
        raise FileNotFoundError(source)
    if source.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError("Поддерживаются только PDF, PPT, PPTX и ODP")
    with tempfile.TemporaryDirectory() as tmp_raw:
        tmp = Path(tmp_raw)
        pdf = source if source.suffix.lower() == ".pdf" else office_to_pdf(source, tmp)
        page_count = pdf_page_count(pdf)
        if page_count <= 0:
            raise RuntimeError("PDF не содержит страниц")
        slide_count = min(page_count, MAX_SLIDES)
        target_dir = output_dir / output_prefix
        ensure_under(target_dir, output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        slides = []
        for index in range(1, slide_count + 1):
            target = target_dir / f"slide-{index}.png"
            image = render_page(pdf, index, tmp)
            if image is None:
                write_placeholder_png(target, f"Слайд {index} — ошибка отображения")
            else:
                shutil.copyfile(image, target)
            text = page_text(pdf, index, tmp)
            slides.append({
                "index": index,
                "imageRef": f"{output_prefix}/slide-{index}.png",
                "textExtract": text,
            })
        if page_count > MAX_SLIDES:
            slides[-1]["textExtract"] = (
                slides[-1]["textExtract"] + "\n\n"
                if slides[-1]["textExtract"] else ""
            ) + f"Импорт ограничен первыми {MAX_SLIDES} слайдами из {page_count}."
        return slides


def office_to_pdf(source: Path, tmp: Path):
    run([
        "soffice",
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
    pdfs = list(tmp.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError("LibreOffice produced no PDF")
    return pdfs[0]


def pdf_page_count(pdf: Path):
    result = run(["pdfinfo", str(pdf)], timeout=30)
    for line in result.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    raise RuntimeError("pdfinfo did not return page count")


def render_page(pdf: Path, page: int, tmp: Path):
    prefix = tmp / f"slide-{page}"
    try:
        run([
            "pdftoppm",
            "-png",
            "-r",
            str(RENDER_DPI),
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
    return image if image.exists() else None


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
        return "Конвертация заняла слишком много времени. Попробуйте сохранить презентацию как PDF и загрузить PDF."
    if isinstance(exc, subprocess.CalledProcessError):
        output = " ".join(part for part in [exc.stdout, exc.stderr] if part).strip()
        if "source file could not be loaded" in output.lower():
            return "LibreOffice не смог открыть файл. Проверьте, что PPTX не повреждён, или сохраните его как PDF."
        if "incorrect password" in output.lower() or "encrypted" in output.lower():
            return "Файл защищён паролем или зашифрован. Снимите защиту и загрузите заново."
        return f"Ошибка конвертации: {output[:500] or exc}"
    message = str(exc)
    if "zip bomb" in message.lower():
        return "PPTX похож на zip-bomb или содержит слишком сильно сжатые вложения. Сохраните презентацию как PDF."
    return message


def write_placeholder_png(path: Path, text: str):
    width, height = 1280, 720
    png = make_placeholder_png(width, height)
    path.write_bytes(png)


def make_placeholder_png(width: int, height: int):
    # Minimal RGB PNG. The text is intentionally not rendered to avoid pulling image libraries into the converter.
    row = bytes([0]) + bytes([248, 240, 240]) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00")
        + png_chunk(b"IDAT", zlib.compress(raw, level=6))
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
