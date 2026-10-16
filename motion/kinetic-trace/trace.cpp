// trace.cpp -- runs Kinetic² (its own headers) over one script with its trace hooks
// (include/kinetic2/trace.hpp) defined, and prints every step the handle renderer takes
// as JSON lines. Scratch build only (bake-handles.mjs).
// Constraints:
// - trace.hpp's hooks are all-or-nothing: this file defines all seventeen before any
//   kinetic2 header. A hook only reads; nothing the planner computes changes.
// - Events only from run 1, pass 0 are read by the bake (one render pass).
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
static FILE* T = stdout;
static int g_phase = -1, g_pass = -1, g_run = 0, g_m = 0, g_round = -1;
static float g_v0[64];   // each knot's angle before the sweep that is running (K2T_SWEEP gives the new one only)
namespace kinetic2::handles { struct Piece; struct Cfg; struct HKnot; struct Fit; }
static void tJudge(const kinetic2::handles::Piece& q, float pL, float f, float o, const kinetic2::handles::Cfg& cs);
static void tSolved(const kinetic2::handles::HKnot* k, int n, int tag);
static void tStart(const kinetic2::handles::HKnot* k, int n);
static void tPiece(int i, bool hit, const kinetic2::handles::HKnot& L);
static void tPieceEnd(int i, const kinetic2::handles::HKnot& L, const kinetic2::handles::HKnot& R, const kinetic2::handles::Fit& f, float dp);
// pchipAngle runs again for the pchip line in tSolved, which sets g_quiet
static bool g_quiet = false;
#define K2T_PCHIP(i, m, h1, h2, w1, w2, r) (!g_quiet ? (void)std::fprintf(T, "{\"ev\":\"pchipTerms\",\"run\":%d,\"pass\":%d,\"i\":%d,\"h1\":%.7g,\"h2\":%.7g,\"w1\":%.7g,\"w2\":%.7g,\"dIn\":%.7g,\"dOut\":%.7g,\"r\":%.7g}\n", g_run, g_pass, int(i), h1, h2, w1, w2, m.dIn, m.dOut, r) : (void)0)
// aL and aR: the acceleration at the knot from the left piece and from the right, linear in the angle (solveStyle)
#define K2T_SWEEP(s, i, AL, BL, AR, BR, lo, hi, v) (std::fprintf(T, "{\"ev\":\"sweep\",\"run\":%d,\"pass\":%d,\"s\":%d,\"i\":%d,\"raw\":%.7g,\"lo\":%.7g,\"hi\":%.7g,\"v0\":%.7g,\"v\":%.7g,\"aL0\":%.7g,\"aR0\":%.7g,\"aL\":%.7g,\"aR\":%.7g}\n", g_run, g_pass, int(s), int(i), (AR - AL) / (BL - BR), lo, hi, g_v0[i], v, AL + BL * g_v0[i], AR + BR * g_v0[i], AL + BL * (v), AR + BR * (v)), g_v0[i] = (v))
#define K2T_STYLE(k, n, smooth, phase) ((phase) == 0 ? tStart(k, n) : (void)0)
#define K2T_ROUND(k, n, tag, round) tSolved(k, n, tag)
#define K2T_PIECE(i, hit, L, R, pL) tPiece(i, hit, L)
#define K2T_PHASE(x) (g_phase = (x))
#define K2T_RETRY() ((void)0)
#define K2T_JUDGE(f, q, pL, cs, ro, o) tJudge(q, pL, f, o, cs)
#define K2T_FIT(pR, f) ((void)0)
#define K2T_PIECE_END(i, L, R, f, dp, hold, canTrim) tPieceEnd(i, L, R, f, dp)
#define K2T_SOLVE(origin, origin_us, n, c) ((void)0)
#define K2T_RUN(k, te, m, me, base) (++g_run, g_m = int(m))
#define K2T_PASS(pass, rescue) (g_pass = (pass), std::fprintf(T, "{\"ev\":\"pass\",\"run\":%d,\"pass\":%d,\"m\":%d}\n", g_run, int(pass), g_m))
#define K2T_PASS_END(k, built, me, again, over) ((void)0)
#define K2T_RUN_END(out, me) ((void)0)
#define K2T_CHASE(i, j, out) ((void)0)
#define K2T_HARD(i, o) ((void)0)
#include "kinetic2/engine.hpp"
using namespace kinetic2;
namespace h = kinetic2::handles;
static h::Cfg g_cs;   // the last judge's ceilings (a piece's slack applied): the detail judges with them

