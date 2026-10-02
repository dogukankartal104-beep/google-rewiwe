"""Canlıya geçmeden önceki doğrulama araçları.

reconcile  paper işlemler ↔ aynı tokenlar için backtest ne demişti? (maliyet modeli dürüst mü)
costs      maliyet başa baş noktası (fee/tx maliyeti artınca edge dayanıyor mu)
drift      model eskidi mi? (özellik dağılımı kaydı + son dönem AUC)
golive     hepsini tek kontrol listesinde toplar
"""

from __future__ import annotations

import statistics
import time
from dataclasses import dataclass, replace
from typing import Optional

from .config import Config
from .dataset import Case, build_rows, iter_cases, make_case
from .model import TARGETS, auc, load_models
from .optimize import objective, returns
from .paper import simulate
from .reputation import Reputation
from .risk import position_size
from .store import Store


# ------------------------------------------------------------------ reconcile
@dataclass
class Reconciliation:
    n_paper: int
    n_pairs: int
    paper_mean: float
    bt_mean: float
    gap: float  # ort(paper − backtest); negatif = backtest iyimser
    exit_match: float
    text: str


def reconcile(store: Store, cfg: Config, now: Optional[int] = None) -> Reconciliation:
    now = now or int(time.time())
    rows = store.db.execute(
        "SELECT mint, opened_ts, cost_sol, pnl_sol, exit_reason FROM paper_trades "
        "WHERE cost_sol > 0 ORDER BY opened_ts").fetchall()
    rep = Reputation(cfg)
    pairs = []
    for mint, opened, cost, pnl, reason in rows:
        tok = store.token(mint)
        if tok is None or tok.created_ts is None:
            continue
        t_d = tok.created_ts + cfg.decision_age_s
        if t_d + cfg.horizon_s > now:
            continue  # ufku bitmemiş
        rep.refresh_from_store(store, t_d)
        c = make_case(store, cfg, tok, store.trades(mint, until_ts=t_d + cfg.horizon_s), rep)
        if c is None:
            continue
        p = simulate(mint, c.decision_trade, c.after,
                     position_size(cfg.equity_sol, cfg, c.f["real_sol"]), c.end_ts, cfg, c.watch)
        pairs.append((mint, pnl / cost, reason, p.ret if p else None, p.exit_reason if p else "dolmadı"))
    both = [x for x in pairs if x[3] is not None]
    if not both:
        return Reconciliation(len(rows), 0, 0, 0, 0, 0,
                              f"{len(rows)} paper işlem var, karşılaştırılabilir (ufku bitmiş) yok.")
    pm = statistics.fmean(x[1] for x in both)
    bm = statistics.fmean(x[3] for x in both)
    gap = statistics.fmean(x[1] - x[3] for x in both)
    match = sum(x[2] == x[4] for x in both) / len(both)
    lines = [
        "== Paper ↔ backtest karşılaştırması ==",
        f"{len(rows)} paper işlem, {len(both)} tanesi backtest ile eşleşti "
        f"({len(pairs) - len(both)} tanesinde backtest 'dolmazdı' diyor)",
        f"ortalama getiri  paper: {pm:+.2%}   backtest: {bm:+.2%}   fark: {gap:+.2%}",
        f"medyan |fark|: {statistics.median(abs(x[1] - x[3]) for x in both):.2%}   "
        f"aynı çıkış sebebi: {match:.0%}",
        "\nEn büyük 5 sapma (paper − backtest):",
    ]
    for m, pr, preason, br, breason in sorted(both, key=lambda x: x[1] - x[3])[:5]:
        lines.append(f"  {m[:12]}…  paper {pr:+.1%} ({preason})  backtest {br:+.1%} ({breason})")
    lines.append("")
    if gap < -cfg.golive_max_gap:
        lines.append(f"⚠ Paper backtest'ten %{-gap * 100:.1f} kötü → backtest iyimser. latency_trades, "
                     "tx_cost_sol veya fee_bps'i gerçeğe göre artır, sonra tüm analizleri yeniden çalıştır.")
    else:
        lines.append("✓ Paper ile backtest uyumlu: maliyet/gecikme modeli gerçekçi görünüyor.")
    return Reconciliation(len(rows), len(both), pm, bm, gap, match, "\n".join(lines))


