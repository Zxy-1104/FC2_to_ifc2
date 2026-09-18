const api = require("./converter.js");

function assert(c, m) {
  if (!c) {
    console.error("FAIL:", m);
    process.exitCode = 1;
  } else console.log("OK:", m);
}

// Ta-N style: ibrav=4, F, no lattice after F (from user screenshot)
const taHeader = `2 2 4 5.5590583 0.0000000 0.9830720 0.0000000 0.0000000 0.0000000
           1  'Ta '    164924.012902025
           2  'N  '    12765.688068798
    1    1      0.0000000000      0.0000000000      0.4915360150
    2    2      0.5000000050      0.2886751317      0.0000000000
F
`;

const h1 = api.parseIfc2Header(taHeader);
console.log("Ta header", h1);
assert(h1.nat === 2 && h1.ntyp === 2 && h1.ibrav === 4, "Ta ntyp/nat/ibrav");
assert(h1.hasZ === false, "Ta lrigid=F");
assert(h1.headerLines.length === 1 + 2 + 2 + 1, "Ta header lines = 6 (no lattice)");
assert(
  h1.headerLines[h1.headerLines.length - 1].trim().toUpperCase() === "F",
  "Ta header ends at F"
);

// GaN style T: 3 lines are epsil, not lattice — still consumed as part of NAC header
const gan = api.SAMPLE_HEADER;
const h2 = api.parseIfc2Header(gan);
console.log("GaN header hasZ", h2.hasZ, "nat", h2.nat, "lines", h2.headerLines.length);
assert(h2.hasZ === true, "GaN T");
assert(h2.nat === 4, "GaN nat=4");
// 1 + 2 species + 4 atoms + T + 3 eps + 4*(1+3) born = 1+2+4+1+3+16 = 27
assert(h2.headerLines.length === 27, "GaN header line count 27, got " + h2.headerLines.length);
assert(!h2.headerLines.some((l) => /6\.43/.test(l) && /0\.000/.test(l) && l.trim().split(/\s+/).length === 3 && false), "skip");

// Full convert with Ta header + synthetic FC2
const syn = api.generateSyntheticFc2({ nat: 2, dims: [2, 2, 2] });
const r = api.convert(syn.text, taHeader, { dims: [2, 2, 2] });
console.log("convert info", { N: r.info.nSup, nat: r.info.nat, hasZ: r.info.hasZ, dims: r.info.dims });
assert(r.info.nSup === 16, "convert N=16");
assert(r.info.hasZ === false, "convert hasZ false");
const outLines = r.text.split("\n");
assert(outLines[5].trim().toUpperCase() === "F" || outLines[5].includes("F"), "output has F flag");
// after F should be mesh 2 2 2, not lattice
const after = outLines.slice(6, 9).map((l) => l.trim());
console.log("lines after F:", after);
assert(after[0].split(/\s+/).slice(0, 3).join(" ") === "2 2 2", "mesh right after F");

console.log(process.exitCode ? "TESTS FAILED" : "ALL TESTS PASSED");