static void tJudge(const h::Piece& q, float pL, float f, float o, const h::Cfg& cs) {
    g_cs = cs;
    const bool legal = o <= 1.0f + h::kTol;
    h::Over pr;
    h::overOf(q, pL, cs, INFINITY, &pr);
    std::fprintf(T, "{\"ev\":\"judge\",\"run\":%d,\"pass\":%d,\"phase\":%d,\"T\":%.7g,\"D\":%.7g,\"s0\":%.7g,\"s1\":%.7g,\"i0\":%.7g,\"i1\":%.7g,\"pL\":%.7g,\"f\":%.4g,\"o\":%.7g,\"legal\":%d,\"rv\":%.6g,\"ra\":%.6g,\"rj\":%.6g,\"rx\":%.6g}\n",
                 g_run, g_pass, g_phase, q.T, q.D, q.s0, q.s1, q.i0, q.i1, pL, f, o, int(legal), pr.v, pr.a, pr.j, pr.x);
}
static void tStart(const h::HKnot* k, int n) { for (int i = 0; i < n && i < 64; ++i) g_v0[i] = k[i].vel; }
static void tPiece(int i, bool hit, const h::HKnot&) {
    std::fprintf(T, "{\"ev\":\"piece\",\"run\":%d,\"pass\":%d,\"i\":%d,\"hit\":%d}\n", g_run, g_pass, i, int(hit));
}
static void tDetail(int i, const h::HKnot& L, const h::HKnot& R, float pL, const h::Cfg& cs, float dp, float fk);
static void tPieceEnd(int i, const h::HKnot& L, const h::HKnot& R, const h::Fit& f, float dp) {
    std::fprintf(T, "{\"ev\":\"pieceEnd\",\"run\":%d,\"pass\":%d,\"i\":%d,\"k\":%.4g,\"i0\":%.7g,\"i1\":%.7g,\"o\":%.7g,\"legal\":%d,\"dp\":%.7g}\n", g_run, g_pass, i, f.k, f.i0, f.i1, f.o, int(f.legal), dp);
    tDetail(i, L, R, h::rendered(L), g_cs, dp, f.k);
}
static void tSolved(const h::HKnot* k, int n, int tag) {
    if (g_run == 1 && g_pass == 0 && (tag == 0 || tag == 2)) ++g_round;
    if (tag == 0) { g_quiet = true; std::fprintf(T, "{\"ev\":\"pchip\",\"base\":["); for (int i = 0; i < n; ++i) std::fprintf(T, "%s%.7g", i ? "," : "", (i > 0 && i + 1 < n && k[i].cls == h::KnotClass::Through) ? h::pchipAngle(k, i) : 0.0f); std::fprintf(T, "]}\n"); g_quiet = false; }
    std::fprintf(T, "{\"ev\":\"solved\",\"run\":%d,\"pass\":%d,\"tag\":%d,\"knots\":[", g_run, g_pass, tag);
    for (int i = 0; i < n; ++i)
        std::fprintf(T, "%s{\"t\":%.7g,\"p\":%.7g,\"dp\":%.7g,\"cls\":%d,\"g2\":%d,\"vel\":%.7g,\"lIn\":%.7g,\"lOut\":%.7g,\"effIn\":%.7g,\"effOut\":%.7g,\"dIn\":%.7g,\"dOut\":%.7g,\"slack\":[%.5g,%.5g,%.5g],\"inf\":%d}",
                     i ? "," : "", k[i].t, k[i].p, k[i].dp, int(k[i].cls), int(k[i].g2), k[i].vel, k[i].lIn, k[i].lOut, k[i].effIn, k[i].effOut, k[i].dIn, k[i].dOut,
                     k[i].slack[0], k[i].slack[1], k[i].slack[2], int(k[i].infeasible));
    std::fprintf(T, "]}\n");
}