# ------------------------------------------------------------------ costs
COST_MULTS = (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0)


def cost_curve(cases: list[Case], cfg: Config, mults: tuple = COST_MULTS) -> dict[float, float]:
    out = {}
    for m in mults:
        c = replace(cfg, tx_cost_sol=cfg.tx_cost_sol * m, fee_bps=int(cfg.fee_bps * max(m, 1.0)))
        out[m] = objective(returns(cases, c))
    return out


def cost_report(cases: list[Case], cfg: Config) -> str:
    if not cases:
        return "Aday yok."
    curve = cost_curve(cases, cfg)
    lines = ["== Maliyet başa baş (tx maliyeti × m; m>1'de fee de ölçeklenir) =="]
    for m, obj in curve.items():
        lines.append(f"maliyet ×{m:<4} tx={cfg.tx_cost_sol * m:.4f} SOL  kırpılmış ort={obj:+.2%}")
    breakeven = next((m for m, o in curve.items() if o <= 0), None)
    lines.append("")
    if breakeven is None:
        lines.append(f"✓ Edge ×{max(curve)} maliyette bile pozitif.")
    elif breakeven <= 1.0:
        lines.append("⚠ Mevcut maliyetlerde bile edge yok.")
    elif breakeven <= 2.0:
        lines.append(f"⚠ Maliyetler ×{breakeven} olunca edge sıfırlanıyor; ağ yoğunluğunda priority "
                     "fee bu kadar kolayca artar → kırılgan.")
    else:
        lines.append(f"✓ Edge ×{breakeven} maliyete kadar dayanıyor.")
    return "\n".join(lines)


# ------------------------------------------------------------------ drift
@dataclass
class DriftResult:
    stale: bool
    text: str


def drift(store: Store, cfg: Config, hours: float = 48, now: Optional[int] = None) -> DriftResult:
    now = now or int(time.time())
    models = load_models(cfg.model_dir)
    if not models:
        return DriftResult(False, "Eğitilmiş model yok (önce `train`).")
    rows = build_rows(store, cfg, now - int(hours * 3600), now - cfg.horizon_s)
    if len(rows) < 50:
        return DriftResult(False, f"Son {hours:.0f} saatte {len(rows)} etiketli token var; "
                                  "drift için en az 50 gerekli.")
    lines = [f"== Model drift: son {hours:.0f} saat, {len(rows)} token =="]
    stale = False
    for name, m in models.items():
        lab = TARGETS[name]
        labeled = [(r, lab(r)) for r in rows]
        labeled = [(r, y) for r, y in labeled if y is not None]
        ys = [bool(y) for _, y in labeled]
        recent_auc = auc([m.predict(r) for r, _ in labeled], ys) if labeled else float("nan")
        wf = m.meta.get("wf_auc") or []
        wf_mean = statistics.fmean(wf) if wf else float("nan")
        shifts = []
        for k, mean, std, w in zip(m.features, m.mean, m.std, m.w):
            vals = [float(r.get(k, 0) or 0) for r in rows]
            smd = abs(statistics.fmean(vals) - mean) / std
            shifts.append((abs(w) * smd, k, smd))
        top = [s for s in sorted(shifts, reverse=True) if s[2] > 0.5][:5]
        bad = (recent_auc == recent_auc) and (recent_auc < 0.55 or
                                              (wf_mean == wf_mean and recent_auc < wf_mean - 0.10))
        stale |= bad
        lines.append(f"{name:10s} son dönem AUC={recent_auc:.3f}  (eğitimde walk-forward ort "
                     f"{wf_mean:.3f})  {'⚠ ESKİDİ' if bad else '✓'}")
        if top:
            lines.append("   kayan özellikler: " + ", ".join(f"{k} ({smd:.1f}σ)" for _, k, smd in top))
    lines.append("")
    lines.append("⚠ Model güncel piyasayı tahmin etmiyor → `dataset` + `train` ile yeniden eğit."
                 if stale else "✓ Modeller hâlâ tahmin gücünü koruyor.")
    return DriftResult(stale, "\n".join(lines))


