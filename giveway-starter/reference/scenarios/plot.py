import json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

D = sys.argv[1]
R = json.load(open(f"{D}/results_fix.json"))
B = json.load(open(f"{D}/results.json"))
nx, ny = R["grid"]["nx"], R["grid"]["ny"]
water = np.array(R["grid"]["water"]).reshape(ny, nx)
LEV = ["Low", "Medium", "Serious", "High", "Critical"]
LC = ["#0ca30c", "#fab219", "#ec835a", "#e07070", "#d03b3b"]
INK, INK2, GRID, LAND, SEA, ACC, ORG = "#0b0b0b", "#52514e", "#e4e3df", "#d6d4ce", "#fcfcfb", "#2a78d6", "#eb6834"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": "#b9b7b0", "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "axes.spines.top": False, "axes.spines.right": False})
NAME = {t["id"]: t["name"] for t in R["targets"]}
SHORT = {"cruise": "Cruise Terminal", "research": "Research Dock", "pier400": "Container Ship (Pier 400)", "fuel": "Fuel Pier", "ferry": "Ferry Landing", "islands": "Oil Islands"}

def expected(s, r):
    k, t, eta = s["key"], r["t"], r["etaTrueMin"]
    if k == "A": return 1 if t < 2 else (3 if eta >= 10 else 4)
    if k == "B": return 1 if t < 2 else (2 if (not r["turned"] or eta >= 10) else 3)
    if k == "C": return 0
    if k == "D": return 1
    if k == "E": return 3 if t < 2 else 4
def agree(s):
    ex = [expected(s, r) for r in s["recs"]]; md = [r["level"] for r in s["recs"]]
    exact = np.mean([a == b for a, b in zip(ex, md)]); near = np.mean([abs(a - b) <= 1 for a, b in zip(ex, md)])
    hotter = np.mean([b > a for a, b in zip(ex, md)])
    return exact, near, hotter

FIND = {
  "A": "Called the Fuel Pier 52 min before arrival (dumb guess: 19 min). Escalates sooner than we expected.",
  "B": "Fooled by the fake-out like a person would be, then locked on the Cruise Terminal 86 min out (dumb guess: 13 min). Runs one level hotter than expected.",
  "C": "Stays Low the whole time. Drifting looks like aiming to TELL; the cold, no-motor reading is what keeps it calm.",
  "D": "Stays at Medium (ask and watch), never moves boats. Matches what we expected after fix 1.",
  "E": "Critical within a minute of being seen, about 8 min before arrival.",
}

