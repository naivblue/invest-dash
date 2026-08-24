"""QQQ·QLD·VIX·USD/KRW 시세를 모아 data.json으로 떨군다.

GitHub Actions가 평일 미국장 마감 후 실행 → 커밋 → Pages가 정적 서빙.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

TICKERS = {"qqq": "QQQ", "qld": "QLD", "vix": "^VIX", "fx": "KRW=X"}


def rsi(prices: pd.Series, period: int = 14) -> float:
    """Wilder 아닌 단순이동평균 RSI — investment/analyzer/indicators.py와 동일 정의."""
    delta = prices.diff()
    gain = delta.clip(lower=0).rolling(period).mean().iloc[-1]
    loss = (-delta).clip(lower=0).rolling(period).mean().iloc[-1]
    if loss == 0:
        return 100.0 if gain > 0 else 50.0
    return round(100 - 100 / (1 + gain / loss), 1)


def classify(drawdown: float, rsi_val: float) -> dict:
    """고점대비 하락률이 단계를 정하고, -10%대에서만 RSI가 AND 게이트로 붙는다."""
    if drawdown <= -30:
        return {"n": 4, "label": "공포·패닉", "action": "잔여 실탄 전액 + QLD 한도까지 채움"}
    if drawdown <= -20:
        return {"n": 3, "label": "본격 하락", "action": "실탄 1/3 추가 + QLD 진입 시작(여력 절반)"}
    if drawdown <= -10 and rsi_val < 35:
        return {"n": 2, "label": "1차 조정", "action": "실탄 1/3 → QQQ. QLD는 아직 대기(-20%부터)"}
    return {"n": 1, "label": "평상시", "action": "적립만(자동매수+코어). 실탄·QLD 대기, QLD 신규 금지"}


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


def main() -> None:
    _selfcheck()
    close = yf.download(
        list(TICKERS.values()), period="2y", progress=False, auto_adjust=True
    )["Close"]

    qqq = close["QQQ"].dropna()
    qld = close["QLD"].dropna()
    qqq_rsi = rsi(qqq.iloc[-90:])
    q = quote(qqq, with_52w=True) | {"rsi": qqq_rsi}
    stage = classify(q["drawdown_pct"], qqq_rsi)

    data = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asof": str(qqq.index[-1].date()),
        "qqq": q,
        "qld": quote(qld, with_52w=True) | {"rsi": rsi(qld.iloc[-90:])},
        "vix": quote(close["^VIX"].dropna()),
        "fx": quote(close["KRW=X"].dropna()),
        "stage": stage,
        "triggers": {
            str(p): round(q["high52"] * (1 + p / 100), 2) for p in (-10, -20, -30)
        },
    }
    Path("data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
