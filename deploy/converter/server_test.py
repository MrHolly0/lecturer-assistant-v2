import http.client
import json
import threading
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

import server


class ConverterAdmissionTest(unittest.TestCase):
    def test_busy_converter_rejects_without_queue_and_health_stays_available(self):
        started = threading.Event()
        release = threading.Event()

        def convert(**kwargs):
            started.set()
            release.wait(5)
            kwargs["emit"]({"type": "complete", "totalSlides": 1, "renderedSlides": 1})

        with patch.object(server, "CONVERSION_SEMAPHORE", threading.BoundedSemaphore(1)), \
                patch.object(server, "stream_convert", convert), patch.object(server, "CONVERTER_KEY", "test") :
            httpd = server.BoundedHTTPServer(("127.0.0.1", 0), server.ConvertHandler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            port = httpd.server_address[1]
            first = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            second = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            try:
                payload = json.dumps({"jobId": "test", "sourcePath": "/data/test.pdf",
                                      "outputDir": "/data", "outputPrefix": "test"})
                first.request("POST", "/convert", payload, headers={"X-Converter-Key":"test"})
                self.assertTrue(started.wait(2))
                second.request("POST", "/convert", payload, headers={"X-Converter-Key":"test"})
                response = second.getresponse()
                self.assertEqual(503, response.status)
                self.assertEqual("3", response.getheader("Retry-After"))
                response.read()
                second.request("GET", "/health")
                response = second.getresponse()
                self.assertEqual(200, response.status)
                response.read()
                release.set()
                response = first.getresponse()
                self.assertEqual(200, response.status)
                self.assertIn(b'"type": "complete"', response.read())
            finally:
                release.set()
                first.close()
                second.close()
                httpd.shutdown()
                httpd.server_close()
                thread.join(2)


class PageTextBudgetTest(unittest.TestCase):
    def test_unicode_extract_is_bounded_and_image_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "text.txt"
            file.write_bytes(("Текст 😀漢字" * 100000).encode("utf-8"))
            text = server.bounded_page_text(file)
            self.assertLessEqual(len(text.encode("utf-8")), server.MAX_PAGE_TEXT_BYTES)
            self.assertTrue(text.endswith(server.TEXT_TRUNCATED_MARKER))
            self.assertNotIn("\ufffd", text)
            self.assertTrue(text.startswith("Текст 😀漢字"))

    def test_small_unicode_extract_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "text.txt"
            file.write_text("  Привет 😀\n", encoding="utf-8")
            self.assertEqual("Привет 😀", server.bounded_page_text(file))


if __name__ == "__main__":
    unittest.main()

class ConversionBoundaryTest(unittest.TestCase):
    def test_job_cannot_choose_another_document_root(self):
        import uuid
        with tempfile.TemporaryDirectory() as raw, patch.object(server, 'CONVERSION_ROOT', Path(raw).resolve()):
            job=str(uuid.uuid4());other=Path(raw)/'other';other.mkdir();source=other/'input.pdf';source.write_bytes(b'%PDF-test')
            with self.assertRaisesRegex(ValueError,'assigned job'):
                server.stream_convert(job,source,other,'output',lambda event:None)

    def test_total_deadline_kills_a_slow_native_process(self):
        import time,sys,subprocess
        with patch.object(server.BUDGET,'deadline',time.monotonic()+.15,create=True):
            with self.assertRaises((TimeoutError,subprocess.TimeoutExpired)):
                server.run([sys.executable,'-c','import time;time.sleep(30)'],60)

    def test_process_log_budget_stops_output_flood(self):
        import time,sys
        with patch.object(server.BUDGET,'deadline',time.monotonic()+5,create=True):
            with self.assertRaisesRegex(ValueError,'log exceeds'):
                server.run([sys.executable,'-c','import sys,time;sys.stdout.write("x"*1100000);sys.stdout.flush();time.sleep(3)'],10)
