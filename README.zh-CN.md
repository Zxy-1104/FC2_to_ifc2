# FC2_to_ifc2

[English](README.md) | [简体中文](README.zh-CN.md)

将 **phonopy / 有限差分 FC2**（`FORCE_CONSTANTS`、`FORCE_CONSTANTS_2ND`）转换为 **Quantum ESPRESSO ifc2** 实空间二阶力常数（`.fc` / q2r 格式）的浏览器工具。

## 功能

- **FC2 输入**：仅支持**文件上传**（数据量大，不支持粘贴）
- **ifc2 表头**：粘贴 QE 表头（物种、位置、`lrigid` 标志、ε∞、Born 有效电荷等）
- 单位换算：**eV/Å² → Ry/bohr²**（CODATA）
- 超胞自动分解：`N / nat → n1×n2×n3`（可手动指定）
- 用 **Hermiticity** 自动识别超胞原子排序  
  \(\Phi_{\alpha\beta}(\kappa,\kappa';R)=\Phi_{\beta\alpha}(\kappa',\kappa;-R)\)
- 可选对角块 **ASR** 修正
- 下载转换后的 ifc2；**纯本地计算**，不上传服务器

## 目录结构

| 文件 | 作用 |
|------|------|
| `index.html` | 页面入口（含物理说明） |
| `styles.css` | 样式 |
| `converter.js` | 转换核心 |
| `app.js` | 文件/表头交互 |
| `samples/` | 合成小体系 FC2 与表头示例 |

## 使用方法

1. 用现代浏览器打开 `index.html`（双击或拖入浏览器均可）。
2. 上传 phonopy **FC2** 文本文件。
3. 粘贴 **ifc2 表头**（`n1 n2 n3` 网格行与力常数块之前的部分）。
4. 若自动识别的超胞尺寸不对，请手动填写（例如 `4 4 4`）。
5. 点击**执行转换**，再**下载**结果。

页面提供「载入合成样例」（2 原子 × 2×2×2），便于快速试用。

## 转换逻辑（摘要）

将超胞力常数 \(\Phi_{\alpha\beta}(I,J)\) 按 \((\kappa,R)\) 约化到原胞：

\[
\Phi_{\alpha\beta}(\kappa,\kappa';R)
=
\Phi^{\rm sc}\big((0\kappa),(R\kappa')\big)
\times
\frac{(1/13.60569)}{(1/0.529177)^2}
\]

\(\Phi\) **不含质量**；质量在 phonopy / matdyn 构造 \(D(q)\) 时才引入。表头中的 Born / ε 为**原样透传**，供 matdyn 做 NAC，本工具**不生成** Z\* / ε。

## ifc2 输出结构

```
ntyp  nat  ibrav  celldm(1:6)
物种行
原子行
T/F              # lrigid
ε∞ 3×3           # 仅当 T；是介电张量，不是晶格
Z* 块            # 仅当 T
n1 n2 n3
α β κ κ'
R1 R2 R3  value
```

`ibrav ≠ 0` 时**不要求**粘贴三行晶格矢量（晶格由 `celldm` 决定）。  
`F` 时表头到 `F` 行结束（完整文件中下一行即为 `n1 n2 n3`）。

## 使用注意

- 与 phonopy **无 LO–TO** 结果对比时：表头用 **F**，或 matdyn 侧统一 `loto_disable`。
- Γ 点 **LO–TO** 需要表头 **T + Z\* + ε**；若短程来自 MACE，则属于「MACE 短程 + DFT 长程」的混合方案。

## 许可

未指定开源协议（默认学术/个人使用）。若公开分发，请自行补充 License。