int main(int argc, char** argv) {
    // knots: t_s p(window) pairs on the command line; the last at rest.
    std::vector<float> a;
    for (int i = 1; i < argc; ++i) a.push_back(std::strtof(argv[i], nullptr));
    const float p0 = a[3], Tend = a[4];
    Config cfg;
    cfg.limits = Limits{a[0], a[1], a[2]};
    cfg.smoothness = 0.0f; cfg.handle_floor = 0.15f; cfg.trim_max = 1.0f; cfg.react_us = 4000;
    static Engine<1, 64> eng{cfg};
    eng.setConfig(cfg);
    eng.resetAt(p0, 0);
    const int nk = (int(a.size()) - 5) / 2;
    for (int i = 0; i < nk; ++i) {
        Knot k; k.t_us = uint64_t(double(a[5 + 2 * i]) * 1e6 + 0.5); k.p = a[6 + 2 * i];
        const bool last = i == nk - 1;
        k.has_v = last; k.v = 0.0f; k.rest_if_last = !last;
        if (!eng.submit(k, 0)) std::fprintf(T, "{\"ev\":\"refused\",\"i\":%d}\n", i);
    }
    const int n = int(Tend * 1000.0f + 0.5f);
    std::vector<State> st(n + 1);
    for (int i = 0; i <= n; ++i) st[i] = eng.stateAt(0, uint64_t(i) * 1000);
    std::fprintf(T, "{\"ev\":\"samples\",\"P\":[");
    for (int i = 0; i <= n; ++i) std::fprintf(T, "%s%.9g", i ? "," : "", st[i].p);
    std::fprintf(T, "],\"V\":[");
    for (int i = 0; i <= n; ++i) std::fprintf(T, "%s%.9g", i ? "," : "", st[i].v);
    std::fprintf(T, "],\"A\":[");
    for (int i = 0; i <= n; ++i) std::fprintf(T, "%s%.9g", i ? "," : "", st[i].a);
    std::fprintf(T, "]}\n");
    Anomaly an;
    while (eng.popAnomaly(an)) std::fprintf(T, "{\"ev\":\"anomaly\",\"kind\":%d,\"t\":%.6g,\"target\":%.6g,\"detail\":%.6g}\n", int(an.kind), double(an.t_us) * 1e-6, an.target, an.detail);
    return 0;
}

