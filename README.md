# invest-dash

QQQ / QLD 매수 신호 대시보드 — https://naivblue.github.io/invest-dash/

매일 2회(한국장 마감 16:00 KST · 미국장 마감 07:10 KST) GitHub Actions가 `update.py`를 돌려 `data.json`을 갱신하고,
`index.html`이 그걸 읽어 그린다. 빌드 스텝 없음.

| 지표 | 출처 |
|------|------|
| QQQ 가격·RSI(14)·52주 고점대비 | yfinance `QQQ` |
| QLD 가격·RSI(14)·52주 고점대비 | yfinance `QLD` |
| 공포지수 | yfinance `^VIX` |
| 환율 | yfinance `KRW=X` |

## 단계 판정

단계는 QQQ 52주 고점대비 하락률이 정한다. RSI는 −10%대 구간에서만 AND 게이트로 붙는다
(RSI 단독 오발동 방지).

| 단계 | 조건 | 행동 |
|---|---|---|
| 4 · 공포·패닉 | ≤ −30% | 잔여 실탄 전액 + QLD 한도까지 |
| 3 · 본격 하락 | ≤ −20% | 실탄 1/3 추가 + QLD 진입 시작 |
| 2 · 1차 조정 | ≤ −10% **AND** RSI < 35 | 실탄 1/3 → QQQ (QLD는 대기) |
| 1 · 평상시 | 그 외 | 적립만, QLD 신규 금지 |

로컬 실행: `pip install yfinance pandas && python update.py`
