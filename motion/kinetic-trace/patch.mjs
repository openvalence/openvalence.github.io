// patch.mjs -- adds trace hooks to a scratch copy of Kinetic's headers (run in that copy).
// Every hook is a no-op unless trace.cpp defines it; nothing the planner computes changes.
// Each anchor must match exactly once, so a Kinetic change that moves one fails loudly.
import { readFileSync, writeFileSync } from 'node:fs';
function patch(f, pairs) {
  let s = readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(f + ': ' + n + 'x ' + a.slice(0, 60)); s = s.replace(a, b); }
  writeFileSync(f, s);
}
const H = 'include/kinetic2/handles.hpp', S = 'include/kinetic2/solver.hpp';
patch(H, [
  ['#include "types.hpp"\n', '#include "types.hpp"\n#ifndef K2T_JUDGE\n#define K2T_JUDGE(q, pL, f, o, legal) ((void)0)\n#define K2T_PHASE(x) ((void)0)\n#define K2T_PIECE(i, hit) ((void)0)\n#define K2T_PIECE_END2(i, f, dp, L, R, pL, c, hold, canTrim) ((void)0)\n#define K2T_SOLVED(k, n, tag) ((void)0)\n#endif\n'],
  ['        return Fit{f, q.i0, q.i1, o, o <= 1.0f + kTol};\n    };', '        K2T_JUDGE(q, pL, f, o, o <= 1.0f + kTol);\n        return Fit{f, q.i0, q.i1, o, o <= 1.0f + kTol};\n    };'],
  ['        if (hit) {\n            L.effOut = R.mi0;', '        K2T_PIECE(i, hit);\n        if (hit) {\n            L.effOut = R.mi0;'],
  ['            f = fitAt(R.p + dp, INFINITY);\n', '            K2T_PHASE(0);\n            f = fitAt(R.p + dp, INFINITY);\n'],
  ['                Fit fh = fitAt(R.p + dir * hi, 1.0f + kTol, true);\n', '                K2T_PHASE(1);\n                Fit fh = fitAt(R.p + dir * hi, 1.0f + kTol, true);\n'],
  ['                        const Fit fm = fitAt(R.p + dir * mid, 1.0f + kTol, true);\n', '                        K2T_PHASE(10 + s);\n                        const Fit fm = fitAt(R.p + dir * mid, 1.0f + kTol, true);\n'],
  ['                        const Fit fq = fitAt(R.p + d, f.o);\n', '                        K2T_PHASE(30 + q);\n                        const Fit fq = fitAt(R.p + d, f.o);\n'],
  ['        R.infeasible = !f.legal;\n        if (!f.legal) ++bad;\n        R.memo = true;', '        R.infeasible = !f.legal;\n        K2T_PIECE_END2(i, f, dp, L, R, pL, c, hold, canTrim);\n        if (!f.legal) ++bad;\n        R.memo = true;'],
  ['    solve(k, n, c, false);\n    int bad = nudge(k, n, c);\n', '    solve(k, n, c, false);\n    K2T_SOLVED(k, n, 0);\n    int bad = nudge(k, n, c);\n    K2T_SOLVED(k, n, 1);\n'],
  ['        solve(k, n, c, true);\n        bad = nudge(k, n, c, &capped);\n', '        solve(k, n, c, true);\n        K2T_SOLVED(k, n, 2);\n        bad = nudge(k, n, c, &capped);\n        K2T_SOLVED(k, n, 3);\n'],
]);
patch(S, [['        K2_STAT(judges, 1);\n        handles::render(k, m, c);', '        K2_STAT(judges, 1);\n        K2T_PASS(pass, m);\n        handles::render(k, m, c);']]);
console.log('patched');