// ---- details for the video: run 1, pass 0, the first nudge (round 0) only ----
static void curveOut(const h::Piece& q, float pL, const h::Cfg& cs) {
    const h::Coef k = h::coefOf(q);
    static constexpr float kOrder[11] = {0.0f, 1.0f, 0.5f, 0.2f, 0.8f, 0.4f, 0.6f, 0.1f, 0.9f, 0.3f, 0.7f};
    std::fprintf(T, "\"samples\":[");
    for (int s = 0; s <= 10; ++s) {
        const h::Deriv d = h::derivAt(k, kOrder[s]);
        std::fprintf(T, "%s[%.3g,%.7g,%.7g,%.7g]", s ? "," : "", kOrder[s], h::vAt(d), h::aAt(d), h::jAt(d));
    }
    float r[6]; int n;
    std::fprintf(T, "],\"rootsV\":[");
    n = h::rootsOf([&](float u) { return h::derivAt(k, u).nA; }, 6, r, 3);
    for (int i = 0; i < n; ++i) std::fprintf(T, "%s[%.7g,%.7g]", i ? "," : "", r[i], h::vAt(h::derivAt(k, r[i])));
    std::fprintf(T, "],\"rootsA\":[");
    n = h::rootsOf([&](float u) { return h::derivAt(k, u).nJ; }, 8, r, 4);
    for (int i = 0; i < n; ++i) std::fprintf(T, "%s[%.7g,%.7g]", i ? "," : "", r[i], h::aAt(h::derivAt(k, r[i])));
    std::fprintf(T, "],\"rootsJ\":[");
    n = h::rootsOf([&](float u) { return h::jSlopeNum(k, u); }, 10, r, 5);
    for (int i = 0; i < n; ++i) std::fprintf(T, "%s[%.7g,%.7g]", i ? "," : "", r[i], h::jAt(h::derivAt(k, r[i])));
    std::fprintf(T, "],\"dense\":[");
    for (int s = 0; s <= 100; ++s) {
        const float u = s / 100.0f;
        const h::Eval e = h::evalPiece(q, u);
        std::fprintf(T, "%s[%.3g,%.7g,%.7g,%.7g,%.7g,%.7g]", s ? "," : "", u, e.t, e.p, e.v, e.a, e.j);
    }
    h::Over pr; const float o = h::overOf(q, pL, cs, INFINITY, &pr);
    std::fprintf(T, "],\"over\":[%.7g,%.7g,%.7g,%.7g,%.7g]", o, pr.v, pr.a, pr.j, pr.x);
}
static void tDetail(int i, const h::HKnot& L, const h::HKnot& R, float pL, const h::Cfg& cs, float dp, float fk) {
    if (g_run != 1 || g_pass != 0 || g_round != 0) return;
    const float floor = std::fmax(h::kLMin, cs.lfloor);
    std::fprintf(T, "{\"ev\":\"detail\",\"i\":%d,\"pL\":%.7g,\"pR\":%.7g,\"dp\":%.7g,\"lim\":[%.7g,%.7g,%.7g],\"floor\":%.4g,\"sweep\":[", i, pL, R.p, dp, cs.lim.vmax, cs.lim.amax, cs.lim.jmax, floor);
    for (int pass = 0; pass < 2; ++pass)
    for (int idx = 0; idx < h::kKs; ++idx) {
        const float f = h::ksAt(idx), pR = R.p + (pass ? dp : 0.0f);
        h::Piece q; q.T = R.t - L.t; q.D = pR - pL; q.s0 = L.vel; q.s1 = R.vel;
        q.i0 = std::fmin(h::kLMax, std::fmax(floor, L.lOut * f));
        q.i1 = std::fmin(h::kLMax, std::fmax(floor, R.lIn * f));
        h::Over pr; const float o = h::overOf(q, pL, cs, INFINITY, &pr);
        std::fprintf(T, "%s[%d,%.4g,%.7g,%.7g,%.7g,%.7g,%.7g,%.7g]", (pass || idx) ? "," : "", pass, f, q.i0, q.i1, o, pr.v, pr.a, pr.j);
    }
    std::fprintf(T, "],\"atK1\":{");
    { h::Piece q; q.T = R.t - L.t; q.D = R.p - pL; q.s0 = L.vel; q.s1 = R.vel; q.i0 = std::fmin(h::kLMax, std::fmax(floor, L.lOut)); q.i1 = std::fmin(h::kLMax, std::fmax(floor, R.lIn)); curveOut(q, pL, cs); }
    std::fprintf(T, "},\"chosen\":{");
    { const float pR = R.p + dp; h::Piece q; q.T = R.t - L.t; q.D = pR - pL; q.s0 = L.vel; q.s1 = R.vel;
      q.i0 = std::fmin(h::kLMax, std::fmax(floor, L.lOut * fk)); q.i1 = std::fmin(h::kLMax, std::fmax(floor, R.lIn * fk)); curveOut(q, pL, cs); }
    // every factor on the k grid at the knot as submitted, as the length walk judged it
    std::fprintf(T, "},\"byK\":[");
    for (int idx = 0; idx < h::kKs; ++idx) {
        const float f = h::ksAt(idx);
        h::Piece q; q.T = R.t - L.t; q.D = R.p - pL; q.s0 = L.vel; q.s1 = R.vel;
        q.i0 = std::fmin(h::kLMax, std::fmax(floor, L.lOut * f)); q.i1 = std::fmin(h::kLMax, std::fmax(floor, R.lIn * f));
        std::fprintf(T, "%s{\"f\":%.4g,", idx ? "," : "", f);
        curveOut(q, pL, cs);
        std::fprintf(T, "}");
    }
    std::fprintf(T, "]}\n");
}
