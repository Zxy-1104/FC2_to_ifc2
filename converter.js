/* FC2 (phonopy) -> IFC2 (QE) converter core logic — browser + node. */
(function (global) {
  "use strict";

  const EV_PER_RY = 13.605693122994;
  const ANG_PER_BOHR = 0.529177210903;
  /** eV/Å² → Ry/bohr² */
  const FC_EV_A2_TO_RY_BOHR2 = (1 / EV_PER_RY) / (1 / ANG_PER_BOHR) ** 2;

  function parseIfc2Header(text) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
    if (!lines.length) throw new Error("表头为空");
    const t0 = lines[0].trim().split(/\s+/);
    if (t0.length < 9) throw new Error("首行应为：ntyp nat ibrav celldm(1:6)");
    const ntyp = parseInt(t0[0], 10);
    const nat = parseInt(t0[1], 10);
    const ibrav = parseInt(t0[2], 10);
    const celldm = t0.slice(3, 9).map(Number);
    if (!Number.isFinite(ntyp) || !Number.isFinite(nat) || nat < 1 || ntyp < 1) {
      throw new Error("无法解析 ntyp/nat");
    }
    if (lines.length < 1 + ntyp + nat) {
      throw new Error("表头过短：物种/原子行数不足");
    }
    let idx = 1 + ntyp + nat;

    // lrigid flag: T -> ε∞ (3×3) + Born (nat blocks); F -> nothing (ibrav≠0 时无晶格行)
    let flag = null;
    if (idx < lines.length) {
      const f = lines[idx].trim().toUpperCase();
      if (f === "T" || f === "F" || f === ".TRUE." || f === ".FALSE.") {
        flag = f === "T" || f.startsWith(".T");
        idx += 1;
      }
    }
    if (flag === true) {
      // dielectric tensor — NOT lattice vectors; ibrav+celldm already define the cell
      if (idx + 3 > lines.length) throw new Error("lrigid=T 但缺少介电张量 ε∞ 3 行");
      idx += 3;
      if (idx + nat * 4 > lines.length) throw new Error("Z* 块不完整（lrigid=T 时需要）");
      idx += nat * 4;
    } else if (flag === false) {
      // QE ifc2 with F: next is n1 n2 n3 (or end of pasted header). Do NOT require lattice.
    } else {
      // flag missing — treat as end of header (assume user omitted F / file starts mesh next)
    }

    return {
      headerLines: lines.slice(0, idx),
      nat,
      ntyp,
      ibrav,
      celldm,
      hasZ: flag === true,
    };
  }

  function parseFc2(text) {
    const lines = text.split(/\r?\n/);
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) throw new Error("FC2 文件为空");
    const first = lines[i].trim().split(/\s+/);
    const n1 = parseInt(first[0], 10);
    const n2 = first.length > 1 ? parseInt(first[1], 10) : n1;
    if (!Number.isFinite(n1) || n1 < 1) throw new Error("FC2 首行无法解析原子数");
    if (n1 !== n2) throw new Error(`FC2 首行两维不一致：${n1} vs ${n2}`);
    const n = n1;
    const fc = new Map();
    i += 1;
    let parsed = 0;
    while (i < lines.length) {
      const p = lines[i].trim().split(/\s+/);
      if (p.length < 2) {
        i += 1;
        continue;
      }
      const ia = parseInt(p[0], 10);
      const ib = parseInt(p[1], 10);
      if (!Number.isFinite(ia) || !Number.isFinite(ib)) {
        i += 1;
        continue;
      }
      if (i + 3 >= lines.length) throw new Error(`FC2 在原子对 ${ia}-${ib} 处截断`);
      const mat = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < 3; r++) {
        const row = lines[i + 1 + r].trim().split(/\s+/).map(Number);
        if (row.length < 3 || row.some((x) => !Number.isFinite(x))) {
          throw new Error(`FC2 矩阵行无效：原子对 ${ia}-${ib} 第 ${r + 1} 行`);
        }
        mat[r * 3] = row[0];
        mat[r * 3 + 1] = row[1];
        mat[r * 3 + 2] = row[2];
      }
      fc.set(ia * 1e6 + ib, mat);
      parsed += 1;
      i += 4;
    }
    if (parsed !== n * n) {
      throw new Error(`FC2 块数 ${parsed} ≠ 预期 ${n * n}`);
    }
    return { n, fc };
  }

  function factorize(ncell) {
    const cands = [];
    for (let n1 = 1; n1 <= ncell; n1++) {
      if (ncell % n1) continue;
      const rest = ncell / n1;
      for (let n2 = 1; n2 <= rest; n2++) {
        if (rest % n2) continue;
        const n3 = rest / n2;
        cands.push([n1, n2, n3]);
      }
    }
    cands.sort((a, b) => {
      const sa = Math.max(...a) - Math.min(...a);
      const sb = Math.max(...b) - Math.min(...b);
      if (sa !== sb) return sa - sb;
      return Math.min(...b) - Math.min(...a);
    });
    return cands.length ? { best: cands[0], all: cands } : null;
  }

  function idxBasisOuter(l0, l1, l2, s0, n1, n2, n3, nat) {
    return s0 * (n1 * n2 * n3) + (l0 + n1 * l1 + n1 * n2 * l2) + 1;
  }

  function idxCellOuter(l0, l1, l2, s0, n1, n2, n3, nat) {
    return ((l2 * n2 + l1) * n1 + l0) * nat + s0 + 1;
  }

  const CONVENTIONS = {
    "basis-outer": idxBasisOuter,
    "cell-outer": idxCellOuter,
  };

  function hermiticityError(fc, nat, n1, n2, n3, idxFn) {
    let maxerr = 0;
    for (let s = 0; s < nat; s++) {
      const ia = idxFn(0, 0, 0, s, n1, n2, n3, nat);
      for (let sp = 0; sp < nat; sp++) {
        for (let l0 = 0; l0 < n1; l0++) {
          for (let l1 = 0; l1 < n2; l1++) {
            for (let l2 = 0; l2 < n3; l2++) {
              const jb = idxFn(l0, l1, l2, sp, n1, n2, n3, nat);
              const m = fc.get(ia * 1e6 + jb);
              const r0 = (n1 - l0) % n1;
              const r1 = (n2 - l1) % n2;
              const r2 = (n3 - l2) % n3;
              const ia2 = idxFn(0, 0, 0, sp, n1, n2, n3, nat);
              const jb2 = idxFn(r0, r1, r2, s, n1, n2, n3, nat);
              const m2 = fc.get(ia2 * 1e6 + jb2);
              for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                  const err = Math.abs(m[a * 3 + b] - m2[b * 3 + a]);
                  if (err > maxerr) maxerr = err;
                }
              }
            }
          }
        }
      }
    }
    return maxerr;
  }

  function fmtSci(x) {
    if (!Number.isFinite(x)) return " NaN";
    if (x === 0) return " 0.00000000000E+00";
    const a = Math.abs(x);
    const exp = Math.floor(Math.log10(a));
    const mant = x / Math.pow(10, exp);
    const es = (exp >= 0 ? "" : "-") + String(Math.abs(exp)).padStart(2, "0");
    return (x < 0 ? "-" : " ") + mant.toFixed(11) + "E" + (exp >= 0 ? "+" : "-") + es;
  }

  // simpler fixed Fortran-like scientific
  function fortE(x, width = 19, prec = 11) {
    if (!Number.isFinite(x)) return " NaN".padStart(width);
    if (x === 0) {
      const body = "0." + "0".repeat(prec) + "E+00";
      return body.padStart(width, " ");
    }
    let s = x.toExponential(prec - 1).toUpperCase().replace("E", "E");
    const m = s.match(/^(-?\d+\.\d+)E([+-]\d+)$/);
    if (!m) {
      return String(x).padStart(width, " ");
    }
    const exp = parseInt(m[2], 10);
    const expStr = (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
    const [ip, fp = ""] = m[1].split(".");
    const fp2 = (fp + "0".repeat(prec)).slice(0, prec);
    const out = ip + "." + fp2 + "E" + expStr;
    return out.length < width ? out.padStart(width, " ") : out;
  }

  function convert(fc2Text, headerText, options = {}) {
    const t0 = performance.now();
    const opts = Object.assign(
      {
        dims: null, // [n1,n2,n3] or null → auto
        convention: "auto", // auto | basis-outer | cell-outer
        unitFactor: FC_EV_A2_TO_RY_BOHR2,
        enforceAsr: false,
      },
      options
    );

    const header = parseIfc2Header(headerText);
    const { n: nSup, fc } = parseFc2(fc2Text);
    const nat = header.nat;
    if (nSup % nat !== 0) {
      throw new Error(`FC2 原子数 ${nSup} 不能被原胞原子数 ${nat} 整除`);
    }
    const ncell = nSup / nat;

    let dims = opts.dims;
    if (!dims || dims.length !== 3) {
      const fac = factorize(ncell);
      if (!fac) throw new Error(`无法分解超胞胞数 ${ncell}`);
      dims = fac.best;
    }
    const [n1, n2, n3] = dims;
    if (n1 * n2 * n3 * nat !== nSup) {
      throw new Error(`超胞尺寸 ${n1}×${n2}×${n3}×nat=${nat} ≠ FC2 原子数 ${nSup}`);
    }

    let convention = opts.convention;
    let hermErr;
    const errMap = {};
    if (convention === "auto") {
      for (const name of Object.keys(CONVENTIONS)) {
        errMap[name] = hermiticityError(fc, nat, n1, n2, n3, CONVENTIONS[name]);
      }
      convention = Object.keys(errMap).reduce((a, b) => (errMap[a] <= errMap[b] ? a : b));
      hermErr = errMap[convention];
    } else {
      if (!CONVENTIONS[convention]) throw new Error(`未知原子排序：${convention}`);
      hermErr = hermiticityError(fc, nat, n1, n2, n3, CONVENTIONS[convention]);
    }

    const idxFn = CONVENTIONS[convention];
    const conv = opts.unitFactor;

    // Phi[a][b][s][sp] → Map key (a*3+b)*nat*nat + s*nat+sp → {l0+l1*n1+l2*n1*n2: val}
    // Store as nested arrays for speed
    const Phi = [];
    for (let a = 0; a < 3; a++) {
      Phi[a] = [];
      for (let b = 0; b < 3; b++) {
        Phi[a][b] = [];
        for (let s = 0; s < nat; s++) {
          Phi[a][b][s] = [];
          for (let sp = 0; sp < nat; sp++) {
            Phi[a][b][s][sp] = new Float64Array(n1 * n2 * n3);
          }
        }
      }
    }

    for (let s = 0; s < nat; s++) {
      const ia = idxFn(0, 0, 0, s, n1, n2, n3, nat);
      for (let sp = 0; sp < nat; sp++) {
        for (let l0 = 0; l0 < n1; l0++) {
          for (let l1 = 0; l1 < n2; l1++) {
            for (let l2 = 0; l2 < n3; l2++) {
              const jb = idxFn(l0, l1, l2, sp, n1, n2, n3, nat);
              const m = fc.get(ia * 1e6 + jb);
              const cell = l0 + n1 * l1 + n1 * n2 * l2;
              for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                  Phi[a][b][s][sp][cell] = m[a * 3 + b] * conv;
                }
              }
            }
          }
        }
      }
    }

    if (opts.enforceAsr) {
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          for (let s = 0; s < nat; s++) {
            let tot = 0;
            for (let sp = 0; sp < nat; sp++) {
              const arr = Phi[a][b][s][sp];
              for (let c = 0; c < arr.length; c++) tot += arr[c];
            }
            const corr = tot / nat;
            const diag = Phi[a][b][s][s];
            for (let c = 0; c < diag.length; c++) diag[c] -= corr;
          }
        }
      }
    }

    const out = [];
    for (const ln of header.headerLines) out.push(ln);
    out.push(`${String(n1).padStart(4)}${String(n2).padStart(4)}${String(n3).padStart(4)}`);
    for (let a = 1; a <= 3; a++) {
      for (let b = 1; b <= 3; b++) {
        for (let s = 1; s <= nat; s++) {
          for (let sp = 1; sp <= nat; sp++) {
            out.push(
              `${String(a).padStart(5)}${String(b).padStart(5)}${String(s).padStart(5)}${String(sp).padStart(5)}`
            );
            const arr = Phi[a - 1][b - 1][s - 1][sp - 1];
            for (let l3 = 0; l3 < n3; l3++) {
              for (let l2 = 0; l2 < n2; l2++) {
                for (let l1 = 0; l1 < n1; l1++) {
                  const cell = l1 + n1 * l2 + n1 * n2 * l3;
                  const v = arr[cell];
                  const r1 = l1 + 1;
                  const r2 = l2 + 1;
                  const r3 = l3 + 1;
                  out.push(
                    `${String(r1).padStart(5)}${String(r2).padStart(5)}${String(r3).padStart(5)}${fortE(v, 19, 11)}`
                  );
                }
              }
            }
          }
        }
      }
    }

    // ASR diagnostic on output
    let maxAsr = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        for (let s = 0; s < nat; s++) {
          let tot = 0;
          for (let sp = 0; sp < nat; sp++) {
            const arr = Phi[a][b][s][sp];
            for (let c = 0; c < arr.length; c++) tot += arr[c];
          }
          if (Math.abs(tot) > maxAsr) maxAsr = Math.abs(tot);
        }
      }
    }

    const onsite = Phi[0][0][0][0][0];

    return {
      text: out.join("\n") + "\n",
      info: {
        nSup,
        nat,
        ntyp: header.ntyp,
        ibrav: header.ibrav,
        dims: [n1, n2, n3],
        ncell,
        convention,
        conventionErrors: errMap,
        hermiticityError: hermErr,
        maxAsr,
        unitFactor: conv,
        hasZ: header.hasZ,
        onsiteXX: onsite,
        elapsedMs: Math.round(performance.now() - t0),
        nLines: out.length,
      },
    };
  }

  function generateSyntheticFc2({ nat = 2, dims = [2, 2, 2], kOnsite = 8.0, kOff = -1.0, seed = 42 }) {
    // Build Hermitian real-space IFCs that satisfy ASR by construction, then unfold to FC2.
    // Atom order: basis-outer (s*ncell + l0 + n1*l1 + n1*n2*l2).
    const [n1, n2, n3] = dims;
    const ncell = n1 * n2 * n3;
    const N = nat * ncell;
    let st = seed >>> 0;
    const rnd = () => {
      st = (st * 1664525 + 1013904223) >>> 0;
      return st / 4294967296 - 0.5;
    };

    const Phi = [];
    for (let a = 0; a < 3; a++) {
      Phi[a] = [];
      for (let b = 0; b < 3; b++) {
        Phi[a][b] = [];
        for (let s = 0; s < nat; s++) {
          Phi[a][b][s] = [];
          for (let sp = 0; sp < nat; sp++) {
            Phi[a][b][s][sp] = new Float64Array(ncell);
          }
        }
      }
    }

    const cellOf = (l0, l1, l2) => l0 + n1 * l1 + n1 * n2 * l2;
    const negMod = (x, n) => (n - x) % n;
    const isHome = (l0, l1, l2) => l0 === 0 && l1 === 0 && l2 === 0;

    // Random Hermitian part on ALL bonds except on-site diagonal (s,s,R=0)
    for (let a = 0; a < 3; a++) {
      for (let b = a; b < 3; b++) {
        for (let s = 0; s < nat; s++) {
          for (let sp = 0; sp < nat; sp++) {
            for (let l0 = 0; l0 < n1; l0++) {
              for (let l1 = 0; l1 < n2; l1++) {
                for (let l2 = 0; l2 < n3; l2++) {
                  if (s === sp && isHome(l0, l1, l2)) continue;
                  const c = cellOf(l0, l1, l2);
                  const cn = cellOf(negMod(l0, n1), negMod(l1, n2), negMod(l2, n3));
                  // skip if we already wrote the pair (visit each unordered pair once)
                  const v = kOff * (0.3 + 0.7 * rnd()) * (s === sp ? 1 : 0.55);
                  // isotropic + small anisotropy
                  const aniso = a === b ? 1.0 : 0.15 * rnd();
                  const val = v * aniso;
                  Phi[a][b][s][sp][c] = val;
                  Phi[b][a][sp][s][cn] = val;
                }
              }
            }
          }
        }
      }
    }

    // On-site: start from kOnsite, then subtract ASR residual from Phi(s,s,R=0)
    for (let s = 0; s < nat; s++) {
      for (let a = 0; a < 3; a++) {
        Phi[a][a][s][s][0] += kOnsite * (1 + 0.02 * rnd());
      }
    }
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        for (let s = 0; s < nat; s++) {
          let tot = 0;
          for (let sp = 0; sp < nat; sp++) {
            const arr = Phi[a][b][s][sp];
            for (let c = 0; c < ncell; c++) tot += arr[c];
          }
          Phi[a][b][s][s][0] -= tot;
        }
      }
    }
    // Re-symmetrize on-site (ASR residual may have broken Herm on the diagonal block)
    for (let a = 0; a < 3; a++) {
      for (let b = a; b < 3; b++) {
        for (let s = 0; s < nat; s++) {
          const v = 0.5 * (Phi[a][b][s][s][0] + Phi[b][a][s][s][0]);
          Phi[a][b][s][s][0] = v;
          Phi[b][a][s][s][0] = v;
        }
      }
    }
    // One more ASR pass (Herm-preserving by applying equal correction to both (a,b) and (b,a))
    for (let s = 0; s < nat; s++) {
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          let tot = 0;
          for (let sp = 0; sp < nat; sp++) {
            const arr = Phi[a][b][s][sp];
            for (let c = 0; c < ncell; c++) tot += arr[c];
          }
          Phi[a][b][s][s][0] -= tot;
          // keep Herm on-site
          Phi[b][a][s][s][0] = Phi[a][b][s][s][0];
        }
      }
    }

    // Unfold to supercell FC2 (basis-outer)
    const idx = (l0, l1, l2, s) => s * ncell + cellOf(l0, l1, l2) + 1;
    const H = new Float64Array(N * 3 * N * 3);
    for (let s = 0; s < nat; s++) {
      const ia = idx(0, 0, 0, s);
      for (let sp = 0; sp < nat; sp++) {
        for (let l0 = 0; l0 < n1; l0++) {
          for (let l1 = 0; l1 < n2; l1++) {
            for (let l2 = 0; l2 < n3; l2++) {
              const jb = idx(l0, l1, l2, sp);
              const cell = cellOf(l0, l1, l2);
              for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                  H[((ia - 1) * 3 + a) * N * 3 + ((jb - 1) * 3 + b)] = Phi[a][b][s][sp][cell];
                }
              }
            }
          }
        }
      }
    }

    const lines = [`${N}  ${N}`];
    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= N; j++) {
        lines.push(`${i} ${j}`);
        for (let a = 0; a < 3; a++) {
          const row = [0, 1, 2].map(
            (b) => H[((i - 1) * 3 + a) * N * 3 + ((j - 1) * 3 + b)]
          );
          lines.push(row.map((x) => x.toFixed(15).padStart(22)).join(""));
        }
      }
    }
    return { text: lines.join("\n") + "\n", n: N, nat, dims };
  }

  const SAMPLE_HEADER = [
    "2    4   4  6.0901580  0.0000000  1.6289100  0.0000000  0.0000000  0.0000000",
    "           1  'Ga '    63548.6269622649",
    "           2  'N  '    12766.3260799500",
    "    1    2     -0.0000000050      0.5773502721      0.6122393531",
    "    2    1      0.5000000050      0.2886751317      0.8130568969",
    "    3    2      0.5000000050      0.2886751317      1.4266943531",
    "    4    1     -0.0000000050      0.5773502721      1.6275118969",
    " T",
    "          6.435147750739          0.000000000000          0.000000000000",
    "          0.000000000000          6.435147750739          0.000000000000",
    "          0.000000000000          0.000000000000          6.293269609498",
    "    1",
    "     -2.6760895      0.0000000      0.0000000",
    "      0.0000000     -2.6760895      0.0000000",
    "      0.0000000      0.0000000     -2.7876465",
    "    2",
    "      2.6760895      0.0000000      0.0000000",
    "      0.0000000      2.6760895      0.0000000",
    "      0.0000000      0.0000000      2.7876465",
    "    3",
    "     -2.6760895      0.0000000      0.0000000",
    "      0.0000000     -2.6760895      0.0000000",
    "      0.0000000      0.0000000     -2.7876465",
    "    4",
    "      2.6760895      0.0000000      0.0000000",
    "      0.0000000      2.6760895      0.0000000",
    "      0.0000000      0.0000000      2.7876465",
  ].join("\n") + "\n";

  // Minimal ifc2 header for synthetic 2-atom cubic cell
  const SAMPLE_HEADER_2ATOM = [
    "2    2   1  5.6700000  0.0000000  1.0000000  0.0000000  0.0000000  0.0000000",
    "           1  'A '    40.0000000000",
    "           2  'B '    20.0000000000",
    "    1    1      0.0000000000      0.0000000000      0.0000000000",
    "    2    1      0.5000000000      0.5000000000      0.5000000000",
    " F",
    "          3.000000000000          0.000000000000          0.000000000000",
    "          0.000000000000          3.000000000000          0.000000000000",
    "          0.000000000000          0.000000000000          3.000000000000",
  ].join("\n") + "\n";

  const api = {
    EV_PER_RY,
    ANG_PER_BOHR,
    FC_EV_A2_TO_RY_BOHR2,
    parseIfc2Header,
    parseFc2,
    factorize,
    convert,
    generateSyntheticFc2,
    SAMPLE_HEADER,
    SAMPLE_HEADER_2ATOM,
    CONVENTIONS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.Fc2Ifc2 = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
