(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const logEl = $("log");
  let fc2Text = null;
  let lastResult = null;
  let fc2MetaInfo = null;

  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function logClear(msg) {
    logEl.innerHTML = "";
    if (msg) log(msg);
  }

  function setKpi(id, value, cls) {
    const el = $(id);
    el.textContent = value;
    el.className = "v" + (cls ? " " + cls : "");
  }

  function resetKpis() {
    ["kpiN", "kpiNat", "kpiDims", "kpiConv", "kpiHerm", "kpiAsr", "kpiLines", "kpiTime"].forEach((id) =>
      setKpi(id, "—")
    );
  }

  function updateConvertEnabled() {
    const ready = !!fc2Text && $("headerInput").value.trim().length > 0;
    $("btnConvert").disabled = !ready;
  }

  function previewFc2(text, name, n, blockCount) {
    const lines = text.split(/\r?\n/);
    const head = lines.slice(0, 12).join("\n");
    $("fc2Meta").value =
      `文件: ${name}\n` +
      `原子数 N = ${n}\n` +
      `力常数块 = ${blockCount} (期望 ${n * n})\n` +
      `总行数 = ${lines.length}\n` +
      `单位假设: eV/Å²\n` +
      `---- 前 12 行 ----\n` + head;
  }

  function onFc2File(file) {
    if (!file) return;
    log(`读取 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)…`);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        fc2Text = String(reader.result);
        const parsed = Fc2Ifc2.parseFc2(fc2Text);
        fc2MetaInfo = parsed;
        $("fc2FileName").textContent = file.name;
        previewFc2(fc2Text, file.name, parsed.n, parsed.fc.size);
        log(`FC2 解析成功：N=${parsed.n}，块=${parsed.fc.size}`, "ok");
        // try auto header nat hint
        updateConvertEnabled();
      } catch (e) {
        fc2Text = null;
        $("fc2FileName").textContent = "解析失败";
        $("fc2Meta").value = String(e.message || e);
        log("FC2 解析失败: " + (e.message || e), "err");
        updateConvertEnabled();
      }
    };
    reader.onerror = () => {
      log("文件读取失败", "err");
    };
    reader.readAsText(file);
  }

  function parseDims() {
    const raw = $("dimsInput").value.trim();
    if (!raw) return null;
    const parts = raw.split(/[\s,，xX×]+/).filter(Boolean).map(Number);
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x) || x < 1)) {
      throw new Error("超胞尺寸应为三个正整数，例如 4 4 4");
    }
    return parts.map((x) => Math.round(x));
  }

  function doConvert() {
    if (!fc2Text) {
      log("请先上传 FC2 文件", "err");
      return;
    }
    const headerText = $("headerInput").value;
    if (!headerText.trim()) {
      log("请粘贴 ifc2 表头", "err");
      return;
    }
    logClear("开始转换…");
    resetKpis();
    $("btnConvert").disabled = true;
    $("btnDownload").disabled = true;

    // defer so UI updates
    setTimeout(() => {
      try {
        const dims = parseDims();
        const unitFactor = Number($("unitFactor").value);
        if (!Number.isFinite(unitFactor) || unitFactor <= 0) {
          throw new Error("单位因子无效");
        }
        const result = Fc2Ifc2.convert(fc2Text, headerText, {
          dims,
          convention: $("convSelect").value,
          unitFactor,
          enforceAsr: $("asrCheck").checked,
        });
        lastResult = result;
        const info = result.info;

        setKpi("kpiN", String(info.nSup));
        setKpi("kpiNat", String(info.nat));
        setKpi("kpiDims", info.dims.join("×"));
        setKpi("kpiConv", info.convention);
        setKpi(
          "kpiHerm",
          info.hermiticityError.toExponential(3),
          info.hermiticityError < 1e-8 ? "ok" : info.hermiticityError < 1e-4 ? "warn" : "err"
        );
        setKpi(
          "kpiAsr",
          info.maxAsr.toExponential(3),
          info.maxAsr < 1e-8 ? "ok" : info.maxAsr < 1e-3 ? "warn" : "err"
        );
        setKpi("kpiLines", String(info.nLines));
        setKpi("kpiTime", info.elapsedMs + " ms");

        log(
          `转换完成：nat=${info.nat}, 超胞=${info.dims.join("×")}, 排序=${info.convention}`,
          "ok"
        );
        log(
          `Hermiticity=${info.hermiticityError.toExponential(3)} | max|ASR|=${info.maxAsr.toExponential(3)} | Φxx(κ=1,R=0)=${info.onsiteXX.toExponential(6)} Ry/bohr²`,
          info.hermiticityError < 1e-8 ? "ok" : "warn"
        );
        if (info.conventionErrors) {
          for (const [k, v] of Object.entries(info.conventionErrors)) {
            log(`  排序候选 ${k}: Herm err = ${v.toExponential(3)}`);
          }
        }

        const previewLines = result.text.split("\n").slice(0, 40).join("\n");
        $("outputPreview").value =
          previewLines + `\n\n…（共 ${info.nLines} 行，完整内容请下载）`;
        $("btnDownload").disabled = false;
      } catch (e) {
        log("转换失败: " + (e.message || e), "err");
        console.error(e);
      } finally {
        $("btnConvert").disabled = false;
        updateConvertEnabled();
      }
    }, 30);
  }

  function download() {
    if (!lastResult) return;
    const blob = new Blob([lastResult.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "FORCE_CONSTANTS_ifc2.fc";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log("已触发下载 FORCE_CONSTANTS_ifc2.fc", "ok");
  }

  function loadSynthetic() {
    const syn = Fc2Ifc2.generateSyntheticFc2({ nat: 2, dims: [2, 2, 2], kOnsite: 8, kOff: -1 });
    fc2Text = syn.text;
    $("fc2FileName").textContent = "synthetic_2atom_2x2x2.fc2";
    const parsed = Fc2Ifc2.parseFc2(fc2Text);
    previewFc2(fc2Text, "synthetic_2atom_2x2x2.fc2", parsed.n, parsed.fc.size);
    $("headerInput").value = Fc2Ifc2.SAMPLE_HEADER_2ATOM;
    $("dimsInput").value = "2 2 2";
    logClear("已载入合成样例：2 原子原胞 × 2×2×2 超胞（N=16）", "ok");
    log("表头已填入立方 2 原子示例。点「执行转换」。");
    updateConvertEnabled();
  }

  function loadGanHeader() {
    $("headerInput").value = Fc2Ifc2.SAMPLE_HEADER;
    logClear("已载入 GaN wurtzite ifc2 表头样例（nat=4, ibrav=4）");
    if (!fc2Text) {
      log("请再上传匹配的 FC2 文件（例如 4×4×4 超胞，N=256）");
    }
    updateConvertEnabled();
  }

  function clearAll() {
    fc2Text = null;
    lastResult = null;
    fc2MetaInfo = null;
    $("fc2File").value = "";
    $("fc2FileName").textContent = "未选择";
    $("fc2Meta").value = "";
    $("headerInput").value = "";
    $("dimsInput").value = "";
    $("outputPreview").value = "";
    $("btnDownload").disabled = true;
    resetKpis();
    logClear("已清空");
    updateConvertEnabled();
  }

  $("fc2File").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    onFc2File(f);
  });
  $("headerInput").addEventListener("input", updateConvertEnabled);
  $("btnConvert").addEventListener("click", doConvert);
  $("btnDownload").addEventListener("click", download);
  $("btnLoadSample").addEventListener("click", loadSynthetic);
  $("btnLoadSampleGaN").addEventListener("click", loadGanHeader);
  $("btnClear").addEventListener("click", clearAll);

  resetKpis();
  log("就绪：上传 FC2 + 粘贴 ifc2 表头，或先点「载入合成样例」。");
})();