summary = []
for s in R["scenarios"]:
    sb = next(x for x in B["scenarios"] if x["key"] == s["key"])
    ea, na, ha = agree(s); eb, nb, hb = agree(sb)
    summary.append({"key": s["key"], "name": s["name"], "tell": s["tellWarnMin"], "base": s["baseWarnMin"], "trip": s["totalMin"],
                    "exact_fix": ea, "near_fix": na, "hot_fix": ha, "exact_before": eb, "near_before": nb, "peak": LEV[max(r["level"] for r in s["recs"])]})
    fig = plt.figure(figsize=(13, 6.4), dpi=150)
    gs = fig.add_gridspec(2, 2, width_ratios=[1.35, 1], height_ratios=[1, 1], wspace=0.12, hspace=0.42, left=0.02, right=0.98, top=0.80, bottom=0.08)
    ax = fig.add_subplot(gs[:, 0])
    ax.imshow(np.where(water == 1, 1.0, 0.0), cmap=matplotlib.colors.ListedColormap([LAND, SEA]), interpolation="nearest", origin="upper")
    ax.set_xticks([]); ax.set_yticks([]); [sp.set_visible(False) for sp in ax.spines.values()]
    for t in R["targets"]:
        x, y = t["xy"]
        is_true = t["id"] == s["trueGoal"]; is_decoy = t["id"] == s["decoy"]
        ax.plot(x, y, "s", ms=7 if is_true else 5, color=INK if is_true else INK2, zorder=5)
        ax.annotate(SHORT[t["id"]] + (" (true target)" if is_true else " (decoy)" if is_decoy else ""), (x, y), xytext=(6, 6), textcoords="offset points",
                    fontsize=8.5, color=INK if (is_true or is_decoy) else INK2, fontweight="bold" if is_true else "normal", zorder=6,
                    bbox=dict(boxstyle="round,pad=0.15", fc=SEA, ec="none", alpha=0.8))
    tr = np.array(s["track"]); recs = s["recs"]
    ax.plot(tr[:, 0], tr[:, 1], "-", color="#7a7871", lw=1.4, zorder=3)
    lv = np.array([r["level"] for r in recs]); every = max(1, len(recs) // 40)
    for i in range(0, len(recs), every):
        x, y = recs[i]["xy"]; ax.plot(x, y, "o", ms=4.2, color=LC[lv[i]], mec="white", mew=0.6, zorder=4)
    ax.plot(*tr[0], "^", ms=10, color=INK, zorder=7); ax.annotate("first seen", tr[0], xytext=(-10, -16), textcoords="offset points", ha="right", fontsize=8.5, color=INK, bbox=dict(boxstyle="round,pad=0.15", fc=SEA, ec="none", alpha=0.85))
    snaps = s["snaps"]
    if s["key"] == "B": show = [(snaps[0], ORG), (snaps[2], ACC)]
    elif s["key"] == "C": show = []
    else: show = [(snaps[0], ACC)]
    for sn, col in show:
        if not sn["path"]: continue
        p = np.array(sn["path"]); ax.plot(p[:, 0], p[:, 1], "--", color=col, lw=2.0, zorder=4)
        ax.plot(*p[0], "o", ms=7, color=col, mec="white", mew=1, zorder=8)
        ax.annotate(f"at {sn['t']:.0f} min: predicts {SHORT[sn['top']]} ({sn['p']*100:.0f}%)", p[0], xytext=(8, 10) if col == ACC else (-10, -18), ha="left" if col == ACC else "right", textcoords="offset points",
                    fontsize=8.5, color=col, fontweight="bold", zorder=9, bbox=dict(boxstyle="round,pad=0.2", fc=SEA, ec="none", alpha=0.85))
    if s["key"] in ("C", "E"):
        pts = np.vstack([tr] + ([np.array([t_["xy"] for t_ in R["targets"] if t_["id"] == s["trueGoal"]])] if s["trueGoal"] else []))
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean(); hw, hh = 60, 42
        ax.set_xlim(max(0, cx - hw), min(nx, cx + hw)); ax.set_ylim(min(ny, cy + hh), max(0, cy - hh))
    else:
        ax.set_xlim(0, nx); ax.set_ylim(ny, 0)
    ax.text(0.01, 0.01, "Real OpenStreetMap land/water, 50 m cells; breakwaters approximate. Track and sensor data simulated.", fontsize=7.5, color=INK2, transform=ax.transAxes)
    leg = [Line2D([], [], color="#7a7871", lw=1.4, label="actual track")] + [Line2D([], [], marker="o", ls="", color=LC[i], mec="white", label=f"risk: {LEV[i]}") for i in range(5)] + \
          [Line2D([], [], ls="--", color=ACC, lw=2, label="TELL's predicted path")]
    ax.legend(handles=leg, loc="upper right", fontsize=7.8, frameon=True, framealpha=0.9, edgecolor="none")

    t = np.array([r["t"] for r in recs])
    a1 = fig.add_subplot(gs[0, 1])
    if s["trueGoal"]:
        gi = [x["id"] for x in R["targets"]].index(s["trueGoal"])
        a1.plot(t, [r["odds"][gi] * 100 for r in recs], color=ACC, lw=2.2, label=f"{SHORT[s['trueGoal']]} (true target)")
    if s["decoy"]:
        di = [x["id"] for x in R["targets"]].index(s["decoy"])
        a1.plot(t, [r["odds"][di] * 100 for r in recs], color=ORG, lw=1.6, label=f"{SHORT[s['decoy']]} (decoy)")
    if s["key"] == "C":
        pi = [x["id"] for x in R["targets"]].index("pier400")
        a1.plot(t, [r["odds"][pi] * 100 for r in recs], color="#9a988f", lw=1.6, label="Container Ship (not really a target)")
    a1.plot(t, [r["lost"] * 100 for r in recs], color=INK2, lw=1.4, ls=":", label="Lost / wandering")
    a1.axhline(60, color="#b9b7b0", lw=0.8, ls="--"); a1.text(t[-1] * 0.01, 61.5, "call line 60%", ha="left", fontsize=7.5, color=INK2)
    a1.set_ylim(0, 105); a1.set_ylabel("TELL's odds (%)"); a1.set_xlim(0, t[-1])
    a1.grid(axis="y", color=GRID, lw=0.6); a1.legend(fontsize=7.6, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3, frameon=False, handlelength=1.6, columnspacing=1.0)
    a1.set_title("Where is it going?", loc="left", fontsize=10.5, color=INK, fontweight="bold", pad=20)

    a2 = fig.add_subplot(gs[1, 1])
    for i in range(5): a2.axhspan(i - 0.5, i + 0.5, color=LC[i], alpha=0.10, lw=0)
    a2.step(t, [expected(s, r) for r in recs], where="post", color="#9a988f", lw=6, alpha=0.45, solid_capstyle="butt", label="what we expected")
    a2.step(t, lv, where="post", color=INK, lw=2.2, label="GIVE WAY's risk level")
    a2.set_yticks(range(5)); a2.set_yticklabels(LEV); a2.set_ylim(-0.6, 4.6); a2.set_xlim(0, t[-1])
    a2.set_xlabel("minutes since first seen"); a2.grid(axis="y", color=GRID, lw=0.6)
    a2.legend(fontsize=7.6, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=2, frameon=False)
    a2.set_title("How risky is it?", loc="left", fontsize=10.5, color=INK, fontweight="bold", pad=20)
    if s["turnIdx"] is not None:
        tt = recs[s["turnIdx"]]["t"]
        for a in (a1, a2): a.axvline(tt, color=ORG, lw=0.8, ls=":")
        a1.text(tt, 50, " turns", color=ORG, fontsize=7.5, va="center")

    fig.text(0.02, 0.955, f"{s['key']}. {s['name']}", fontsize=15, fontweight="bold", color=INK)
    fig.text(0.02, 0.915, FIND[s["key"]], fontsize=10.5, color=INK)
    import textwrap
    fig.text(0.02, 0.865, "\n".join(textwrap.wrap("Contact: " + s["desc"], 105)), fontsize=8.5, color=INK2, va="top")
    fig.savefig(f"{D}/scenario_{s['key']}.png", facecolor="white")
    plt.close(fig)

json.dump(summary, open(f"{D}/summary.json", "w"), indent=1)
for x in summary:
    print(f"{x['key']} {x['name']:<18} TELL {x['tell']} | base {x['base']} | trip {x['trip']:.1f} | peak {x['peak']:<8} | matches expectation (exact/within 1) before {x['exact_before']:.0%}/{x['near_before']:.0%} -> after {x['exact_fix']:.0%}/{x['near_fix']:.0%} | hotter than expected {x['hot_fix']:.0%}")
