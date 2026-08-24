"""QQQ·QLD·VIX·USD/KRW 시세를 모아 data.json으로 떨군다.

GitHub Actions가 평일 미국장 마감 후 실행 → 커밋 → Pages가 정적 서빙.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

# 하단 트래킹 표 — (표시명, 야후 심볼, 통화기호). 순서가 곧 표의 행 순서.
TRACK = [
    ("QQQ", "QQQ", "$"),
    ("QLD (2x)", "QLD", "$"),
    ("S&P 500", "^GSPC", ""),
    ("나스닥", "^IXIC", ""),
    ("미국 10년물(%)", "^TNX", ""),  # unit은 접두사라 % 못 씀 → 이름에 넣는다
    ("USD/KRW", "KRW=X", "₩"),
    ("삼성전자", "005930.KS", "₩"),
    ("코스피", "^KS11", ""),
]
_VIX = "^VIX"


def rsi(prices: pd.Series, period: int = 14) -> float:
    """Wilder 지수평활 RSI — investment/analyzer/indicators.py와 동일 정의.

    단순이동평균(rolling)을 쓰면 큰 봉이 14일 창을 벗어나는 날 RSI가 통째로 튄다
    (2026-08-24: 가격 -1%인데 RSI 58->37). 그 drop-off 결함 때문에 ewm을 쓴다.
    """
    delta = prices.diff()
    a = 1 / period
    gain = delta.clip(lower=0).ewm(alpha=a, adjust=False).mean().iloc[-1]
    loss = (-delta).clip(lower=0).ewm(alpha=a, adjust=False).mean().iloc[-1]
    if loss == 0:
        return 100.0 if gain > 0 else 50.0
    return round(100 - 100 / (1 + gain / loss), 1)


# 단계 사다리 — 표시(대시보드 표)와 판정(classify)의 단일 출처.
# 조건 문구를 고치면 아래 classify의 임계값도 같이 고칠 것.
LADDER = [
    {"n": 1, "pct": None, "cond": "−10% 위 (또는 −10%대인데 RSI≥35)", "label": "평상시",
     "action": "적립만(자동매수+코어). 실탄·QLD 대기, QLD 신규 금지"},
    {"n": 2, "pct": -10, "cond": "≤ −10% AND RSI 35 미만", "label": "1차 조정",
     "action": "실탄 1/3 → QQQ. QLD는 아직 대기(−20%부터)"},
    {"n": 3, "pct": -20, "cond": "≤ −20%", "label": "본격 하락",
     "action": "실탄 1/3 추가 + QLD 진입 시작(여력 절반)"},
    {"n": 4, "pct": -30, "cond": "≤ −30%", "label": "공포·패닉",
     "action": "잔여 실탄 전액 + QLD 한도까지 채움"},
]


def classify(drawdown: float, rsi_val: float) -> dict:
    """고점대비 하락률이 단계를 정하고, -10%대에서만 RSI가 AND 게이트로 붙는다."""
    if drawdown <= -30:
        n = 4
    elif drawdown <= -20:
        n = 3
    elif drawdown <= -10 and rsi_val < 35:
        n = 2
    else:
        n = 1
    return next(s for s in LADDER if s["n"] == n)


def stage_history(closes: pd.Series) -> dict:
    """QQQ 전체 역사에 현재 규칙을 그대로 적용해 단계별 '마지막 도달일'을 찾는다.

    52주 고점·RSI를 매 시점 기준으로 다시 계산하므로 당시에 봤을 판정과 같다.
    """
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    rsi_s = (100 - 100 / (1 + gain / loss)).fillna(50)
    dd_s = (closes / closes.rolling(252, min_periods=60).max() - 1) * 100

    stages = pd.Series(
        [classify(a, b)["n"] for a, b in zip(dd_s, rsi_s)], index=closes.index
    )
    out = {}
    for n in (2, 3, 4):
        hit = stages[stages == n]
        if len(hit):
            last = hit.index[-1]
            out[str(n)] = {
                "date": str(last.date()),
                "drawdown_pct": round(float(dd_s.loc[last]), 1),
                "days": int((stages == n).sum()),
            }
    return out


def quote(s: pd.Series, with_52w: bool = False) -> dict:
    cur = float(s.iloc[-1])
    prev = float(s.iloc[-2])
    d = {"price": round(cur, 2), "chg_pct": round((cur - prev) / prev * 100, 2)}
    if with_52w:
        window = s.iloc[-252:]
        high52 = float(window.max())
        d |= {
            "high52": round(high52, 2),
            "low52": round(float(window.min()), 2),
            "drawdown_pct": round((cur - high52) / high52 * 100, 1),
        }
    return d


def _selfcheck() -> None:
    assert classify(-2, 55)["n"] == 1
    assert classify(-12, 55)["n"] == 1      # 하락만으로는 대기 (RSI 게이트)
    assert classify(-12, 30)["n"] == 2      # 하락 + 투매 → 실탄 1차
    assert classify(-5, 28)["n"] == 1       # RSI 단독으로는 발동 안 함
    assert classify(-22, 55)["n"] == 3      # -20%부터는 할인폭만으로 발동
    assert classify(-35, 55)["n"] == 4
    up = pd.Series(range(1, 40), dtype=float)
    assert rsi(up) == 100.0
    # 급등 후 횡보 — 급등일이 14일 창을 벗어나는 날 RSI가 튀면 안 된다.
    # 같은 데이터로 rolling(14) 방식은 하루에 15.9p 점프한다 (가격은 +0.4%).
    v = [100.0] * 3 + [103.4]
    for i in range(30):
        v.append(v[-1] * (1.004 if i % 2 else 0.997))
    chop = pd.Series(v)
    jumps = [abs(rsi(chop.iloc[:n + 1]) - rsi(chop.iloc[:n])) for n in range(16, 34)]
    assert max(jumps) < 8, f"RSI drop-off: {max(jumps):.1f}p"
    assert [s["n"] for s in LADDER] == [1, 2, 3, 4]
    assert [s["pct"] for s in LADDER] == [None, -10, -20, -30]
    names = [t[0] for t in TRACK]
    assert len(names) == len(set(names))          # 표시명 중복 = 표에서 구분 불가
    assert "QQQ" in names                          # 단계 판정이 QQQ에 의존
    assert "<" not in json.dumps(LADDER)   # 표에 그대로 꽂히므로 태그로 오해될 문자 금지


def main() -> None:
    _selfcheck()
    symbols = [t[1] for t in TRACK] + [_VIX]
    close = yf.download(symbols, period="2y", progress=False, auto_adjust=True)["Close"]

    track = []
    for name, sym, unit in TRACK:
        series = close[sym].dropna()
        track.append(
            {"name": name, "unit": unit}
            | quote(series, with_52w=True)
            | {"rsi": rsi(series.iloc[-90:]), "asof": str(series.index[-1].date())}
        )

    qqq = next(t for t in track if t["name"] == "QQQ")
    qqq_close = close["QQQ"].dropna()
    # 마지막 N단계는 2년치로는 안 잡힌다 (직전 4단계가 2023-01) → 전체 역사 별도 조회
    full = yf.download("QQQ", period="max", progress=False, auto_adjust=True)["Close"]
    full = (full["QQQ"] if hasattr(full, "columns") else full).dropna()

    data = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asof": str(qqq_close.index[-1].date()),
        "qqq": qqq,
        "vix": quote(close[_VIX].dropna()),
        "stage": classify(qqq["drawdown_pct"], qqq["rsi"]),
        "ladder": LADDER,
        "triggers": {
            str(p): round(qqq["high52"] * (1 + p / 100), 2) for p in (-10, -20, -30)
        },
        "track": track,
        "last_seen": stage_history(full),
        "history_from": str(full.index[0].date()),
    }
    Path("data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("마지막 도달:", {k: v["date"] for k, v in data["last_seen"].items()})
    print(f"stage {data['stage']['n']} · {data['stage']['label']} "
          f"| QQQ {qqq['price']} ({qqq['drawdown_pct']}%) RSI {qqq['rsi']} "
          f"| VIX {data['vix']['price']} | {len(track)}종 트래킹")


if __name__ == "__main__":
    main()
