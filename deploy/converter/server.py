import json
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


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
            self.respond(500, {"error": str(exc)})

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
    with tempfile.TemporaryDirectory() as tmp_raw:
        tmp = Path(tmp_raw)
        pdf = source if source.suffix.lower() == ".pdf" else office_to_pdf(source, tmp)
        target_dir = output_dir / output_prefix
        ensure_under(target_dir, output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        prefix = tmp / "slide"
        subprocess.run(["pdftoppm", "-png", "-r", "144", str(pdf), str(prefix)], check=True)
        images = sorted(tmp.glob("slide-*.png"))
        if not images:
            raise RuntimeError("pdftoppm produced no slides")
        slides = []
        for index, image in enumerate(images, start=1):
            target = target_dir / f"slide-{index}.png"
            shutil.copyfile(image, target)
            text = page_text(pdf, index, tmp)
            slides.append({
                "index": index,
                "imageRef": f"{output_prefix}/slide-{index}.png",
                "textExtract": text,
            })
        return slides


def office_to_pdf(source: Path, tmp: Path):
    subprocess.run([
        "soffice",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(tmp),
        str(source),
    ], check=True, timeout=120)
    pdfs = list(tmp.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError("LibreOffice produced no PDF")
    return pdfs[0]


def page_text(pdf: Path, page: int, tmp: Path):
    text_file = tmp / f"slide-{page}.txt"
    subprocess.run([
        "pdftotext",
        "-layout",
        "-f",
        str(page),
        "-l",
        str(page),
        str(pdf),
        str(text_file),
    ], check=True)
    return text_file.read_text(encoding="utf-8", errors="ignore").strip()


def ensure_under(path: Path, root: Path):
    if root not in path.parents and path != root:
        raise ValueError("path escapes blob root")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), ConvertHandler).serve_forever()