# ------------------------------------------------------------------ golive
def golive(store: Store, cfg: Config, hours: float = 168, now: Optional[int] = None) -> str:
    from .montecarlo import simulate as mc_sim

    now = now or int(time.time())
    checks: list[tuple[bool, str, str]] = []

    n_paper = store.db.execute("SELECT COUNT(*) FROM paper_trades").fetchone()[0]
    checks.append((n_paper >= cfg.golive_min_paper, "Paper işlem sayısı",
                   f"{n_paper} / en az {cfg.golive_min_paper}"))

    cases = [c for c in iter_cases(store, cfg, now - int(hours * 3600), now - cfg.horizon_s)
             if c.verdict.decision == "BUY"]
    if len(cases) >= 30:
        base = objective(returns(cases, cfg))
        lag3 = objective(returns(cases, replace(cfg, latency_trades=3)))
        checks.append((base > 0, "Backtest edge (maliyetler dahil)", f"kırpılmış ort {base:+.2%}, n={len(cases)}"))
        checks.append((lag3 > 0, "Gecikmeye dayanıklılık (3 trade)", f"kırpılmış ort {lag3:+.2%}"))
        c2 = cost_curve(cases, cfg, (2.0,))[2.0]
        checks.append((c2 > 0, "Maliyet ×2'de edge", f"kırpılmış ort {c2:+.2%}"))
    else:
        checks.append((False, "Backtest edge", f"sadece {len(cases)} BUY adayı (en az 30)"))

    models = load_models(cfg.model_dir)
    checks.append(("win" in models, "Model walk-forward doğrulaması",
                   "win modeli kayıtlı" if "win" in models else "doğrulanmış model yok (`train`)"))
    if models:
        d = drift(store, cfg, now=now)
        checks.append((not d.stale, "Model güncel (drift yok)", d.text.splitlines()[-1]))

    rec = reconcile(store, cfg, now)
    checks.append((rec.n_pairs >= 30 and rec.gap >= -cfg.golive_max_gap, "Paper ↔ backtest uyumu",
                   f"{rec.n_pairs} eşleşme, fark {rec.gap:+.2%}" if rec.n_pairs else "eşleşme yok"))

    rets = [r[0] for r in store.db.execute(
        "SELECT pnl_sol / cost_sol FROM paper_trades WHERE cost_sol > 0").fetchall()]
    if len(rets) >= 30:
        mc = mc_sim(rets, max(len(rets), 100), cfg.risk_per_trade, sims=2000)
        checks.append((mc.ret_p50 > 0, "Monte Carlo tipik getiri", f"{mc.ret_p50:+.1%}"))
        checks.append((mc.dd_p95 <= cfg.golive_max_dd, "Monte Carlo kötü senaryo drawdown",
                       f"{mc.dd_p95:.1%} / en fazla {cfg.golive_max_dd:.0%}"))
        checks.append((cfg.max_consecutive_losses > mc.streak_p95, "Kill switch normal kayıp serisinden geniş",
                       f"kill={cfg.max_consecutive_losses}, normal seri={mc.streak_p95}"))
    else:
        checks.append((False, "Monte Carlo", f"{len(rets)} paper işlem (en az 30)"))

    ok = all(c[0] for c in checks)
    lines = ["== Canlıya geçiş kontrol listesi =="]
    lines += [f"{'✅' if passed else '❌'} {name:42s} {detail}" for passed, name, detail in checks]
    lines.append("")
    lines.append("🟢 Tüm kontroller geçti. Yine de KÜÇÜK sermayeyle başla ve ilk ay paper ile kıyasla."
                 if ok else f"🔴 CANLIYA HAZIR DEĞİL: {sum(not c[0] for c in checks)} kontrol başarısız.")
    return "\n".join(lines)
