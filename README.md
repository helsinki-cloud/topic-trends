# 진료과별 연구 주제 트렌드 대시보드

PubMed 논문 수를 진료과별 주제·연도별로 집계해 그래프로 보여 주는 정적 웹페이지입니다.
GitHub Actions가 매월 1일 자동으로 데이터를 갱신하고 GitHub Pages로 배포합니다.

- 시범 진료과: 이비인후과, 호흡기내과 (각 9개 주제)
- 비용: 0원 (공개 저장소 + 표준 러너 + PubMed 건수 검색만 사용)

## 처음 설정 (한 번만)

1. **공개(Public) 저장소 만들기**
   GitHub에서 새 저장소(예: `topic-trends`)를 **Public**으로 만들고 이 폴더의 파일을 모두 올립니다.
   `.github` 폴더(숨김 폴더)도 반드시 함께 올리세요.
   > 비공개 저장소로 하면 Actions 무료 분량을 넘을 경우 과금될 수 있습니다.

2. **NCBI API 키 발급 (선택이지만 권장)**
   https://account.ncbi.nlm.nih.gov 에서 로그인 → Account settings → API Key Management → Create API Key

3. **Secrets 등록**
   저장소 → Settings → Secrets and variables → Actions → New repository secret
   - `NCBI_API_KEY` : 2번에서 발급한 키
   - `NCBI_EMAIL` : 연락받을 이메일 (NCBI 권장 사항)
   > 키는 절대 코드나 topics.yaml에 직접 쓰지 마세요. 공개 저장소라 누구나 볼 수 있습니다.

4. **Pages 설정**
   Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택

5. **첫 실행**
   Actions 탭 → "데이터 갱신 및 배포" → Run workflow
   약 10~20분 뒤 끝나면 Settings → Pages에 나오는 주소로 접속합니다.

## 평소 관리

| 하고 싶은 일 | 방법 |
|---|---|
| 주제 추가·수정 | `topics.yaml` 수정 → 커밋 → Actions에서 Run workflow (데이터 다시 수집) |
| 검색식 검토 완료 표시 | 해당 주제의 `reviewed: "2026-12-01"`처럼 날짜 입력 |
| 진료과 추가 | `topics.yaml`의 `departments` 아래에 같은 형식으로 추가 |
| 수집 시작 연도 변경 | `settings.start_year` 수정 |
| 화면만 수정 | `index.html`, `app.js`, `style.css` 수정 → 커밋하면 자동 재배포(수집은 안 함) |

### 검색식을 고칠 때

1. PubMed 화면에 검색식을 그대로 붙여 넣어 검색합니다.
2. 상위 20~30건이 주제에 맞는지 확인합니다. 엉뚱한 논문이 많으면 검색어를 좁힙니다.
   - 약어(TORS, PRISm, EBUS, PPPD 등)는 다른 뜻으로 쓰인 논문이 섞이기 쉽습니다.
3. 확인이 끝나면 `reviewed`에 날짜를 적습니다. 화면에서 "검토 전" 표시가 사라집니다.

### 로컬에서 테스트

```bash
pip install pyyaml
python scripts/fetch_pubmed.py --only tinnitus   # 주제 하나만 수집해 출력 (파일 저장 안 함)
python scripts/fetch_pubmed.py                   # 전체 수집 후 data/에 저장
python -m http.server 8000                       # http://localhost:8000 에서 화면 확인
```

## 화면 기능

- 진료과 선택, 주제 최대 8개 동시 비교 (색은 주제에 고정)
- 논문 수 / PubMed 전체 1만 편당 비율 전환
- 올해(집계 중) 연도는 기본 숨김, 체크하면 점선으로 표시
- 최근 5년 변화표 (마지막 완성 연도 기준, 1만 편당 비율로 계산)
- 주제별 검색식 공개 + PubMed 바로가기
- CSV 내려받기

## 한계 (화면 하단에도 표시됨)

- 숫자는 검색식 결과 건수이며 검색식에 따라 크게 달라집니다.
- 최근 연도는 PubMed 등재가 늦게 반영되어 실제보다 적게 보일 수 있습니다.
  그래서 매번 전체 연도를 다시 수집합니다.
- 증가·감소의 원인은 해석하지 않습니다.

## 주의

- 워크플로의 `runs-on: ubuntu-latest`를 다른 러너로 바꾸지 마세요. 큰 러너는 공개 저장소에서도 유료입니다.
- 예약 실행은 UTC 기준입니다 (`0 1 1 * *` = 매월 1일 한국 시간 10시).
- 예약 실행이 멈춘 것 같으면 Actions 탭에서 실행 기록을 확인하고 수동 실행하세요.
