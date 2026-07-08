import argparse
import csv
import mimetypes
import re
import sys
import time
import zipfile
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

URL_RE = re.compile(r"https?://[^\s\"',<>]+", re.I)
EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


def extract_urls(path):
    seen = set()
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        for url in URL_RE.findall(line):
            if url not in seen:
                seen.add(url)
                yield url


def download(url, timeout):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 image-zipper/1.0"})
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get_content_type()
        data = response.read()
    if not content_type.startswith("image/"):
        raise ValueError(f"not image: {content_type}")
    return content_type, data


def filename(url, index, content_type):
    last = Path(urlparse(url).path).name or f"image-{index + 1}"
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", last).strip("-") or f"image-{index + 1}"
    if Path(clean).suffix:
        ext = ""
    else:
        ext = EXT_BY_TYPE.get(content_type) or mimetypes.guess_extension(content_type) or ".img"
    return f"{index + 1:06d}-{clean}{ext}"


def run(args):
    urls = list(extract_urls(args.csv))
    if not urls:
        raise SystemExit("No image URLs found.")

    started = time.time()
    ok = failed = done = 0
    failures = []
    pending = {}
    source = iter(enumerate(urls))

    with zipfile.ZipFile(args.out, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            while True:
                while len(pending) < args.workers * 2:
                    try:
                        index, url = next(source)
                    except StopIteration:
                        break
                    pending[pool.submit(download, url, args.timeout)] = (index, url)

                if not pending:
                    break

                ready, _ = wait(pending, return_when=FIRST_COMPLETED)
                for future in ready:
                    index, url = pending.pop(future)
                    try:
                        content_type, data = future.result()
                        archive.writestr(filename(url, index, content_type), data)
                        ok += 1
                    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as error:
                        failed += 1
                        failures.append([url, str(error)])
                    done += 1
                    if done == len(urls) or done % args.report_every == 0:
                        rate = done / max(time.time() - started, 0.001)
                        print(f"{done}/{len(urls)} done | {ok} ok | {failed} failed | {rate:.1f}/s", flush=True)

        if failures:
            body = csv_rows([["url", "error"], *failures])
            archive.writestr("failed-links.csv", body)

    print(f"Saved {args.out} | {ok} images | {failed} failed")


def csv_rows(rows):
    import io

    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    return buffer.getvalue()


def self_test():
    assert list(URL_RE.findall("x https://a.com/1.jpg, y")) == ["https://a.com/1.jpg"]
    assert filename("https://x.test/path/a b", 4, "image/png") == "000005-a-b.png"
    assert filename("https://x.test/path/a.jpg", 0, "image/jpeg") == "000001-a.jpg"


def parse_args():
    parser = argparse.ArgumentParser(description="Download image URLs from CSV/text into one ZIP.")
    parser.add_argument("csv", nargs="?", help="CSV/text file containing URLs")
    parser.add_argument("-o", "--out", default="images.zip", help="output ZIP path")
    parser.add_argument("-w", "--workers", type=int, default=32, help="parallel downloads")
    parser.add_argument("--timeout", type=int, default=30, help="per-image timeout in seconds")
    parser.add_argument("--report-every", type=int, default=100, help="progress print interval")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    ns = parse_args()
    if ns.self_test:
        self_test()
        print("self-test ok")
    elif not ns.csv:
        sys.exit("CSV path required.")
    else:
        run(ns)
