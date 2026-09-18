# FC2_to_ifc2

[English](README.md) | [简体中文](README.zh-CN.md)

Browser tool that converts **phonopy / finite-difference FC2** (`FORCE_CONSTANTS`, `FORCE_CONSTANTS_2ND`) into **Quantum ESPRESSO ifc2** real-space force constants (`.fc` / q2r format).

## Features

- **FC2 input**: file upload only (large matrices; no paste)
- **ifc2 header**: paste QE header (species, positions, `lrigid` flag, ε∞, Born charges)
- Unit conversion: **eV/Å² → Ry/bohr²** (CODATA)
- Supercell factorization: `N / nat → n1×n2×n3` (editable)
- Atom-order auto-detect via **Hermiticity** \(\Phi_{\alpha\beta}(\kappa,\kappa';R)=\Phi_{\beta\alpha}(\kappa',\kappa;-R)\)
- Optional **ASR** correction on diagonal blocks
- Download converted ifc2; local-only (no server upload)

## Files

| File | Role |
|------|------|
| `index.html` | UI + physics notes |
| `styles.css` | Layout |
| `converter.js` | Conversion core |
| `app.js` | File/header wiring |
| `samples/` | Tiny FC2 + header examples |

## Usage

1. Open `index.html` in a modern browser (double-click or drag into the browser).
2. Upload a phonopy **FC2** text file.
3. Paste the **ifc2 header** (everything before `n1 n2 n3` and force-constant blocks).
4. Set supercell dims if auto-detect is wrong (e.g. `4 4 4`).
5. Click **Convert**, then **Download**.

You can load the bundled synthetic sample (2-atom × 2×2×2) from the page for a quick demo.

## Conversion logic (short)

Supercell FC \(\Phi_{\alpha\beta}(I,J)\) is reduced to primitive IFCs by mapping each atom to \((\kappa,R)\):

\[
\Phi_{\alpha\beta}(\kappa,\kappa';R)
=
\Phi^{\rm sc}\big((0\kappa),(R\kappa')\big)
\times
\frac{(1/13.60569)}{(1/0.529177)^2}
\]

Masses are **not** folded into \(\Phi\); they enter only when building \(D(q)\) (phonopy / matdyn). Born charges in the header are **passthrough** for matdyn NAC — this tool does not invent Z* / ε.

## ifc2 layout (output)

```
ntyp  nat  ibrav  celldm(1:6)
species lines
atom lines
T/F          (lrigid)
ε∞ 3×3       (only if T)   # dielectric, not lattice
Z* blocks    (only if T)
n1 n2 n3
α β κ κ'
R1 R2 R3  value
```

When `ibrav ≠ 0`, **no lattice-vector lines** are required — the cell comes from `celldm`. With `F`, the header ends at the `F` line (next is `n1 n2 n3` in a full file).

## Notes

- Fair MACE vs phonopy comparison **without** LO–TO: use header `F` (no Born) or disable NAC in matdyn (`loto_disable`) consistently.
- LO–TO at Γ needs a header with `T` + Z* + ε; that is hybrid (short-range + DFT long-range) if FC2 came from MACE.

中文说明见 [README.zh-CN.md](README.zh-CN.md)。
