"""PubMed 연도별 논문 수 수집기.

topics.yaml의 각 주제 검색식에 대해 연도별 PubMed 논문 수를 세어
data/ 폴더에 JSON으로 저장합니다. 검색 건수만 세므로(rettype=count)
요금이 없고, NCBI 속도 제한(키 없음 초당 3건, 키 있음 초당 10건)만 지킵니다.

사용법:
    python scripts/fetch_pubmed.py              # 전체 수집
    python scripts/fetch_pubmed.py --only glp1  # 특정 주제만 (테스트용)

환경 변수:
    NCBI_API_KEY  (선택) NCBI API 키. GitHub Secrets에 넣어 사용
    NCBI_EMAIL    (선택) NCBI 권장 연락처 이메일
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
TOPICS_FILE = ROOT / "topics.yaml"
DATA_DIR = ROOT / "data"
ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"

API_KEY = os.environ.get("NCBI_API_KEY", "").strip()
EMAIL = os.environ.get("NCBI_EMAIL", "").strip()
# 제한보다 약간 느리게: 키 있음 초당 약 8건, 없음 초당 약 2.5건
DELAY = 0.125 if API_KEY else 0.4
MAX_RETRY = 5


def count(term: str) -> int:
    """PubMed 검색 결과 건수만 반환."""
    params = {"db": "pubmed", "term": term, "rettype": "count", "retmode": "json",
              "tool": "topic-trends"}
    if API_KEY:
        params["api_key"] = API_KEY
    if EMAIL:
        params["email"] = EMAIL
    url = ESEARCH + "?" + urllib.parse.urlencode(params)

    for attempt in range(1, MAX_RETRY + 1):
        time.sleep(DELAY)
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                body = json.loads(r.read().decode("utf-8"))
            result = body.get("esearchresult", {})
            if "ERROR" in result or "count" not in result:
                raise RuntimeError(f"PubMed 오류 응답: {result.get('ERROR', body)}")
            return int(result["count"])
        except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError) as e:
            wait = 2 ** attempt
            print(f"  ! 재시도 {attempt}/{MAX_RETRY} ({e}) - {wait}초 대기", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"반복 실패: {term}")


def year_term(query: str, year: int) -> str:
    return f'({query}) AND ("{year}"[dp])'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="이 id의 주제만 수집 (테스트용, 저장하지 않음)")
    args = ap.parse_args()

    cfg = yaml.safe_load(TOPICS_FILE.read_text(encoding="utf-8"))
    start = int(cfg["settings"]["start_year"])
    this_year = dt.date.today().year
    years = list(range(start, this_year + 1))

    # 1) 연도별 PubMed 전체 건수 (1만 편당 비율 계산용)
    if not args.only:
        print("[전체 건수]")
        totals = {}
        for y in years:
            totals[str(y)] = count(f'"{y}"[dp]')
            print(f"  {y}: {totals[str(y)]:,}")

    # 2) 주제별 연도별 건수
    counts: dict[str, dict[str, int]] = {}
    for dept in cfg["departments"]:
        for t in dept["topics"]:
            if args.only and t["id"] != args.only:
                continue
            print(f"[{dept['name_ko']}] {t.get('name') or t.get('name_ko')}")
            counts[t["id"]] = {}
            for y in years:
                counts[t["id"]][str(y)] = count(year_term(t["query"], y))
            print("  " + ", ".join(f"{y}:{n}" for y, n in counts[t["id"]].items()))

    if args.only:
        print("(--only 모드: 파일을 저장하지 않았습니다)")
        return 0

    # 3) 저장 — 모든 호출이 성공했을 때만 덮어씀 (중간 실패 시 위에서 예외로 종료)
    DATA_DIR.mkdir(exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    meta = {
        "collected_at_utc": now.isoformat(timespec="seconds"),
        "source": "PubMed E-utilities (esearch, rettype=count)",
        "date_field": "[dp] Publication Date",
        "start_year": start,
        "current_year": this_year,
        "departments": [
            {
                "id": d["id"],
                "name_ko": d["name_ko"],
                "topics": [
                    {"id": t["id"], "name": t.get("name") or t.get("name_ko", ""),
                     "query": t["query"], "reviewed": t.get("reviewed", "")}
                    for t in d["topics"]
                ],
            }
            for d in cfg["departments"]
        ],
    }
    write_json(DATA_DIR / "totals.json", totals)
    write_json(DATA_DIR / "counts.json", counts)
    write_json(DATA_DIR / "meta.json", meta)
    print(f"저장 완료: 주제 {len(counts)}개, {years[0]}–{years[-1]}")
    return 0


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
